import { readFileSync } from "node:fs";
import * as path from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { buildProjectMap } from "../../src/core/architecture/graph";
import { parseModule } from "../../src/core/architecture/parse";
import {
  DEFAULT_MANIFEST,
  validateManifest,
  type Manifest,
} from "../../src/core/manifest/schema";
import { globToRegExp } from "../../src/core/structure/glob";
import {
  buildStructure,
  classify,
  defaultStructureConfig,
  unitNoun,
  type StructureConfig,
} from "../../src/core/structure/model";
import { checkImports } from "../../src/core/structure/rules";

/** A Feature-Sliced-Design-like structure, to exercise every rule. */
const LAYERED: StructureConfig = {
  layers: [
    {
      name: "app",
      paths: ["src/app"],
      mayImport: ["pages", "features", "entities", "shared"],
      siblings: "any",
    },
    {
      name: "pages",
      paths: ["src/pages/*"],
      mayImport: ["features", "entities", "shared"],
      entry: "index.ts",
      siblings: "none",
    },
    {
      name: "features",
      paths: ["src/features/*"],
      mayImport: ["entities", "shared"],
      entry: "index.ts",
      siblings: "entry",
    },
    {
      name: "entities",
      paths: ["src/entities/*"],
      mayImport: ["shared"],
      entry: "index.ts",
      siblings: "any",
    },
    { name: "shared", paths: ["src/shared"], mayImport: [], siblings: "any" },
  ],
  ignore: ["**/*.test.*", "src/test/**"],
  unlisted: "allowed",
  naming: [],
};
const manifest: Manifest = { ...DEFAULT_MANIFEST, structure: LAYERED };
const structure = buildStructure(LAYERED);

const check = (
  file: string,
  specifier: string,
  overrides: Partial<Manifest> = {},
) =>
  checkImports(
    file,
    parseModule(file, `import { x } from "${specifier}";`),
    { ...manifest, ...overrides },
    [],
  );

describe("globToRegExp", () => {
  it.each([
    ["**/*.test.*", "src/a/B.test.tsx", true],
    ["**/*.test.*", "B.test.ts", true],
    ["**/*.test.*", "src/a/B.tsx", false],
    ["src/test/**", "src/test/setup.ts", true],
    ["src/test/**", "src/tests/setup.ts", false],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/a/b.ts", false],
    ["src/?.ts", "src/a.ts", true],
    ["a.b", "axb", false],
  ])("%s matches %s: %s", (glob, file, expected) => {
    expect(globToRegExp(glob).test(file)).toBe(expected);
  });
});

describe("classify", () => {
  it("finds the layer and unit", () => {
    expect(classify("src/features/cart/ui/Cart.tsx", structure)).toMatchObject({
      layer: { name: "features" },
      unit: { name: "cart", folder: "src/features/cart" },
    });
    expect(classify("src/features/cart", structure)?.unit?.name).toBe("cart");
    expect(classify("src/shared/ui/Button.tsx", structure)).toMatchObject({
      layer: { name: "shared" },
      folder: "src/shared",
    });
    expect(
      classify("src/shared/ui/Button.tsx", structure)?.unit,
    ).toBeUndefined();
  });

  it("leaves out files in no layer, and files directly in a unit folder", () => {
    expect(classify("src/main.tsx", structure)).toBeUndefined();
    expect(classify("src/features/index.ts", structure)).toBeUndefined();
  });

  it("prefers the most specific path", () => {
    const nested = buildStructure({
      layers: [
        {
          name: "features",
          paths: ["src/features/*"],
          mayImport: [],
          siblings: "any",
        },
        {
          name: "admin",
          paths: ["src/features/admin/*"],
          mayImport: [],
          siblings: "any",
        },
        { name: "everything", paths: ["src"], mayImport: [], siblings: "any" },
      ],
      ignore: [],
      unlisted: "allowed",
      naming: [],
    });
    expect(classify("src/features/admin/users/x.ts", nested)).toMatchObject({
      layer: { name: "admin" },
      unit: { name: "users" },
    });
    expect(classify("src/features/cart/x.ts", nested)?.layer.name).toBe(
      "features",
    );
    expect(classify("src/main.ts", nested)?.layer.name).toBe("everything");
  });

  it("supports units at the project root", () => {
    const root = buildStructure(
      defaultStructureConfig({ ...DEFAULT_MANIFEST.paths, features: "." }),
    );
    expect(classify("cart/Cart.tsx", root)?.unit?.folder).toBe("cart");
  });
});

