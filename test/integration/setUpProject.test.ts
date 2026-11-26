import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Prompts } from "../../src/commands/prompts";
import { setUpProjectCommand } from "../../src/commands/setUpProject";
import { parseManifest } from "../../src/core/manifest/schema";

function prompts(answer: boolean) {
  const calls: string[] = [];
  const value: Prompts = {
    pickWorkspaceFolder: async () => vscode.workspace.workspaceFolders?.[0],
    askName: async () => undefined,
    askYesNo: async () => undefined,
    confirmCreateManifest: async () => {
      calls.push("confirm");
      return answer;
    },
    askConflictChoice: async () => undefined,
    confirmPlan: async () => true,
    showError: (message) => calls.push(`error: ${message}`),
    showWarning: (message) => calls.push(`warning: ${message}`),
  };
  return { value, calls };
}

function makeProject(files: Record<string, string>): string {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const root = fs.mkdtempSync(path.join(workspace, "setup-"));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

suite("Set Up Existing Project", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("writes the suggested settings and opens them", async () => {
    const root = makeProject({
      "package.json": JSON.stringify({ dependencies: { react: "^19" } }),
      "tsconfig.json": "{}",
      "src/modules/cart/index.ts": "",
    });
    const { value, calls } = prompts(true);

    const outcome = await setUpProjectCommand(
      vscode.Uri.file(path.join(root, "src")),
      value,
    );

    assert.strictEqual(outcome, "created");
    assert.deepStrictEqual(calls, ["confirm"]);
    const result = parseManifest(
      fs.readFileSync(path.join(root, "react-architect.json"), "utf8"),
    );
    assert.ok(result.ok);
    assert.strictEqual(result.manifest.paths.features, "src/modules");
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.fsPath,
      path.join(root, "react-architect.json"),
    );
  });

  test("writes nothing when the suggestion is declined", async () => {
    const root = makeProject({ "package.json": "{}" });
    const outcome = await setUpProjectCommand(
      vscode.Uri.file(root),
      prompts(false).value,
    );
    assert.strictEqual(outcome, "cancelled");
    assert.ok(!fs.existsSync(path.join(root, "react-architect.json")));
  });

  test("opens the existing file when the project is already set up", async () => {
    const root = makeProject({
      "package.json": "{}",
      "react-architect.json": '{ "manifestVersion": 1 }\n',
    });
    const { value, calls } = prompts(true);

    const outcome = await setUpProjectCommand(vscode.Uri.file(root), value);

    assert.strictEqual(outcome, "alreadySetUp");
    assert.ok(!calls.includes("confirm"));
    assert.strictEqual(
      fs.readFileSync(path.join(root, "react-architect.json"), "utf8"),
      '{ "manifestVersion": 1 }\n',
    );
  });
});
