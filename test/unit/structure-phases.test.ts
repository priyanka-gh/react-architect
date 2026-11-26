import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli } from "../../src/cli/check";
import { buildProjectMap } from "../../src/core/architecture/graph";
import { aliasesFromTsconfig } from "../../src/core/architecture/modules";
import { isSourceFile, parseModule } from "../../src/core/architecture/parse";
import {
  compareWithBaseline,
  createBaseline,
  parseBaseline,
} from "../../src/core/check/baseline";
import { formatGithub, formatText } from "../../src/core/check/format";
import { getGenerator } from "../../src/core/generators";
import {
  pageFilesAt,
  pageNames,
  structurePageLocation,
} from "../../src/core/generators/page";
import {
  DEFAULT_MANIFEST,
  serializeManifest,
  validateManifest,
  type Manifest,
} from "../../src/core/manifest/schema";
import { parseName } from "../../src/core/naming";
import {
  DEFAULT_PROJECT_CHOICES,
  manifestFor,
} from "../../src/core/project/options";
import { projectOverlay } from "../../src/core/project/overlay";
import {
  inferStructure,
  placeUnknownFolder,
} from "../../src/core/structure/infer";
import { kindOf } from "../../src/core/structure/kinds";
import type { StructureConfig } from "../../src/core/structure/model";
import { PRESETS } from "../../src/core/structure/presets";
import { checkFile } from "../../src/core/structure/rules";
import { parseTree } from "../../src/core/structure/treeFile";

const name = (input: string) => {
  const result = parseName(input);
  if (!result.ok) throw new Error(result.error);
  return result.name;
};
const withStructure = (
  structure: StructureConfig,
  rules: Partial<Manifest["rules"]> = {},
): Manifest => ({
  ...DEFAULT_MANIFEST,
  structure,
  rules: { ...DEFAULT_MANIFEST.rules, ...rules },
});
const problemsIn = (files: Record<string, string>, manifest: Manifest) => {
  const tsconfig = files["tsconfig.app.json"];
  const modules = new Map(
    Object.entries(files)
      .filter(([file]) => isSourceFile(file))
      .map(([file, text]) => [file, parseModule(file, text)]),
  );
  return buildProjectMap(
    modules,
    manifest,
    tsconfig ? aliasesFromTsconfig(tsconfig, ".") : [],
  ).problems;
};

