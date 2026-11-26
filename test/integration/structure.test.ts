import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { generateArtifact } from "../../src/commands/generateArtifact";
import {
  generatePage,
  type PagePrompts,
} from "../../src/commands/generatePage";
import {
  movePath,
  type RefactorPrompts,
} from "../../src/commands/refactorFeature";
import {
  chooseStructure,
  importStructure,
  showStructureReport,
  type StructurePrompts,
} from "../../src/commands/structure";
import {
  DEFAULT_MANIFEST,
  serializeManifest,
  type Manifest,
} from "../../src/core/manifest/schema";
import { PRESETS } from "../../src/core/structure/presets";
import type { ProjectIndex } from "../../src/editor/projectIndex";
import { ProjectMapProvider } from "../../src/editor/projectMapView";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
) as { publisher: string; name: string };

async function extensionIndex(): Promise<ProjectIndex> {
  const extension = vscode.extensions.getExtension<ProjectIndex>(
    `${packageJson.publisher}.${packageJson.name}`,
  );
  assert.ok(extension);
  return extension.activate();
}

function project(
  files: Record<string, string>,
  manifest: Manifest = DEFAULT_MANIFEST,
) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const root = fs.mkdtempSync(path.join(folder.uri.fsPath, "structure-"));
  const all = {
    "package.json": JSON.stringify({
      dependencies: { react: "*", "react-router": "*" },
    }),
    "react-architect.json": serializeManifest(manifest),
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return {
    root,
    uri: (file: string) => vscode.Uri.file(path.join(root, file)),
    read: (file: string) => fs.readFileSync(path.join(root, file), "utf8"),
    exists: (file: string) => fs.existsSync(path.join(root, file)),
    manifest: () =>
      JSON.parse(
        fs.readFileSync(path.join(root, "react-architect.json"), "utf8"),
      ) as Manifest,
  };
}

