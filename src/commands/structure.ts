import * as path from "node:path";
import * as vscode from "vscode";
import { buildProjectMap } from "../core/architecture/graph";
import { parseModule, type ModuleInfo } from "../core/architecture/parse";
import {
  MANIFEST_FILE_NAME,
  parseManifest,
  serializeManifest,
  validateManifest,
  type Manifest,
} from "../core/manifest/schema";
import type { FileOperation } from "../core/plan";
import {
  inferStructure,
  placeUnknownFolder,
  type UnknownFolderAnswer,
} from "../core/structure/infer";
import type { StructureConfig } from "../core/structure/model";
import { PRESETS, type Preset } from "../core/structure/presets";
import { RULE_IDS, type Violation } from "../core/structure/rules";
import { parseTree, type TreeEntry } from "../core/structure/treeFile";
import { readTextFileIfExists } from "../infra/fileSystem";
import {
  listFiles,
  listSourceFiles,
  readAliases,
  readFiles,
} from "../infra/projectFiles";
import { writePlanInWorkspace } from "../infra/workspaceEditWriter";
import { proposalUri } from "../editor/proposals";
import type { ProjectIndex } from "../editor/projectIndex";
import { loadProject } from "./generateArtifact";
import { vscodePrompts, type Prompts } from "./prompts";

/** Choose Structure, Import Structure and Show Structure Report (plans/custom-structure.md). */

export interface StructurePrompts extends Prompts {
  pickPreset(presets: readonly Preset[]): Promise<Preset | undefined>;
  pickImportSource(): Promise<"file" | "folder" | undefined>;
  pickFile(): Promise<vscode.Uri | undefined>;
  pickProjectFolder(): Promise<vscode.Uri | undefined>;
  askUnknownFolder(folder: string): Promise<UnknownFolderAnswer | undefined>;
  /** Shown next to the diff of react-architect.json. */
  reviewStructure(
    title: string,
    lines: string[],
  ): Promise<"apply" | "applyErrors" | undefined>;
  showInformation(message: string): void;
}

export const vscodeStructurePrompts: StructurePrompts = {
  ...vscodePrompts,

  async pickPreset(presets) {
    const picked = await vscode.window.showQuickPick(
      presets.map((preset) => ({
        label: preset.label,
        description: preset.description,
        detail: preset.detail,
        preset,
      })),
      {
        title: "Choose Structure",
        placeHolder: "How should this project be organised?",
        ignoreFocusOut: true,
      },
    );
    return picked?.preset;
  },

  async pickImportSource() {
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: "$(file) From a file…",
          detail:
            "A folder tree (drawn, indented or one path per line) in a .txt or .md file, or a structure in a .json file",
          value: "file" as const,
        },
        {
          label: "$(folder) From another project…",
          detail: "Use the folders of a project you already like",
          value: "folder" as const,
        },
      ],
      { title: "Import Structure", ignoreFocusOut: true },
    );
    return picked?.value;
  },

  async pickFile() {
    const [uri] =
      (await vscode.window.showOpenDialog({
        title: "Import Structure from a file",
        canSelectMany: false,
        filters: {
          "Folder tree or structure": ["txt", "md", "json"],
          "All files": ["*"],
        },
      })) ?? [];
    return uri;
  },

  async pickProjectFolder() {
    const [uri] =
      (await vscode.window.showOpenDialog({
        title: "Import Structure from another project",
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      })) ?? [];
    return uri;
  },

  async askUnknownFolder(folder) {
    const answers: {
      label: string;
      detail: string;
      answer: UnknownFolderAnswer;
    }[] = [
      {
        label: "Part of shared code",
        detail: "Anything may use it; it can't use features",
        answer: "shared",
      },
      {
        label: "Its own layer at the top",
        detail: "Like app: it may use every other layer",
        answer: "top",
      },
      {
        label: "Its own layer at the bottom",
        detail: "Every other layer may use it; it uses none",
        answer: "bottom",
      },
      {
        label: "Not part of the structure",
        detail: "The rules ignore it",
        answer: "ignore",
      },
    ];
    const picked = await vscode.window.showQuickPick(answers, {
      title: `Import Structure: what is ${folder}?`,
      placeHolder: `React Architect doesn't recognise the name "${path.posix.basename(folder)}"`,
      ignoreFocusOut: true,
    });
    return picked?.answer;
  },

  async reviewStructure(title, lines) {
    const apply = "Apply";
    const strict = "Apply as Errors";
    const answer = await vscode.window.showInformationMessage(
      title,
      { modal: true, detail: lines.join("\n") },
      apply,
      strict,
    );
    return answer === apply
      ? "apply"
      : answer === strict
        ? "applyErrors"
        : undefined;
  },

  showInformation(message) {
    void vscode.window.showInformationMessage(message);
  },
};

