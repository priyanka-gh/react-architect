import * as vscode from "vscode";
import { createProjectCommand } from "./commands/createProject";
import { generateArtifact } from "./commands/generateArtifact";
import { generatePage } from "./commands/generatePage";
import {
  movePath,
  moveToShared,
  renameFeature,
} from "./commands/refactorFeature";
import {
  chooseStructure,
  importStructure,
  showStructureReport,
} from "./commands/structure";
import { registerProposals } from "./editor/proposals";
import { setUpProjectCommand } from "./commands/setUpProject";
import type { GeneratorId } from "./core/generators";
import { ProjectIndex } from "./editor/projectIndex";
import {
  PROJECT_MAP_VIEW,
  ProjectMapProvider,
  updateContextKeys,
} from "./editor/projectMapView";
import {
  MOVE_PATH_COMMAND,
  registerStructureRules,
} from "./editor/structureRules";

const GENERATE_COMMANDS: Record<string, GeneratorId> = {
  "reactArchitect.generateComponent": "component",
  "reactArchitect.generateHook": "hook",
  "reactArchitect.generateFeature": "feature",
};

export function activate(context: vscode.ExtensionContext): ProjectIndex {
  const output = vscode.window.createOutputChannel("React Architect");
  context.subscriptions.push(output);

  // Structure rules and the Project Map (ADR 11).
  const index = new ProjectIndex(output);
  context.subscriptions.push(
    index,
    registerStructureRules(index),
    index.onDidChange(() => updateContextKeys(index)),
    vscode.window.registerTreeDataProvider(
      PROJECT_MAP_VIEW,
      new ProjectMapProvider(index),
    ),
  );
  void index.refresh();

  /** Commands report their own expected failures; this catches the unexpected ones. */
  const guarded =
    (handler: (...args: unknown[]) => Promise<unknown>) =>
    async (...args: unknown[]) => {
      try {
        await handler(...args);
      } catch (error) {
        output.appendLine(
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
        );
        const choice = await vscode.window.showErrorMessage(
          "React Architect hit an unexpected error.",
          "Show Details",
        );
        if (choice !== undefined) {
          output.show();
        }
      }
    };

  for (const [command, generatorId] of Object.entries(GENERATE_COMMANDS)) {
    context.subscriptions.push(
      // From the Explorer menu the first argument is the clicked folder; from
      // the command palette or a keybinding it's undefined or something else.
      vscode.commands.registerCommand(
        command,
        guarded((target) =>
          generateArtifact(
            generatorId,
            target instanceof vscode.Uri ? target : undefined,
          ),
        ),
      ),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "reactArchitect.createProject",
      guarded(() => createProjectCommand({ output })),
    ),
    vscode.commands.registerCommand(
      "reactArchitect.setUpProject",
      guarded((target) =>
        setUpProjectCommand(target instanceof vscode.Uri ? target : undefined),
      ),
    ),
    vscode.commands.registerCommand(
      "reactArchitect.generatePage",
      guarded((target) =>
        generatePage(target instanceof vscode.Uri ? target : undefined),
      ),
    ),
    vscode.commands.registerCommand(
      "reactArchitect.renameFeature",
      guarded((target) => renameFeature(folderArgument(target))),
    ),
    vscode.commands.registerCommand(
      "reactArchitect.moveToShared",
      guarded((target) => moveToShared(folderArgument(target))),
    ),
    vscode.commands.registerCommand("reactArchitect.refreshProjectMap", () =>
      index.refresh(),
    ),
    // Custom structures (plans/custom-structure.md).
    registerProposals(),
    vscode.commands.registerCommand(
      "reactArchitect.chooseStructure",
      guarded((target) =>
        chooseStructure(target instanceof vscode.Uri ? target : undefined),
      ),
    ),
    vscode.commands.registerCommand(
      "reactArchitect.importStructure",
      guarded((target) =>
        importStructure(target instanceof vscode.Uri ? target : undefined),
      ),
    ),
    vscode.commands.registerCommand(
      "reactArchitect.showStructureReport",
      guarded(() => showStructureReport(index)),
    ),
    vscode.commands.registerCommand(
      MOVE_PATH_COMMAND,
      guarded((source, destination) =>
        source instanceof vscode.Uri && typeof destination === "string"
          ? movePath(source, destination)
          : Promise.resolve(),
      ),
    ),
  );
  return index;
}

/** From the Explorer the argument is a Uri; from the Project Map, a tree item with one. */
function folderArgument(target: unknown): vscode.Uri | undefined {
  if (target instanceof vscode.Uri) return target;
  const feature = (
    target as { feature?: { folder: string }; project?: { root: string } }
  )?.feature;
  const root = (target as { project?: { root: string } })?.project?.root;
  return feature !== undefined && root !== undefined
    ? vscode.Uri.joinPath(vscode.Uri.file(root), ...feature.folder.split("/"))
    : undefined;
}
