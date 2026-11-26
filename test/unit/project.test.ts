import * as path from "node:path";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import { checkPlan, type FilePlan } from "../../src/core/plan";
import {
  createProject,
  type ProjectDisk,
  type RunCommand,
  type StepId,
} from "../../src/core/project/createProject";
import {
  CREATE_VITE_VERSION,
  isSupportedNodeVersion,
} from "../../src/core/project/dependencies";
import { projectOverlay } from "../../src/core/project/overlay";
import { mergePackageJson } from "../../src/core/project/packageJson";
import { projectNameProblem } from "../../src/core/project/projectName";

describe("isSupportedNodeVersion", () => {
  it.each([
    ["v22.22.2", true],
    ["v22.23.0", true],
    ["v22.22.1", false],
    ["v22.12.0", false],
    ["v23.11.0", false],
    ["v24.15.0", true],
    ["v24.14.9", false],
    ["v25.2.0", false],
    ["v26.13.1\n", true],
    ["v20.19.0", false],
    ["not a version", false],
  ])("%j: %s", (version, expected) => {
    expect(isSupportedNodeVersion(version)).toBe(expected);
  });
});

describe("projectNameProblem", () => {
  it.each(["my-app", "app2", "a"])("accepts %j", (name) => {
    expect(projectNameProblem(name)).toBeUndefined();
  });

  it.each([
    ["", "Enter a project name."],
    ["My-App", "lowercase"],
    ["my app", "lowercase"],
    ["2app", "lowercase"],
    ["my_app", "lowercase"],
    ["my-app; rm -rf ~", "lowercase"],
    ["my-app-", "can't end with a hyphen"],
    ["con", "reserved name on Windows"],
    ["a".repeat(51), "shorter name"],
  ])("rejects %j", (name, message) => {
    expect(projectNameProblem(name)).toContain(message);
  });
});

describe("mergePackageJson", () => {
  const vite = JSON.stringify(
    {
      name: "my-app",
      type: "module",
      scripts: { dev: "vite", build: "tsc -b && vite build" },
      dependencies: { react: "^19.3.1" },
      devDependencies: { vite: "^8.3.6", eslint: "^10.14.0" },
    },
    null,
    2,
  );

  it("adds dependencies and scripts and keeps everything else", () => {
    const merged = JSON.parse(
      mergePackageJson(vite, {
        dependencies: { "react-router": "8.5.3" },
        devDependencies: { vitest: "5.1.2" },
        scripts: { test: "vitest run" },
      }),
    );
    expect(merged).toEqual({
      name: "my-app",
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc -b && vite build",
        test: "vitest run",
      },
      dependencies: { react: "^19.3.1", "react-router": "8.5.3" },
      devDependencies: { eslint: "^10.14.0", vite: "^8.3.6", vitest: "5.1.2" },
    });
    expect(Object.keys(merged.devDependencies)).toEqual([
      "eslint",
      "vite",
      "vitest",
    ]);
  });

  it("rejects a package.json that isn't an object", () => {
    expect(() =>
      mergePackageJson("[]", {
        dependencies: {},
        devDependencies: {},
        scripts: {},
      }),
    ).toThrow(/JSON object/);
  });
});

describe("projectOverlay", () => {
  const root = path.resolve("/work/my-app");

  it.each([true, false])("routing %s: produces a sound plan", (routing) => {
    const overlay = projectOverlay({ name: "my-app", routing });
    expect(checkPlan({ root, operations: overlay.operations })).toEqual([]);
  });

  it("adds routing files only when routing is on", () => {
    const paths = (routing: boolean) =>
      projectOverlay({ name: "my-app", routing }).operations.map((o) => o.path);
    expect(paths(true)).toContain("src/app/routes.tsx");
    expect(paths(true)).toContain(
      "src/components/layout/AppLayout/AppLayout.tsx",
    );
    expect(paths(false)).not.toContain("src/app/routes.tsx");
    expect(
      projectOverlay({ name: "x", routing: false }).packageJson.dependencies,
    ).toEqual({});
  });

  it("lists the files it creates", () => {
    expect(
      projectOverlay({ name: "my-app", routing: true }).operations.map(
        (operation) => operation.path,
      ),
    ).toMatchSnapshot();
  });

  it.each([true, false])(
    "routing %s: every file is already formatted by Prettier",
    async (routing) => {
      for (const operation of projectOverlay({ name: "my-app", routing })
        .operations) {
        if (operation.kind !== "create") {
          continue;
        }
        // Files Prettier has no parser for (.env.example, .prettierignore) are
        // skipped by \`prettier --check\` too.
        const { inferredParser } = await prettier.getFileInfo(operation.path);
        if (inferredParser === null) {
          continue;
        }
        const formatted = await prettier.format(operation.content, {
          filepath: operation.path,
        });
        expect(operation.content, operation.path).toBe(formatted);
      }
    },
  );
});

