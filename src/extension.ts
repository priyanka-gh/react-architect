import * as vscode from "vscode";
import { createProjectCommand } from "./commands/createProject";
import { generateArtifact } from "./commands/generateArtifact";
import { setUpProjectCommand } from "./commands/setUpProject";
import type { GeneratorId } from "./core/generators";

const GENERATE_COMMANDS: Record<string, GeneratorId> = {
  "reactArchitect.generateComponent": "component",
  "reactArchitect.generateHook": "hook",
  "reactArchitect.generateFeature": "feature",
};

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("React Architect");
  context.subscriptions.push(output);

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
  );
}
