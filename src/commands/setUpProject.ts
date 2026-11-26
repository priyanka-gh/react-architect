import * as path from "node:path";
import * as vscode from "vscode";
import { MANIFEST_FILE_NAME } from "../core/manifest/schema";
import { checkPlan } from "../core/plan";
import { writePlanInWorkspace } from "../infra/workspaceEditWriter";
import { loadProject, startFolder } from "./generateArtifact";
import { vscodePrompts, type Prompts } from "./prompts";

export type SetUpOutcome = "created" | "alreadySetUp" | "cancelled" | "failed";

/**
 * Set Up Existing Project: writes react-architect.json for a project that
 * doesn't have one, from settings suggested by looking at the project
 * (ADR 1), then opens it for review. Generating does the same on first use;
 * this command lets people set up before generating anything.
 */
export async function setUpProjectCommand(
  clickedFolder: vscode.Uri | undefined,
  prompts: Prompts = vscodePrompts,
): Promise<SetUpOutcome> {
  const start = await startFolder(clickedFolder, prompts);
  if (start === undefined) {
    if (!vscode.workspace.workspaceFolders?.length) {
      prompts.showError("Open a project folder first.");
      return "failed";
    }
    return "cancelled";
  }
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(start)?.uri.fsPath;
  if (workspaceFolder === undefined) {
    prompts.showError(`${start.fsPath} isn't inside an open workspace folder.`);
    return "failed";
  }

  const project = await loadProject(start.fsPath, workspaceFolder, prompts);
  if (project.status === "cancelled") {
    return "cancelled";
  }
  if (project.status === "failed") {
    prompts.showError(project.message);
    return "failed";
  }

  const manifestUri = vscode.Uri.file(
    path.join(project.root, MANIFEST_FILE_NAME),
  );
  if (project.extraOperations.length === 0) {
    await vscode.window.showTextDocument(manifestUri);
    prompts.showWarning(
      `${path.basename(project.root)} already has a react-architect.json; it's open for editing.`,
    );
    return "alreadySetUp";
  }

  const plan = { root: project.root, operations: project.extraOperations };
  const problems = checkPlan(plan);
  if (problems.length > 0) {
    prompts.showError(problems.join(" "));
    return "failed";
  }
  if (!(await writePlanInWorkspace(plan))) {
    prompts.showError("VS Code couldn't write react-architect.json.");
    return "failed";
  }
  await vscode.window.showTextDocument(manifestUri);
  return "created";
}
