import type { Manifest } from "../manifest/schema";
import { withoutSourceExtension } from "../architecture/modules";
import { globToRegExp } from "./glob";

/**
 * A project's structure: its layers, which layers may import which, and how
 * units inside a layer may use each other (plans/custom-structure.md).
 * Projects without a `structure` setting get `defaultStructure`, which is the
 * feature-based structure of ADR 11.
 */

/** How units of the same layer may use each other. */
export const SIBLING_POLICIES = ["entry", "none", "any"] as const;
export type SiblingPolicy = (typeof SIBLING_POLICIES)[number];

/** A layer as written in react-architect.json, after validation. */
export interface LayerConfig {
  name: string;
  /** Folders, relative to the manifest; a final "/*" makes each folder inside it a unit. */
  paths: string[];
  mayImport: string[];
  /** A unit's front door, such as "index.ts". Only for layers with units. */
  entry?: string;
  siblings: SiblingPolicy;
  /**
   * What every unit contains, such as ["components/", "hooks/", "index.ts"]:
   * folders end in "/". Used by the placement rule and Generate Feature.
   */
  unitTemplate?: string[];
}

/** File names that must follow a pattern, such as hooks starting with "use". */
export interface NamingRule {
  /** Glob for the files it applies to, such as "**\/hooks/*.ts". */
  files: string;
  /** Glob for the name before its first dot, such as "use[A-Z]*". */
  pattern: string;
}

export interface StructureConfig {
  layers: LayerConfig[];
  /** Files no rule applies to, such as tests: glob patterns. */
  ignore: string[];
  /** Whether source files outside every layer are reported (placement rule). */
  unlisted: "allowed" | "reported";
  naming: NamingRule[];
}

interface LayerPath {
  /** The folder; "" for the project folder itself. */
  base: string;
  /** True for "base/*": each folder in base is a unit. */
  units: boolean;
}

export interface Layer extends LayerConfig {
  parsedPaths: LayerPath[];
}

export interface Structure {
  layers: Layer[];
  isIgnored: (file: string) => boolean;
  unlisted: StructureConfig["unlisted"];
  naming: { files: RegExp; pattern: RegExp; source: NamingRule }[];
}

export interface Place {
  layer: Layer;
  /** Set when the file is inside a unit: its name and folder. */
  unit?: { name: string; folder: string };
  /** The layer folder the file matched, for messages. */
  folder: string;
}

export function parseLayerPath(value: string): LayerPath {
  if (value === "*") return { base: "", units: true };
  return value.endsWith("/*")
    ? { base: value.slice(0, -2), units: true }
    : { base: value, units: false };
}

export function buildStructure(config: StructureConfig): Structure {
  const patterns = config.ignore.map(globToRegExp);
  return {
    layers: config.layers.map((layer) => ({
      ...layer,
      parsedPaths: layer.paths.map(parseLayerPath),
    })),
    isIgnored: (file) => patterns.some((pattern) => pattern.test(file)),
    unlisted: config.unlisted,
    naming: config.naming.map((rule) => ({
      files: globToRegExp(rule.files),
      pattern: globToRegExp(rule.pattern),
      source: rule,
    })),
  };
}

/**
 * The feature-based structure (ADR 11) for a manifest's paths: each folder in
 * paths.features is a unit with index.ts as its front door, and the shared
 * components and hooks may not import any feature.
 */
export function defaultStructureConfig(
  paths: Manifest["paths"],
): StructureConfig {
  const shared = [paths.components, paths.hooks].filter(
    (folder) => folder !== ".",
  );
  return {
    layers: [
      {
        name: "features",
        paths: [paths.features === "." ? "*" : `${paths.features}/*`],
        mayImport: ["shared"],
        entry: "index.ts",
        siblings: "entry",
      },
      { name: "shared", paths: shared, mayImport: [], siblings: "any" },
    ],
    ignore: [],
    unlisted: "allowed",
    naming: [],
  };
}

export function structureFor(manifest: Manifest): Structure {
  return buildStructure(
    manifest.structure ?? defaultStructureConfig(manifest.paths),
  );
}

/**
 * Which layer (and unit) a project-relative path belongs to, or undefined
 * when it's in none. The most specific match wins: a unit match counts as
 * longer than its folder, so "features/*" beats "features".
 *
 * Works for import targets too, which may be a folder ("features/cart") or a
 * file without its extension.
 */
export function classify(
  file: string,
  structure: Structure,
): Place | undefined {
  let best: { place: Place; length: number } | undefined;
  for (const layer of structure.layers) {
    for (const { base, units } of layer.parsedPaths) {
      const prefix = base === "" ? "" : base + "/";
      let match: { place: Place; length: number } | undefined;
      if (units) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const name = rest.split("/")[0];
        // "features/cart" (as an import target) and anything inside it are in
        // the unit; a file directly in the folder, like "features/index.ts",
        // isn't. Unit folder names never contain dots.
        if (!name || (!rest.includes("/") && name.includes("."))) continue;
        match = {
          place: {
            layer,
            unit: { name, folder: prefix + name },
            folder: base || ".",
          },
          length: prefix.length + name.length + 1,
        };
      } else if (file === base || file.startsWith(prefix)) {
        match = { place: { layer, folder: base }, length: base.length };
      }
      if (match && (best === undefined || match.length > best.length)) {
        best = match;
      }
    }
  }
  return best?.place;
}

/** True when `target` is the unit's front door: its folder, or its entry file. */
export function isUnitEntry(
  target: string,
  unitFolder: string,
  entry: string,
): boolean {
  return (
    target === unitFolder ||
    withoutSourceExtension(target) ===
      `${unitFolder}/${withoutSourceExtension(entry)}`
  );
}

/** "features" -> "feature", "entities" -> "entity": how one unit is referred to. */
export function unitNoun(layerName: string): string {
  if (layerName.endsWith("ies")) return layerName.slice(0, -3) + "y";
  if (layerName.endsWith("s")) return layerName.slice(0, -1);
  return layerName;
}
