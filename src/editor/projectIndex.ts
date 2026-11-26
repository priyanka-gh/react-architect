import * as path from "node:path";
import * as vscode from "vscode";
import { buildProjectMap, type ProjectMap } from "../core/architecture/graph";
import type { PathAlias } from "../core/architecture/modules";
import {
  isSourceFile,
  parseModule,
  type ModuleInfo,
} from "../core/architecture/parse";
import {
  MANIFEST_FILE_NAME,
  parseManifest,
  type Manifest,
} from "../core/manifest/schema";
import { isInsideDirectory } from "../core/paths";
import { parseBaseline, type Baseline } from "../core/check/baseline";
import { BASELINE_FILE_NAME, isSkippedFolder } from "../core/projectFolders";
import { readTextFileIfExists } from "../infra/fileSystem";
import { listSourceFiles, readAliases, readFiles } from "../infra/projectFiles";

/**
 * Keeps every project's imports in memory so the structure rules and the
 * project map stay current as files change (ADR 11). A project is a folder
 * with a react-architect.json; in a monorepo there can be several.
 */

export interface IndexedProject {
  root: string;
  manifest: Manifest;
  aliases: PathAlias[];
  modules: Map<string, ModuleInfo>;
  map: ProjectMap;
  /** Problems the project already had when it adopted its rules (Phase 6). */
  baseline: Baseline | undefined;
}

const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

export class ProjectIndex implements vscode.Disposable {
  private projects: IndexedProject[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changed];
  private rebuildTimer: NodeJS.Timeout | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private loading: Promise<void> = Promise.resolve();

  /** Fires after projects are found, or their files change. */
  readonly onDidChange = this.changed.event;

  constructor(private readonly output: vscode.OutputChannel) {
    const sources = vscode.workspace.createFileSystemWatcher(SOURCE_GLOB);
    const settings = vscode.workspace.createFileSystemWatcher(
      `**/{${MANIFEST_FILE_NAME},${BASELINE_FILE_NAME},tsconfig.json,tsconfig.app.json}`,
    );
    this.disposables.push(
      sources,
      settings,
      sources.onDidCreate((uri) => void this.reload(uri)),
      sources.onDidChange((uri) => void this.reload(uri)),
      sources.onDidDelete((uri) => this.remove(uri)),
      settings.onDidCreate(() => this.scheduleRefresh()),
      settings.onDidChange(() => this.scheduleRefresh()),
      settings.onDidDelete(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() =>
        this.scheduleRefresh(),
      ),
      vscode.workspace.onDidChangeTextDocument(({ document }) =>
        this.update(document.uri, document.getText()),
      ),
      // Closing without saving drops the unsaved text, so go back to the disk.
      vscode.workspace.onDidCloseTextDocument(
        (document) => void this.reload(document.uri),
      ),
    );
  }

  get all(): readonly IndexedProject[] {
    return this.projects;
  }

  /** The project a file or folder belongs to: the nearest manifest above it. */
  projectFor(uri: vscode.Uri): IndexedProject | undefined {
    return this.projects
      .filter((project) => isInsideDirectory(uri.fsPath, project.root))
      .sort((a, b) => b.root.length - a.root.length)[0];
  }

  /** The file's path within its project, with "/". */
  relativePath(project: IndexedProject, uri: vscode.Uri): string {
    return path.relative(project.root, uri.fsPath).split(path.sep).join("/");
  }