export type StructureOutcome =
  | { status: "applied"; root: string; before: number; after: number }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

const cancelled: StructureOutcome = { status: "cancelled" };

/** Choose Structure: one of the ready-made styles. */
export async function chooseStructure(
  target: vscode.Uri | undefined,
  prompts: StructurePrompts = vscodeStructurePrompts,
): Promise<StructureOutcome> {
  const project = await projectFor(target, prompts);
  if ("status" in project) return project;
  const preset = await prompts.pickPreset(PRESETS);
  if (preset === undefined) return cancelled;
  return reviewAndApply(
    project,
    preset.build(project.manifest.paths),
    [preset.detail],
    `the "${preset.label}" structure`,
    prompts,
  );
}

/** Import Structure: from a folder-tree file, a structure JSON, or another project. */
export async function importStructure(
  target: vscode.Uri | undefined,
  prompts: StructurePrompts = vscodeStructurePrompts,
): Promise<StructureOutcome> {
  const fail = (message: string): StructureOutcome => {
    prompts.showError(message);
    return { status: "failed", message };
  };
  const project = await projectFor(target, prompts);
  if ("status" in project) return project;

  const source = await prompts.pickImportSource();
  if (source === undefined) return cancelled;

  let entries: TreeEntry[];
  let label: string;
  if (source === "file") {
    const file = await prompts.pickFile();
    if (file === undefined) return cancelled;
    label = path.basename(file.fsPath);
    const text = await readTextFileIfExists(file.fsPath);
    if (text === undefined) return fail(`Couldn't read ${file.fsPath}.`);
    if (file.fsPath.endsWith(".json")) {
      const config = structureFromJson(text);
      if (typeof config === "string") return fail(`${label}: ${config}`);
      return reviewAndApply(
        project,
        config,
        [`From ${label}.`],
        label,
        prompts,
      );
    }
    const tree = parseTree(text);
    if (!tree.ok)
      return fail(
        `${label} couldn't be read as a folder tree. ${tree.errors.slice(0, 5).join(" ")}`,
      );
    entries = tree.entries;
  } else {
    const folder = await prompts.pickProjectFolder();
    if (folder === undefined) return cancelled;
    label = path.basename(folder.fsPath);
    // A project that already describes its structure: use that as it is.
    const manifestText = await readTextFileIfExists(
      path.join(folder.fsPath, MANIFEST_FILE_NAME),
    );
    const existing =
      manifestText === undefined ? undefined : parseManifest(manifestText);
    if (existing?.ok && existing.manifest.structure !== undefined) {
      return reviewAndApply(
        project,
        existing.manifest.structure,
        [`Copied from ${label}'s ${MANIFEST_FILE_NAME}.`],
        label,
        prompts,
      );
    }
    entries = treeFromFiles(await listFiles(folder.fsPath));
    if (entries.length === 0)
      return fail(`${folder.fsPath} has no files to learn a structure from.`);
  }

  const inferred = inferStructure(entries);
  let config = inferred.config;
  for (const folder of inferred.unknown.slice(0, 10)) {
    const answer = await prompts.askUnknownFolder(folder);
    if (answer === undefined) return cancelled;
    config = placeUnknownFolder(config, folder, answer);
  }
  for (const folder of inferred.unknown.slice(10)) {
    config = placeUnknownFolder(config, folder, "ignore");
  }
  if (config.layers.length === 0) {
    return fail(
      `No layers could be found in ${label}: use folder names such as app, pages, features, components or shared.`,
    );
  }
  return reviewAndApply(project, config, inferred.notes, label, prompts);
}

/** Files to the folders and files they're in, up to 6 levels deep. */
function treeFromFiles(files: readonly string[]): TreeEntry[] {
  const entries = new Map<string, boolean>();
  for (const file of files) {
    const parts = file.split("/");
    if (parts.length > 6) continue;
    for (let depth = 1; depth < parts.length; depth += 1) {
      entries.set(parts.slice(0, depth).join("/"), true);
    }
    entries.set(file, false);
  }
  return [...entries].map(([entryPath, isFolder]) => ({
    path: entryPath,
    isFolder,
  }));
}

