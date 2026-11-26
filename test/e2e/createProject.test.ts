/**
 * Creates real projects with the real create-vite and package managers, then
 * checks that they build, lint, test and are formatted (ADR 8). Needs network
 * access and takes a few minutes; run with `npm run test:e2e`. The pnpm and
 * Yarn projects are skipped when those aren't installed.
 */
import spawn from "cross-spawn";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/check";
import { buildProjectMap } from "../../src/core/architecture/graph";
import { aliasesFromTsconfig } from "../../src/core/architecture/modules";
import { isSourceFile, parseModule } from "../../src/core/architecture/parse";
import { addRoute } from "../../src/core/architecture/routes";
import { pageFiles, pageNames } from "../../src/core/generators/page";
import { parseName } from "../../src/core/naming";
import { checkPlan } from "../../src/core/plan";
import {
  createProject,
  INITIAL_COMMIT_MESSAGE,
  type StepId,
} from "../../src/core/project/createProject";
import {
  DEFAULT_PROJECT_CHOICES,
  manifestFor,
  type ProjectOptions,
} from "../../src/core/project/options";
import {
  PACKAGE_MANAGERS,
  type PackageManagerId,
} from "../../src/core/project/packageManager";
import { runProcess } from "../../src/infra/process";
import { nodeProjectDisk } from "../../src/infra/projectDisk";

const parent = mkdtempSync(path.join(tmpdir(), "react-architect-e2e-"));
afterAll(() => {
  if (!process.env.KEEP_E2E_PROJECTS) {
    rmSync(parent, { recursive: true, force: true });
  }
});

const signal = () => new AbortController().signal;
const run = (
  command: string,
  args: string[],
  options: { cwd: string; signal: AbortSignal; env?: Record<string, string> },
) => runProcess(command, args, options);

/** Whether a package manager runs here; synchronous, because it decides which tests are skipped. */
function isInstalled(id: PackageManagerId): boolean {
  return spawn.sync(PACKAGE_MANAGERS[id].command, ["--version"]).status === 0;
}

const installed = {
  npm: true,
  pnpm: isInstalled("pnpm"),
  yarn: isInstalled("yarn"),
};

type Case = Omit<ProjectOptions, "parentDirectory" | "install">;

const cases: Case[] = [
  { ...DEFAULT_PROJECT_CHOICES, name: "recommended" },
  {
    ...DEFAULT_PROJECT_CHOICES,
    name: "tailwind",
    styling: "tailwind",
    tests: false,
    git: false,
    packageManager: "pnpm",
    paths: { components: "src/ui", hooks: "src/use", features: "src/modules" },
  },
  {
    ...DEFAULT_PROJECT_CHOICES,
    name: "plain-css",
    styling: "plain-css",
    pathAlias: false,
    git: false,
    packageManager: "yarn",
  },
  {
    ...DEFAULT_PROJECT_CHOICES,
    name: "bare",
    styling: "none",
    tests: false,
    routing: false,
    git: false,
  },
];