describe("presets", () => {
  it.each(PRESETS.map((preset) => [preset.label, preset] as const))(
    "%s is a valid structure that survives being saved and read back",
    (_, preset) => {
      const structure = preset.build(DEFAULT_MANIFEST.paths);
      const result = validateManifest({ manifestVersion: 1, structure });
      expect(result).toMatchObject({ ok: true, warnings: [] });
      if (result.ok) expect(result.manifest.structure).toEqual(structure);
    },
  );

  it("checks unit templates", () => {
    const layer = { name: "a", paths: ["src/a/*"] };
    const check = (unitTemplate: unknown, paths = layer.paths) =>
      validateManifest({
        manifestVersion: 1,
        structure: { layers: [{ ...layer, paths, unitTemplate }] },
      });
    expect(check(["ui/", "a/b/"])).toMatchObject({
      ok: false,
      errors: [
        '"a/b/" in the "a" layer\'s unitTemplate must be one folder ("components/") or file ("index.ts") name.',
      ],
    });
    expect(check(["ui/"], ["src/a"])).toMatchObject({ ok: false });
    expect(check("ui/")).toMatchObject({ ok: false });
  });

  const generated = Object.fromEntries(
    projectOverlay({
      ...DEFAULT_PROJECT_CHOICES,
      name: "app",
    }).operations.flatMap((operation) =>
      operation.kind === "create" ? [[operation.path, operation.content]] : [],
    ),
  );

  it.each(["feature-based", "feature-based-pages", "layered"])(
    "a new project has no problems under %s",
    (id) => {
      const preset = PRESETS.find((candidate) => candidate.id === id)!;
      const manifest = withStructure(
        preset.build(manifestFor(DEFAULT_PROJECT_CHOICES).paths),
      );
      expect(
        problemsIn(generated, manifest).map((p) => `${p.file}: ${p.message}`),
      ).toEqual([]);
    },
  );

  it("a new project under Feature-Sliced Design only has placement problems (its layout differs)", () => {
    const preset = PRESETS.find(
      (candidate) => candidate.id === "feature-sliced",
    )!;
    const problems = problemsIn(
      generated,
      withStructure(preset.build(DEFAULT_MANIFEST.paths)),
    );
    expect(new Set(problems.map((p) => p.rule))).toEqual(
      new Set(["placement"]),
    );
  });

  /** Phase 5's promise: generating one of everything breaks no rule. */
  it.each(PRESETS.map((preset) => [preset.label, preset] as const))(
    "%s: generated components, hooks, features and pages have no problems",
    (_, preset) => {
      const manifest = withStructure(preset.build(DEFAULT_MANIFEST.paths));
      const files: Record<string, string> = {};
      for (const id of ["component", "hook", "feature"] as const) {
        const generator = getGenerator(id);
        const choices = generator.directoryChoices?.(manifest) ?? [];
        for (const directory of choices.length > 0
          ? choices
          : [generator.defaultDirectory(manifest)]) {
          const result = generator.generate(
            {
              name: name(id === "hook" ? "use cart" : `my ${id}`),
              directory,
              includeTests: true,
              exportFromFeature: false,
            },
            manifest,
          );
          for (const operation of result.operations) {
            if (operation.kind === "create")
              files[operation.path] = operation.content;
          }
        }
      }
      const pages = structurePageLocation(
        pageNames(name("settings")),
        manifest,
      );
      if (pages) {
        for (const operation of pageFilesAt(
          pageNames(name("settings")),
          pages,
          manifest,
          true,
        ).operations) {
          files[operation.path] =
            operation.kind === "create"
              ? operation.content
              : operation.kind === "ensureLine"
                ? operation.line + "\n"
                : "";
        }
      }
      expect(
        problemsIn(files, manifest).map((p) => `${p.file}: ${p.message}`),
      ).toEqual([]);
    },
  );

  it("Feature-Sliced Design features follow the slice template", () => {
    const manifest = withStructure(
      PRESETS.find((p) => p.id === "feature-sliced")!.build(
        DEFAULT_MANIFEST.paths,
      ),
    );
    const generator = getGenerator("feature");
    expect(generator.directoryChoices?.(manifest)).toEqual([
      "src/features",
      "src/pages",
      "src/widgets",
      "src/entities",
    ]);
    const paths = generator
      .generate(
        {
          name: name("cart"),
          directory: "src/features",
          includeTests: false,
          exportFromFeature: false,
        },
        manifest,
      )
      .operations.map((operation) => operation.path);
    expect(paths).toEqual([
      "src/features/cart/ui/Cart/Cart.tsx",
      "src/features/cart/ui/Cart/Cart.module.css",
      "src/features/cart/model/useCart.ts",
      "src/features/cart/api/cartApi.ts",
      "src/features/cart/model/types.ts",
      "src/features/cart/index.ts",
    ]);
    expect(
      structurePageLocation(pageNames(name("settings")), manifest),
    ).toEqual({
      folder: "src/pages/settings/ui",
      unit: { folder: "src/pages/settings", entry: "index.ts" },
      importTarget: "src/pages/settings",
    });
  });
});

describe("parseTree", () => {
  const expected = [
    "src",
    "src/app",
    "src/app/App.tsx",
    "src/features",
    "src/features/auth",
    "src/features/auth/components",
    "src/features/auth/index.ts",
    "src/shared",
  ];
  const paths = (text: string) => {
    const result = parseTree(text);
    if (!result.ok) throw new Error(result.errors.join(" "));
    return result.entries.map((entry) => entry.path);
  };

  it.each([
    [
      "a drawn tree with a project folder",
      `my-app/
├── package.json
└── src/
    ├── app/
    │   └── App.tsx      # the root component
    ├── features/
    │   └── auth/
    │       ├── components/
    │       └── index.ts
    └── shared/`,
    ],
    [
      "ASCII drawing",
      `src
|-- app
|   \`-- App.tsx
|-- features
|   \`-- auth
|       |-- components
|       \`-- index.ts
\`-- shared`,
    ],
    [
      "an indented list with bullets",
      `- src/
  - app/
    - App.tsx
  - features/
    - auth/
      - components/
      - index.ts
  - shared/`,
    ],
    [
      "paths, one per line, in a Markdown code fence",
      `Our layout:

\`\`\`text
src/app/App.tsx
src/features/auth/components/
src/features/auth/index.ts
src/shared/
\`\`\`
Some text after.`,
    ],
  ])("reads %s", (_, text) => {
    const found = paths(text).filter((p) => p !== "package.json");
    expect(found).toEqual(expected);
  });

  it("reports bad lines with their number", () => {
    expect(parseTree("src/\n  a<b>/\n")).toEqual({
      ok: false,
      errors: ['Line 2: "a<b>/" has characters that can\'t be in a file name.'],
    });
    expect(parseTree("../outside/")).toMatchObject({ ok: false });
    expect(parseTree("# just a comment")).toEqual({
      ok: false,
      errors: ["No folders or files were found in it."],
    });
  });
});

