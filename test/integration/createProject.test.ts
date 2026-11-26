/**
 * The Create React Project command's own behaviour: questions, cleanup and
 * retry. Programs are faked here; test/e2e runs the real create-vite and npm.
 */
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { createProjectCommand } from "../../src/commands/createProject";
import type { ProjectPrompts } from "../../src/commands/prompts";
import type { RunCommand } from "../../src/core/project/createProject";

interface Script {
  name: string;
  routing?: boolean;
  install?: boolean;
  deleteOnFailure?: boolean;
  /** Answers to "npm install failed", in order. */
  installFailed?: ("retry" | "open" | "output" | undefined)[];
}

function scripted(parent: string, script: Script) {
  const asked: string[] = [];
  const installAnswers = [...(script.installFailed ?? [])];
  const prompts: ProjectPrompts = {
    pickParentFolder: async () => vscode.Uri.file(parent),
    askProjectName: async (validate) => {
      asked.push("name");
      assert.strictEqual(await validate(script.name), undefined);
      return script.name;
    },
    askYesNo: async (question) => {
      asked.push(question);
      return question.startsWith("Add routing")
        ? (script.routing ?? true)
        : (script.install ?? true);
    },
    // Never open the folder: that would reload the test window.
    projectCreated: async () => {
      asked.push("created");
      return undefined;
    },
    installFailed: async () => {
      asked.push("install failed");
      return installAnswers.shift();
    },
    confirmDelete: async (folder) => {
      asked.push(`delete ${path.basename(folder)}`);
      return script.deleteOnFailure ?? false;
    },
    showError: async (message) => {
      asked.push(`error: ${message}`);
      return undefined;
    },
    showWarning: () => undefined,
  };
  return { prompts, asked };
}

/** Pretends to be node, create-vite and npm. */
function fakePrograms(
  options: { scaffoldFails?: boolean; installFailures?: number } = {},
) {
  let installFailures = options.installFailures ?? 0;
  const run: RunCommand = async (command, args, { cwd }) => {
    if (command === "node") {
      return { output: "v24.15.0\n" };
    }
    if (args[0] === "exec") {
      const root = path.join(cwd, args[5] ?? "");
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      fs.writeFileSync(path.join(root, "src/App.tsx"), "vite's app");
      if (options.scaffoldFails) {
        throw new Error("create-vite crashed");
      }
      fs.writeFileSync(path.join(root, "package.json"), '{ "name": "x" }\n');
      return { output: "" };
    }
    if (args[0] === "install" && installFailures > 0) {
      installFailures--;
      throw new Error("ETIMEDOUT");
    }
    return { output: "" };
  };
  return run;
}

suite("Create React Project", () => {
  const output = vscode.window.createOutputChannel("React Architect tests");
  let parent: string;

  setup(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), "react-architect-create-"));
  });
  teardown(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });

  test("creates the project and offers to open it", async () => {
    const { prompts, asked } = scripted(parent, {
      name: "my-app",
      install: false,
    });

    const result = await createProjectCommand({
      output,
      prompts,
      run: fakePrograms(),
    });

    assert.strictEqual(result?.status, "created");
    assert.deepStrictEqual(asked, [
      "name",
      "Add routing with React Router?",
      "Install packages now (npm install)?",
      "created",
    ]);
    const root = path.join(parent, "my-app");
    assert.ok(fs.existsSync(path.join(root, "react-architect.json")));
    assert.ok(fs.existsSync(path.join(root, "src/app/routes.tsx")));
    assert.ok(
      !fs.existsSync(path.join(root, "src/App.tsx")),
      "Vite's App.tsx was replaced",
    );
  });

  test("offers to delete a folder it created when a step fails", async () => {
    const { prompts, asked } = scripted(parent, {
      name: "broken",
      deleteOnFailure: true,
    });

    const result = await createProjectCommand({
      output,
      prompts,
      run: fakePrograms({ scaffoldFails: true }),
    });

    assert.strictEqual(result?.status, "failed");
    assert.ok(asked.includes("delete broken"));
    assert.ok(
      asked.some((line) => line.startsWith("error: Couldn't create broken")),
    );
    assert.ok(!fs.existsSync(path.join(parent, "broken")));
  });

  test("keeps the folder when the user says so", async () => {
    const { prompts } = scripted(parent, {
      name: "broken",
      deleteOnFailure: false,
    });

    await createProjectCommand({
      output,
      prompts,
      run: fakePrograms({ scaffoldFails: true }),
    });

    assert.ok(fs.existsSync(path.join(parent, "broken", "src", "App.tsx")));
  });

  test("never offers to delete a folder that existed before", async () => {
    fs.mkdirSync(path.join(parent, "existing"));
    const { prompts, asked } = scripted(parent, {
      name: "existing",
      deleteOnFailure: true,
    });

    await createProjectCommand({
      output,
      prompts,
      run: fakePrograms({ scaffoldFails: true }),
    });

    assert.ok(!asked.some((line) => line.startsWith("delete")));
    assert.ok(fs.existsSync(path.join(parent, "existing")));
  });

  test("retries a failed install when asked", async () => {
    const { prompts, asked } = scripted(parent, {
      name: "flaky",
      installFailed: ["retry"],
    });

    const result = await createProjectCommand({
      output,
      prompts,
      run: fakePrograms({ installFailures: 1 }),
    });

    assert.strictEqual(result?.status, "created");
    assert.deepStrictEqual(asked.slice(-2), ["install failed", "created"]);
  });

  test("rejects a name whose folder isn't empty", async () => {
    fs.mkdirSync(path.join(parent, "taken"));
    fs.writeFileSync(path.join(parent, "taken", "notes.txt"), "mine");
    let problem: string | undefined;
    const { prompts } = scripted(parent, { name: "taken" });
    prompts.askProjectName = async (validate) => {
      problem = await validate("taken");
      return undefined;
    };

    const result = await createProjectCommand({
      output,
      prompts,
      run: fakePrograms(),
    });

    assert.strictEqual(result, undefined);
    assert.match(
      problem ?? "",
      /already exists in this folder and isn't empty/,
    );
  });
});
