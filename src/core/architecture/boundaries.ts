import * as path from "node:path";
import { appendMissingLines } from "../plan";
import type { Violation } from "../structure/rules";
import {
  resolveSpecifier,
  specifierFor,
  usesAlias,
  withoutSourceExtension,
  type PathAlias,
} from "./modules";
import { parseModule } from "./parse";

export { checkImports, type RuleId, type Violation } from "../structure/rules";

export interface PublicApiFix {
  /** Replaces the import's specifier. */
  specifier: { start: number; end: number; text: string };
  /** The unit's entry file (its index.ts), project-relative. */
  indexFile: string;
  /** The index file's new text, or undefined when it already exports everything. */
  indexText: string | undefined;
  /** Names added to the index, for the action's description. */
  addedExports: string[];
}

/**
 * The quick fix for an entry problem: import from the unit (such as a
 * feature) instead, and export the imported names from its entry file if
 * they aren't already. Only `import { ... }` and `export { ... } from`
 * statements can be fixed this way; for anything else there is no fix.
 *
 * `index` is the unit's existing entry file, if it has one.
 */
export function planPublicApiFix(
  violation: Violation,
  aliases: readonly PathAlias[],
  index: { file: string; text: string } | undefined,
): PublicApiFix | undefined {
  const { ref, file, target, unitFolder, entry } = violation;
  if (
    violation.rule !== "entry" ||
    ref === undefined ||
    ref.form.kind !== "named" ||
    unitFolder === undefined ||
    entry === undefined
  ) {
    return undefined;
  }

  const indexFile = index?.file ?? `${unitFolder}/${entry}`;
  const existing =
    index === undefined ? undefined : parseModule(index.file, index.text);
  const exported = new Set(existing?.exports.map((entry) => entry.name));
  const fromIndex = specifierFor(indexFile, target, [], false);
  const targetModule = withoutSourceExtension(target);
  const starCovers = (existing?.starExports ?? []).some(
    (specifier) =>
      withoutSourceExtension(
        resolveSpecifier(indexFile, specifier, []) ?? "",
      ) === targetModule,
  );

  const missing = starCovers
    ? []
    : ref.form.names.filter((entry) => !exported.has(entry.name));
  const values = unique(missing.filter((e) => !e.typeOnly).map((e) => e.name));
  const types = unique(
    missing
      .filter((e) => e.typeOnly && !values.includes(e.name))
      .map((e) => e.name),
  );
  const lines = [
    ...(values.length > 0
      ? [`export { ${values.join(", ")} } from "${fromIndex}";`]
      : []),
    ...(types.length > 0
      ? [`export type { ${types.join(", ")} } from "${fromIndex}";`]
      : []),
  ];

  const text = index?.text ?? "";
  const updated = lines.length > 0 ? appendMissingLines(text, lines) : text;
  return {
    specifier: {
      start: ref.start,
      end: ref.end,
      text: specifierFor(
        file,
        unitFolder,
        aliases,
        usesAlias(ref.specifier, aliases),
      ),
    },
    indexFile,
    indexText: updated !== text || index === undefined ? updated : undefined,
    addedExports: [...values, ...types],
  };
}

const unique = (names: string[]) => [...new Set(names)];

/**
 * A unit's entry file among `files`, if there is one. "index.ts" also
 * matches index.tsx, index.js and so on.
 */
export function findIndexFile(
  unitFolder: string,
  files: Iterable<string>,
  entry = "index.ts",
): string | undefined {
  const base = withoutSourceExtension(entry);
  for (const file of files) {
    if (
      path.posix.dirname(file) === unitFolder &&
      withoutSourceExtension(path.posix.basename(file)) === base
    ) {
      return file;
    }
  }
  return undefined;
}