/** An in-memory disk: file paths to contents, plus folders that exist but are empty. */
function memoryDisk(
  files: Record<string, string> = {},
  emptyFolders: string[] = [],
) {
  const contents = new Map(Object.entries(files));
  const folders = new Set(emptyFolders);
  const under = (folder: string) => (file: string) =>
    file === folder || file.startsWith(folder + path.sep);

  const disk: ProjectDisk & { files: Map<string, string> } = {
    files: contents,
    async folderState(folder) {
      if ([...contents.keys()].some(under(folder))) return "notEmpty";
      return folders.has(folder) ? "empty" : "missing";
    },
    async readText(file) {
      const text = contents.get(file);
      if (text === undefined) throw new Error(`ENOENT: ${file}`);
      return text;
    },
    async writeText(file, text) {
      contents.set(file, text);
    },
    async remove(target) {
      for (const file of [...contents.keys()].filter(under(target))) {
        contents.delete(file);
      }
      folders.delete(target);
    },
    async writePlan(plan: FilePlan) {
      for (const operation of plan.operations) {
        if (operation.kind === "create") {
          contents.set(path.join(plan.root, operation.path), operation.content);
        }
      }
    },
  };
  return disk;
}

const parent = path.resolve("/work");
const root = path.join(parent, "my-app");

/** Pretends to be node, create-vite and npm. Override any of them to fail. */
function fakeRun(
  disk: ReturnType<typeof memoryDisk>,
  overrides: Partial<
    Record<
      "node" | "scaffold" | "install" | "format",
      () => Promise<{ output: string }>
    >
  > = {},
) {
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const run: RunCommand = async (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === "node") {
      return overrides.node?.() ?? { output: "v24.15.0\n" };
    }
    if (args[0] === "exec") {
      if (overrides.scaffold) return overrides.scaffold();
      disk.files.set(path.join(root, "package.json"), '{ "name": "my-app" }');
      disk.files.set(path.join(root, "index.html"), "<html></html>");
      disk.files.set(path.join(root, "src/App.tsx"), "vite's app");
      disk.files.set(path.join(root, "README.md"), "vite's readme");
      return { output: "" };
    }
    if (args[0] === "install") {
      return overrides.install?.() ?? { output: "" };
    }
    return overrides.format?.() ?? { output: "" };
  };
  return { run, calls };
}

const options = {
  name: "my-app",
  parentDirectory: parent,
  routing: true,
  install: true,
};