describe.each(cases)("a new project: $name", (options) => {
  const root = path.join(parent, options.name);
  const packageManager = PACKAGE_MANAGERS[options.packageManager];
  const skip = !installed[options.packageManager];
  const script = (name: string) =>
    runProcess(packageManager.command, packageManager.runScriptArgs(name), {
      cwd: root,
      signal: signal(),
    });

  it.skipIf(skip)("is created and installed", async () => {
    const result = await createProject(
      { ...options, parentDirectory: parent, install: true },
      {
        run,
        disk: nodeProjectDisk,
        signal: signal(),
        // Set by the weekly drift check to try the newest create-vite (ADR 3).
        createViteVersion: process.env.CREATE_VITE_VERSION,
      },
    );
    expect(result).toEqual({
      status: "created",
      root,
      installed: true,
      warnings: [],
    });
  });

  it.skipIf(skip)("builds", async () => {
    await script("build");
  });

  it.skipIf(skip)("passes ESLint with no warnings", async () => {
    await runProcess("npx", ["eslint", ".", "--max-warnings", "0"], {
      cwd: root,
      signal: signal(),
    });
  });

  it.skipIf(skip || !options.tests)("passes its own tests", async () => {
    const { output } = await script("test");
    expect(output).toMatch(/Test Files\s+\d+ passed/);
  });

  it.skipIf(skip)("is formatted", async () => {
    await script("format:check");
  });

  it.skipIf(skip || options.tests)("has no test files", () => {
    const files = readdirSync(path.join(root, "src"), { recursive: true });
    expect(files.map(String).filter((file) => file.includes(".test."))).toEqual(
      [],
    );
  });

  it.skipIf(skip || options.styling !== "none")("has no CSS files", () => {
    const files = readdirSync(path.join(root, "src"), { recursive: true });
    expect(files.map(String).filter((file) => file.endsWith(".css"))).toEqual(
      [],
    );
  });

  it.skipIf(skip || options.styling !== "tailwind")(
    "puts Tailwind's classes in the built CSS",
    () => {
      const assets = path.join(root, "dist", "assets");
      const css = readdirSync(assets)
        .filter((file) => file.endsWith(".css"))
        .map((file) => readFileSync(path.join(assets, file), "utf8"))
        .join("");
      // The layout uses mx-auto; Tailwind only emits classes it finds in use.
      expect(css).toContain(".mx-auto");
    },
  );

  it.skipIf(skip || !options.git)("starts with one commit", async () => {
    const { output } = await runProcess("git", ["log", "--format=%s"], {
      cwd: root,
      signal: signal(),
    });
    expect(output.trim()).toBe(INITIAL_COMMIT_MESSAGE);
  });
  it.skipIf(skip)("passes react-architect check", async () => {
    const out: string[] = [];
    const code = await runCli(["check", "--max-warnings", "0"], {
      cwd: root,
      out: (line) => out.push(line),
      err: (line) => out.push(line),
    });
    expect({ code, out }).toEqual({ code: 0, out: ["No structure problems."] });
  });

  it.skipIf(skip)("breaks none of its own structure rules", () => {
    const files = readdirSync(root, { recursive: true })
      .map((file) => String(file).split(path.sep).join("/"))
      .filter(
        (file) =>
          isSourceFile(file) && !/(^|\/)(node_modules|dist)\//.test(file),
      );
    const modules = new Map(
      files.map((file) => [
        file,
        parseModule(file, readFileSync(path.join(root, file), "utf8")),
      ]),
    );
    const tsconfig = readFileSync(path.join(root, "tsconfig.app.json"), "utf8");
    const map = buildProjectMap(
      modules,
      manifestFor(options),
      aliasesFromTsconfig(tsconfig, "."),
    );
    expect(map.problems.map((problem) => problem.message)).toEqual([]);
    expect(map.cycles).toEqual([]);
  });

  // Last, because it adds files the checks above don't expect.
  it.skipIf(skip || !options.routing)(
    "still builds, lints, tests and is formatted with a generated page in its routes",
    async () => {
      const name = parseName("settings");
      if (!name.ok) throw new Error(name.error);
      const manifest = manifestFor(options);
      const page = pageFiles(
        pageNames(name.name),
        `${manifest.paths.features}/settings`,
        manifest,
        options.tests,
      );

      const routesFile = "src/app/routes.tsx";
      const routesText = readFileSync(path.join(root, routesFile), "utf8");
      const route = addRoute(routesFile, routesText, {
        component: "SettingsPage",
        importFrom: options.pathAlias
          ? `@/${manifest.paths.features.replace(/^src\//, "")}/settings`
          : path.posix.relative(
              "src/app",
              `${manifest.paths.features}/settings`,
            ),
        path: "/settings",
      });
      expect(route.ok).toBe(true);
      if (!route.ok) return;

      const plan = {
        root,
        operations: [
          ...page.operations,
          {
            kind: "edit" as const,
            path: routesFile,
            expectedText: routesText,
            changes: route.changes,
          },
        ],
      };
      expect(checkPlan(plan)).toEqual([]);
      await nodeProjectDisk.writePlan(plan);

      await runProcess("npx", ["tsc", "-b"], { cwd: root, signal: signal() });
      await script("build");
      await runProcess("npx", ["eslint", ".", "--max-warnings", "0"], {
        cwd: root,
        signal: signal(),
      });
      await script("format:check");
      if (options.tests) {
        const { output } = await script("test");
        // Vitest only prints totals here; the page's test is the extra file.
        expect(output).toMatch(/Test Files\s+\d+ passed/);
        expect(output).not.toMatch(/failed/);
      }
    },
  );
});

describe("cancelling", () => {
  it("stops the install and reports the project as cancelled", async () => {
    const controller = new AbortController();
    const started = Date.now();
    let cancelledAfter = 0;

    const result = await createProject(
      {
        ...DEFAULT_PROJECT_CHOICES,
        name: "cancelled",
        parentDirectory: parent,
        git: false,
        install: true,
      },
      {
        run,
        disk: nodeProjectDisk,
        signal: controller.signal,
        onStep: (step: StepId) => {
          if (step === "install") {
            setTimeout(() => {
              cancelledAfter = Date.now();
              controller.abort();
            }, 1_000);
          }
        },
      },
    );

    expect(result).toMatchObject({
      status: "cancelled",
      step: "install",
      createdFolder: true,
    });
    // The install was killed rather than left to finish.
    expect(Date.now() - cancelledAfter).toBeLessThan(10_000);
    expect(cancelledAfter).toBeGreaterThan(started);
  });
});
