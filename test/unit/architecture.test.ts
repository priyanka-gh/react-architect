import { describe, expect, it } from "vitest";
import {
  checkImports,
  planPublicApiFix,
} from "../../src/core/architecture/boundaries";
import { buildProjectMap } from "../../src/core/architecture/graph";
import {
  aliasesFromTsconfig,
  areaOf,
  resolveSpecifier,
  specifierFor,
  type PathAlias,
} from "../../src/core/architecture/modules";
import { parseModule } from "../../src/core/architecture/parse";
import {
  DEFAULT_MANIFEST,
  type Manifest,
} from "../../src/core/manifest/schema";
import { applyChanges } from "../../src/core/plan";

const manifest = DEFAULT_MANIFEST;
const alias: PathAlias[] = [{ prefix: "@/", target: "src/", wildcard: true }];

describe("parseModule", () => {
  it("finds every kind of import with the specifier's exact position", () => {
    const text = [
      'import { Avatar, type Size as S } from "../profile/Avatar";',
      'import type { User } from "./types";',
      'import Default from "./default";',
      'import * as all from "./all";',
      'import "./side-effect.css";',
      'export { Card } from "./Card";',
      'export * from "./everything";',
      'const Lazy = lazy(() => import("./Lazy"));',
      '// import { Commented } from "./nope";',
      "const s = \"import { InString } from './nope'\";",
    ].join("\n");
    const { imports } = parseModule("a.tsx", text);

    expect(imports.map((ref) => ref.specifier)).toEqual([
      "../profile/Avatar",
      "./types",
      "./default",
      "./all",
      "./side-effect.css",
      "./Card",
      "./everything",
      "./Lazy",
    ]);
    const first = imports[0]!;
    expect(text.slice(first.start, first.end)).toBe("../profile/Avatar");
    expect(first.form).toEqual({
      kind: "named",
      reExport: false,
      names: [
        { name: "Avatar", typeOnly: false },
        { name: "Size", typeOnly: true },
      ],
    });
    expect(imports[1]!.form).toMatchObject({
      names: [{ name: "User", typeOnly: true }],
    });
    expect(imports[2]!.form.kind).toBe("other");
    expect(imports[5]!.form).toMatchObject({ kind: "named", reExport: true });
    expect(imports[7]!.line).toBe(7);
  });

  it("lists what a module exports", () => {
    const { exports, starExports } = parseModule(
      "index.ts",
      [
        'export { A, B as C } from "./a";',
        'export * from "./rest";',
        'export * as ns from "./ns";',
        "export function f() {}",
        "export const x = 1, y = 2;",
        "export interface I {}",
        "export type T = string;",
        "export default 1;",
        "function hidden() {}",
      ].join("\n"),
    );
    expect(exports.map((entry) => entry.name)).toEqual([
      "A",
      "C",
      "ns",
      "f",
      "x",
      "y",
      "I",
      "T",
      "default",
    ]);
    expect(starExports).toEqual(["./rest"]);
  });
});