  /**
   * Finds every project and reads all their files. Loads run one at a time,
   * and each call gets a load that starts after it, so it sees every file
   * that existed when it was called.
   */
  refresh(): Promise<void> {
    this.loading = this.loading.then(
      () => this.load(),
      () => this.load(),
    );
    return this.loading;
  }

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 300);
  }

  private async load(): Promise<void> {
    // Files that change while this load reads the projects would be lost
    // when its results replace the current ones, so changes made meanwhile
    // are replayed afterwards (see update and remove).
    this.changesDuringLoad = new Map();
    try {
      const manifests = await vscode.workspace.findFiles(
        `**/${MANIFEST_FILE_NAME}`,
        "**/node_modules/**",
      );
      const projects: IndexedProject[] = [];
      for (const uri of manifests) {
        const project = await this.loadProject(path.dirname(uri.fsPath));
        if (project !== undefined) projects.push(project);
      }
      this.projects = projects.sort((a, b) => a.root.localeCompare(b.root));
    } finally {
      const missed = this.changesDuringLoad;
      this.changesDuringLoad = undefined;
      for (const [uri, text] of missed) {
        if (text === undefined) this.remove(vscode.Uri.parse(uri));
        else this.update(vscode.Uri.parse(uri), text);
      }
    }
    this.changed.fire();
  }

  /** Set while load() runs: each changed file's latest text, or undefined if deleted. */
  private changesDuringLoad: Map<string, string | undefined> | undefined;

  private async loadProject(root: string): Promise<IndexedProject | undefined> {
    const text = await readTextFileIfExists(
      path.join(root, MANIFEST_FILE_NAME),
    );
    const result = text === undefined ? undefined : parseManifest(text);
    if (result === undefined || !result.ok) {
      // The generate commands report manifest problems when they're used.
      return undefined;
    }

    const aliases = await readAliases(root);

    const started = Date.now();
    const files = await listSourceFiles(root);
    const modules = new Map<string, ModuleInfo>();
    for (const [file, source] of await readFiles(root, files)) {
      modules.set(file, safeParse(file, source));
    }
    this.output.appendLine(
      `Read ${modules.size} files in ${root} in ${Date.now() - started} ms.`,
    );

    const baselineText = await readTextFileIfExists(
      path.join(root, BASELINE_FILE_NAME),
    );
    const baseline =
      baselineText === undefined ? undefined : parseBaseline(baselineText);
    if (baseline?.ok === false) {
      this.output.appendLine(
        `${BASELINE_FILE_NAME} in ${root} was ignored: ${baseline.error}.`,
      );
    }
    return {
      root,
      manifest: result.manifest,
      aliases,
      modules,
      map: buildProjectMap(modules, result.manifest, aliases),
      baseline: baseline?.ok ? baseline.baseline : undefined,
    };
  }

  private update(uri: vscode.Uri, text: string): void {
    if (uri.scheme !== "file" || !isSourceFile(uri.fsPath)) return;
    this.changesDuringLoad?.set(uri.toString(), text);
    const project = this.projectFor(uri);
    if (project === undefined) return;
    const file = this.relativePath(project, uri);
    if (isSkipped(file)) return;
    project.modules.set(file, safeParse(file, text));
    this.scheduleRebuild();
  }

  private async reload(uri: vscode.Uri): Promise<void> {
    if (!isSourceFile(uri.fsPath)) return;
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    // An open document's text is newer than the disk's; that's tracked as it changes.
    if (open?.isDirty) return;
    const text = await readTextFileIfExists(uri.fsPath);
    if (text === undefined) {
      this.remove(uri);
    } else {
      this.update(uri, text);
    }
  }

  private remove(uri: vscode.Uri): void {
    this.changesDuringLoad?.set(uri.toString(), undefined);
    const project = this.projectFor(uri);
    if (project === undefined) return;
    const prefix = this.relativePath(project, uri);
    // A deleted folder reports only the folder.
    for (const file of [...project.modules.keys()]) {
      if (file === prefix || file.startsWith(prefix + "/")) {
        project.modules.delete(file);
      }
    }
    this.scheduleRebuild();
  }

  private scheduleRebuild(): void {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      for (const project of this.projects) {
        project.map = buildProjectMap(
          project.modules,
          project.manifest,
          project.aliases,
        );
      }
      this.changed.fire();
    }, 200);
  }

  dispose(): void {
    clearTimeout(this.rebuildTimer);
    clearTimeout(this.refreshTimer);
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}

function isSkipped(file: string): boolean {
  return (
    file.split("/").slice(0, -1).some(isSkippedFolder) ||
    file.split("/").at(-1)!.startsWith(".")
  );
}

/** A file that can't be parsed (it shouldn't happen) counts as having no imports. */
function safeParse(file: string, text: string): ModuleInfo {
  try {
    return parseModule(file, text);
  } catch {
    return { imports: [], exports: [], starExports: [] };
  }
}