describe("inferStructure", () => {
  const infer = (text: string) => {
    const result = parseTree(text);
    if (!result.ok) throw new Error(result.errors.join(" "));
    return inferStructure(result.entries);
  };

  it("reads the tree from the original React Architect proposal", () => {
    const { config, unknown } = infer(`
my-app/
├── public/
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   └── providers.tsx
│   ├── assets/
│   ├── components/
│   │   ├── ui/
│   │   └── layout/
│   ├── features/
│   │   ├── auth/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── services/
│   │   │   ├── types/
│   │   │   └── index.ts
│   │   └── dashboard/
│   ├── hooks/
│   ├── lib/
│   ├── services/
│   ├── utils/
│   ├── types/
│   └── styles/
├── package.json
└── vite.config.ts`);
    expect(unknown).toEqual([]);
    expect(config.layers).toEqual([
      {
        name: "app",
        paths: ["src/app"],
        mayImport: ["features", "shared"],
        siblings: "any",
      },
      {
        name: "features",
        paths: ["src/features/*"],
        mayImport: ["shared"],
        entry: "index.ts",
        siblings: "entry",
        unitTemplate: [
          "components/",
          "hooks/",
          "services/",
          "types/",
          "index.ts",
        ],
      },
      {
        name: "shared",
        paths: [
          "src/assets",
          "src/components",
          "src/hooks",
          "src/lib",
          "src/services",
          "src/styles",
          "src/types",
          "src/utils",
        ],
        mayImport: [],
        siblings: "any",
      },
    ]);
    expect(validateManifest({ manifestVersion: 1, structure: config }).ok).toBe(
      true,
    );
  });

  it("recognises Feature-Sliced Design", () => {
    const { config } = infer(`src/app/
src/pages/home/ui/
src/pages/home/index.ts
src/widgets/header/ui/
src/widgets/header/index.ts
src/features/login/ui/
src/features/login/model/
src/features/login/index.ts
src/entities/user/model/
src/entities/user/index.ts
src/shared/ui/`);
    expect(
      config.layers.map((layer) => [
        layer.name,
        layer.siblings,
        layer.mayImport.join(" "),
      ]),
    ).toEqual([
      ["app", "any", "pages widgets features entities shared"],
      ["pages", "none", "widgets features entities shared"],
      ["widgets", "none", "features entities shared"],
      ["features", "none", "entities shared"],
      ["entities", "none", "shared"],
      ["shared", "any", ""],
    ]);
    expect(config.layers[3]!.unitTemplate).toEqual([
      "model/",
      "ui/",
      "index.ts",
    ]);
  });

  it("asks about folders it doesn't recognise, and applies the answers", () => {
    const { config, unknown } = infer(
      "src/features/a/\nsrc/kitchen/\nsrc/shared/\nsrc/__tests__/",
    );
    expect(unknown).toEqual(["src/kitchen"]);
    expect(config.ignore).toContain("src/__tests__/**");
    expect(
      placeUnknownFolder(config, "src/kitchen", "shared").layers.at(-1)!.paths,
    ).toEqual(["src/shared", "src/kitchen"]);
    const top = placeUnknownFolder(config, "src/kitchen", "top").layers[0]!;
    expect(top).toEqual({
      name: "kitchen",
      paths: ["src/kitchen"],
      mayImport: ["features", "shared"],
      siblings: "any",
    });
    const bottom = placeUnknownFolder(config, "src/kitchen", "bottom");
    expect(bottom.layers.at(-1)!.name).toBe("kitchen");
    expect(bottom.layers[0]!.mayImport).toContain("kitchen");
    expect(
      placeUnknownFolder(config, "src/kitchen", "ignore").ignore,
    ).toContain("src/kitchen/**");
  });

  it("treats a pages folder of files as one layer", () => {
    const { config } = infer(
      "src/pages/Home.tsx\nsrc/pages/About.tsx\nsrc/components/",
    );
    expect(config.layers[0]).toMatchObject({
      name: "pages",
      paths: ["src/pages"],
    });
  });
});

