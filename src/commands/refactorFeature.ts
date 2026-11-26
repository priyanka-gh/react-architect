import * as path from "node:path";
import * as vscode from "vscode";
import { areaOf } from "../core/architecture/modules";
import {
  planFeatureRename,
  planMovePath,
  planMoveToShared,
  type ProjectSources,
  type RefactorPlan,
} from "../core/architecture/refactor";
import { parseName } from "../core/naming";
import { isInsideDirectory } from "../core/paths";
import { readDirectory } from "../infra/fileSystem";
import {
  listFiles,
  listSourceFiles,
  readAliases,
  readFiles,
} from "../infra/projectFiles";
import { applyRefactorInWorkspace } from "../infra/workspaceEditWriter";
import { loadProject } from "./generateArtifact";
import { vscodePrompts, type Prompts } from "./prompts";

/** What Rename Feature and Move to Shared Components ask. */
export interface RefactorPrompts extends Prompts {
  pickFolder(title: string, folders: string[]): Promise<string | undefined>;
  /** Shows what will change; resolves true when the user picks `action`. */
  confirmRefactor(
    title: string,
    lines: string[],
    action: string,
  ): Promise<boolean>;
  saveFirst(dirtyFiles: string[]): Promise<boolean>;
  showInformation(message: string): void;
}

export const vscodeRefactorPrompts: RefactorPrompts = {
  ...vscodePrompts,

  async pickFolder(title, folders) {
    return vscode.window.showQuickPick(folders, {
      title,
      ignoreFocusOut: true,
    });
  },

  async confirmRefactor(title, lines, action) {
    const answer = await vscode.window.showInformationMessage(
      title,
      { modal: true, detail: lines.join("\n") },
      action,
    );
    return answer === action;
  },

  async saveFirst(dirtyFiles) {
    const save = "Save and Continue";
    const answer = await vscode.window.showWarningMessage(
      "Save your changes first?",
      {
        modal: true,
        detail: `These files have unsaved changes, and this changes files across the project:\n${dirtyFiles.join("\n")}`,
      },
      save,
    );
    return answer === save;
  },

  showInformation(message) {
    void vscode.window.showInformationMessage(message);
  },
};

export type RefactorOutcome =
  | { status: "done"; root: string; plan: RefactorPlan }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

type Kind = "rename" | "move";

/** Rename Feature (ADR 11). `target` is the clicked feature folder, if any. */
export function renameFeature(
  target: vscode.Uri | undefined,
  prompts: RefactorPrompts = vscodeRefactorPrompts,
): Promise<RefactorOutcome> {
  return refactor("rename", target, prompts);
}

/** Move to Shared Components (ADR 11). `target` is the clicked component folder. */
export function moveToShared(
  target: vscode.Uri | undefined,
  prompts: RefactorPrompts = vscodeRefactorPrompts,
): Promise<RefactorOutcome> {
  return refactor("move", target, prompts);
}

