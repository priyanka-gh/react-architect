import * as assert from "node:assert";
import * as vscode from "vscode";

const EXTENSION_ID = "your-publisher-id.react-architect";

suite("Extension", () => {
  test("activates", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(
      extension,
      `${EXTENSION_ID} is not installed in the test instance`,
    );
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  test("registers the hello command", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("reactArchitect.hello"));
    await vscode.commands.executeCommand("reactArchitect.hello");
  });
});