function structureFromJson(text: string): StructureConfig | string {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    return `it isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  const object = value as { structure?: unknown; layers?: unknown };
  const structure =
    object?.structure ?? (object?.layers !== undefined ? object : undefined);
  if (structure === undefined)
    return 'it has no "structure" (or "layers") to import.';
  const result = validateManifest({ manifestVersion: 1, structure });
  if (!result.ok) return result.errors.join(" ");
  return result.manifest.structure!;
}

interface LoadedProject {
  root: string;
  manifest: Manifest;
}

async function projectFor(
  target: vscode.Uri | undefined,
  prompts: StructurePrompts,
): Promise<LoadedProject | StructureOutcome> {
  const start =
    target ??
    (vscode.window.activeTextEditor?.document.uri.scheme === "file"
      ? vscode.Uri.joinPath(vscode.window.activeTextEditor.document.uri, "..")
      : vscode.workspace.workspaceFolders?.[0]?.uri);
  const workspaceFolder =
    start && vscode.workspace.getWorkspaceFolder(start)?.uri.fsPath;
  if (start === undefined || workspaceFolder === undefined) {
    const message = "Open a React project first.";
    prompts.showError(message);
    return { status: "failed", message };
  }
  const project = await loadProject(start.fsPath, workspaceFolder, prompts);
  if (project.status === "failed") {
    prompts.showError(project.message);
    return project;
  }
  if (project.status === "cancelled") return cancelled;
  return { root: project.root, manifest: project.manifest };
}

/**
 * Shows the proposed react-architect.json as a diff, with how many problems
 * the project has now and would have, then writes it if the user agrees.
 */
async function reviewAndApply(
  project: LoadedProject,
  config: StructureConfig,
  notes: string[],
  label: string,
  prompts: StructurePrompts,
): Promise<StructureOutcome> {
  const fail = (message: string): StructureOutcome => {
    prompts.showError(message);
    return { status: "failed", message };
  };
  const manifestPath = path.join(project.root, MANIFEST_FILE_NAME);
  const currentText = await readTextFileIfExists(manifestPath);
  const raw = JSON.parse(
    currentText ?? serializeManifest(project.manifest),
  ) as Record<string, unknown>;
  const textWith = (strict: boolean) => {
    const next: Record<string, unknown> = { ...raw, structure: config };
    if (strict)
      next.rules = Object.fromEntries(RULE_IDS.map((id) => [id, "error"]));
    return JSON.stringify(next, null, 2) + "\n";
  };

  const proposed = parseManifest(textWith(false));
  if (!proposed.ok) {
    return fail(
      `The structure from ${label} isn't valid: ${proposed.errors.join(" ")}`,
    );
  }

  const modules = await readModules(project.root);
  const aliases = await readAliases(project.root);
  const before = buildProjectMap(modules, project.manifest, aliases).problems;
  const after = buildProjectMap(modules, proposed.manifest, aliases).problems;

  const left =
    currentText !== undefined
      ? vscode.Uri.file(manifestPath)
      : proposalUri("react-architect.json (none yet)", "");
  await vscode.commands.executeCommand(
    "vscode.diff",
    left,
    proposalUri("react-architect.json (proposed)", textWith(false)),
    `react-architect.json: ${label}`,
    { preview: true },
  );

  const layers = config.layers.map(
    (layer) =>
      `  ${layer.name}: ${layer.paths.join(", ")}${layer.mayImport.length > 0 ? `  (may use ${layer.mayImport.join(", ")})` : "  (uses no other layer)"}`,
  );
  const lines = [
    ...notes,
    "",
    "Layers, top to bottom:",
    ...layers,
    "",
    `Problems now: ${before.length}. With this structure: ${after.length}${after.length > 0 ? ` (${byRule(after)})` : ""}.`,
    "",
    'Apply shows them as warnings. "Apply as Errors" makes every rule an error.',
  ];
  const answer = await prompts.reviewStructure(
    `Use ${label} for ${path.basename(project.root)}?`,
    lines,
  );
  if (answer === undefined) return cancelled;

  const text = textWith(answer === "applyErrors");
  const operation: FileOperation =
    currentText === undefined
      ? { kind: "create", path: MANIFEST_FILE_NAME, content: text }
      : {
          kind: "edit",
          path: MANIFEST_FILE_NAME,
          expectedText: currentText,
          changes: [{ start: 0, end: currentText.length, text }],
        };
  if (
    !(await writePlanInWorkspace({
      root: project.root,
      operations: [operation],
    }))
  ) {
    return fail(
      `${MANIFEST_FILE_NAME} changed while you were reviewing it, so nothing was changed. Try again.`,
    );
  }
  await vscode.window.showTextDocument(vscode.Uri.file(manifestPath));
  prompts.showInformation(
    after.length === 0
      ? `${path.basename(project.root)} now uses ${label}, with no problems.`
      : `${path.basename(project.root)} now uses ${label}. ${after.length} existing ${after.length === 1 ? "problem is" : "problems are"} in the Problems panel; React Architect: Show Structure Report summarises them.`,
  );
  return {
    status: "applied",
    root: project.root,
    before: before.length,
    after: after.length,
  };
}

