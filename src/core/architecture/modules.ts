import * as path from "node:path";
import * as ts from "typescript";
import type { Manifest } from "../manifest/schema";
import { SOURCE_EXTENSIONS } from "./parse";

/**
 * Where imports point, worked out from paths alone (no disk access). All
 * paths are relative to the project folder (where react-architect.json is)
 * and use "/".
 */

/** An import shortcut such as "@/*" -> "src/*" from tsconfig "paths". */
export interface PathAlias {
  /** "@/" for a "@/*" pattern, or the whole specifier for an exact one. */
  prefix: string;
  /** Project-relative folder (with trailing "/") or file it maps to. */
  target: string;
  wildcard: boolean;
}

/**
 * Reads "compilerOptions.paths" from a tsconfig file's text. Only the first
 * target of each pattern is used, and only patterns that are an exact name
 * or end in "/*". `tsconfigFolder` is project-relative ("." for the root).
 */
export function aliasesFromTsconfig(
  text: string,
  tsconfigFolder: string,
): PathAlias[] {
  const { config } = ts.parseConfigFileTextToJson("tsconfig.json", text) as {
    config?: { compilerOptions?: { paths?: unknown; baseUrl?: unknown } };
  };
  const options = config?.compilerOptions;
  const paths = options?.paths;
  if (typeof paths !== "object" || paths === null) {
    return [];
  }
  const base = path.posix.join(
    tsconfigFolder,
    typeof options?.baseUrl === "string" ? options.baseUrl : ".",
  );

  const aliases: PathAlias[] = [];
  for (const [pattern, targets] of Object.entries(paths)) {
    const first: unknown = Array.isArray(targets) ? targets[0] : undefined;
    if (typeof first !== "string") {
      continue;
    }
    const wildcard = pattern.endsWith("/*") && first.endsWith("/*");
    if (!wildcard && (pattern.includes("*") || first.includes("*"))) {
      continue;
    }
    const target = path.posix.normalize(
      path.posix.join(base, wildcard ? first.slice(0, -1) : first),
    );
    if (target.startsWith("../")) {
      continue;
    }
    aliases.push({
      prefix: wildcard ? pattern.slice(0, -1) : pattern,
      target: wildcard ? withTrailingSlash(target) : target,
      wildcard,
    });
  }
  return aliases;
}

const withTrailingSlash = (folder: string) =>
  folder === "." ? "" : folder.endsWith("/") ? folder : folder + "/";

/**
 * The project-relative path an import points to, as written: no extension is
 * added and folders stay folders. Undefined for packages and for anything
 * outside the project.
 */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  aliases: readonly PathAlias[],
): string | undefined {
  const clean = specifier.split("?")[0] ?? specifier;
  let resolved: string | undefined;
  if (
    clean.startsWith("./") ||
    clean.startsWith("../") ||
    clean === "." ||
    clean === ".."
  ) {
    resolved = path.posix.join(path.posix.dirname(fromFile), clean);
  } else {
    const alias = aliasFor(clean, aliases);
    if (alias === undefined) {
      return undefined;
    }
    resolved = alias.wildcard
      ? alias.target + clean.slice(alias.prefix.length)
      : alias.target;
  }
  const normalized = path.posix.normalize(resolved).replace(/\/$/, "");
  return normalized.startsWith("../") || normalized === ".."
    ? undefined
    : normalized;
}

function aliasFor(
  specifier: string,
  aliases: readonly PathAlias[],
): PathAlias | undefined {
  // The longest matching prefix wins, as in TypeScript.
  return aliases
    .filter((alias) =>
      alias.wildcard
        ? specifier.startsWith(alias.prefix)
        : specifier === alias.prefix,
    )
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
}

export function usesAlias(
  specifier: string,
  aliases: readonly PathAlias[],
): boolean {
  return (
    !specifier.startsWith(".") && aliasFor(specifier, aliases) !== undefined
  );
}

/**
 * The specifier for importing `target` (project-relative, as an import
 * would write it) from `fromFile`. With `preferAlias`, uses a matching alias
 * when there is one; otherwise a relative path.
 */
export function specifierFor(
  fromFile: string,
  target: string,
  aliases: readonly PathAlias[],
  preferAlias: boolean,
): string {
  if (preferAlias) {
    const alias = aliases
      .filter((candidate) =>
        candidate.wildcard
          ? (target + "/").startsWith(candidate.target) &&
            target.length >= candidate.target.length
          : target === candidate.target,
      )
      .sort((a, b) => b.target.length - a.target.length)[0];
    if (alias !== undefined) {
      return alias.wildcard
        ? alias.prefix + target.slice(alias.target.length)
        : alias.prefix;
    }
  }
  const relative = path.posix.relative(path.posix.dirname(fromFile), target);
  if (relative === "") {
    return ".";
  }
  return relative.startsWith("../") || relative === ".."
    ? relative
    : "./" + relative;
}

/** Drops a source file extension: "a/B.tsx" -> "a/B". Other extensions stay. */
export function withoutSourceExtension(file: string): string {
  const extension = SOURCE_EXTENSIONS.find((candidate) =>
    file.endsWith(candidate),
  );
  return extension === undefined ? file : file.slice(0, -extension.length);
}

/** Where a file sits in the project's structure. */
export type Area =
  | { kind: "feature"; feature: string; folder: string }
  | { kind: "shared"; folder: string }
  | { kind: "other" };

export function areaOf(file: string, manifest: Manifest): Area {
  const features = manifest.paths.features;
  const prefix = features === "." ? "" : features + "/";
  if (file.startsWith(prefix)) {
    const rest = file.slice(prefix.length);
    const name = rest.split("/")[0];
    // "features/cart" (the folder, as an import target) and anything inside
    // it are in the feature; a file directly in the features folder, such as
    // "features/index.ts", isn't. Feature folder names never contain dots.
    if (name && (rest.includes("/") || !name.includes("."))) {
      return { kind: "feature", feature: name, folder: prefix + name };
    }
  }
  for (const shared of [manifest.paths.components, manifest.paths.hooks]) {
    if (shared !== "." && (file === shared || file.startsWith(shared + "/"))) {
      return { kind: "shared", folder: shared };
    }
  }
  return { kind: "other" };
}

/**
 * True when `target` (as resolved from an import) is a feature's public API:
 * the feature folder itself or its index file.
 */
export function isFeatureEntry(target: string, featureFolder: string): boolean {
  return (
    target === featureFolder ||
    withoutSourceExtension(target) === featureFolder + "/index"
  );
}
