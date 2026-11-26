import type { Manifest, RuleSeverity } from "../manifest/schema";
import {
  resolveSpecifier,
  specifierFor,
  usesAlias,
  type PathAlias,
} from "../architecture/modules";
import type { ImportRef, ModuleInfo } from "../architecture/parse";
import * as path from "node:path";
import { withoutSourceExtension } from "../architecture/modules";
import { KIND_FOLDERS, kindOf, stem, templateFolderFor } from "./kinds";
import {
  classify,
  isUnitEntry,
  structureFor,
  unitNoun,
  type Place,
  type Structure,
} from "./model";

/**
 * The structure rules (ADR 11, plans/custom-structure.md):
 *
 * - layers: a layer may only import the layers in its `mayImport`.
 * - entry: code outside a unit may only import the unit's front door (its
 *   folder or entry file), never a file inside it.
 * - siblings: units of a layer whose siblings policy is "none" may not use
 *   each other at all.
 *
 * Each import is reported at most once, for the most basic problem: a layer
 * that may not be used at all comes before how it's used.
 */

export const RULE_IDS = [
  "layers",
  "entry",
  "siblings",
  "placement",
  "naming",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export interface Violation {
  rule: RuleId;
  severity: Exclude<RuleSeverity, "off">;
  /** The importing file, or the file that's misplaced or misnamed. */
  file: string;
  /** The import, for import rules; undefined for placement and naming. */
  ref?: ImportRef;
  /** What the import resolves to. */
  target: string;
  /** The target's layer. */
  layer: string;
  /** The target's unit, if it's in one. */
  unit?: string;
  unitFolder?: string;
  /** The target layer's entry file, such as "index.ts". */
  entry?: string;
  message: string;
  /** A fix the editor can offer: where to move the file, or what to rename it to. */
  fix?: { moveTo: string } | { renameTo: string };
}

export function checkImports(
  file: string,
  module: ModuleInfo,
  manifest: Manifest,
  aliases: readonly PathAlias[],
  structure: Structure = structureFor(manifest),
): Violation[] {
  if (structure.isIgnored(file)) return [];
  const from = classify(file, structure);
  const violations: Violation[] = [];

  for (const ref of module.imports) {
    const target = resolveSpecifier(file, ref.specifier, aliases);
    if (target === undefined || structure.isIgnored(target)) continue;
    const to = classify(target, structure);
    if (to === undefined) continue;

    const problem = problemFor(file, ref, target, from, to, aliases);
    if (problem === undefined) continue;
    const severity = manifest.rules[problem.rule];
    if (severity === "off") continue;
    violations.push({
      ...problem,
      severity,
      file,
      ref,
      target,
      layer: to.layer.name,
      ...(to.unit && { unit: to.unit.name, unitFolder: to.unit.folder }),
      ...(to.layer.entry !== undefined && { entry: to.layer.entry }),
    });
  }
  return violations;
}

function problemFor(
  file: string,
  ref: ImportRef,
  target: string,
  from: Place | undefined,
  to: Place,
  aliases: readonly PathAlias[],
): { rule: RuleId; message: string } | undefined {
  const sameLayer = from !== undefined && from.layer === to.layer;
  if (
    sameLayer &&
    (to.unit === undefined || from.unit?.folder === to.unit.folder)
  ) {
    return undefined;
  }

  if (
    from !== undefined &&
    !sameLayer &&
    !from.layer.mayImport.includes(to.layer.name)
  ) {
    return { rule: "layers", message: layersMessage(from, to) };
  }

  if (to.unit === undefined) return undefined;
  if (sameLayer && to.layer.siblings === "any") return undefined;
  if (sameLayer && to.layer.siblings === "none") {
    return { rule: "siblings", message: siblingsMessage(from!, to) };
  }

  const entry = to.layer.entry;
  if (entry === undefined || isUnitEntry(target, to.unit.folder, entry)) {
    return undefined;
  }
  const suggestion = specifierFor(
    file,
    to.unit.folder,
    aliases,
    usesAlias(ref.specifier, aliases),
  );
  return {
    rule: "entry",
    message: `This reaches inside the "${to.unit.name}" ${unitNoun(to.layer.name)}. Other code should only use what ${to.unit.name}'s ${entry} exports: import from "${suggestion}" instead.`,
  };
}

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

function describe(place: Place): string {
  return place.unit
    ? `the "${place.unit.name}" ${unitNoun(place.layer.name)}`
    : `${place.layer.name} code in ${place.folder}`;
}

function layersMessage(from: Place, to: Place): string {
  const allowed = from.layer.mayImport;
  const may =
    allowed.length === 0
      ? "nothing outside its own layer"
      : allowed.map((name) => `"${name}"`).join(", ");
  return `${capitalise(describe(from))} uses ${describe(to)}. Code in "${from.layer.name}" may only import ${may}: move what's needed into ${from.layer.name}, or move this file to a layer that may use ${to.layer.name}.`;
}

function siblingsMessage(from: Place, to: Place): string {
  const noun = unitNoun(to.layer.name);
  return `${capitalise(describe(from))} uses ${describe(to)}. Each ${noun} in "${to.layer.name}" stands alone: move what both need to a lower layer.`;
}

/**
 * The placement and naming rules, which are about a file rather than its
 * imports:
 *
 * - placement: a source file outside every layer (when structure.unlisted
 *   is "reported"), or inside a unit but outside the layer's unitTemplate.
 * - naming: a file whose name doesn't match a structure.naming pattern.
 */
export function checkFile(
  file: string,
  manifest: Manifest,
  structure: Structure = structureFor(manifest),
): Violation[] {
  if (structure.isIgnored(file)) return [];
  const place = classify(file, structure);
  const found: (Omit<Violation, "severity" | "file" | "target" | "layer"> & {
    layer?: string;
  })[] = [];

  if (place === undefined && structure.unlisted === "reported") {
    const kind = kindOf(file);
    const folders = structure.layers.flatMap((layer) =>
      layer.parsedPaths.filter((p) => !p.units).map((p) => p.base),
    );
    const home =
      kind &&
      folders.find((folder) =>
        KIND_FOLDERS[kind].includes(path.posix.basename(folder)),
      );
    found.push({
      rule: "placement",
      message: `This file isn't in any layer of the structure.${home ? ` It looks like it belongs in ${home}.` : ""} Move it into a layer's folder, or add its folder to a layer or to "ignore" in react-architect.json.`,
      ...(home && { fix: { moveTo: `${home}/${path.posix.basename(file)}` } }),
    });
  }

  const template = place?.layer.unitTemplate;
  if (place?.unit && template !== undefined) {
    const rest = file.slice(place.unit.folder.length + 1);
    const [first] = rest.split("/");
    const allowed = rest.includes("/")
      ? template.includes(`${first}/`)
      : template.includes(rest) ||
        template.some(
          (item) =>
            !item.endsWith("/") &&
            withoutSourceExtension(item) === withoutSourceExtension(rest),
        ) ||
        (place.layer.entry !== undefined &&
          withoutSourceExtension(rest) ===
            withoutSourceExtension(place.layer.entry));
    if (!allowed) {
      const kind = kindOf(file);
      const folder = kind && templateFolderFor(kind, template);
      const noun = unitNoun(place.layer.name);
      found.push({
        rule: "placement",
        layer: place.layer.name,
        unit: place.unit.name,
        unitFolder: place.unit.folder,
        message: `This file is outside the "${place.unit.name}" ${noun}'s template, which is: ${template.join(", ")}.${folder ? ` It looks like it belongs in ${folder}/.` : ""}`,
        ...(folder && {
          fix: {
            moveTo: `${place.unit.folder}/${folder}/${path.posix.basename(file)}`,
          },
        }),
      });
    }
  }

  for (const rule of structure.naming) {
    if (!rule.files.test(file)) continue;
    const name = stem(file);
    if (rule.pattern.test(name)) continue;
    const prefix = /^([a-z]+)\[A-Z\]/.exec(rule.source.pattern)?.[1];
    const renamed =
      prefix !== undefined && !name.startsWith(prefix)
        ? prefix + name.charAt(0).toUpperCase() + name.slice(1)
        : undefined;
    const base = path.posix.basename(file);
    found.push({
      rule: "naming",
      message: `"${base}" doesn't follow the naming rule for ${rule.source.files}: names must match "${rule.source.pattern}".${renamed ? ` For example: ${renamed}.` : ""}`,
      ...(renamed &&
        renamed.length > 0 &&
        rule.pattern.test(renamed) && {
          fix: {
            renameTo: path.posix.join(
              path.posix.dirname(file),
              renamed + base.slice(name.length),
            ),
          },
        }),
    });
  }

  return found.flatMap((problem) => {
    const severity = manifest.rules[problem.rule];
    if (severity === "off") return [];
    return [
      {
        ...problem,
        severity,
        file,
        target: file,
        layer: problem.layer ?? place?.layer.name ?? "",
      },
    ];
  });
}
