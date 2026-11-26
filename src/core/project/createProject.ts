import * as path from "node:path";
import { checkPlan, type FilePlan } from "../plan";
import {
  CREATE_VITE_VERSION,
  isSupportedNodeVersion,
  SUPPORTED_NODE_VERSIONS,
} from "./dependencies";
import type { ProjectOptions } from "./options";
import { projectOverlay } from "./overlay";
import { mergePackageJson } from "./packageJson";
import {
  npmExecArgs,
  PACKAGE_MANAGERS,
  type PackageManagerId,
} from "./packageManager";
import { projectNameProblem } from "./projectName";

export type { ProjectOptions } from "./options";

/**
 * Creating a new project, step by step (ADR 3, 7, 9 and 10). This module
 * decides what happens and in which order; the side effects (running
 * programs, touching the disk) are passed in, so tests can fake them and the
 * end-to-end test can run it without VS Code.
 */

export type StepId =
  "check" | "scaffold" | "overlay" | "install" | "format" | "git";

export const STEP_TITLES: Record<StepId, string> = {
  check: "Checking Node.js",
  scaffold: "Creating the Vite project",
  overlay: "Adding the project structure",
  install: "Installing packages (this can take a minute)",
  format: "Formatting the code",
  git: "Creating the git repository",
};

export type RunCommand = (
  command: string,
  args: string[],
  options: { cwd: string; signal: AbortSignal; env?: Record<string, string> },
) => Promise<{ output: string }>;

export interface ProjectDisk {
  folderState(absolutePath: string): Promise<"missing" | "empty" | "notEmpty">;
  readText(absolutePath: string): Promise<string>;
  writeText(absolutePath: string, text: string): Promise<void>;
  /** Deletes a file or a whole folder. */
  remove(absolutePath: string): Promise<void>;
  /** Writes a checked plan without overwriting files unless the plan says so. */
  writePlan(plan: FilePlan): Promise<void>;
}

export interface CreateProjectDependencies {
  run: RunCommand;
  disk: ProjectDisk;
  signal: AbortSignal;
  onStep?: (step: StepId) => void;
  /** Defaults to the pinned version; the weekly drift check passes "latest" (ADR 3). */
  createViteVersion?: string;
}

export type CreateProjectResult =
  | {
      status: "created";
      root: string;
      installed: boolean;
      /** Set when the project was created but installing failed (ADR 9). */
      installError?: string;
      /** Problems that don't stop the project from working, e.g. formatting failed. */
      warnings: string[];
    }
  | {
      status: "cancelled" | "failed";
      root: string;
      step: StepId;
      message: string;
      /** True only when this run created the folder, so it's safe to offer deleting it. */
      createdFolder: boolean;
    };

export const INITIAL_COMMIT_MESSAGE = "Initial commit from React Architect";

