import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import { buildProjectMap } from "../../src/core/architecture/graph";
import { aliasesFromTsconfig } from "../../src/core/architecture/modules";
import { isSourceFile, parseModule } from "../../src/core/architecture/parse";
import { addRoute } from "../../src/core/architecture/routes";
import {
  pageFiles,
  pageNames,
  routePathProblem,
} from "../../src/core/generators/page";
import type { Styling } from "../../src/core/manifest/schema";
import { DEFAULT_MANIFEST } from "../../src/core/manifest/schema";
import { MAX_NAME_LENGTH, parseName } from "../../src/core/naming";
import { applyChanges, checkPlan } from "../../src/core/plan";
import {
  DEFAULT_PROJECT_CHOICES,
  manifestFor,
} from "../../src/core/project/options";
import { projectOverlay } from "../../src/core/project/overlay";

const names = (input: string) => {
  const result = parseName(input);
  if (!result.ok) throw new Error(result.error);
  return pageNames(result.name);
};

describe("pageNames", () => {
  it.each(["settings", "settings page", "SettingsPage", "settings-page"])(
    "%j gives SettingsPage",
    (input) => {
      expect(names(input)).toEqual({
        component: "SettingsPage",
        title: "Settings",
        kebab: "settings",
      });
    },
  );

  it("titles multi-word pages", () => {
    expect(names("user profile")).toMatchObject({
      component: "UserProfilePage",
      title: "User Profile",
    });
  });
});

describe("pageFiles", () => {
  it("puts the page in the feature's pages folder and exports it", () => {
    const { operations, mainFile } = pageFiles(
      names("settings"),
      "src/features/settings",
      DEFAULT_MANIFEST,
      true,
    );
    expect(mainFile).toBe("src/features/settings/pages/SettingsPage.tsx");
    expect(operations.map((operation) => operation.path)).toEqual([
      "src/features/settings/pages/SettingsPage.tsx",
      "src/features/settings/pages/SettingsPage.test.tsx",
      "src/features/settings/index.ts",
    ]);
    expect(operations[2]).toEqual({
      kind: "ensureLine",
      path: "src/features/settings/index.ts",
      line: 'export { SettingsPage } from "./pages/SettingsPage";',
    });
    expect(checkPlan({ root: "/p", operations })).toEqual([]);
  });

  it.each(["settings", "a".repeat(MAX_NAME_LENGTH), "abc ".repeat(7) + "ab"])(
    "writes already-formatted code for %j",
    async (input) => {
      const { operations } = pageFiles(
        names(input),
        "src/features/x",
        DEFAULT_MANIFEST,
        true,
      );
      for (const operation of operations) {
        if (operation.kind !== "create") continue;
        const formatted = await prettier.format(operation.content, {
          filepath: operation.path,
        });
        expect(operation.content).toBe(formatted);
      }
    },
  );

  it("leaves out the test when the project has no test framework", () => {
    const manifest = {
      ...DEFAULT_MANIFEST,
      testing: { framework: "none" as const, generateTests: false },
    };
    expect(
      pageFiles(names("a"), "src/features/a", manifest, true).operations,
    ).toHaveLength(2);
  });
});

describe("routePathProblem", () => {
  it.each(["/settings", "/users/:id", "/docs/*", "/a/b-c_d.e"])(
    "accepts %s",
    (value) => {
      expect(routePathProblem(value)).toBeUndefined();
    },
  );
  it.each(["settings", "/", "/a//b", "/a b", "/:1"])("rejects %j", (value) => {
    expect(routePathProblem(value)).toBeDefined();
  });
});

/** Generated projects must follow their own rules, or every new user starts with squiggles. */
describe("generated projects", () => {
  const STYLINGS: Styling[] = ["css-modules", "tailwind", "plain-css", "none"];
  const combinations = STYLINGS.flatMap((styling) =>
    [true, false].flatMap((routing) =>
      [true, false].map((pathAlias) => ({
        styling,
        routing,
        pathAlias,
        tests: true,
      })),
    ),
  );

  it.each(combinations)("%j: no rule problems or cycles", (combination) => {
    const options = {
      ...DEFAULT_PROJECT_CHOICES,
      name: "my-app",
      ...combination,
    };
    const operations = projectOverlay(options).operations;
    const files = new Map(
      operations.flatMap((operation) =>
        operation.kind === "create"
          ? [[operation.path, operation.content] as const]
          : [],
      ),
    );
    const tsconfig = files.get("tsconfig.app.json");
    const aliases =
      tsconfig === undefined ? [] : aliasesFromTsconfig(tsconfig, ".");
    expect(aliases.length > 0).toBe(combination.pathAlias);

    const modules = new Map(
      [...files]
        .filter(([file]) => isSourceFile(file))
        .map(([file, text]) => [file, parseModule(file, text)]),
    );
    const map = buildProjectMap(modules, manifestFor(options), aliases);
    expect(map.problems).toEqual([]);
    expect(map.cycles).toEqual([]);
    expect(map.units.map((feature) => feature.name)).toEqual(["home"]);
  });

  it.each(combinations.filter((c) => c.routing))(
    "%j: a page can be added to the routes, and the result is formatted",
    async (combination) => {
      const options = {
        ...DEFAULT_PROJECT_CHOICES,
        name: "my-app",
        ...combination,
      };
      const routes = projectOverlay(options).operations.find(
        (operation) => operation.path === "src/app/routes.tsx",
      );
      expect(routes?.kind).toBe("create");
      if (routes?.kind !== "create") return;

      const result = addRoute("src/app/routes.tsx", routes.content, {
        component: "SettingsPage",
        importFrom: combination.pathAlias
          ? "@/features/settings"
          : "../features/settings",
        path: "/settings",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const updated = applyChanges(routes.content, result.changes);
      expect(updated).toBe(
        await prettier.format(updated, { filepath: "src/app/routes.tsx" }),
      );
      expect(updated).toContain(
        '{ path: "settings", element: <SettingsPage /> },',
      );
    },
  );
});