describe("modules", () => {
  it("reads aliases from tsconfig, comments and all", () => {
    const text = `{
      // Vite's tsconfig has comments
      "compilerOptions": {
        "paths": { "@/*": ["./src/*"], "~utils": ["src/utils/index.ts"], "bad/*": ["../outside/*"] },
      },
    }`;
    expect(aliasesFromTsconfig(text, ".")).toEqual([
      { prefix: "@/", target: "src/", wildcard: true },
      { prefix: "~utils", target: "src/utils/index.ts", wildcard: false },
    ]);
  });

  it.each([
    ["src/features/cart/Cart.tsx", "../profile", "src/features/profile"],
    [
      "src/features/cart/Cart.tsx",
      "./hooks/useCart",
      "src/features/cart/hooks/useCart",
    ],
    ["src/app/App.tsx", "@/features/home", "src/features/home"],
    ["src/app/App.tsx", "react", undefined],
    ["src/App.tsx", "../../outside", undefined],
    ["src/a.ts", "./style.css?inline", "src/style.css"],
  ])("from %s, %s resolves to %s", (from, specifier, expected) => {
    expect(resolveSpecifier(from, specifier, alias)).toBe(expected);
  });

  it("writes specifiers relative or with an alias", () => {
    const from = "src/features/cart/components/Cart/Cart.tsx";
    expect(specifierFor(from, "src/features/profile", alias, false)).toBe(
      "../../../profile",
    );
    expect(specifierFor(from, "src/features/profile", alias, true)).toBe(
      "@/features/profile",
    );
    expect(
      specifierFor(from, "src/features/cart/components/Cart/x", [], false),
    ).toBe("./x");
  });

  it("knows which area a file is in", () => {
    expect(areaOf("src/features/cart/hooks/useCart.ts", manifest)).toEqual({
      kind: "feature",
      feature: "cart",
      folder: "src/features/cart",
    });
    expect(areaOf("src/features/cart", manifest)).toMatchObject({
      feature: "cart",
    });
    expect(areaOf("src/features/index.ts", manifest)).toEqual({
      kind: "other",
    });
    expect(areaOf("src/components/Button/Button.tsx", manifest)).toEqual({
      kind: "shared",
      folder: "src/components",
    });
    expect(areaOf("src/app/App.tsx", manifest)).toEqual({ kind: "other" });
  });
});

const check = (
  file: string,
  text: string,
  rules?: Partial<Manifest["rules"]>,
) =>
  checkImports(
    file,
    parseModule(file, text),
    { ...manifest, rules: { ...manifest.rules, ...rules } },
    alias,
  );

