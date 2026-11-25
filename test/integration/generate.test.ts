import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { generateArtifact } from "../../src/commands/generateArtifact";
import type { Prompts } from "../../src/commands/prompts";
import type { ConflictChoice } from "../../src/core/conflicts";
import {
  DEFAULT_MANIFEST,
  serializeManifest,
} from "../../src/core/manifest/schema";
import { componentSource } from "../../src/core/templates/component";

/** Answers for every question a generate command might ask. */
interface Script {
  name?: string;
  /** Answers to yes/no questions, in the order they are asked. */
  yesNo?: boolean[];
  createManifest?: boolean;
  conflict?: ConflictChoice;
  confirm?: boolean;
}

function scripted(script: Script) {
  const asked: string[] = [];
  const errors: string[] = [];
  const yesNo = [...(script.yesNo ?? [])];
  let previewLines: string[] = [];

  const prompts: Prompts = {
    pickWorkspaceFolder: async () => vscode.workspace.workspaceFolders?.[0],
    askName: async ({ validate }) => {
      asked.push("name");
      if (script.name !== undefined) {
        assert.strictEqual(validate(script.name), undefined);
      }
      return script.name;
    },
    askYesNo: async (question) => {
      asked.push(question);
      return yesNo.shift();
    },
    confirmCreateManifest: async () => {
      asked.push("create manifest");
      return script.createManifest ?? false;
    },
    askConflictChoice: async (files) => {
      asked.push(`conflict: ${files.join(", ")}`);
      return script.conflict;
    },
    confirmPlan: async (title, lines) => {
      asked.push(title);
      previewLines = lines;
      return script.confirm ?? true;
    },
    showError: (message) => errors.push(message),
    showWarning: () => undefined,
  };
  return { prompts, asked, errors, previewLines: () => previewLines };
}

const workspaceRoot = () => {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the test run must open a workspace folder");
  return folder.uri.fsPath;
};

/**
 * Creates a project folder in the test workspace with the given files. Each
 * gets a unique name, because test runs against different VS Code versions
 * share the workspace.
 */
function project(
  files: Record<string, string>,
  options: { manifest?: boolean } = {},
) {
  const root = fs.mkdtempSync(path.join(workspaceRoot(), "project-"));
  const all: Record<string, string> = { "package.json": "{}\n", ...files };
  if (options.manifest !== false) {
    all["react-architect.json"] = serializeManifest(DEFAULT_MANIFEST);
  }
  for (const [file, content] of Object.entries(all)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (file.endsWith("/")) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.writeFileSync(target, content);
    }
  }
  return {
    root,
    uri: (relative = ".") => vscode.Uri.file(path.join(root, relative)),
    read: (relative: string) =>
      fs.readFileSync(path.join(root, relative), "utf8"),
    exists: (relative: string) => fs.existsSync(path.join(root, relative)),
    list: (relative: string) => fs.readdirSync(path.join(root, relative)),
  };
}