export async function createProject(
  options: ProjectOptions,
  dependencies: CreateProjectDependencies,
): Promise<CreateProjectResult> {
  const { run, disk, signal, onStep } = dependencies;
  const packageManager = PACKAGE_MANAGERS[options.packageManager];
  const root = path.join(options.parentDirectory, options.name);
  let createdFolder = false;

  const stop = (step: StepId, error: unknown): CreateProjectResult => ({
    status: signal.aborted ? "cancelled" : "failed",
    root,
    step,
    message: signal.aborted ? "Cancelled." : errorMessage(error),
    createdFolder,
  });

  // 1. Check everything that can be checked before touching the disk.
  onStep?.("check");
  const nameProblem = projectNameProblem(options.name);
  if (nameProblem !== undefined) {
    return stop("check", new Error(nameProblem));
  }
  const folderState = await disk.folderState(root);
  if (folderState === "notEmpty") {
    return stop(
      "check",
      new Error(
        `${root} already exists and isn't empty. Choose another name or folder.`,
      ),
    );
  }
  try {
    const { output } = await run("node", ["--version"], {
      cwd: options.parentDirectory,
      signal,
    });
    if (!isSupportedNodeVersion(output)) {
      return stop(
        "check",
        new Error(
          `This needs Node.js ${SUPPORTED_NODE_VERSIONS}, but ${output.trim()} is installed. Install a newer version from nodejs.org.`,
        ),
      );
    }
  } catch (error) {
    return stop("check", error);
  }

  // 2. Let create-vite build the base project (ADR 3). Always through npm,
  //    which comes with Node.js; the chosen package manager installs (ADR 10).
  if (signal.aborted) return stop("scaffold", undefined);
  onStep?.("scaffold");
  // Recorded before running, so a half-finished scaffold is still cleaned up.
  createdFolder = folderState === "missing";
  try {
    await run(
      "npm",
      npmExecArgs(
        `create-vite@${dependencies.createViteVersion ?? CREATE_VITE_VERSION}`,
        "create-vite",
        [
          options.name,
          "--template",
          "react-ts",
          "--eslint",
          "--no-interactive",
          "--no-immediate",
        ],
      ),
      { cwd: options.parentDirectory, signal },
    );
  } catch (error) {
    return stop("scaffold", error);
  }

  // 3. Replace Vite's starter files with ours.
  if (signal.aborted) return stop("overlay", undefined);
  onStep?.("overlay");
  try {
    const overlay = projectOverlay(options);
    const plan: FilePlan = { root, operations: overlay.operations };
    const problems = checkPlan(plan);
    if (problems.length > 0) {
      throw new Error(`The project template is invalid: ${problems.join(" ")}`);
    }
    for (const relative of overlay.remove) {
      await disk.remove(path.join(root, relative));
    }
    const packageJsonPath = path.join(root, "package.json");
    await disk.writeText(
      packageJsonPath,
      mergePackageJson(
        await disk.readText(packageJsonPath),
        overlay.packageJson,
      ),
    );
    await disk.writePlan(plan);
  } catch (error) {
    return stop("overlay", error);
  }

  const warnings: string[] = [];
  let installed = false;
  let installError: string | undefined;

  // 4. Install. A failure here still leaves a usable project (ADR 9).
  if (options.install) {
    if (signal.aborted) return stop("install", undefined);
    onStep?.("install");
    const result = await installDependencies(
      root,
      options.packageManager,
      dependencies,
    );
    if (result === "cancelled") {
      return stop("install", undefined);
    }
    installError = result;
    installed = result === undefined;
  }

  // 5. Format once, so the files Vite wrote match ours (ADR 7). Needs Prettier
  //    installed.
  if (installed) {
    onStep?.("format");
    try {
      await run(
        packageManager.command,
        packageManager.runScriptArgs("format"),
        {
          cwd: root,
          signal,
        },
      );
    } catch (error) {
      if (signal.aborted) return stop("format", undefined);
      warnings.push(`Formatting failed: ${errorMessage(error)}`);
    }
  }

  // 6. Git, last, so the first commit holds the finished project (ADR 10).
  if (options.git) {
    if (signal.aborted) return stop("git", undefined);
    onStep?.("git");
    const gitWarning = await initialiseGit(root, run, signal);
    if (signal.aborted) return stop("git", undefined);
    if (gitWarning !== undefined) {
      warnings.push(gitWarning);
    }
  }

  return installError === undefined
    ? { status: "created", root, installed, warnings }
    : { status: "created", root, installed, installError, warnings };
}

/**
 * Runs the install step on its own, for "Retry Install". Returns undefined on
 * success, "cancelled", or the error message.
 */
export async function installDependencies(
  root: string,
  packageManagerId: PackageManagerId,
  dependencies: Pick<CreateProjectDependencies, "run" | "signal">,
): Promise<string | undefined> {
  const packageManager = PACKAGE_MANAGERS[packageManagerId];
  try {
    await dependencies.run(
      packageManager.command,
      packageManager.installArgs(),
      {
        cwd: root,
        signal: dependencies.signal,
        env: packageManager.installEnv,
      },
    );
    return undefined;
  } catch (error) {
    return dependencies.signal.aborted ? "cancelled" : errorMessage(error);
  }
}

/**
 * `git init`, then a first commit. Problems here never fail the project; they
 * come back as a warning. Returns undefined when everything worked.
 */
async function initialiseGit(
  root: string,
  run: RunCommand,
  signal: AbortSignal,
): Promise<string | undefined> {
  const git = (...args: string[]) => run("git", args, { cwd: root, signal });

  try {
    await git("--version");
  } catch {
    return "Git isn't installed, so no git repository was created.";
  }
  // Inside another repository (a monorepo, say), a nested one would be wrong.
  const insideRepository = await git("rev-parse", "--is-inside-work-tree").then(
    () => true,
    () => false,
  );
  if (insideRepository) {
    return "The project is inside an existing git repository, so no new one was created.";
  }

  try {
    await git("init");
    await git("add", "--all");
  } catch (error) {
    return `Creating the git repository failed: ${errorMessage(error)}`;
  }
  try {
    await git("commit", "--message", INITIAL_COMMIT_MESSAGE);
  } catch {
    return 'The git repository was created, but the first commit failed, usually because git doesn\'t know your name and email yet. Run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then commit.';
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