async function refactor(
  kind: Kind,
  target: vscode.Uri | undefined,
  prompts: RefactorPrompts,
): Promise<RefactorOutcome> {
  const fail = (message: string): RefactorOutcome => {
    prompts.showError(message);
    return { status: "failed", message };
  };
  const cancelled: RefactorOutcome = { status: "cancelled" };

  const start = target ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  const workspaceFolder =
    start && vscode.workspace.getWorkspaceFolder(start)?.uri.fsPath;
  if (start === undefined || workspaceFolder === undefined) {
    return fail("Open a React project first.");
  }
  const project = await loadProject(start.fsPath, workspaceFolder, prompts);
  if (project.status !== "loaded") {
    return project.status === "failed" ? fail(project.message) : cancelled;
  }
  if (project.extraOperations.length > 0) {
    return fail(
      "Set up this project first (React Architect: Set Up Existing Project), then try again.",
    );
  }
  const { root, manifest } = project;
  const relative = (uri: vscode.Uri) =>
    path.relative(root, uri.fsPath).split(path.sep).join("/");

  // 1. Which folder?
  let folder = target === undefined ? undefined : relative(target);
  const candidates =
    kind === "rename"
      ? await featureFolders(root, manifest.paths.features)
      : await componentFoldersInFeatures(root, manifest);
  if (folder === undefined) {
    if (candidates.length === 0) {
      return fail(
        kind === "rename"
          ? `There are no features in ${manifest.paths.features} yet.`
          : "No feature has components to move yet.",
      );
    }
    folder = await prompts.pickFolder(
      kind === "rename"
        ? "Rename which feature?"
        : "Move which component to shared components?",
      candidates,
    );
    if (folder === undefined) return cancelled;
  }
  if (!candidates.includes(folder)) {
    return fail(
      kind === "rename"
        ? `${folder} isn't a feature folder. Features are the folders directly inside ${manifest.paths.features}.`
        : `${folder} isn't a component folder inside a feature (such as ${manifest.paths.features}/cart/components/Price).`,
    );
  }

  // 2. Where to?
  const base = path.posix.basename(folder);
  let destination: string;
  const oldName = parseName(base);
  let newName = oldName;
  if (kind === "rename") {
    if (!oldName.ok) return fail(`Can't rename "${base}": ${oldName.error}`);
    const answer = await prompts.askName({
      title: `Rename Feature "${base}"`,
      placeholder: "The feature's new name, for example: account",
      validate: (value) => {
        const result = parseName(value);
        if (!result.ok) return result.error;
        return result.name.kebab === base
          ? "That's its current name."
          : undefined;
      },
    });
    if (answer === undefined) return cancelled;
    newName = parseName(answer);
    if (!newName.ok) return fail(newName.error);
    destination = path.posix.join(
      path.posix.dirname(folder),
      newName.name.kebab,
    );
  } else {
    destination = path.posix.join(manifest.paths.components, base);
  }
  const parent = await readDirectory(
    path.join(root, path.posix.dirname(destination)),
  );
  const clash = parent?.find(
    (entry) =>
      entry.name.toLowerCase() ===
      path.posix.basename(destination).toLowerCase(),
  );
  if (clash !== undefined) {
    return fail(
      `${path.posix.join(path.posix.dirname(destination), clash.name)} already exists.`,
    );
  }

  // 3. Everything must be saved: the plan is made from the files on disk.
  const dirty = vscode.workspace.textDocuments.filter(
    (document) =>
      document.isDirty && isInsideDirectory(document.uri.fsPath, root),
  );
  if (dirty.length > 0) {
    if (
      !(await prompts.saveFirst(
        dirty.map((document) => relative(document.uri)),
      ))
    ) {
      return cancelled;
    }
    for (const document of dirty) {
      if (!(await document.save()))
        return fail(`Couldn't save ${relative(document.uri)}.`);
    }
  }

  // 4. Work out every change.
  const sources = await readFiles(root, await listSourceFiles(root));
  const projectSources: ProjectSources = {
    sources,
    filesInFolder: await listFiles(root, path.join(root, folder)),
    manifest,
    aliases: await readAliases(root),
  };
  const plan =
    kind === "rename" && oldName.ok && newName.ok
      ? planFeatureRename(projectSources, folder, oldName.name, newName.name)
      : planMoveToShared(projectSources, folder, destination);

  // 5. Preview, then apply.
  const lines = previewLines(plan, folder, destination);
  const title =
    kind === "rename"
      ? `Rename feature "${base}" to "${path.posix.basename(destination)}"?`
      : `Move ${base} to ${manifest.paths.components}?`;
  const action = kind === "rename" ? "Rename" : "Move";
  if (!(await prompts.confirmRefactor(title, lines, action))) {
    return cancelled;
  }
  const applied = await applyRefactorInWorkspace(
    root,
    plan.changes,
    plan.renames,
    sources,
  );
  if (!applied) {
    return fail(
      "VS Code couldn't make the changes (a file may have changed meanwhile), so nothing was changed.",
    );
  }

  const files = plan.changes.size;
  prompts.showInformation(
    kind === "rename"
      ? `Renamed "${base}" to "${path.posix.basename(destination)}" and updated ${files} ${files === 1 ? "file" : "files"}. Edit > Undo reverts it.`
      : `Moved ${base} to ${destination} and updated ${files} ${files === 1 ? "file" : "files"}. Edit > Undo reverts it.`,
  );
  return { status: "done", root, plan };
}

function previewLines(
  plan: RefactorPlan,
  folder: string,
  destination: string,
): string[] {
  const lines = [`Move  ${folder}  →  ${destination}`];
  const fileRenames = plan.renames.filter((rename) => rename.from !== folder);
  for (const rename of fileRenames) {
    lines.push(
      `Rename  ${path.posix.relative(folder, rename.from)}  →  ${path.posix.basename(rename.to)}`,
    );
  }
  if (plan.renamedNames.size > 0) {
    lines.push(
      "",
      "Rename in code: " +
        [...plan.renamedNames]
          .map(([from, to]) => `${from} → ${to}`)
          .join(", "),
    );
  }
  if (plan.updatedImporters.length > 0) {
    lines.push(
      "",
      `Update imports in ${plan.updatedImporters.length} other ${plan.updatedImporters.length === 1 ? "file" : "files"}:`,
    );
    lines.push(
      ...plan.updatedImporters.slice(0, 15).map((file) => `  ${file}`),
    );
    if (plan.updatedImporters.length > 15) {
      lines.push(`  …and ${plan.updatedImporters.length - 15} more`);
    }
  }
  if (plan.warnings.length > 0) {
    lines.push(
      "",
      "Warnings:",
      ...plan.warnings.map((warning) => `  ${warning}`),
    );
  }
  lines.push("", "Text in strings, comments and stylesheets isn't changed.");
  return lines;
}

