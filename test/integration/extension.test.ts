import * as assert from "node:assert";
import * as vscode from "vscode";

const EXTENSION_ID = "your-publisher-id.react-architect";
const COMMANDS = [
  "reactArchitect.generateComponent",
  "reactArchitect.generateHook",
  "reactArchitect.generateFeature",
];

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

  test("registers the generate commands", async () => {
    const registered = await vscode.commands.getCommands(true);
    for (const command of COMMANDS) {
      assert.ok(registered.includes(command), `${command} is not registered`);
    }
  });

  test("puts the generate commands in the Explorer's folder menu", () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const menus = extension?.packageJSON.contributes.menus as Record<
      string,
      { command?: string; submenu?: string; when?: string }[]
    >;
    const entry = menus["explorer/context"]?.[0];
    assert.strictEqual(entry?.when, "explorerResourceIsFolder");
    const submenu = menus[entry?.submenu ?? ""] ?? [];
    assert.deepStrictEqual(
      submenu.map((item) => item.command),
      COMMANDS,
    );
  });
});
