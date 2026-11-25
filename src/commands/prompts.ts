import * as vscode from "vscode";
import type { ConflictChoice } from "../core/conflicts";

/**
 * Every question the generate commands ask. Commands depend on this interface
 * rather than calling vscode.window directly, so integration tests can answer
 * the questions with a script.
 *
 * Each method resolves to undefined (or false) when the user dismisses it.
 */
export interface Prompts {
  pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined>;
  askName(options: {
    title: string;
    placeholder: string;
    validate: (value: string) => string | undefined;
  }): Promise<string | undefined>;
  askYesNo(
    question: string,
    defaultAnswer: boolean,
  ): Promise<boolean | undefined>;
  confirmCreateManifest(projectName: string): Promise<boolean>;
  askConflictChoice(
    existingFiles: string[],
  ): Promise<ConflictChoice | undefined>;
  confirmPlan(title: string, lines: string[]): Promise<boolean>;
  showError(message: string): void;
  showWarning(message: string): void;
}

export const vscodePrompts: Prompts = {
  async pickWorkspaceFolder() {
    return vscode.window.showWorkspaceFolderPick({
      placeHolder: "Which folder should React Architect work in?",
    });
  },

  async askName({ title, placeholder, validate }) {
    return vscode.window.showInputBox({
      title,
      prompt: "Name",
      placeHolder: placeholder,
      validateInput: validate,
      ignoreFocusOut: true,
    });
  },

  async askYesNo(question, defaultAnswer) {
    const yes = { label: "Yes", answer: true };
    const no = { label: "No", answer: false };
    const picked = await vscode.window.showQuickPick(
      defaultAnswer ? [yes, no] : [no, yes],
      { title: question, placeHolder: question, ignoreFocusOut: true },
    );
    return picked?.answer;
  },

  async confirmCreateManifest(projectName) {
    const create = "Create";
    const answer = await vscode.window.showInformationMessage(
      `"${projectName}" has no react-architect.json yet. Create one with the default settings?`,
      {
        modal: true,
        detail:
          "It records where components, hooks and features go. You can edit it at any time.",
      },
      create,
    );
    return answer === create;
  },

  async askConflictChoice(existingFiles) {
    const overwrite = "Overwrite";
    const skip = "Skip Existing";
    const count = existingFiles.length;
    const answer = await vscode.window.showWarningMessage(
      count === 1 ? "1 file already exists." : `${count} files already exist.`,
      { modal: true, detail: existingFiles.join("\n") },
      overwrite,
      skip,
    );
    if (answer === overwrite) {
      return "overwrite";
    }
    return answer === skip ? "skip" : undefined;
  },

  async confirmPlan(title, lines) {
    const generate = "Generate";
    const answer = await vscode.window.showInformationMessage(
      title,
      { modal: true, detail: lines.join("\n") },
      generate,
    );
    return answer === generate;
  },

  showError(message) {
    void vscode.window.showErrorMessage(message);
  },

  showWarning(message) {
    void vscode.window.showWarningMessage(message);
  },
};
