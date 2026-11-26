import * as path from "node:path";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import type { Styling } from "../../src/core/manifest/schema";
import { checkPlan, type FilePlan } from "../../src/core/plan";
import {
  createProject,
  INITIAL_COMMIT_MESSAGE,
  type ProjectDisk,
  type RunCommand,
  type StepId,
} from "../../src/core/project/createProject";
import {
  CREATE_VITE_VERSION,
  isSupportedNodeVersion,
} from "../../src/core/project/dependencies";
import {
  DEFAULT_PROJECT_CHOICES,
  manifestFor,
  projectFolderProblem,
  type ProjectOptions,
} from "../../src/core/project/options";
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

describe("projectFolderProblem", () => {
  const others = ["src/hooks", "src/features"];

  it.each(["src/ui", "src/shared/components", "./src/ui/"])(
    "accepts %j",
    (folder) => {
      expect(projectFolderProblem(folder, others)).toBeUndefined();
    },
  );

  it.each([
    ["components", "inside src/"],
    ["src", "inside src/"],
    ["../ui", '".."'],
    ["src/app", "used by the starter files"],
    ["src/styles/ui", "used by the starter files"],
    ["src/hooks", "overlaps src/hooks"],
    ["src/features/ui", "overlaps src/features"],
    ["SRC/Hooks", "inside src/"],
  ])("rejects %j", (folder, message) => {
    expect(projectFolderProblem(folder, others)).toContain(message);
  });
});

describe("manifestFor", () => {
  it("records the styling, folders and whether tests are on", () => {
    const paths = {
      components: "src/ui",
      hooks: "src/use",
      features: "src/modules",
    };
    expect(
      manifestFor({ styling: "tailwind", tests: false, paths }),
    ).toMatchObject({
      styling: "tailwind",
      paths,
      testing: { framework: "none", generateTests: false },
    });
  });
});

const choices = (overrides: Partial<ProjectOptions> = {}) => ({
  ...DEFAULT_PROJECT_CHOICES,
  name: "my-app",
  ...overrides,
});

const overlayPaths = (overrides: Partial<ProjectOptions> = {}) =>
  projectOverlay(choices(overrides)).operations.map(
    (operation) => operation.path,
  );

const overlayFile = (file: string, overrides: Partial<ProjectOptions> = {}) => {
  const operation = projectOverlay(choices(overrides)).operations.find(
    (candidate) => candidate.path === file,
  );
  return operation?.kind === "create" ? operation.content : undefined;
};

/** Every combination of the choices that change which files exist and what's in them. */
const STYLINGS: Styling[] = ["css-modules", "tailwind", "plain-css", "none"];
const combinations = STYLINGS.flatMap((styling) =>
  [true, false].flatMap((tests) =>
    [true, false].flatMap((routing) =>
      [true, false].map((pathAlias) => ({
        styling,
        tests,
        routing,
        pathAlias,
      })),
    ),
  ),
);
const describeCombination = (c: (typeof combinations)[number]) =>
  `${c.styling}, tests ${c.tests}, routing ${c.routing}, @/ ${c.pathAlias}`;