async function readModules(root: string): Promise<Map<string, ModuleInfo>> {
  const modules = new Map<string, ModuleInfo>();
  for (const [file, text] of await readFiles(
    root,
    await listSourceFiles(root),
  )) {
    try {
      modules.set(file, parseModule(file, text));
    } catch {
      // As in the project index: an unparsable file has no imports.
    }
  }
  return modules;
}

function byRule(problems: readonly Violation[]): string {
  const counts = new Map<string, number>();
  for (const problem of problems)
    counts.set(problem.rule, (counts.get(problem.rule) ?? 0) + 1);
  return [...counts].map(([rule, count]) => `${count} ${rule}`).join(", ");
}

const RULE_ADVICE: Record<string, string> = {
  layers:
    "A layer imports one it may not use. Move the shared piece down a layer, pass it in as a prop, or move the importing file up.",
  entry:
    "Code reaches inside a unit. Import from the unit's entry file instead: the lightbulb does it, and exports what's needed.",
  siblings:
    "Units of the same layer use each other. Move what both need to a lower layer.",
  placement:
    "Files are in the wrong place. The lightbulb moves them where the structure expects, and updates imports.",
  naming:
    "File names don't follow the naming rules. The lightbulb renames them when the right name is clear.",
};

/** Show Structure Report: a summary of a project's problems, for adopting a structure. */
export async function showStructureReport(
  index: ProjectIndex,
): Promise<string | undefined> {
  const active = vscode.window.activeTextEditor?.document.uri;
  const project = (active && index.projectFor(active)) ?? index.all[0];
  if (project === undefined) {
    void vscode.window.showWarningMessage(
      "There's no react-architect.json in this workspace yet.",
    );
    return undefined;
  }
  const { problems } = project.map;
  const count = (list: readonly Violation[], key: (p: Violation) => string) => {
    const counts = new Map<string, number>();
    for (const problem of list)
      counts.set(key(problem), (counts.get(key(problem)) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const name = path.basename(project.root);
  const lines = [`# Structure report: ${name}`, ""];
  if (problems.length === 0) {
    lines.push("No problems: every file follows the structure.");
  } else {
    lines.push(
      `${problems.length} ${problems.length === 1 ? "problem" : "problems"} (${problems.filter((p) => p.severity === "error").length} errors).`,
      "",
      "## By rule",
      "",
      "| Rule | Problems | What to do |",
      "| --- | --- | --- |",
      ...count(problems, (p) => p.rule).map(
        ([rule, n]) => `| ${rule} | ${n} | ${RULE_ADVICE[rule] ?? ""} |`,
      ),
      "",
      "## By layer it involves",
      "",
      "| Layer | Problems |",
      "| --- | --- |",
      ...count(problems, (p) => p.layer || "(no layer)").map(
        ([layer, n]) => `| ${layer} | ${n} |`,
      ),
      "",
      "## Files with the most problems",
      "",
      ...count(problems, (p) => p.file)
        .slice(0, 15)
        .map(([file, n]) => `- \`${file}\`: ${n}`),
      "",
      "To stop existing problems failing CI while you fix them, run `react-architect check --update-baseline`.",
    );
  }
  const markdown = lines.join("\n") + "\n";
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: markdown,
  });
  await vscode.window.showTextDocument(document, { preview: true });
  await vscode.commands.executeCommand("markdown.showPreview", document.uri);
  return markdown;
}