suite("Generate commands", () => {
  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("palette: generates a component in the manifest's components folder", async () => {
    const app = project({});
    await vscode.window.showTextDocument(app.uri("package.json"));
    const { prompts, asked, errors, previewLines } = scripted({
      name: "user card",
      yesNo: [true],
    });

    const outcome = await generateArtifact("component", undefined, prompts);

    assert.deepStrictEqual(errors, []);
    assert.strictEqual(outcome.status, "generated");
    assert.deepStrictEqual(asked, [
      "name",
      "Include a test for UserCard?",
      "Generate component UserCard?",
    ]);
    assert.deepStrictEqual(previewLines(), [
      "New  src/components/UserCard/UserCard.tsx",
      "New  src/components/UserCard/UserCard.module.css",
      "New  src/components/UserCard/UserCard.test.tsx",
    ]);
    assert.strictEqual(
      app.read("src/components/UserCard/UserCard.tsx"),
      componentSource({ name: "UserCard", withStyles: true }),
    );
    assert.ok(app.exists("src/components/UserCard/UserCard.module.css"));
    assert.ok(app.exists("src/components/UserCard/UserCard.test.tsx"));
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.fsPath,
      app.uri("src/components/UserCard/UserCard.tsx").fsPath,
    );
  });

  test("Explorer: generates into the clicked folder", async () => {
    const app = project({ "src/widgets/": "" });
    const { prompts } = scripted({ name: "cart", yesNo: [false] });

    const outcome = await generateArtifact(
      "hook",
      app.uri("src/widgets"),
      prompts,
    );

    assert.strictEqual(outcome.status, "generated");
    assert.deepStrictEqual(app.list("src/widgets"), ["useCart.ts"]);
  });

  test("creates react-architect.json first when the project has none", async () => {
    const app = project({ "src/": "" }, { manifest: false });
    const { prompts, asked } = scripted({
      name: "cart",
      createManifest: true,
      yesNo: [false],
    });

    const outcome = await generateArtifact("hook", app.uri("src"), prompts);

    assert.strictEqual(outcome.status, "generated");
    assert.strictEqual(asked[0], "create manifest");
    assert.strictEqual(
      app.read("react-architect.json"),
      serializeManifest(DEFAULT_MANIFEST),
    );
    assert.ok(app.exists("src/useCart.ts"));
  });

  test("writes nothing when the user declines to create react-architect.json", async () => {
    const app = project({ "src/": "" }, { manifest: false });
    const { prompts } = scripted({ name: "cart", createManifest: false });

    const outcome = await generateArtifact("hook", app.uri("src"), prompts);

    assert.strictEqual(outcome.status, "cancelled");
    assert.ok(!app.exists("react-architect.json"));
    assert.deepStrictEqual(app.list("src"), []);
  });

  test("exports a hook from its feature's index.ts, once", async () => {
    const existing = 'export { Shop } from "./components/Shop/Shop";\n';
    const app = project({
      "src/features/shop/index.ts": existing,
      "src/features/shop/hooks/": "",
    });
    const exportLine = 'export { useCheckout } from "./hooks/useCheckout";\n';

    const first = scripted({ name: "checkout", yesNo: [false, true] });
    await generateArtifact(
      "hook",
      app.uri("src/features/shop/hooks"),
      first.prompts,
    );
    assert.deepStrictEqual(first.errors, []);
    assert.strictEqual(
      app.read("src/features/shop/index.ts"),
      existing + exportLine,
    );

    // Running it again skips the existing hook and doesn't repeat the export.
    const second = scripted({
      name: "checkout",
      yesNo: [false, true],
      conflict: "skip",
    });
    await generateArtifact(
      "hook",
      app.uri("src/features/shop/hooks"),
      second.prompts,
    );
    assert.ok(
      second.asked.includes("conflict: src/features/shop/hooks/useCheckout.ts"),
    );
    assert.strictEqual(
      app.read("src/features/shop/index.ts"),
      existing + exportLine,
    );
  });

  test("Skip Existing keeps the user's file and writes the rest", async () => {
    const app = project({ "src/components/Card/Card.tsx": "// mine\n" });
    await vscode.window.showTextDocument(app.uri("package.json"));
    const { prompts } = scripted({
      name: "card",
      yesNo: [false],
      conflict: "skip",
    });

    await generateArtifact("component", undefined, prompts);

    assert.strictEqual(app.read("src/components/Card/Card.tsx"), "// mine\n");
    assert.ok(app.exists("src/components/Card/Card.module.css"));
  });

  test("Overwrite replaces the user's file after they agree", async () => {
    const app = project({ "src/components/Card/Card.tsx": "// mine\n" });
    await vscode.window.showTextDocument(app.uri("package.json"));
    const { prompts, previewLines } = scripted({
      name: "card",
      yesNo: [false],
      conflict: "overwrite",
    });

    await generateArtifact("component", undefined, prompts);

    assert.strictEqual(
      app.read("src/components/Card/Card.tsx"),
      componentSource({ name: "Card", withStyles: true }),
    );
    assert.strictEqual(
      previewLines()[0],
      "Replace  src/components/Card/Card.tsx",
    );
  });

  test("refuses names that differ from existing ones only by letter case", async () => {
    const app = project({ "src/components/card/": "" });
    await vscode.window.showTextDocument(app.uri("package.json"));
    const { prompts, errors, asked } = scripted({
      name: "card",
      yesNo: [false],
    });

    const outcome = await generateArtifact("component", undefined, prompts);

    assert.strictEqual(outcome.status, "failed");
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0] ?? "", /different capital letters/);
    assert.ok(!asked.some((question) => question.startsWith("Generate")));
    assert.deepStrictEqual(app.list("src/components/card"), []);
  });

  test("writes nothing when the preview is dismissed", async () => {
    const app = project({ "src/": "" });
    const { prompts } = scripted({
      name: "shop",
      yesNo: [true],
      confirm: false,
    });

    const outcome = await generateArtifact("feature", app.uri("src"), prompts);

    assert.strictEqual(outcome.status, "cancelled");
    assert.deepStrictEqual(app.list("src"), []);
  });

  test("writes nothing when the name prompt is dismissed", async () => {
    const app = project({ "src/": "" });
    const { prompts, asked } = scripted({});

    const outcome = await generateArtifact(
      "component",
      app.uri("src"),
      prompts,
    );

    assert.strictEqual(outcome.status, "cancelled");
    assert.deepStrictEqual(asked, ["name"]);
    assert.deepStrictEqual(app.list("src"), []);
  });
});