async function featureFolders(
  root: string,
  featuresPath: string,
): Promise<string[]> {
  const entries = (await readDirectory(path.join(root, featuresPath))) ?? [];
  return entries
    .filter((entry) => entry.isDirectory && !entry.name.startsWith("."))
    .map((entry) => path.posix.join(featuresPath, entry.name))
    .sort();
}

async function componentFoldersInFeatures(
  root: string,
  manifest: ProjectSources["manifest"],
): Promise<string[]> {
  const folders: string[] = [];
  for (const feature of await featureFolders(root, manifest.paths.features)) {
    const entries =
      (await readDirectory(path.join(root, feature, "components"))) ?? [];
    for (const entry of entries) {
      const folder = `${feature}/components/${entry.name}`;
      if (entry.isDirectory && areaOf(folder, manifest).kind === "feature") {
        folders.push(folder);
      }
    }
  }
  return folders.sort();
}

/**
 * Moves or renames one file to `destination` (project-relative), updating
 * every import: the placement and naming quick fixes
 * (plans/custom-structure.md, Phase 4).
 */
export async function movePath(
  source: vscode.Uri,
  destination: string,
  prompts: RefactorPrompts = vscodeRefactorPrompts,
): Promise<RefactorOutcome> {
  const fail = (message: string): RefactorOutcome => {
    prompts.showError(message);
    return { status: "failed", message };
  };
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(source)?.uri.fsPath;
  if (workspaceFolder === undefined)
    return fail(`${source.fsPath} isn't in an open workspace folder.`);
  const project = await loadProject(
    path.dirname(source.fsPath),
    workspaceFolder,
    prompts,
  );
  if (project.status !== "loaded") {
    return project.status === "failed"
      ? fail(project.message)
      : { status: "cancelled" };
  }
  const { root, manifest } = project;
  const from = path.relative(root, source.fsPath).split(path.sep).join("/");
  if (await exists(path.join(root, ...destination.split("/")))) {
    return fail(`${destination} already exists.`);
  }

  const dirty = vscode.workspace.textDocuments.filter(
    (document) =>
      document.isDirty && isInsideDirectory(document.uri.fsPath, root),
  );
  if (dirty.length > 0) {
    const relative = (uri: vscode.Uri) =>
      path.relative(root, uri.fsPath).split(path.sep).join("/");
    if (
      !(await prompts.saveFirst(
        dirty.map((document) => relative(document.uri)),
      ))
    ) {
      return { status: "cancelled" };
    }
    for (const document of dirty) await document.save();
  }

  const sources = await readFiles(root, await listSourceFiles(root));
  const plan = planMovePath(
    {
      sources,
      filesInFolder: [from],
      manifest,
      aliases: await readAliases(root),
    },
    from,
    destination,
  );
  const renaming = path.posix.dirname(from) === path.posix.dirname(destination);
  const lines = [
    `${renaming ? "Rename" : "Move"}  ${from}  →  ${destination}`,
    ...(plan.updatedImporters.length > 0
      ? [
          "",
          `Update imports in ${plan.updatedImporters.length} ${plan.updatedImporters.length === 1 ? "file" : "files"}:`,
          ...plan.updatedImporters.map((file) => `  ${file}`),
        ]
      : []),
  ];
  const action = renaming ? "Rename" : "Move";
  if (
    !(await prompts.confirmRefactor(
      `${action} ${path.posix.basename(from)}?`,
      lines,
      action,
    ))
  ) {
    return { status: "cancelled" };
  }
  if (
    !(await applyRefactorInWorkspace(root, plan.changes, plan.renames, sources))
  ) {
    return fail(
      "VS Code couldn't make the changes (a file may have changed meanwhile), so nothing was changed.",
    );
  }
  await vscode.window.showTextDocument(
    vscode.Uri.file(path.join(root, ...destination.split("/"))),
  );
  return { status: "done", root, plan };
}

async function exists(file: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(file));
    return true;
  } catch {
    return false;
  }
}
