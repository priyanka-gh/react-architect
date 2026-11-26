import * as path from "node:path";
import * as vscode from "vscode";
import {
  applyConflictChoice,
  findConflicts,
  isBlocking,
  type Conflict,
} from "../core/conflicts";
import { getGenerator, type GeneratorId } from "../core/generators";
import { enclosingFeature } from "../core/generators/featureIndex";
import { findManifest, findNearestFile } from "../core/manifest/find";
import { inferManifest } from "../core/manifest/infer";
import {
  MANIFEST_FILE_NAME,
  parseManifest,
  serializeManifest,
  type Manifest,
} from "../core/manifest/schema";
import { parseName } from "../core/naming";
import { normalizeRelativePath } from "../core/paths";
import { checkPlan, type FileOperation, type FilePlan } from "../core/plan";
import {
  fileExists,
  readDirectory,
  readTextFile,
  readTextFileIfExists,
} from "../infra/fileSystem";
import { writePlanInWorkspace } from "../infra/workspaceEditWriter";
import { vscodePrompts, type Prompts } from "./prompts";

export type GenerationOutcome =
  | { status: "generated"; root: string; files: string[]; mainFile: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

const cancelled: GenerationOutcome = { status: "cancelled" };

/**
 * The Generate Component / Hook / Feature commands. Collects the input, builds
 * the plan, checks it against the disk, asks before writing, then writes it as
 * one undoable edit. See ADR 4 and ADR 9.
 *
 * `clickedFolder` is set when the command runs from the Explorer menu.
 */
export async function generateArtifact(
  generatorId: GeneratorId,
  clickedFolder: vscode.Uri | undefined,
  prompts: Prompts = vscodePrompts,
): Promise<GenerationOutcome> {
  const generator = getGenerator(generatorId);
  const fail = (message: string): GenerationOutcome => {
    prompts.showError(message);
    return { status: "failed", message };
  };

  // 1. Which project?
  const start = await startFolder(clickedFolder, prompts);
  if (start === undefined) {
    return vscode.workspace.workspaceFolders?.length
      ? cancelled
      : fail(
          "Open a folder first: React Architect generates code inside a project.",
        );
  }
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(start)?.uri.fsPath;
  if (workspaceFolder === undefined) {
    return fail(`${start.fsPath} isn't inside an open workspace folder.`);
  }

  const project = await loadProject(start.fsPath, workspaceFolder, prompts);
  if (project.status !== "loaded") {
    return project.status === "failed" ? fail(project.message) : cancelled;
  }
  const { root, manifest, extraOperations } = project;

  // 2. Where in the project?
  let directory = generator.defaultDirectory(manifest);
  if (clickedFolder !== undefined) {
    const relative = normalizeRelativePath(
      path.relative(root, clickedFolder.fsPath).split(path.sep).join("/") ||
        ".",
    );
    if (!relative.ok) {
      return fail(
        `Can't generate into ${clickedFolder.fsPath}: the path ${relative.reason}.`,
      );
    }
    directory = relative.path;
  }

  // 3. What should it be called, and what should it include?
  const rawName = await prompts.askName({
    title: `Generate ${generator.label}`,
    placeholder: generator.namePlaceholder,
    validate: (value) => {
      const result = parseName(value);
      return result.ok ? undefined : result.error;
    },
  });
  if (rawName === undefined) {
    return cancelled;
  }
  const parsed = parseName(rawName);
  if (!parsed.ok) {
    return fail(parsed.error);
  }
  const name = parsed.name;
  const displayName = generator.displayName(name);

  let includeTests = false;
  if (manifest.testing.framework !== "none") {
    const answer = await prompts.askYesNo(
      `Include a test for ${displayName}?`,
      manifest.testing.generateTests,
    );
    if (answer === undefined) {
      return cancelled;
    }
    includeTests = answer;
  }

  let exportFromFeature = false;
  const feature = generator.canExportFromFeature
    ? enclosingFeature(directory, manifest)
    : undefined;
  if (feature !== undefined) {
    const answer = await prompts.askYesNo(
      `Export ${displayName} from the "${path.posix.basename(feature)}" feature's public API (index.ts)?`,
      false,
    );
    if (answer === undefined) {
      return cancelled;
    }
    exportFromFeature = answer;
  }

  // 4. Build and check the plan.
  const generated = generator.generate(
    { name, directory, includeTests, exportFromFeature },
    manifest,
  );
  let plan: FilePlan = {
    root,
    operations: [...extraOperations, ...generated.operations],
  };

  const problems = checkPlan(plan);
  if (problems.length > 0) {
    return fail(`Can't generate ${displayName}: ${problems.join(" ")}`);
  }

  const conflicts = await findConflicts(plan, readDirectory);
  const blocking = conflicts.filter(isBlocking);
  if (blocking.length > 0) {
    return fail(
      `Can't generate ${displayName}: ${blocking.map(describeBlockingConflict).join(" ")}`,
    );
  }
  const replaced = new Set<string>();
  if (conflicts.length > 0) {
    const choice = await prompts.askConflictChoice(
      conflicts.map((c) => c.path),
    );
    if (choice === undefined) {
      return cancelled;
    }
    plan = applyConflictChoice(plan, conflicts, choice);
    if (choice === "overwrite") {
      conflicts.forEach((conflict) => replaced.add(conflict.path));
    }
  }
  if (plan.operations.length === 0) {
    prompts.showWarning(
      `Nothing to generate: every file for ${displayName} already exists.`,
    );
    return cancelled;
  }

  // 5. Preview, then write.
  const confirmed = await prompts.confirmPlan(
    `Generate ${generator.label.toLowerCase()} ${displayName}?`,
    plan.operations.map((operation) => describeOperation(operation, replaced)),
  );
  if (!confirmed) {
    return cancelled;
  }

  if (!(await writePlanInWorkspace(plan))) {
    return fail("VS Code couldn't write the files, so nothing was changed.");
  }

  const mainFile = vscode.Uri.joinPath(
    vscode.Uri.file(root),
    ...generated.mainFile.split("/"),
  );
  await vscode.window.showTextDocument(mainFile);

  return {
    status: "generated",
    root,
    files: plan.operations.map((operation) => operation.path),
    mainFile: generated.mainFile,
  };
}

/** The clicked folder, else the active file's folder, else a workspace folder. */
export async function startFolder(
  clickedFolder: vscode.Uri | undefined,
  prompts: Prompts,
): Promise<vscode.Uri | undefined> {
  if (clickedFolder !== undefined) {
    return clickedFolder;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (
    active?.scheme === "file" &&
    vscode.workspace.getWorkspaceFolder(active)
  ) {
    return vscode.Uri.joinPath(active, "..");
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) {
    return folders[0]?.uri;
  }
  return (await prompts.pickWorkspaceFolder())?.uri;
}

export type LoadedProject =
  | {
      status: "loaded";
      root: string;
      manifest: Manifest;
      /** Creates react-architect.json when the project didn't have one. */
      extraOperations: FileOperation[];
    }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/**
 * Finds the project's manifest. Without one, suggests settings based on the
 * project and offers to create it next to package.json (ADR 1).
 */
export async function loadProject(
  start: string,
  workspaceFolder: string,
  prompts: Prompts,
): Promise<LoadedProject> {
  const manifestPath = await findManifest(start, workspaceFolder, fileExists);
  if (manifestPath !== undefined) {
    const result = parseManifest(await readTextFile(manifestPath));
    if (!result.ok) {
      return {
        status: "failed",
        message: `${manifestPath} has problems: ${result.errors.join(" ")}`,
      };
    }
    if (result.warnings.length > 0) {
      prompts.showWarning(`${manifestPath}: ${result.warnings.join(" ")}`);
    }
    return {
      status: "loaded",
      root: path.dirname(manifestPath),
      manifest: result.manifest,
      extraOperations: [],
    };
  }

  const packageJson = await findNearestFile(
    "package.json",
    start,
    workspaceFolder,
    fileExists,
  );
  if (packageJson === undefined) {
    return {
      status: "failed",
      message: `No package.json found in ${start} or the folders above it. React Architect works inside a React project.`,
    };
  }
  const root = path.dirname(packageJson);
  const { manifest, notes } = await inferManifest(root, {
    readDirectory,
    readText: readTextFileIfExists,
  });
  if (!(await prompts.confirmCreateManifest(path.basename(root), notes))) {
    return { status: "cancelled" };
  }
  return {
    status: "loaded",
    root,
    manifest,
    extraOperations: [
      {
        kind: "create",
        path: MANIFEST_FILE_NAME,
        content: serializeManifest(manifest),
      },
    ],
  };
}

function describeOperation(
  operation: FileOperation,
  replaced: Set<string>,
): string {
  if (operation.kind === "ensureLine") {
    return `Update  ${operation.path}`;
  }
  return replaced.has(operation.path)
    ? `Replace  ${operation.path}`
    : `New  ${operation.path}`;
}

function describeBlockingConflict(conflict: Conflict): string {
  switch (conflict.kind) {
    case "letterCase":
      return `"${conflict.existingPath}" already exists with different capital letters from "${conflict.path}". Rename one of them first.`;
    case "fileFolderClash":
      return `"${conflict.existingPath}" is in the way of "${conflict.path}" (one is a file, the other a folder).`;
    case "exists":
      return `"${conflict.path}" already exists.`;
  }
}