describe("rules with a custom structure", () => {
  it("layers: a layer may only import the layers it lists", () => {
    const [problem] = check(
      "src/entities/user/model.ts",
      "../../features/auth",
    );
    expect(problem).toMatchObject({
      rule: "layers",
      layer: "features",
      unit: "auth",
    });
    expect(problem!.message).toBe(
      'The "user" entity uses the "auth" feature. Code in "entities" may only import "shared": move what\'s needed into entities, or move this file to a layer that may use features.',
    );
    expect(check("src/shared/lib/x.ts", "../../app/App")[0]!.message).toContain(
      'Code in "shared" may only import nothing outside its own layer',
    );
    expect(check("src/features/auth/x.ts", "../../entities/user")).toEqual([]);
  });

  it("entry: other code only uses a unit's entry", () => {
    expect(
      check("src/app/App.tsx", "../features/auth/ui/Login")[0],
    ).toMatchObject({
      rule: "entry",
      entry: "index.ts",
    });
    expect(check("src/app/App.tsx", "../features/auth")).toEqual([]);
    expect(check("src/app/App.tsx", "../features/auth/index")).toEqual([]);
  });

  it("siblings: none, entry and any", () => {
    const [none] = check("src/pages/home/index.ts", "../settings");
    expect(none).toMatchObject({ rule: "siblings", unit: "settings" });
    expect(none!.message).toBe(
      'The "home" page uses the "settings" page. Each page in "pages" stands alone: move what both need to a lower layer.',
    );
    expect(check("src/features/a/x.ts", "../b")).toEqual([]);
    expect(check("src/features/a/x.ts", "../b/internal")[0]!.rule).toBe(
      "entry",
    );
    expect(check("src/entities/a/x.ts", "../b/internal")).toEqual([]);
    expect(check("src/pages/home/ui/x.ts", "../Other")).toEqual([]);
  });

  it("ignores the files in ignore, as importer and as target", () => {
    expect(
      check("src/shared/ui/Button.test.tsx", "../../features/auth"),
    ).toEqual([]);
    expect(check("src/shared/ui/Button.tsx", "../../test/fixtures")).toEqual(
      [],
    );
  });

  it("follows each rule's severity", () => {
    const rules = {
      ...DEFAULT_MANIFEST.rules,
      siblings: "off" as const,
      layers: "error" as const,
    };
    expect(check("src/pages/home/index.ts", "../settings", { rules })).toEqual(
      [],
    );
    expect(
      check("src/shared/x.ts", "../features/a", { rules })[0]!.severity,
    ).toBe("error");
  });

  it("builds the map from units of every layer", () => {
    const modules = new Map(
      Object.entries({
        "src/pages/home/index.ts":
          'import { auth } from "../../features/auth";',
        "src/features/auth/index.ts":
          'import { user } from "../../entities/user";\nexport const auth = 1;',
        "src/entities/user/index.ts": "export const user = 1;",
      }).map(([file, text]) => [file, parseModule(file, text)]),
    );
    const map = buildProjectMap(modules, manifest, []);
    expect(map.units.map((unit) => [unit.name, unit.layer])).toEqual([
      ["auth", "features"],
      ["home", "pages"],
      ["user", "entities"],
    ]);
    expect(map.problems).toEqual([]);
  });
});

describe("unitNoun", () => {
  it.each([
    ["features", "feature"],
    ["entities", "entity"],
    ["pages", "page"],
    ["app", "app"],
  ])("%s -> %s", (layer, noun) => {
    expect(unitNoun(layer)).toBe(noun);
  });
});

