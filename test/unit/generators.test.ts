import * as path from "node:path";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";
import { getGenerator, GENERATORS } from "../../src/core/generators";
import { enclosingFeature } from "../../src/core/generators/featureIndex";
import type { GenerateInput } from "../../src/core/generators";
import {
  DEFAULT_MANIFEST,
  type Manifest,
} from "../../src/core/manifest/schema";
import { parseName, type NameForms } from "../../src/core/naming";
import { checkPlan, type FileOperation } from "../../src/core/plan";
import { code } from "../../src/core/templates/code";

function name(input: string): NameForms {
  const result = parseName(input);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.name;
}

const component = getGenerator("component");
const hook = getGenerator("hook");
const feature = getGenerator("feature");

function input(
  overrides: Partial<GenerateInput> & { name: NameForms },
): GenerateInput {
  return {
    directory: "src/components",
    includeTests: true,
    exportFromFeature: false,
    ...overrides,
  };
}

const paths = (operations: FileOperation[]) => operations.map((o) => o.path);

describe("component generator", () => {
  it("creates a component folder with styles and a test", () => {
    const result = component.generate(
      input({ name: name("user card") }),
      DEFAULT_MANIFEST,
    );
    expect(result.mainFile).toBe("src/components/UserCard/UserCard.tsx");
    expect(paths(result.operations)).toEqual([
      "src/components/UserCard/UserCard.tsx",
      "src/components/UserCard/UserCard.module.css",
      "src/components/UserCard/UserCard.test.tsx",
    ]);
    expect(result.operations).toMatchSnapshot();
  });

  it("skips the stylesheet when styling is none", () => {
    const manifest: Manifest = { ...DEFAULT_MANIFEST, styling: "none" };
    const result = component.generate(
      input({ name: name("user card") }),
      manifest,
    );
    expect(paths(result.operations)).toEqual([
      "src/components/UserCard/UserCard.tsx",
      "src/components/UserCard/UserCard.test.tsx",
    ]);
    expect(result.operations[0]).toMatchSnapshot();
  });

  it("skips the test when not wanted, or when the project has no test framework", () => {
    const noTests = component.generate(
      input({ name: name("card"), includeTests: false }),
      DEFAULT_MANIFEST,
    );
    const noFramework = component.generate(input({ name: name("card") }), {
      ...DEFAULT_MANIFEST,
      testing: { framework: "none", generateTests: true },
    });
    for (const result of [noTests, noFramework]) {
      expect(paths(result.operations)).not.toContain(
        "src/components/Card/Card.test.tsx",
      );
    }
  });

  it("can export itself from the enclosing feature", () => {
    const result = component.generate(
      input({
        name: name("cart item"),
        directory: "src/features/shop/components",
        exportFromFeature: true,
      }),
      DEFAULT_MANIFEST,
    );
    expect(result.operations.at(-1)).toEqual({
      kind: "ensureLine",
      path: "src/features/shop/index.ts",
      line: 'export { CartItem } from "./components/CartItem/CartItem";',
    });
  });

  it("adds no export outside a feature, even when asked", () => {
    const result = component.generate(
      input({ name: name("card"), exportFromFeature: true }),
      DEFAULT_MANIFEST,
    );
    expect(result.operations.every((o) => o.kind === "create")).toBe(true);
  });
});

describe("hook generator", () => {
  it("creates the hook and its test side by side", () => {
    const result = hook.generate(
      input({ name: name("cart"), directory: "src/hooks" }),
      DEFAULT_MANIFEST,
    );
    expect(result.mainFile).toBe("src/hooks/useCart.ts");
    expect(paths(result.operations)).toEqual([
      "src/hooks/useCart.ts",
      "src/hooks/useCart.test.ts",
    ]);
    expect(result.operations).toMatchSnapshot();
  });

  it("can export itself from the enclosing feature", () => {
    const result = hook.generate(
      input({
        name: name("useCheckout"),
        directory: "src/features/shop/hooks",
        exportFromFeature: true,
      }),
      DEFAULT_MANIFEST,
    );
    expect(result.operations.at(-1)).toEqual({
      kind: "ensureLine",
      path: "src/features/shop/index.ts",
      line: 'export { useCheckout } from "./hooks/useCheckout";',
    });
  });
});

describe("feature generator", () => {
  it("creates the full feature folder", () => {
    const result = feature.generate(
      input({ name: name("user profile"), directory: "src/features" }),
      DEFAULT_MANIFEST,
    );
    expect(result.mainFile).toBe(
      "src/features/user-profile/components/UserProfile/UserProfile.tsx",
    );
    expect(paths(result.operations)).toEqual([
      "src/features/user-profile/components/UserProfile/UserProfile.tsx",
      "src/features/user-profile/components/UserProfile/UserProfile.module.css",
      "src/features/user-profile/components/UserProfile/UserProfile.test.tsx",
      "src/features/user-profile/hooks/useUserProfile.ts",
      "src/features/user-profile/hooks/useUserProfile.test.ts",
      "src/features/user-profile/services/userProfileApi.ts",
      "src/features/user-profile/types.ts",
      "src/features/user-profile/index.ts",
    ]);
    expect(result.operations).toMatchSnapshot();
  });
});

describe("enclosingFeature", () => {
  it.each([
    ["src/features/shop", "src/features/shop"],
    ["src/features/shop/components/deep", "src/features/shop"],
    ["src/features", undefined],
    ["src/featuresExtra/shop", undefined],
    ["src/components", undefined],
  ])("%s is inside %s", (directory, expected) => {
    expect(enclosingFeature(directory, DEFAULT_MANIFEST)).toBe(expected);
  });

  it("handles features at the project root", () => {
    const manifest: Manifest = {
      ...DEFAULT_MANIFEST,
      paths: { ...DEFAULT_MANIFEST.paths, features: "." },
    };
    expect(enclosingFeature("shop/hooks", manifest)).toBe("shop");
  });
});

describe("every generator", () => {
  // Shortest, typical, and the longest name parseName accepts.
  const names = ["a", "user card", "shoppingCartSummaryPanelWidget"];

  const cases = GENERATORS.flatMap((generator) =>
    names.map((raw) => [generator.id, raw] as const),
  );

  it.each(cases)("%s %j: produces a sound plan", (id, raw) => {
    const generator = getGenerator(id);
    const result = generator.generate(
      input({
        name: name(raw),
        directory: "src/features/shop",
        exportFromFeature: true,
      }),
      DEFAULT_MANIFEST,
    );
    expect(
      checkPlan({
        root: path.resolve("/work/app"),
        operations: result.operations,
      }),
    ).toEqual([]);
    expect(paths(result.operations)).toContain(result.mainFile);
  });

  it.each(cases)(
    "%s %j: output is already formatted by Prettier",
    async (id, raw) => {
      const generator = getGenerator(id);
      const result = generator.generate(
        input({
          name: name(raw),
          directory: "src/features/shop",
          exportFromFeature: true,
        }),
        DEFAULT_MANIFEST,
      );
      for (const operation of result.operations) {
        const content =
          operation.kind === "create"
            ? operation.content
            : operation.line + "\n";
        const formatted = await prettier.format(content, {
          filepath: operation.path,
        });
        expect(content, operation.path).toBe(formatted);
      }
    },
  );
});

describe("code", () => {
  it("removes shared indentation and ends with one newline", () => {
    const value = "x";
    expect(code`
      if (${value}) {
        run();
      }

    `).toBe("if (x) {\n  run();\n}\n");
  });
});