describe("checkImports", () => {
  it("flags reaching inside another feature, from anywhere", () => {
    const fromFeature = check(
      "src/features/cart/Cart.tsx",
      'import { Avatar } from "../profile/components/Avatar/Avatar";',
    );
    expect(fromFeature).toHaveLength(1);
    expect(fromFeature[0]).toMatchObject({
      rule: "entry",
      severity: "warning",
      unit: "profile",
      unitFolder: "src/features/profile",
      layer: "features",
    });
    expect(fromFeature[0]!.message).toContain(
      'import from "../profile" instead',
    );

    const fromApp = check(
      "src/app/routes.tsx",
      'import { X } from "@/features/profile/internal";',
    );
    expect(fromApp[0]!.message).toContain('"@/features/profile"');
  });

  it("allows a feature's public API and its own files", () => {
    expect(
      check(
        "src/features/cart/Cart.tsx",
        [
          'import { Avatar } from "../profile";',
          'import { A } from "../profile/index";',
          'import { B } from "@/features/profile/index.ts";',
          'import { useCart } from "./hooks/useCart";',
          'import { Button } from "../../components/Button/Button";',
          'import { useState } from "react";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("flags shared code using any part of a feature", () => {
    const found = check(
      "src/components/Header/Header.tsx",
      'import { useCart } from "../../features/cart";',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      rule: "layers",
      layer: "features",
      unit: "cart",
    });
  });

  it("follows the severity settings", () => {
    const text = 'import { A } from "../profile/A";';
    expect(
      check("src/features/cart/C.ts", text, { entry: "error" })[0]!.severity,
    ).toBe("error");
    expect(check("src/features/cart/C.ts", text, { entry: "off" })).toEqual([]);
    expect(
      check("src/hooks/useX.ts", 'import { A } from "../features/a";', {
        layers: "off",
      }),
    ).toEqual([]);
  });
});

describe("planPublicApiFix", () => {
  const file = "src/features/cart/Cart.tsx";
  const text =
    'import { Avatar, type AvatarProps } from "../profile/components/Avatar/Avatar";\n';
  const violation = () => check(file, text)[0]!;

  it("imports from the feature and adds missing exports to its index", () => {
    const fix = planPublicApiFix(violation(), alias, {
      file: "src/features/profile/index.ts",
      text: 'export { Profile } from "./components/Profile/Profile";\n',
    })!;
    expect(applyChanges(text, [fix.specifier])).toBe(
      'import { Avatar, type AvatarProps } from "../profile";\n',
    );
    expect(fix.indexText).toBe(
      [
        'export { Profile } from "./components/Profile/Profile";',
        'export { Avatar } from "./components/Avatar/Avatar";',
        'export type { AvatarProps } from "./components/Avatar/Avatar";',
        "",
      ].join("\n"),
    );
    expect(fix.addedExports).toEqual(["Avatar", "AvatarProps"]);
  });

  it("leaves the index alone when it already exports the names", () => {
    const fix = planPublicApiFix(violation(), alias, {
      file: "src/features/profile/index.ts",
      text: 'export { Avatar, type AvatarProps } from "./components/Avatar/Avatar";\n',
    })!;
    expect(fix.indexText).toBeUndefined();
    const star = planPublicApiFix(violation(), alias, {
      file: "src/features/profile/index.ts",
      text: 'export * from "./components/Avatar/Avatar";\n',
    })!;
    expect(star.indexText).toBeUndefined();
  });

  it("creates the index when the feature has none", () => {
    const fix = planPublicApiFix(violation(), alias, undefined)!;
    expect(fix.indexFile).toBe("src/features/profile/index.ts");
    expect(fix.indexText).toContain(
      'export { Avatar } from "./components/Avatar/Avatar";',
    );
  });

  it("has no fix for default or namespace imports", () => {
    const [found] = check(file, 'import Avatar from "../profile/Avatar";');
    expect(planPublicApiFix(found!, alias, undefined)).toBeUndefined();
  });
});

describe("buildProjectMap", () => {
  const modules = (files: Record<string, string>) =>
    new Map(
      Object.entries(files).map(([file, text]) => [
        file,
        parseModule(file, text),
      ]),
    );

  it("summarises features, who uses whom, problems and cycles", () => {
    const map = buildProjectMap(
      modules({
        "src/features/cart/index.ts":
          'export { Cart } from "./Cart";\nexport * from "./types";',
        "src/features/cart/Cart.tsx":
          'import { Avatar } from "../profile/Avatar";',
        "src/features/profile/index.ts": 'export { Avatar } from "./Avatar";',
        "src/features/profile/Avatar.tsx": 'import { Cart } from "../cart";',
        "src/features/auth/index.ts": "export const auth = 1;",
        "src/app/App.tsx": 'import { auth } from "../features/auth";',
      }),
      manifest,
      alias,
    );

    expect(map.units.map((feature) => feature.name)).toEqual([
      "auth",
      "cart",
      "profile",
    ]);
    const [auth, cart, profile] = map.units;
    expect(cart!.indexFile).toBe("src/features/cart/index.ts");
    expect(cart!.shares.map((entry) => entry.name)).toEqual(["Cart"]);
    expect(cart!.sharesAllOf).toEqual(["./types"]);
    expect([...cart!.uses.keys()]).toEqual(["src/features/profile"]);
    expect(profile!.usedBy.map((entry) => entry.unit)).toEqual([
      "src/features/cart",
    ]);
    expect(auth!.usedBy).toEqual([
      {
        unit: undefined,
        site: { file: "src/app/App.tsx", line: 0, character: 22 },
      },
    ]);
    expect(cart!.problems).toHaveLength(1);
    expect(map.problems).toHaveLength(1);
    expect(map.cycles).toEqual([["cart", "profile"]]);
  });

  it("reports longer cycles as one loop", () => {
    const map = buildProjectMap(
      modules({
        "src/features/a/index.ts": 'import "../b";',
        "src/features/b/index.ts": 'import "../c";',
        "src/features/c/index.ts": 'import "../a";',
        "src/features/d/index.ts": 'import "../a";',
      }),
      manifest,
      alias,
    );
    expect(map.cycles).toEqual([["a", "b", "c"]]);
  });
});
