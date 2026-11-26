import type { Manifest } from "../manifest/schema";
import { defaultStructureConfig, type StructureConfig } from "./model";

/**
 * Ready-made structures for Choose Structure (plans/custom-structure.md,
 * Phase 2). Each is tested like a template: valid, and a generated project
 * has no problems under it.
 */

export interface Preset {
  id: "feature-based" | "feature-based-pages" | "layered" | "feature-sliced";
  label: string;
  description: string;
  detail: string;
  build(paths: Manifest["paths"]): StructureConfig;
}

/** Tests and stories may reach anywhere; so may the test setup folder. */
export const TEST_FILES = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.stories.*",
  "src/test/**",
];

const HOOK_NAMES = [{ files: "**/hooks/*.ts", pattern: "use[A-Z]*" }];

/** What Generate Feature and Generate Page put in a feature (ADR 5, 11). */
export const FEATURE_TEMPLATE = [
  "components/",
  "hooks/",
  "services/",
  "pages/",
  "types.ts",
  "index.ts",
];

export const PRESETS: readonly Preset[] = [
  {
    id: "feature-based",
    label: "Feature-based",
    description: "What new projects use",
    detail:
      "Each feature in its own folder, used through its index.ts. Shared components and hooks can't use features.",
    build(paths) {
      const base = defaultStructureConfig(paths);
      return {
        ...base,
        layers: base.layers.map((layer) =>
          layer.name === "features"
            ? { ...layer, unitTemplate: FEATURE_TEMPLATE }
            : layer,
        ),
        ignore: TEST_FILES,
        naming: HOOK_NAMES,
      };
    },
  },
  {
    id: "feature-based-pages",
    label: "Feature-based with pages",
    description: "app → pages → features → shared",
    detail:
      "Like feature-based, plus a pages folder for screens that put features together, and an app folder on top.",
    build(paths) {
      return {
        layers: [
          {
            name: "app",
            paths: ["src/app"],
            mayImport: ["pages", "features", "shared"],
            siblings: "any",
          },
          {
            name: "pages",
            paths: ["src/pages"],
            mayImport: ["features", "shared"],
            siblings: "any",
          },
          {
            name: "features",
            paths: [`${paths.features}/*`],
            mayImport: ["shared"],
            entry: "index.ts",
            siblings: "entry",
            unitTemplate: FEATURE_TEMPLATE,
          },
          {
            name: "shared",
            paths: unique([
              paths.components,
              paths.hooks,
              "src/lib",
              "src/utils",
              "src/types",
            ]),
            mayImport: [],
            siblings: "any",
          },
        ],
        ignore: TEST_FILES,
        unlisted: "allowed",
        naming: HOOK_NAMES,
      };
    },
  },
  {
    id: "layered",
    label: "Layered (by kind)",
    description: "pages → components → hooks → services → utils",
    detail:
      "Folders by kind of code rather than by feature. Each layer may only use the layers below it.",
    build(paths) {
      return {
        layers: [
          {
            name: "app",
            paths: ["src/app"],
            mayImport: ["pages", "components", "hooks", "services", "utils"],
            siblings: "any",
          },
          {
            name: "pages",
            paths: ["src/pages"],
            mayImport: ["components", "hooks", "services", "utils"],
            siblings: "any",
          },
          {
            name: "components",
            paths: [paths.components],
            mayImport: ["hooks", "services", "utils"],
            siblings: "any",
          },
          {
            name: "hooks",
            paths: [paths.hooks],
            mayImport: ["services", "utils"],
            siblings: "any",
          },
          {
            name: "services",
            paths: ["src/services", "src/api"],
            mayImport: ["utils"],
            siblings: "any",
          },
          {
            name: "utils",
            paths: ["src/utils", "src/lib", "src/types"],
            mayImport: [],
            siblings: "any",
          },
        ],
        ignore: TEST_FILES,
        unlisted: "allowed",
        naming: HOOK_NAMES,
      };
    },
  },
  {
    id: "feature-sliced",
    label: "Feature-Sliced Design",
    description: "app → pages → widgets → features → entities → shared",
    detail:
      "Six layers, each split into slices that can't use each other. Each slice has ui/, model/ and api/ segments and an index.ts.",
    build() {
      const sliced = (name: string, below: string[]) => ({
        name,
        paths: [`src/${name}/*`],
        mayImport: below,
        entry: "index.ts",
        siblings: "none" as const,
        unitTemplate: ["ui/", "model/", "api/", "lib/", "index.ts"],
      });
      return {
        layers: [
          {
            name: "app",
            paths: ["src/app"],
            mayImport: ["pages", "widgets", "features", "entities", "shared"],
            siblings: "any",
          },
          sliced("pages", ["widgets", "features", "entities", "shared"]),
          sliced("widgets", ["features", "entities", "shared"]),
          sliced("features", ["entities", "shared"]),
          sliced("entities", ["shared"]),
          {
            name: "shared",
            paths: ["src/shared"],
            mayImport: [],
            siblings: "any",
          },
        ],
        ignore: TEST_FILES,
        unlisted: "allowed",
        naming: [],
      };
    },
  },
];

function unique(folders: string[]): string[] {
  return [...new Set(folders.filter((folder) => folder !== "."))];
}
