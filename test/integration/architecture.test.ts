import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  generatePage,
  type PagePrompts,
} from "../../src/commands/generatePage";
import {
  moveToShared,
  renameFeature,
  type RefactorPrompts,
} from "../../src/commands/refactorFeature";
import {
  DEFAULT_MANIFEST,
  serializeManifest,
} from "../../src/core/manifest/schema";
import { ProjectMapProvider } from "../../src/editor/projectMapView";
import type { ProjectIndex } from "../../src/editor/projectIndex";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
) as { publisher: string; name: string };
const EXTENSION_ID = `${packageJson.publisher}.${packageJson.name}`;

async function extensionIndex(): Promise<ProjectIndex> {
  const extension = vscode.extensions.getExtension<ProjectIndex>(EXTENSION_ID);
  assert.ok(extension);
  return extension.activate();
}

function project(files: Record<string, string>) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder);
  const root = fs.mkdtempSync(path.join(folder.uri.fsPath, "architecture-"));
  const all = {
    "package.json": JSON.stringify({
      dependencies: { react: "*", "react-router": "*" },
    }),
    "react-architect.json": serializeManifest(DEFAULT_MANIFEST),
    ...files,
  };
  for (const [file, content] of Object.entries(all)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return {
    root,
    uri: (file: string) => vscode.Uri.file(path.join(root, file)),
    read: (file: string) => fs.readFileSync(path.join(root, file), "utf8"),
    exists: (file: string) => fs.existsSync(path.join(root, file)),
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

const ourDiagnostics = (uri: vscode.Uri) =>
  vscode.languages
    .getDiagnostics(uri)
    .filter((d) => d.source === "React Architect");

const FILES = {
  "src/features/profile/index.ts":
    'export { Profile } from "./components/Profile/Profile";\n',
  "src/features/profile/components/Profile/Profile.tsx":
    "export function Profile() {\n  return null;\n}\n",
  "src/features/profile/components/Avatar/Avatar.tsx":
    "export function Avatar() {\n  return null;\n}\n",
  "src/features/cart/Cart.tsx":
    'import { Avatar } from "../profile/components/Avatar/Avatar";\n\nexport const cart = Avatar;\n',
  "src/components/Header/Header.tsx":
    'import { Profile } from "../../features/profile";\n\nexport const header = Profile;\n',
};

function refactorPrompts(answers: { name?: string; confirm?: boolean }) {
  const shown: { lines: string[]; info: string[]; errors: string[] } = {
    lines: [],
    info: [],
    errors: [],
  };
  const prompts: RefactorPrompts = {
    pickWorkspaceFolder: async () => vscode.workspace.workspaceFolders?.[0],
    askName: async ({ validate }) => {
      if (answers.name !== undefined)
        assert.strictEqual(validate(answers.name), undefined);
      return answers.name;
    },
    askYesNo: async () => true,
    confirmCreateManifest: async () => false,
    askConflictChoice: async () => undefined,
    confirmPlan: async () => true,
    showError: (message) => shown.errors.push(message),
    showWarning: () => undefined,
    pickFolder: async () => undefined,
    confirmRefactor: async (_title, lines) => {
      shown.lines = lines;
      return answers.confirm ?? true;
    },
    saveFirst: async () => true,
    showInformation: (message) => shown.info.push(message),
  };
  return { prompts, shown };
}

suite("Structure rules and Project Map", () => {
  teardown(() =>
    vscode.commands.executeCommand("workbench.action.closeAllEditors"),
  );

  test("squiggles imports that break the rules, and fixes them through the feature's index", async () => {
    const index = await extensionIndex();
    const app = project(FILES);
    await index.refresh();

    const cart = app.uri("src/features/cart/Cart.tsx");
    const [problem] = await waitFor("the entry problem", () => {
      const found = ourDiagnostics(cart);
      return found.length > 0 && found;
    });
    assert.strictEqual(problem!.code, "entry");
    assert.strictEqual(problem!.severity, vscode.DiagnosticSeverity.Warning);
    assert.match(problem!.message, /reaches inside the "profile" feature/);

    const header = await waitFor("the layers problem", () => {
      const found = ourDiagnostics(app.uri("src/components/Header/Header.tsx"));
      return found.length > 0 && found;
    });
    assert.strictEqual(header[0]!.code, "layers");

    // The lightbulb fix.
    const document = await vscode.workspace.openTextDocument(cart);
    await vscode.window.showTextDocument(document);
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      "vscode.executeCodeActionProvider",
      cart,
      problem!.range,
    );
    const fix = actions.find((action) =>
      action.title.startsWith('Import from the "profile" feature'),
    );
    assert.ok(
      fix?.edit,
      `no fix among: ${actions.map((a) => a.title).join(", ")}`,
    );
    assert.strictEqual(
      fix.title,
      'Import from the "profile" feature and export Avatar from its index.ts',
    );
    assert.ok(await vscode.workspace.applyEdit(fix.edit));
    // VS Code runs the action's command after its edit; that saves the index.
    assert.ok(fix.command);
    await vscode.commands.executeCommand(
      fix.command.command,
      ...(fix.command.arguments ?? []),
    );
    await vscode.workspace.saveAll(false);

    assert.strictEqual(
      app.read("src/features/cart/Cart.tsx").split("\n")[0],
      'import { Avatar } from "../profile";',
    );
    assert.strictEqual(
      app.read("src/features/profile/index.ts"),
      'export { Profile } from "./components/Profile/Profile";\nexport { Avatar } from "./components/Avatar/Avatar";\n',
    );
    await waitFor(
      "the problem to clear",
      () => ourDiagnostics(cart).length === 0,
    );
  });

  test("updates as you type, before saving", async () => {
    const index = await extensionIndex();
    const app = project({
      ...FILES,
      "src/features/cart/Cart.tsx": "export const cart = 1;\n",
    });
    await index.refresh();
    const cart = app.uri("src/features/cart/Cart.tsx");
    const editor = await vscode.window.showTextDocument(cart);
    await editor.edit((edit) =>
      edit.insert(
        new vscode.Position(0, 0),
        'import { Avatar } from "../profile/components/Avatar/Avatar";\n',
      ),
    );
    await waitFor(
      "a problem in the unsaved file",
      () => ourDiagnostics(cart).length === 1,
    );
    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  test("the Project Map lists features, problems and cycles", async () => {
    const index = await extensionIndex();
    const app = project({
      ...FILES,
      "src/features/profile/components/Profile/Profile.tsx":
        'import { cart } from "../../../cart";\nexport const Profile = cart;\n',
      "src/features/cart/index.ts": 'export { cart } from "./Cart";\n',
      "src/features/cart/Cart.tsx":
        'import { Profile } from "../profile";\nexport const cart = Profile;\n',
    });
    await index.refresh();

    // Only this test's project, as the view shows it in a workspace with one project.
    const real = (folder: string) => fs.realpathSync(folder);
    const mine = index.all.filter((p) => real(p.root) === real(app.root));
    assert.strictEqual(
      mine.length,
      1,
      `project not indexed; have ${index.all.map((p) => p.root).join(", ")}`,
    );
    const only = {
      all: mine,
      onDidChange: index.onDidChange,
    } as unknown as ProjectIndex;
    const provider = new ProjectMapProvider(only);
    const top = provider
      .getChildren()
      .map((node) => provider.getTreeItem(node));
    assert.deepStrictEqual(
      top.map((item) => [item.label, item.description]),
      [
        ["Rule problems", "1"],
        ["Dependency cycles", "1"],
        ["cart", "uses 1 · used by 1"],
        ["profile", "uses 1 · used by 2"],
      ],
    );
    const cycles = provider.getChildren(provider.getChildren()[1]);
    assert.strictEqual(
      provider.getTreeItem(cycles[0]!).label,
      "cart → profile → cart",
    );
  });

  test("Generate Page adds the page to its feature and to the routes", async () => {
    const app = project({
      "src/app/routes.tsx": [
        'import { createBrowserRouter } from "react-router";',
        'import { AppLayout } from "../components/layout/AppLayout/AppLayout";',
        'import { Home } from "../features/home";',
        "",
        "export const router = createBrowserRouter([",
        "  {",
        '    path: "/",',
        "    element: <AppLayout />,",
        "    children: [{ index: true, element: <Home /> }],",
        "  },",
        "]);",
        "",
      ].join("\n"),
      "src/features/home/index.ts":
        'export { Home } from "./components/Home/Home";\n',
    });
    let preview: string[] = [];
    const prompts: PagePrompts = {
      ...refactorPrompts({}).prompts,
      askName: async () => "settings",
      askYesNo: async () => true,
      pickFeature: async (_page, choices) => {
        assert.deepStrictEqual(choices[0], {
          folder: "src/features/settings",
          isNew: true,
        });
        return choices[0];
      },
      askRoutePath: async (suggested) => {
        assert.strictEqual(suggested, "/settings");
        return suggested;
      },
      confirmPlan: async (_title, lines) => {
        preview = lines;
        return true;
      },
    };

    const outcome = await generatePage(app.uri("src"), prompts);
    assert.strictEqual(outcome.status, "generated", JSON.stringify(outcome));
    assert.deepStrictEqual(preview, [
      "New  src/features/settings/pages/SettingsPage.tsx",
      "New  src/features/settings/pages/SettingsPage.test.tsx",
      "Update  src/features/settings/index.ts",
      "Update  src/app/routes.tsx  (adds the /settings route)",
    ]);
    assert.strictEqual(
      app.read("src/features/settings/index.ts"),
      'export { SettingsPage } from "./pages/SettingsPage";\n',
    );
    const routes = app.read("src/app/routes.tsx");
    assert.ok(
      routes.includes('import { SettingsPage } from "../features/settings";'),
    );
    assert.ok(
      routes.includes('      { path: "settings", element: <SettingsPage /> },'),
    );
  });

  test("Rename Feature renames the folder, files, names and every import", async () => {
    const app = project({
      "src/features/user-profile/index.ts":
        'export { UserProfile } from "./components/UserProfile/UserProfile";\n',
      "src/features/user-profile/components/UserProfile/UserProfile.tsx":
        'import styles from "./UserProfile.module.css";\n\nexport function UserProfile() {\n  return <div className={styles.root} />;\n}\n',
      "src/features/user-profile/components/UserProfile/UserProfile.module.css":
        ".root {\n}\n",
      "src/app/App.tsx":
        'import { UserProfile } from "../features/user-profile";\n\nexport const App = () => <UserProfile />;\n',
    });
    const { prompts, shown } = refactorPrompts({ name: "account" });

    const outcome = await renameFeature(
      app.uri("src/features/user-profile"),
      prompts,
    );
    assert.strictEqual(outcome.status, "done", shown.errors.join(" "));
    assert.strictEqual(
      shown.lines[0],
      "Move  src/features/user-profile  →  src/features/account",
    );
    assert.ok(shown.lines.includes("Rename in code: UserProfile → Account"));

    assert.ok(!app.exists("src/features/user-profile"));
    assert.ok(
      app.exists("src/features/account/components/Account/Account.module.css"),
    );
    assert.strictEqual(
      app.read("src/features/account/components/Account/Account.tsx"),
      'import styles from "./Account.module.css";\n\nexport function Account() {\n  return <div className={styles.root} />;\n}\n',
    );
    assert.strictEqual(
      app.read("src/features/account/index.ts"),
      'export { Account } from "./components/Account/Account";\n',
    );
    assert.strictEqual(
      app.read("src/app/App.tsx"),
      'import { Account } from "../features/account";\n\nexport const App = () => <Account />;\n',
    );
  });

  test("Move to Shared Components moves the folder and fixes imports both ways", async () => {
    const app = project({
      "src/features/cart/index.ts":
        'export { Price } from "./components/Price/Price";\n',
      "src/features/cart/components/Price/Price.tsx":
        'import { useCart } from "../../hooks/useCart";\n\nexport const Price = useCart;\n',
      "src/features/cart/hooks/useCart.ts": "export const useCart = () => 1;\n",
    });
    const { prompts, shown } = refactorPrompts({});

    const outcome = await moveToShared(
      app.uri("src/features/cart/components/Price"),
      prompts,
    );
    assert.strictEqual(outcome.status, "done", shown.errors.join(" "));
    assert.ok(
      shown.lines.some((line) =>
        line.includes("shared code would depend on that feature"),
      ),
    );
    assert.strictEqual(
      app.read("src/components/Price/Price.tsx"),
      'import { useCart } from "../../features/cart/hooks/useCart";\n\nexport const Price = useCart;\n',
    );
    assert.strictEqual(
      app.read("src/features/cart/index.ts"),
      'export { Price } from "../../components/Price/Price";\n',
    );
  });
});