async function waitFor<T>(
  what: string,
  check: () => T | undefined | false,
  ms = 15_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const ours = (uri: vscode.Uri) =>
  vscode.languages
    .getDiagnostics(uri)
    .filter((d) => d.source === "React Architect");

interface Answers {
  preset?: string;
  source?: "file" | "folder";
  file?: vscode.Uri;
  folder?: vscode.Uri;
  unknown?: "shared" | "top" | "bottom" | "ignore";
  review?: "apply" | "applyErrors";
  directory?: string;
}

function scripted(answers: Answers) {
  const seen = {
    review: [] as string[],
    unknown: [] as string[],
    errors: [] as string[],
  };
  const base: RefactorPrompts & StructurePrompts = {
    pickWorkspaceFolder: async () => vscode.workspace.workspaceFolders?.[0],
    askName: async () => undefined,
    askYesNo: async () => false,
    confirmCreateManifest: async () => false,
    askConflictChoice: async () => undefined,
    confirmPlan: async () => true,
    showError: (message) => seen.errors.push(message),
    showWarning: () => undefined,
    pickDirectory: async (_title, folders) => {
      assert.ok(
        answers.directory && folders.includes(answers.directory),
        folders.join(", "),
      );
      return answers.directory;
    },
    pickFolder: async () => undefined,
    confirmRefactor: async () => true,
    saveFirst: async () => true,
    showInformation: () => undefined,
    pickPreset: async (presets) =>
      presets.find((preset) => preset.id === answers.preset),
    pickImportSource: async () => answers.source,
    pickFile: async () => answers.file,
    pickProjectFolder: async () => answers.folder,
    askUnknownFolder: async (folder) => {
      seen.unknown.push(folder);
      return answers.unknown;
    },
    reviewStructure: async (_title, lines) => {
      seen.review = lines;
      return answers.review;
    },
  };
  return { prompts: base, seen };
}

suite("Custom structures", () => {
  teardown(() =>
    vscode.commands.executeCommand("workbench.action.closeAllEditors"),
  );

  test("Choose Structure shows the change and its problem count, then applies it", async () => {
    await extensionIndex();
    const app = project({
      "src/features/cart/index.ts": "export const cart = 1;\n",
      "src/features/cart/hooks/useCart.ts": "export const useCart = () => 1;\n",
    });
    const { prompts, seen } = scripted({
      preset: "feature-sliced",
      review: "apply",
    });

    const outcome = await chooseStructure(app.uri("src"), prompts);
    assert.deepStrictEqual(seen.errors, []);
    assert.strictEqual(outcome.status, "applied");
    assert.ok(
      seen.review.includes(
        "Problems now: 0. With this structure: 1 (1 placement).",
      ),
      seen.review.join("\n"),
    );
    const saved = app.manifest();
    assert.deepStrictEqual(
      saved.structure,
      PRESETS.find((p) => p.id === "feature-sliced")!.build(
        DEFAULT_MANIFEST.paths,
      ),
    );
    assert.strictEqual(saved.rules.layers, "warning");

    // The Project Map groups by layer.
    const index = await extensionIndex();
    await index.refresh();
    const real = (folder: string) => fs.realpathSync(folder);
    const mine = index.all.filter((p) => real(p.root) === real(app.root));
    const provider = new ProjectMapProvider({
      all: mine,
      onDidChange: index.onDidChange,
    } as unknown as ProjectIndex);
    const labels = provider
      .getChildren()
      .map((node) => provider.getTreeItem(node).label);
    assert.deepStrictEqual(labels, [
      "Rule problems",
      "app",
      "pages",
      "widgets",
      "features",
      "entities",
      "shared",
    ]);
  });

  test('"Apply as Errors" makes every rule an error', async () => {
    const app = project({});
    const { prompts } = scripted({
      preset: "feature-based",
      review: "applyErrors",
    });
    assert.strictEqual(
      (await chooseStructure(app.uri("."), prompts)).status,
      "applied",
    );
    assert.deepStrictEqual(Object.values(app.manifest().rules), [
      "error",
      "error",
      "error",
      "error",
      "error",
    ]);
  });

  test("Import Structure reads a folder-tree file and asks about unknown folders", async () => {
    const app = project({
      "structure.md": [
        "# Our structure",
        "",
        "```",
        "src/",
        "├── app/",
        "├── features/",
        "│   └── billing/",
        "│       ├── components/",
        "│       ├── hooks/",
        "│       └── index.ts",
        "├── kitchen/",
        "└── components/",
        "```",
      ].join("\n"),
    });
    const { prompts, seen } = scripted({
      source: "file",
      file: app.uri("structure.md"),
      unknown: "bottom",
      review: "apply",
    });

    assert.strictEqual(
      (await importStructure(app.uri("."), prompts)).status,
      "applied",
      seen.errors.join(" "),
    );
    assert.deepStrictEqual(seen.unknown, ["src/kitchen"]);
    assert.deepStrictEqual(
      app
        .manifest()
        .structure?.layers.map((layer) => [
          layer.name,
          layer.paths.join(" "),
          layer.mayImport.join(" "),
        ]),
      [
        ["app", "src/app", "features shared kitchen"],
        ["features", "src/features/*", "shared kitchen"],
        ["shared", "src/components", "kitchen"],
        ["kitchen", "src/kitchen", ""],
      ],
    );
  });

  test("Import Structure copies another project's structure", async () => {
    const source = project(
      {},
      {
        ...DEFAULT_MANIFEST,
        structure: PRESETS[2]!.build(DEFAULT_MANIFEST.paths),
      },
    );
    const app = project({});
    const { prompts } = scripted({
      source: "folder",
      folder: vscode.Uri.file(source.root),
      review: "apply",
    });
    assert.strictEqual(
      (await importStructure(app.uri("."), prompts)).status,
      "applied",
    );
    assert.deepStrictEqual(
      app.manifest().structure,
      source.manifest().structure,
    );
  });

  test("placement problems offer a move, which updates imports; baselined problems are quiet", async () => {
    const structure = PRESETS[0]!.build(DEFAULT_MANIFEST.paths);
    const app = project(
      {
        "src/features/cart/index.ts": 'export { useCart } from "./useCart";\n',
        "src/features/cart/useCart.ts": "export const useCart = () => 1;\n",
        "src/features/cart/helpers.ts": "export const helper = 1;\n",
        "react-architect-baseline.json": JSON.stringify({
          version: 1,
          problems: [
            {
              rule: "placement",
              file: "src/features/cart/helpers.ts",
              target: "src/features/cart/helpers.ts",
              count: 1,
            },
          ],
        }),
      },
      { ...DEFAULT_MANIFEST, structure },
    );
    const index = await extensionIndex();
    await index.refresh();

    const hook = app.uri("src/features/cart/useCart.ts");
    const [problem] = await waitFor(
      "the placement problem",
      () => ours(hook).length > 0 && ours(hook),
    );
    assert.strictEqual(problem!.code, "placement");
    assert.strictEqual(problem!.severity, vscode.DiagnosticSeverity.Warning);
    const helper = await waitFor("the baselined problem", () => {
      const found = ours(app.uri("src/features/cart/helpers.ts"));
      return found.length > 0 && found;
    });
    assert.strictEqual(
      helper[0]!.severity,
      vscode.DiagnosticSeverity.Information,
    );
    assert.match(
      helper[0]!.message,
      /listed in react-architect-baseline\.json/,
    );

    await vscode.window.showTextDocument(hook);
    // The first request after a file opens can be dropped while the editor
    // settles, so ask again until the fix appears, as the lightbulb does.
    let move: vscode.CodeAction | undefined;
    for (let attempt = 0; attempt < 50 && move === undefined; attempt += 1) {
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        "vscode.executeCodeActionProvider",
        hook,
        problem!.range,
      );
      move = actions.find(
        (action) => action.title === "Move to src/features/cart/hooks/",
      );
      if (move === undefined)
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(move?.command, "no Move to hooks/ quick fix");
    assert.deepStrictEqual(
      move.command.arguments?.[1],
      "src/features/cart/hooks/useCart.ts",
    );

    const { prompts } = scripted({});
    const outcome = await movePath(
      hook,
      "src/features/cart/hooks/useCart.ts",
      prompts,
    );
    assert.strictEqual(outcome.status, "done");
    assert.ok(app.exists("src/features/cart/hooks/useCart.ts"));
    assert.strictEqual(
      app.read("src/features/cart/index.ts"),
      'export { useCart } from "./hooks/useCart";\n',
    );

    const report = await showStructureReport({
      ...index,
      all: index.all.filter(
        (p) => fs.realpathSync(p.root) === fs.realpathSync(app.root),
      ),
      projectFor: () => undefined,
    } as unknown as ProjectIndex);
    assert.match(report ?? "", /^# Structure report: /);
  });

  test("generators follow a Feature-Sliced Design structure", async () => {
    const structure = PRESETS.find((p) => p.id === "feature-sliced")!.build(
      DEFAULT_MANIFEST.paths,
    );
    const app = project(
      {
        "src/app/routes.tsx": [
          'import { createBrowserRouter } from "react-router";',
          "",
          "export const router = createBrowserRouter([]);",
          "",
        ].join("\n"),
      },
      { ...DEFAULT_MANIFEST, structure },
    );
    await vscode.window.showTextDocument(app.uri("package.json"));
    const { prompts } = scripted({ directory: "src/entities" });
    const outcome = await generateArtifact("feature", undefined, {
      ...prompts,
      askName: async () => "user",
    });
    assert.strictEqual(outcome.status, "generated", JSON.stringify(outcome));
    for (const file of [
      "ui/User/User.tsx",
      "model/useUser.ts",
      "api/userApi.ts",
      "model/types.ts",
      "index.ts",
    ]) {
      assert.ok(app.exists(`src/entities/user/${file}`), file);
    }

    const pagePrompts: PagePrompts = {
      ...prompts,
      askName: async () => "settings",
      pickFeature: async () =>
        assert.fail("pages go in the pages layer, so no feature is asked for"),
      askRoutePath: async (suggested) => suggested,
    };
    const page = await generatePage(app.uri("src"), pagePrompts);
    assert.strictEqual(page.status, "generated", JSON.stringify(page));
    assert.ok(app.exists("src/pages/settings/ui/SettingsPage.tsx"));
    assert.strictEqual(
      app.read("src/pages/settings/index.ts"),
      'export { SettingsPage } from "./ui/SettingsPage";\n',
    );
    assert.ok(
      app
        .read("src/app/routes.tsx")
        .includes('import { SettingsPage } from "../pages/settings";'),
    );
  });
});
