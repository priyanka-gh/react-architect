import * as vscode from "vscode";
import type { GeneratorId } from "./core/generators";
import { generateArtifact } from "./commands/generateArtifact";

const GENERATE_COMMANDS: Record<string, GeneratorId> = {
  "reactArchitect.generateComponent": "component",
  "reactArchitect.generateHook": "hook",
  "reactArchitect.generateFeature": "feature",
};

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("React Architect");
  context.subscriptions.push(output);

  for (const [command, generatorId] of Object.entries(GENERATE_COMMANDS)) {
    context.subscriptions.push(
      // From the Explorer menu the first argument is the clicked folder; from
      // the command palette or a keybinding it's undefined or something else.
      vscode.commands.registerCommand(command, async (target?: unknown) => {
        try {
          await generateArtifact(
            generatorId,
            target instanceof vscode.Uri ? target : undefined,
          );
        } catch (error) {
          output.appendLine(
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
          );
          void vscode.window
            .showErrorMessage(
              "React Architect hit an unexpected error.",
              "Show Details",
            )
            .then((choice) => choice && output.show());
        }
      }),
    );
  }
}
