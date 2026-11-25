import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    // Placeholder command proving the extension loads; replaced by real commands in Phase 2.
    vscode.commands.registerCommand("reactArchitect.hello", () => {
      void vscode.window.showInformationMessage("React Architect is running.");
    }),
  );
}