describe("validating structure", () => {
  const validate = (structure: unknown) =>
    validateManifest({ manifestVersion: 1, structure });
  const layer = (overrides: Record<string, unknown> = {}) => ({
    name: "features",
    paths: ["src/features/*"],
    ...overrides,
  });

  it("accepts a structure and fills in defaults", () => {
    expect(
      validate({
        layers: [
          layer({ entry: "index.ts" }),
          { name: "shared", paths: ["./src/shared/"] },
        ],
      }),
    ).toMatchObject({
      ok: true,
      manifest: {
        structure: {
          layers: [
            {
              name: "features",
              paths: ["src/features/*"],
              mayImport: [],
              entry: "index.ts",
              siblings: "entry",
            },
            {
              name: "shared",
              paths: ["src/shared"],
              mayImport: [],
              siblings: "any",
            },
          ],
          ignore: [],
        },
      },
    });
  });

  it.each([
    [{}, '"structure.layers" must be a list with at least one layer.'],
    [
      { layers: [] },
      '"structure.layers" must be a list with at least one layer.',
    ],
    [
      { layers: [{ paths: ["a"] }] },
      '"structure.layers[0].name" must be a lower-case name such as "features" or "shared-ui", not undefined.',
    ],
    [
      { layers: [{ name: "a" }] },
      'The "a" layer needs "paths": at least one folder, such as "src/features/*".',
    ],
    [
      { layers: [layer({ mayImport: ["shared"] })] },
      'The "features" layer may import "shared", but there\'s no layer called "shared".',
    ],
    [
      { layers: [layer(), layer({ name: "other" })] },
      '"src/features/*" is in both the "features" and "other" layers.',
    ],
    [
      { layers: [layer(), layer()] },
      'Two layers are called "features"; layer names must be different.',
    ],
    [
      { layers: [layer({ paths: ["src/*/x"] })] },
      '"src/*/x" in the "features" layer: only a final "/*" is supported, meaning each folder in it is a unit.',
    ],
    [
      { layers: [layer({ paths: ["../x"] })] },
      '"../x" in the "features" layer must not contain "..".',
    ],
    [
      { layers: [layer({ paths: ["."] })] },
      '"." in the "features" layer is the whole project; name a folder inside it.',
    ],
    [
      { layers: [layer({ paths: ["src/a"], entry: "index.ts" })] },
      'The "features" layer has an entry, but entries only apply to layers with units: paths ending in "/*".',
    ],
    [
      { layers: [layer({ siblings: "entry" })] },
      'The "features" layer has siblings "entry" but no entry file. Add "entry": "index.ts".',
    ],
    [
      { layers: [layer({ siblings: "maybe" })] },
      '"structure.layers[0].siblings" must be one of "entry", "none", "any", not "maybe".',
    ],
    [
      { layers: [layer()], ignore: "*.test.*" },
      '"structure.ignore" must be a list of strings.',
    ],
  ])("rejects %j", (structure, error) => {
    const result = validate(structure);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain(error);
  });

  it("warns about unknown fields", () => {
    expect(
      validate({ layers: [layer({ colour: "red" })], extra: 1 }),
    ).toMatchObject({
      ok: true,
      warnings: [
        'Unknown setting "structure.extra" was ignored.',
        'Unknown setting "structure.layers[0].colour" was ignored.',
      ],
    });
  });

  it("agrees with the JSON Schema on shapes; references between layers are only checked here", () => {
    const schema = JSON.parse(
      readFileSync(path.resolve("schemas/react-architect.schema.json"), "utf8"),
    ) as Record<string, unknown>;
    const accepts = new Ajv({ allErrors: true }).compile(schema);
    const good = { manifestVersion: 1, structure: LAYERED };
    expect(accepts(good)).toBe(true);
    expect(validateManifest(good).ok).toBe(true);
    for (const bad of [
      { layers: [] },
      { layers: [layer({ paths: ["src/*/x"] })] },
      { layers: [layer({ siblings: "maybe" })] },
    ]) {
      expect(accepts({ manifestVersion: 1, structure: bad })).toBe(false);
      expect(validate(bad).ok).toBe(false);
    }
    const dangling = { layers: [layer({ mayImport: ["nowhere"] })] };
    expect(accepts({ manifestVersion: 1, structure: dangling })).toBe(true);
    expect(validate(dangling).ok).toBe(false);
  });
});
