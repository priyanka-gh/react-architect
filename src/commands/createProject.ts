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
  const routing = await prompts.askYesNo(
    "Add routing with React Router?",
    true,
  );
  if (routing === undefined) {
    return undefined;
  }
  const install = await prompts.askYesNo(
    "Install packages now (npm install)?",
    true,
  );
  if (install === undefined) {
    return undefined;
  }

  // 2. Create it.
  output.appendLine(`Creating ${name.trim()} in ${parent.fsPath}`);
  const result = await withCancellableProgress(
    `Creating ${name.trim()}`,
    (signal, report) =>
      createProject(
        { name: name.trim(), parentDirectory: parent.fsPath, routing, install },
        { run, disk, signal, onStep: (step) => report(STEP_TITLES[step]) },
      ),
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
          (signal) => installDependencies(result.root, { run, signal }),
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
