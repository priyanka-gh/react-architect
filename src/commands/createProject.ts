import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  createProject,
  installDependencies,
  STEP_TITLES,
  type CreateProjectResult,
  type ProjectDisk,
  type RunCommand,
} from "../core/project/createProject";
import {
  DEFAULT_PROJECT_CHOICES,
  DEFAULT_TOGGLES,
  projectFolderProblem,
  type ProjectOptions,
} from "../core/project/options";
import type { Manifest } from "../core/manifest/schema";
import { normalizeRelativePath } from "../core/paths";
import {
  PACKAGE_MANAGER_IDS,
  PACKAGE_MANAGERS,
  type PackageManagerId,
} from "../core/project/packageManager";
import { projectNameProblem } from "../core/project/projectName";
import { runProcess } from "../infra/process";
import { nodeProjectDisk } from "../infra/projectDisk";
import { vscodeProjectPrompts, type ProjectPrompts } from "./prompts";

export interface CreateProjectCommandDependencies {
  output: vscode.OutputChannel;
  prompts?: ProjectPrompts;
  /** Replaced in tests; defaults to running real programs. */
  run?: RunCommand;
  disk?: ProjectDisk;
}

/**
 * The Create React Project command: asks the questions, runs the steps with a
 * cancellable progress notification, then opens the project or cleans up
 * (ADR 9).
 */
export async function createProjectCommand(
  dependencies: CreateProjectCommandDependencies,
): Promise<CreateProjectResult | undefined> {
  const { output } = dependencies;
  const prompts = dependencies.prompts ?? vscodeProjectPrompts;
  const disk = dependencies.disk ?? nodeProjectDisk;
  const run: RunCommand =
    dependencies.run ??
    ((command, args, options) =>
      runProcess(command, args, {
        ...options,
        onOutput: (text) => output.append(text),
      }));

  // 1. Questions.
  const parent = await prompts.pickParentFolder(defaultParentFolder());
  if (parent === undefined) {
    return undefined;
  }
  const name = await prompts.askProjectName(async (value) => {
    const problem = projectNameProblem(value);
    if (problem !== undefined) {
      return problem;
    }
    const state = await disk.folderState(
      path.join(parent.fsPath, value.trim()),
    );
    return state === "notEmpty"
      ? `${value.trim()} already exists in this folder and isn't empty.`
      : undefined;
  });
  if (name === undefined) {
    return undefined;
  }
  const styling = await prompts.askStyling();
  if (styling === undefined) {
    return undefined;
  }
  const toggles = await prompts.askToggles(DEFAULT_TOGGLES);
  if (toggles === undefined) {
    return undefined;
  }
  const available = await availablePackageManagers(run);
  const packageManager =
    available.length > 1 ? await prompts.askPackageManager(available) : "npm";
  if (packageManager === undefined) {
    return undefined;
  }
  const chosenFolders = await prompts.askFolders(
    DEFAULT_PROJECT_CHOICES.paths,
    projectFolderProblem,
  );
  if (chosenFolders === undefined) {
    return undefined;
  }
  const paths = normaliseFolders(chosenFolders);
  if (paths === undefined) {
    await prompts.showError("Those folder names can't be used.");
    return undefined;
  }

  // 2. Create it.
  const options: ProjectOptions = {
    ...toggles,
    name: name.trim(),
    parentDirectory: parent.fsPath,
    styling,
    packageManager,
    paths,
  };
  output.appendLine(
    `Creating ${options.name} in ${options.parentDirectory}: ${JSON.stringify({ ...toggles, styling, packageManager, paths })}`,
  );
  const result = await withCancellableProgress(
    `Creating ${options.name}`,
    (signal, report) =>
      createProject(options, {
        run,
        disk,
        signal,
        onStep: (step) => report(STEP_TITLES[step]),
      }),
  );

  // 3. Afterwards.
  if (result.status === "created") {
    for (const warning of result.warnings) {
      output.appendLine(warning);
      prompts.showWarning(warning);
    }
    // The project is usable even when install failed (ADR 9): offer to retry.
    let installError = result.installError;
    while (installError !== undefined) {
      output.appendLine(`npm install failed: ${installError}`);
      const choice = await prompts.installFailed(name.trim());
      if (choice === "retry") {
        const retried = await withCancellableProgress(
          `Installing packages for ${name.trim()}`,
          (signal) =>
            installDependencies(result.root, packageManager, { run, signal }),
        );
        if (retried === "cancelled") {
          return result;
        }
        installError = retried;
        continue;
      }
      if (choice === "output") {
        output.show();
      }
      if (choice !== "open") {
        return result;
      }
      break;
    }
    await openProject(result.root, await prompts.projectCreated(name.trim()));
    return result;
  }

  output.appendLine(`${STEP_TITLES[result.step]}: ${result.message}`);
  if (result.createdFolder && (await prompts.confirmDelete(result.root))) {
    await disk.remove(result.root);
  }
  if (result.status === "failed") {
    const choice = await prompts.showError(
      `Couldn't create ${name.trim()}: ${firstLine(result.message)}`,
    );
    if (choice === "output") {
      output.show();
    }
  }
  return result;
}

/** npm always (it comes with Node.js), plus pnpm and Yarn when they run. */
async function availablePackageManagers(
  run: RunCommand,
): Promise<PackageManagerId[]> {
  const signal = new AbortController().signal;
  const checks = await Promise.all(
    PACKAGE_MANAGER_IDS.map(async (id) => {
      if (id === "npm") {
        return true;
      }
      return run(PACKAGE_MANAGERS[id].command, ["--version"], {
        cwd: os.homedir(),
        signal,
      }).then(
        () => true,
        () => false,
      );
    }),
  );
  return PACKAGE_MANAGER_IDS.filter((_, index) => checks[index]);
}

/** Normal form for each folder, or undefined if any can't be used. */
function normaliseFolders(
  folders: Manifest["paths"],
): Manifest["paths"] | undefined {
  const result: Partial<Manifest["paths"]> = {};
  for (const key of ["components", "hooks", "features"] as const) {
    const others = (["components", "hooks", "features"] as const)
      .filter((other) => other !== key)
      .map((other) => folders[other]);
    if (projectFolderProblem(folders[key], others) !== undefined) {
      return undefined;
    }
    const normalised = normalizeRelativePath(folders[key].trim());
    if (!normalised.ok) {
      return undefined;
    }
    result[key] = normalised.path;
  }
  return result as Manifest["paths"];
}

function defaultParentFolder(): vscode.Uri {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
  return workspace
    ? vscode.Uri.joinPath(workspace, "..")
    : vscode.Uri.file(os.homedir());
}

async function openProject(
  root: string,
  choice: "open" | "newWindow" | undefined,
): Promise<void> {
  if (choice !== undefined) {
    await vscode.commands.executeCommand(
      "vscode.openFolder",
      vscode.Uri.file(root),
      {
        forceNewWindow: choice === "newWindow",
      },
    );
  }
}

function withCancellableProgress<T>(
  title: string,
  task: (signal: AbortSignal, report: (message: string) => void) => Promise<T>,
): Promise<T> {
  return Promise.resolve(
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      (progress, token) => {
        const controller = new AbortController();
        const subscription = token.onCancellationRequested(() =>
          controller.abort(),
        );
        return task(controller.signal, (message) =>
          progress.report({ message }),
        ).finally(() => subscription.dispose());
      },
    ),
  );
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? text;
}