describe("projectOverlay", () => {
  const root = path.resolve("/work/my-app");

  it.each(combinations.map((c) => [describeCombination(c), c] as const))(
    "%s: produces a sound plan with already-formatted files",
    async (_, combination) => {
      const operations = projectOverlay(choices(combination)).operations;
      expect(checkPlan({ root, operations })).toEqual([]);
      for (const operation of operations) {
        if (operation.kind !== "create") continue;
        // Files Prettier has no parser for (.gitignore, .env.example) are
        // skipped by \`prettier --check\` too.
        const { inferredParser } = await prettier.getFileInfo(operation.path);
        if (inferredParser === null) continue;
        const formatted = await prettier.format(operation.content, {
          filepath: operation.path,
        });
        expect(operation.content, operation.path).toBe(formatted);
      }
    },
  );

  it("lists the files for the recommended setup", () => {
    expect(overlayPaths()).toMatchSnapshot();
  });

  it("leaves out every test file and test package without tests", () => {
    const overlay = projectOverlay(choices({ tests: false }));
    const paths = overlay.operations.map((operation) => operation.path);
    expect(paths.filter((file) => /\.test\.|src\/test\//.test(file))).toEqual(
      [],
    );
    expect(overlay.packageJson.devDependencies).not.toHaveProperty("vitest");
    expect(overlay.packageJson.scripts).not.toHaveProperty("test");
    expect(overlayFile("vite.config.ts", { tests: false })).toContain(
      'from "vite"',
    );
    expect(overlayFile("react-architect.json", { tests: false })).toContain(
      '"framework": "none"',
    );
  });

  it("creates no CSS files at all with styling none", () => {
    expect(
      overlayPaths({ styling: "none" }).filter((file) => file.endsWith(".css")),
    ).toEqual([]);
    expect(overlayFile("src/main.tsx", { styling: "none" })).not.toContain(
      ".css",
    );
  });

  it("sets up Tailwind without per-component stylesheets", () => {
    const overlay = projectOverlay(choices({ styling: "tailwind" }));
    const paths = overlay.operations.map((operation) => operation.path);
    expect(paths.filter((file) => file.endsWith(".css"))).toEqual([
      "src/styles/global.css",
    ]);
    expect(overlayFile("src/styles/global.css", { styling: "tailwind" })).toBe(
      '@import "tailwindcss";\n',
    );
    expect(overlayFile("vite.config.ts", { styling: "tailwind" })).toContain(
      "plugins: [react(), tailwindcss()]",
    );
    expect(overlay.packageJson.devDependencies).toHaveProperty("tailwindcss");
  });

  it("gives plain CSS components ordinary class names", () => {
    expect(overlayPaths({ styling: "plain-css" })).toContain(
      "src/features/home/components/Home/Home.css",
    );
    expect(
      overlayFile("src/features/home/components/Home/Home.css", {
        styling: "plain-css",
      }),
    ).toContain(".home {");
  });

  it("uses @/ imports, and the tsconfig and Vite settings they need", () => {
    expect(overlayFile("src/app/routes.tsx")).toContain(
      'from "@/features/home"',
    );
    expect(overlayFile("tsconfig.app.json")).toContain('"@/*": ["./src/*"]');
    expect(overlayFile("vite.config.ts")).toContain('"@": fileURLToPath');
    expect(projectOverlay(choices()).remove).toContain("tsconfig.app.json");
  });

  it("uses relative imports and keeps Vite's tsconfig without the alias", () => {
    expect(overlayFile("src/app/routes.tsx", { pathAlias: false })).toContain(
      'from "../features/home"',
    );
    expect(overlayPaths({ pathAlias: false })).not.toContain(
      "tsconfig.app.json",
    );
    expect(projectOverlay(choices({ pathAlias: false })).remove).not.toContain(
      "tsconfig.app.json",
    );
  });

  it("puts code in custom folders and imports it from there", () => {
    const paths = {
      components: "src/ui",
      hooks: "src/use",
      features: "src/modules",
    };
    expect(overlayPaths({ paths })).toContain(
      "src/ui/layout/AppLayout/AppLayout.tsx",
    );
    expect(overlayPaths({ paths })).toContain("src/modules/home/index.ts");
    expect(
      overlayFile("src/app/routes.tsx", { paths, pathAlias: false }),
    ).toContain('from "../ui/layout/AppLayout/AppLayout"');
    expect(overlayFile("react-architect.json", { paths })).toContain(
      '"components": "src/ui"',
    );
  });

  it("adds Yarn's settings only for Yarn", () => {
    expect(overlayPaths({ packageManager: "yarn" })).toContain(".yarnrc.yml");
    expect(overlayFile(".gitignore", { packageManager: "yarn" })).toContain(
      ".yarn/*",
    );
    expect(overlayPaths()).not.toContain(".yarnrc.yml");
    expect(overlayFile("README.md", { packageManager: "pnpm" })).toContain(
      "`pnpm dev`",
    );
  });
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

type Program = "node" | "scaffold" | "install" | "format" | "git";

/** Pretends to be node, create-vite, the package managers and git. Override any to fail. */
function fakeRun(
  disk: ReturnType<typeof memoryDisk>,
  overrides: Partial<
    Record<Program, (args: string[]) => Promise<{ output: string }>>
  > = {},
) {
  const calls: {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
  }[] = [];
  const run: RunCommand = async (command, args, options) => {
    calls.push({
      command,
      args,
      cwd: options.cwd,
      ...(options.env && Object.keys(options.env).length
        ? { env: options.env }
        : {}),
    });
    if (command === "node") {
      return overrides.node?.(args) ?? { output: "v24.15.0\n" };
    }
    if (command === "git") {
      if (overrides.git) return overrides.git(args);
      // Not inside a repository yet.
      if (args[0] === "rev-parse") throw new Error("not a git repository");
      return { output: "" };
    }
    if (args[0] === "exec") {
      if (overrides.scaffold) return overrides.scaffold(args);
      disk.files.set(path.join(root, "package.json"), '{ "name": "my-app" }');
      disk.files.set(path.join(root, "index.html"), "<html></html>");
      disk.files.set(path.join(root, "src/App.tsx"), "vite's app");
      disk.files.set(path.join(root, "README.md"), "vite's readme");
      return { output: "" };
    }
    if (args[0] === "install") {
      return overrides.install?.(args) ?? { output: "" };
    }
    return overrides.format?.(args) ?? { output: "" };
  };
  return { run, calls };
}

const options: ProjectOptions = {
  ...DEFAULT_PROJECT_CHOICES,
  name: "my-app",
  parentDirectory: parent,
};

const create = (
  overrides: Partial<ProjectOptions> = {},
  programs: Parameters<typeof fakeRun>[1] = {},
  signal = new AbortController().signal,
) => {
  const disk = memoryDisk();
  const { run, calls } = fakeRun(disk, programs);
  const steps: StepId[] = [];
  return createProject(
    { ...options, ...overrides },
    { run, disk, signal, onStep: (step) => steps.push(step) },
  ).then((result) => ({ result, calls, steps, disk }));
};

describe("createProject", () => {
  it("runs every step in order, with argument arrays", async () => {
    const { result, calls, steps } = await create();

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
      "git",
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
      { command: "git", args: ["--version"], cwd: root },
      {
        command: "git",
        args: ["rev-parse", "--is-inside-work-tree"],
        cwd: root,
      },
      { command: "git", args: ["init"], cwd: root },
      { command: "git", args: ["add", "--all"], cwd: root },
      {
        command: "git",
        args: ["commit", "--message", INITIAL_COMMIT_MESSAGE],
        cwd: root,
      },
    ]);
  });

  it("installs with the chosen package manager, but always scaffolds with npm", async () => {
    const pnpm = await create({ packageManager: "pnpm", git: false });
    expect(pnpm.calls.map((call) => `${call.command} ${call.args[0]}`)).toEqual(
      ["node --version", "npm exec", "pnpm install", "pnpm run"],
    );
    expect(pnpm.calls[2]?.args).toEqual(["install", "--no-frozen-lockfile"]);

    const yarn = await create({ packageManager: "yarn", git: false });
    expect(yarn.calls[2]).toMatchObject({
      command: "yarn",
      args: ["install"],
      env: { YARN_ENABLE_IMMUTABLE_INSTALLS: "false" },
    });
  });

  it("replaces Vite's files and merges package.json", async () => {
    const { disk } = await create();
    expect(disk.files.get(path.join(root, "src/App.tsx"))).toBeUndefined();
    expect(disk.files.get(path.join(root, "index.html"))).toBe("<html></html>");
    expect(disk.files.get(path.join(root, "README.md"))).toContain("# my-app");
    expect(disk.files.has(path.join(root, "react-architect.json"))).toBe(true);
    const pkg = JSON.parse(
      disk.files.get(path.join(root, "package.json")) ?? "",
    );
    expect(pkg.name).toBe("my-app");
    expect(pkg.dependencies["react-router"]).toBe("8.5.2");
    expect(pkg.scripts.test).toBe("vitest run");
  });

  it("skips install and formatting when not wanted, but still sets up git", async () => {
    const { result, steps } = await create({ install: false });
    expect(result).toMatchObject({ status: "created", installed: false });
    expect(steps).toEqual(["check", "scaffold", "overlay", "git"]);
  });

  it("skips git when not wanted", async () => {
    const { steps, calls } = await create({ git: false });
    expect(steps).not.toContain("git");
    expect(calls.some((call) => call.command === "git")).toBe(false);
  });

  it("doesn't create a repository inside another one", async () => {
    const { result, calls } = await create(
      {},
      { git: async () => ({ output: "true" }) },
    );
    expect(result).toMatchObject({
      status: "created",
      warnings: [expect.stringContaining("inside an existing git repository")],
    });
    expect(calls.some((call) => call.args[0] === "init")).toBe(false);
  });

  it("warns, without failing, when git isn't installed", async () => {
    const { result } = await create(
      {},
      {
        git: async () => {
          throw new Error('"git" wasn\'t found.');
        },
      },
    );
    expect(result).toMatchObject({
      status: "created",
      warnings: ["Git isn't installed, so no git repository was created."],
    });
  });

  it("explains what to do when the first commit fails", async () => {
    const { result } = await create(
      {},
      {
        git: async (args) => {
          if (args[0] === "rev-parse") throw new Error("not a repository");
          if (args[0] === "commit")
            throw new Error("Please tell me who you are");
          return { output: "" };
        },
      },
    );
    expect(result).toMatchObject({
      status: "created",
      warnings: [expect.stringContaining("git config --global user.name")],
    });
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
    const { result } = await create(
      {},
      { node: async () => ({ output: "v20.11.0\n" }) },
    );
    expect(result).toMatchObject({ status: "failed", step: "check" });
    expect(result.status !== "created" && result.message).toMatch(
      /needs Node\.js .* but v20\.11\.0 is installed/,
    );
  });

  it("marks a folder it created for cleanup when scaffolding fails", async () => {
    const { result } = await create(
      {},
      {
        scaffold: async () => {
          throw new Error("network down");
        },
      },
    );
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

  it("keeps the project when install fails, skips formatting, and still sets up git", async () => {
    const { result, steps } = await create(
      {},
      {
        install: async () => {
          throw new Error("ETIMEDOUT");
        },
      },
    );
    expect(result).toEqual({
      status: "created",
      root,
      installed: false,
      installError: "ETIMEDOUT",
      warnings: [],
    });
    expect(steps).toEqual(["check", "scaffold", "overlay", "install", "git"]);
  });

  it("reports cancellation during install as cancelled, not failed", async () => {
    const controller = new AbortController();
    const { result } = await create(
      {},
      {
        install: async () => {
          controller.abort();
          throw new Error("Cancelled.");
        },
      },
      controller.signal,
    );
    expect(result).toMatchObject({
      status: "cancelled",
      step: "install",
      createdFolder: true,
    });
  });

  it("keeps a working project when formatting fails, with a warning", async () => {
    const { result } = await create(
      { git: false },
      {
        format: async () => {
          throw new Error("prettier crashed");
        },
      },
    );
    expect(result).toEqual({
      status: "created",
      root,
      installed: true,
      warnings: ["Formatting failed: prettier crashed"],
    });
  });
});
