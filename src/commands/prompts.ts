import * as vscode from "vscode";
import type { ConflictChoice } from "../core/conflicts";
import type { Manifest, Styling } from "../core/manifest/schema";
import type { ProjectToggles } from "../core/project/options";
import type { PackageManagerId } from "../core/project/packageManager";

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
  /** Where to generate, when the structure has more than one suitable folder. */
  pickDirectory?(title: string, folders: string[]): Promise<string | undefined>;
}

export const vscodePrompts: Prompts = {
  async pickDirectory(title, folders) {
    return vscode.window.showQuickPick(folders, {
      title,
      placeHolder: "Your project structure has more than one place for this",
      ignoreFocusOut: true,
    });
  },

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
  askStyling(): Promise<Styling | undefined>;
  /** One checklist for the yes/no choices, starting from `defaults`. */
  askToggles(defaults: ProjectToggles): Promise<ProjectToggles | undefined>;
  /** Only asked when more than one package manager is installed. */
  askPackageManager(
    available: PackageManagerId[],
  ): Promise<PackageManagerId | undefined>;
  /** Standard folders, or custom ones checked with `validate`. */
  askFolders(
    defaults: Manifest["paths"],
    validate: (value: string, otherFolders: string[]) => string | undefined,
  ): Promise<Manifest["paths"] | undefined>;
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

  async askStyling() {
    const choices: (vscode.QuickPickItem & { styling: Styling })[] = [
      {
        label: "CSS Modules",
        description: "Recommended",
        detail:
          "A .module.css file next to each component; its styles can't leak into others.",
        styling: "css-modules",
      },
      {
        label: "Tailwind CSS",
        detail:
          "Utility classes in your markup, set up and ready; no CSS file per component.",
        styling: "tailwind",
      },
      {
        label: "Plain CSS",
        detail:
          "A .css file next to each component, with ordinary class names.",
        styling: "plain-css",
      },
      {
        label: "No CSS files",
        detail: "No stylesheets at all; add your own styling later.",
        styling: "none",
      },
    ];
    const picked = await vscode.window.showQuickPick(choices, {
      title: "Create React Project: styling",
      placeHolder: "How should components be styled?",
      ignoreFocusOut: true,
    });
    return picked?.styling;
  },

  async askToggles(defaults) {
    type ToggleItem = vscode.QuickPickItem & { key: keyof ProjectToggles };
    const items: Omit<ToggleItem, "picked">[] = [
      {
        label: "Routing",
        detail: "Pages and links with React Router",
        key: "routing",
      },
      {
        label: "Tests",
        detail: "Vitest and React Testing Library, with starter tests",
        key: "tests",
      },
      {
        label: "@/ imports",
        detail:
          'import { Home } from "@/features/home" instead of "../../features/home"',
        key: "pathAlias",
      },
      {
        label: "Git repository",
        detail: "Start with git and a first commit",
        key: "git",
      },
      {
        label: "Install packages",
        detail: "Run the install now (takes a minute)",
        key: "install",
      },
    ];
    const choices: ToggleItem[] = items.map((item) => ({
      ...item,
      picked: defaults[item.key],
    }));
    const picked = await vscode.window.showQuickPick(choices, {
      title: "Create React Project: options",
      placeHolder: "Untick anything you don't want, then press Enter",
      canPickMany: true,
      ignoreFocusOut: true,
    });
    if (picked === undefined) {
      return undefined;
    }
    const chosen = new Set(picked.map((choice) => choice.key));
    return {
      routing: chosen.has("routing"),
      tests: chosen.has("tests"),
      pathAlias: chosen.has("pathAlias"),
      git: chosen.has("git"),
      install: chosen.has("install"),
    };
  },

  async askPackageManager(available) {
    const picked = await vscode.window.showQuickPick(
      available.map((id) => ({ label: id, id })),
      {
        title: "Create React Project: package manager",
        placeHolder: "Which package manager should install and run scripts?",
        ignoreFocusOut: true,
      },
    );
    return picked?.id;
  },

  async askFolders(defaults, validate) {
    const standard = {
      label: "Standard folders",
      detail: `${defaults.components}, ${defaults.hooks}, ${defaults.features}`,
    };
    const custom = {
      label: "Choose folder names",
      detail: "For example src/ui for components",
    };
    const choice = await vscode.window.showQuickPick([standard, custom], {
      title: "Create React Project: folders",
      placeHolder: "Where should components, hooks and features go?",
      ignoreFocusOut: true,
    });
    if (choice === undefined) {
      return undefined;
    }
    if (choice === standard) {
      return defaults;
    }

    const folders = { ...defaults };
    const labels: Record<keyof Manifest["paths"], string> = {
      components: "Folder for shared components",
      hooks: "Folder for shared hooks",
      features: "Folder for features",
    };
    for (const key of ["components", "hooks", "features"] as const) {
      const others = (["components", "hooks", "features"] as const)
        .filter((other) => other !== key)
        .map((other) => folders[other]);
      const value = await vscode.window.showInputBox({
        title: "Create React Project: folders",
        prompt: labels[key],
        value: folders[key],
        validateInput: (input) => validate(input, others),
        ignoreFocusOut: true,
      });
      if (value === undefined) {
        return undefined;
      }
      // The command normalises it with the shared path rules.
      folders[key] = value.trim();
    }
    return folders;
  },

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
