import * as assert from "node:assert";
import * as vscode from "vscode";

import * as fs from "node:fs";
import * as path from "node:path";

// Read from package.json, so changing the publisher doesn't break the tests.
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
) as { publisher: string; name: string };
const EXTENSION_ID = `${manifest.publisher}.${manifest.name}`;
const COMMANDS = [
  "reactArchitect.generateComponent",
  "reactArchitect.generateHook",
  "reactArchitect.generateFeature",
  "reactArchitect.setUpProject",
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

  test("registers every command", async () => {
    const registered = await vscode.commands.getCommands(true);
    for (const command of [...COMMANDS, "reactArchitect.createProject"]) {
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