describe("placement and naming", () => {
  const structure: StructureConfig = {
    layers: [
      {
        name: "features",
        paths: ["src/features/*"],
        mayImport: ["shared"],
        entry: "index.ts",
        siblings: "entry",
        unitTemplate: ["components/", "hooks/", "types.ts", "index.ts"],
      },
      {
        name: "shared",
        paths: ["src/components", "src/hooks"],
        mayImport: [],
        siblings: "any",
      },
    ],
    ignore: ["**/*.test.*"],
    unlisted: "reported",
    naming: [{ files: "**/hooks/*.ts", pattern: "use[A-Z]*" }],
  };
  const manifest = withStructure(structure);

  it.each([
    ["src/features/cart/components/Cart/Cart.tsx", []],
    ["src/features/cart/index.ts", []],
    ["src/features/cart/types.ts", []],
    ["src/features/cart/Cart.test.tsx", []],
  ])("%s is fine", (file, expected) => {
    expect(checkFile(file, manifest)).toEqual(expected);
  });

  it("flags files outside the unit template, with a move when the kind is clear", () => {
    const [problem] = checkFile("src/features/cart/useCart.ts", manifest);
    expect(problem).toMatchObject({
      rule: "placement",
      unit: "cart",
      fix: { moveTo: "src/features/cart/hooks/useCart.ts" },
    });
    expect(problem!.message).toBe(
      'This file is outside the "cart" feature\'s template, which is: components/, hooks/, types.ts, index.ts. It looks like it belongs in hooks/.',
    );
    expect(
      checkFile("src/features/cart/misc/helpers.ts", manifest)[0],
    ).not.toHaveProperty("fix");
  });

  it("flags files in no layer when unlisted files are reported", () => {
    expect(checkFile("src/widgets/Banner.tsx", manifest)[0]).toMatchObject({
      rule: "placement",
      fix: { moveTo: "src/components/Banner.tsx" },
    });
    expect(
      checkFile(
        "src/widgets/Banner.tsx",
        withStructure({ ...structure, unlisted: "allowed" }),
      ),
    ).toEqual([]);
  });

  it("flags names that break a naming rule, suggesting one that fits", () => {
    expect(checkFile("src/hooks/cart.ts", manifest)[0]).toMatchObject({
      rule: "naming",
      fix: { renameTo: "src/hooks/useCart.ts" },
    });
    expect(checkFile("src/hooks/useCart.ts", manifest)).toEqual([]);
    expect(
      checkFile(
        "src/hooks/cart.ts",
        withStructure(structure, { naming: "off" }),
      ),
    ).toEqual([]);
  });

  it.each([
    ["useCart.ts", "hook"],
    ["Cart.tsx", "component"],
    ["SettingsPage.tsx", "page"],
    ["cartApi.ts", "service"],
    ["cart.types.ts", "types"],
    ["types.ts", "types"],
    ["helpers.ts", undefined],
  ])("kindOf(%s) is %s", (file, kind) => {
    expect(kindOf(file)).toBe(kind);
  });
});

describe("baseline and formats", () => {
  const problems = problemsIn(
    {
      "src/components/A.tsx":
        'import { x } from "../features/cart";\nimport { y } from "../features/cart";',
      "src/components/B.tsx": 'import { x } from "../features/cart";',
    },
    DEFAULT_MANIFEST,
  );

  it("matches problems by rule, file and target, with counts", () => {
    const baseline = createBaseline(problems.slice(0, 2));
    expect(baseline.problems).toEqual([
      {
        rule: "layers",
        file: "src/components/A.tsx",
        target: "src/features/cart",
        count: 2,
      },
    ]);
    const { fresh, known } = compareWithBaseline(problems, baseline);
    expect(known).toHaveLength(2);
    expect(fresh.map((p) => p.file)).toEqual(["src/components/B.tsx"]);
    expect(parseBaseline(JSON.stringify(baseline))).toEqual({
      ok: true,
      baseline,
    });
    expect(parseBaseline('{"version":2}').ok).toBe(false);
  });

  it("formats problems for people and for GitHub", () => {
    expect(formatText(problems[0]!, "src/components/A.tsx")).toBe(
      `src/components/A.tsx:1:20  warning  ${problems[0]!.message}  [layers]`,
    );
    expect(
      formatGithub(
        { ...problems[0]!, message: "50% done,\nreally" },
        "a:b,c.tsx",
      ),
    ).toBe(
      "::warning file=a%3Ab%2Cc.tsx,line=1,col=20,title=React Architect (layers)::50%25 done,%0Areally",
    );
  });
});