describe("createProject", () => {
  it("runs every step in order with argument arrays", async () => {
    const disk = memoryDisk();
    const { run, calls } = fakeRun(disk);
    const steps: StepId[] = [];

    const result = await createProject(options, {
      run,
      disk,
      signal: new AbortController().signal,
      onStep: (step) => steps.push(step),
    });

    expect(result).toEqual({
      status: "created",
      root,
      installed: true,
      warnings: [],
    });
    expect(steps).toEqual([
      "check",
      "scaffold",
      "overlay",
      "install",
      "format",
    ]);
    expect(calls).toEqual([
      { command: "node", args: ["--version"], cwd: parent },
      {
        command: "npm",
        args: [
          "exec",
          "--yes",
          `--package=create-vite@${CREATE_VITE_VERSION}`,
          "--",
          "create-vite",
          "my-app",
          "--template",
          "react-ts",
          "--eslint",
          "--no-interactive",
          "--no-immediate",
        ],
        cwd: parent,
      },
      {
        command: "npm",
        args: ["install", "--no-fund", "--no-audit"],
        cwd: root,
      },
      { command: "npm", args: ["run", "format"], cwd: root },
    ]);
  });

  it("replaces Vite's files and merges package.json", async () => {
    const disk = memoryDisk();
    await createProject(options, {
      run: fakeRun(disk).run,
      disk,
      signal: new AbortController().signal,
    });

    expect(disk.files.get(path.join(root, "src/App.tsx"))).toBeUndefined();
    expect(disk.files.get(path.join(root, "index.html"))).toBe("<html></html>");
    expect(disk.files.get(path.join(root, "README.md"))).toContain("# my-app");
    expect(disk.files.has(path.join(root, "react-architect.json"))).toBe(true);
    const pkg = JSON.parse(
      disk.files.get(path.join(root, "package.json")) ?? "",
    );
    expect(pkg.name).toBe("my-app");
    expect(pkg.dependencies["react-router"]).toBe("8.5.3");
    expect(pkg.scripts.test).toBe("vitest run");
  });

  it("skips install and formatting when not wanted", async () => {
    const disk = memoryDisk();
    const { run, calls } = fakeRun(disk);
    const result = await createProject(
      { ...options, install: false },
      { run, disk, signal: new AbortController().signal },
    );
    expect(result).toMatchObject({ status: "created", installed: false });
    expect(calls.map((call) => call.args[0])).toEqual(["--version", "exec"]);
  });

  it("refuses a folder that isn't empty, before running anything", async () => {
    const disk = memoryDisk({ [path.join(root, "notes.txt")]: "mine" });
    const { run, calls } = fakeRun(disk);
    const result = await createProject(options, {
      run,
      disk,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: "failed",
      step: "check",
      createdFolder: false,
    });
    expect(calls).toEqual([]);
    expect(disk.files.get(path.join(root, "notes.txt"))).toBe("mine");
  });

  it("refuses an old Node.js with a clear message", async () => {
    const disk = memoryDisk();
    const { run } = fakeRun(disk, {
      node: async () => ({ output: "v20.11.0\n" }),
    });
    const result = await createProject(options, {
      run,
      disk,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: "failed", step: "check" });
    expect(result.status !== "created" && result.message).toMatch(
      /needs Node\.js .* but v20\.11\.0 is installed/,
    );
  });

  it("marks a folder it created for cleanup when scaffolding fails", async () => {
    const disk = memoryDisk();
    const { run } = fakeRun(disk, {
      scaffold: async () => {
        throw new Error("network down");
      },
    });
    const result = await createProject(options, {
      run,
      disk,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      status: "failed",
      root,
      step: "scaffold",
      message: "network down",
      createdFolder: true,
    });
  });

  it("never marks a folder that already existed for cleanup", async () => {
    const disk = memoryDisk({}, [root]);
    const { run } = fakeRun(disk, {
      scaffold: async () => {
        throw new Error("network down");
      },
    });
    const result = await createProject(options, {
      run,
      disk,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: "failed", createdFolder: false });
  });

  it("keeps the project when install fails, and skips formatting", async () => {
    const disk = memoryDisk();
    const { run, calls } = fakeRun(disk, {
      install: async () => {
        throw new Error("ETIMEDOUT");
      },
    });
    const result = await createProject(options, {
      run,
      disk,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      status: "created",
      root,
      installed: false,
      installError: "ETIMEDOUT",
      warnings: [],
    });
    expect(calls.some((call) => call.args[1] === "format")).toBe(false);
  });

  it("reports cancellation during install as cancelled, not failed", async () => {
    const disk = memoryDisk();
    const controller = new AbortController();
    const { run } = fakeRun(disk, {
      install: async () => {
        controller.abort();
        throw new Error("Cancelled.");
      },
    });
    const result = await createProject(options, {
      run,
      disk,
      signal: controller.signal,
    });
    expect(result).toMatchObject({
      status: "cancelled",
      step: "install",
      createdFolder: true,
    });
  });

  it("keeps a working project when formatting fails, with a warning", async () => {
    const disk = memoryDisk();
    const { run } = fakeRun(disk, {
      format: async () => {
        throw new Error("prettier crashed");
      },
    });
    const result = await createProject(options, {
      run,
      disk,
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      status: "created",
      root,
      installed: true,
      warnings: ["Formatting failed: prettier crashed"],
    });
  });
});
