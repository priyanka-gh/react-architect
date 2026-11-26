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
  /** `settings` explains each suggested setting, one sentence per line. */
  confirmCreateManifest(
    projectName: string,
    settings: string[],
  ): Promise<boolean>;
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

  async confirmCreateManifest(projectName, settings) {
    const create = "Create";
    const answer = await vscode.window.showInformationMessage(
      `"${projectName}" has no react-architect.json yet. Create one with these settings?`,
      {
        modal: true,
        detail: [
          ...settings,
          "",
          "You can change any of these later by editing react-architect.json.",
        ].join("\n"),
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

/** The questions Create React Project asks; see Prompts for why this is an interface. */
export interface ProjectPrompts {
  pickParentFolder(defaultFolder: vscode.Uri): Promise<vscode.Uri | undefined>;
  askProjectName(
    validate: (value: string) => Promise<string | undefined>,
  ): Promise<string | undefined>;
  askYesNo(
    question: string,
    defaultAnswer: boolean,
  ): Promise<boolean | undefined>;
  /** "open" reuses this window; "newWindow" opens another. */
  projectCreated(name: string): Promise<"open" | "newWindow" | undefined>;
  installFailed(name: string): Promise<"retry" | "open" | "output" | undefined>;
  confirmDelete(folder: string): Promise<boolean>;
  showError(message: string): Promise<"output" | undefined>;
  showWarning(message: string): void;
}

export const vscodeProjectPrompts: ProjectPrompts = {
  async pickParentFolder(defaultFolder) {
    const picked = await vscode.window.showOpenDialog({
      title: "Create React Project: choose where to put it",
      openLabel: "Create Project Here",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: defaultFolder,
    });
    return picked?.[0];
  },

  async askProjectName(validate) {
    return vscode.window.showInputBox({
      title: "Create React Project",
      prompt: "Project name (also the folder name)",
      placeHolder: "For example: my-app",
      validateInput: validate,
      ignoreFocusOut: true,
    });
  },

  askYesNo: (question, defaultAnswer) =>
    vscodePrompts.askYesNo(question, defaultAnswer),

  async projectCreated(name) {
    const open = "Open";
    const newWindow = "Open in New Window";
    const answer = await vscode.window.showInformationMessage(
      `Created ${name}.`,
      open,
      newWindow,
    );
    if (answer === open) {
      return "open";
    }
    return answer === newWindow ? "newWindow" : undefined;
  },

  async installFailed(name) {
    const retry = "Retry Install";
    const open = "Open Anyway";
    const output = "Show Output";
    const answer = await vscode.window.showWarningMessage(
      `Created ${name}, but npm install failed.`,
      retry,
      open,
      output,
    );
    if (answer === retry) {
      return "retry";
    }
    if (answer === open) {
      return "open";
    }
    return answer === output ? "output" : undefined;
  },

  async confirmDelete(folder) {
    const remove = "Delete";
    const answer = await vscode.window.showWarningMessage(
      `Delete the partially created project at ${folder}?`,
      { modal: true, detail: "Choose Cancel to keep it." },
      remove,
    );
    return answer === remove;
  },

  async showError(message) {
    const output = "Show Output";
    const answer = await vscode.window.showErrorMessage(message, output);
    return answer === output ? "output" : undefined;
  },

  showWarning(message) {
    void vscode.window.showWarningMessage(message);
  },
};