describe("react-architect check", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "react-architect-cli-"));
  afterAll(() => rmSync(parent, { recursive: true, force: true }));

  const project = (
    files: Record<string, string>,
    manifest: Manifest = DEFAULT_MANIFEST,
  ) => {
    const root = mkdtempSync(path.join(parent, "p-"));
    for (const [file, text] of Object.entries({
      "react-architect.json": serializeManifest(manifest),
      ...files,
    })) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    return root;
  };
  const run = async (cwd: string, ...args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(args, {
      cwd,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
    });
    return { code, out, err };
  };

  it("passes a clean project and fails errors, not warnings", async () => {
    const clean = project({
      "src/features/cart/index.ts": "export const cart = 1;\n",
    });
    expect(await run(clean, "check")).toEqual({
      code: 0,
      out: ["No structure problems."],
      err: [],
    });

    const files = {
      "src/components/A.tsx": 'import { cart } from "../features/cart";\n',
    };
    const warned = await run(project(files), "check");
    expect(warned.code).toBe(0);
    expect(warned.out[0]).toMatch(
      /^src\/components\/A\.tsx:1:23 {2}warning {2}Shared code/,
    );
    expect(warned.out.at(-1)).toBe("0 errors, 1 warning.");
    expect(
      (await run(project(files), "check", "--max-warnings", "0")).code,
    ).toBe(1);

    const strict = {
      ...DEFAULT_MANIFEST,
      rules: { ...DEFAULT_MANIFEST.rules, layers: "error" as const },
    };
    const failed = await run(
      project(files, strict),
      "check",
      "--format",
      "github",
    );
    expect(failed.code).toBe(1);
    expect(failed.out).toEqual([
      expect.stringMatching(
        /^::error file=src\/components\/A\.tsx,line=1,col=23,title=React Architect \(layers\)::Shared code/,
      ),
    ]);
  });

  it("only fails new problems once there's a baseline", async () => {
    const strict = {
      ...DEFAULT_MANIFEST,
      rules: { ...DEFAULT_MANIFEST.rules, layers: "error" as const },
    };
    const root = project(
      { "src/components/A.tsx": 'import { cart } from "../features/cart";\n' },
      strict,
    );
    expect((await run(root, "check", "--update-baseline")).out).toEqual([
      "react-architect-baseline.json: recorded 1 existing problem.",
    ]);
    expect(
      JSON.parse(
        readFileSync(path.join(root, "react-architect-baseline.json"), "utf8"),
      ).problems,
    ).toHaveLength(1);
    expect(await run(root)).toEqual({
      code: 0,
      out: ["No structure problems (1 more in the baseline)."],
      err: [],
    });

    writeFileSync(
      path.join(root, "src/components/B.tsx"),
      'import { cart } from "../features/cart";\n',
    );
    const after = await run(root);
    expect(after.code).toBe(1);
    expect(after.out[0]).toMatch(/^src\/components\/B\.tsx/);
  });

  it("finds projects below and above, and explains what's wrong", async () => {
    const own = mkdtempSync(path.join(parent, "below-"));
    const root = mkdtempSync(path.join(own, "p-"));
    writeFileSync(
      path.join(root, "react-architect.json"),
      serializeManifest(DEFAULT_MANIFEST),
    );
    expect((await run(own)).code).toBe(0);
    mkdirSync(path.join(root, "src/deep"), { recursive: true });
    expect((await run(path.join(root, "src/deep"))).out).toEqual([
      "No structure problems.",
    ]);
    const empty = mkdtempSync(path.join(tmpdir(), "react-architect-none-"));
    expect((await run(empty)).code).toBe(2);
    expect((await run(root, "--format", "xml")).err).toEqual([
      '--format must be "text" or "github".',
    ]);
    expect((await run(root, "lint")).code).toBe(2);
    rmSync(empty, { recursive: true });
  });
});
