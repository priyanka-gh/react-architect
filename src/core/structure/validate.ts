import { normalizeRelativePath } from "../paths";
import {
  parseLayerPath,
  SIBLING_POLICIES,
  type LayerConfig,
  type SiblingPolicy,
  type StructureConfig,
} from "./model";

/**
 * Checks the `structure` section of react-architect.json. Problems that the
 * JSON Schema can't express (references between layers, duplicates) are
 * caught here. Messages name the field, as the rest of validateManifest does.
 */

const LAYER_FIELDS = [
  "name",
  "paths",
  "mayImport",
  "entry",
  "siblings",
  "unitTemplate",
];
const STRUCTURE_FIELDS = ["layers", "ignore", "unlisted", "naming"];
const LAYER_NAME = /^[a-z][a-z0-9-]*$/;

type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readStructure(
  value: unknown,
  errors: string[],
  warnings: string[],
): StructureConfig | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    errors.push('"structure" must be an object.');
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!STRUCTURE_FIELDS.includes(key)) {
      warnings.push(`Unknown setting "structure.${key}" was ignored.`);
    }
  }

  const rawLayers = value.layers;
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) {
    errors.push('"structure.layers" must be a list with at least one layer.');
    return undefined;
  }

  const layers: LayerConfig[] = [];
  rawLayers.forEach((raw, index) => {
    const layer = readLayer(
      raw,
      `structure.layers[${index}]`,
      errors,
      warnings,
    );
    if (layer !== undefined) layers.push(layer);
  });

  const names = new Set<string>();
  for (const layer of layers) {
    if (names.has(layer.name)) {
      errors.push(
        `Two layers are called "${layer.name}"; layer names must be different.`,
      );
    }
    names.add(layer.name);
  }
  const owners = new Map<string, string>();
  for (const layer of layers) {
    for (const folder of layer.paths) {
      const owner = owners.get(folder);
      if (owner !== undefined && owner !== layer.name) {
        errors.push(
          `"${folder}" is in both the "${owner}" and "${layer.name}" layers.`,
        );
      } else if (owner === layer.name) {
        warnings.push(
          `"${folder}" is listed twice in the "${layer.name}" layer.`,
        );
      }
      owners.set(folder, layer.name);
    }
    for (const other of layer.mayImport) {
      if (!names.has(other)) {
        errors.push(
          `The "${layer.name}" layer may import "${other}", but there's no layer called "${other}".`,
        );
      }
    }
  }

  const ignore = readStringList(value.ignore, "structure.ignore", errors) ?? [];

  let unlisted: StructureConfig["unlisted"] = "allowed";
  if (value.unlisted !== undefined) {
    if (value.unlisted === "allowed" || value.unlisted === "reported") {
      unlisted = value.unlisted;
    } else {
      errors.push(
        `"structure.unlisted" must be "allowed" or "reported", not ${JSON.stringify(value.unlisted)}.`,
      );
    }
  }

  const naming: StructureConfig["naming"] = [];
  if (value.naming !== undefined) {
    if (!Array.isArray(value.naming)) {
      errors.push(
        '"structure.naming" must be a list of { "files", "pattern" } rules.',
      );
    } else {
      value.naming.forEach((rule: unknown, index) => {
        const field = `structure.naming[${index}]`;
        if (
          !isObject(rule) ||
          typeof rule.files !== "string" ||
          typeof rule.pattern !== "string"
        ) {
          errors.push(
            `"${field}" must have "files" and "pattern", such as { "files": "**/hooks/*.ts", "pattern": "use[A-Z]*" }.`,
          );
        } else {
          naming.push({ files: rule.files, pattern: rule.pattern });
        }
      });
    }
  }

  return errors.length > 0 ? undefined : { layers, ignore, unlisted, naming };
}

function readLayer(
  raw: unknown,
  field: string,
  errors: string[],
  warnings: string[],
): LayerConfig | undefined {
  if (!isObject(raw)) {
    errors.push(`"${field}" must be an object with a name and paths.`);
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!LAYER_FIELDS.includes(key)) {
      warnings.push(`Unknown setting "${field}.${key}" was ignored.`);
    }
  }

  const name = raw.name;
  if (typeof name !== "string" || !LAYER_NAME.test(name)) {
    errors.push(
      `"${field}.name" must be a lower-case name such as "features" or "shared-ui", not ${JSON.stringify(name)}.`,
    );
    return undefined;
  }
  const label = `the "${name}" layer`;

  const rawPaths = readStringList(raw.paths, `${field}.paths`, errors);
  if (rawPaths === undefined || rawPaths.length === 0) {
    if (raw.paths === undefined || rawPaths?.length === 0) {
      errors.push(
        `${capitalise(label)} needs "paths": at least one folder, such as "src/features/*".`,
      );
    }
    return undefined;
  }
  const paths: string[] = [];
  for (const value of rawPaths) {
    const folder = readLayerPath(value, label, errors);
    if (folder !== undefined) paths.push(folder);
  }

  const mayImport =
    readStringList(raw.mayImport, `${field}.mayImport`, errors) ?? [];
  const hasUnits = paths.some((folder) => parseLayerPath(folder).units);

  let entry: string | undefined;
  if (raw.entry !== undefined) {
    if (typeof raw.entry !== "string" || !/^[^/\\]+\.[a-z]+$/.test(raw.entry)) {
      errors.push(`"${field}.entry" must be a file name such as "index.ts".`);
    } else if (!hasUnits) {
      errors.push(
        `${capitalise(label)} has an entry, but entries only apply to layers with units: paths ending in "/*".`,
      );
    } else {
      entry = raw.entry;
    }
  }

  let siblings: SiblingPolicy = entry !== undefined ? "entry" : "any";
  if (raw.siblings !== undefined) {
    const match = SIBLING_POLICIES.find((policy) => policy === raw.siblings);
    if (match === undefined) {
      errors.push(
        `"${field}.siblings" must be one of "entry", "none", "any", not ${JSON.stringify(raw.siblings)}.`,
      );
    } else if (match === "entry" && entry === undefined) {
      errors.push(
        `${capitalise(label)} has siblings "entry" but no entry file. Add "entry": "index.ts".`,
      );
    } else {
      siblings = match;
    }
  }

  let unitTemplate: string[] | undefined;
  const rawTemplate = readStringList(
    raw.unitTemplate,
    `${field}.unitTemplate`,
    errors,
  );
  if (rawTemplate !== undefined) {
    if (!hasUnits) {
      errors.push(
        `${capitalise(label)} has a unitTemplate, but templates only apply to layers with units: paths ending in "/*".`,
      );
    } else {
      unitTemplate = [];
      for (const item of rawTemplate) {
        const folder = item.endsWith("/");
        const name = folder ? item.slice(0, -1) : item;
        const normalized = normalizeRelativePath(name);
        if (
          !normalized.ok ||
          normalized.path.includes("/") ||
          normalized.path === "."
        ) {
          errors.push(
            `"${item}" in ${label}'s unitTemplate must be one folder ("components/") or file ("index.ts") name.`,
          );
        } else {
          unitTemplate.push(folder ? `${normalized.path}/` : normalized.path);
        }
      }
    }
  }

  return {
    name,
    paths,
    mayImport,
    ...(entry !== undefined && { entry }),
    siblings,
    ...(unitTemplate !== undefined && { unitTemplate }),
  };
}

function readLayerPath(
  value: string,
  label: string,
  errors: string[],
): string | undefined {
  const units = value === "*" || value.endsWith("/*");
  const base = value === "*" ? "." : units ? value.slice(0, -2) : value;
  if (base.includes("*")) {
    errors.push(
      `"${value}" in ${label}: only a final "/*" is supported, meaning each folder in it is a unit.`,
    );
    return undefined;
  }
  const normalized = normalizeRelativePath(base);
  if (!normalized.ok) {
    errors.push(`"${value}" in ${label} ${normalized.reason}.`);
    return undefined;
  }
  if (normalized.path === ".") {
    if (!units) {
      errors.push(
        `"${value}" in ${label} is the whole project; name a folder inside it.`,
      );
      return undefined;
    }
    return "*";
  }
  return units ? `${normalized.path}/*` : normalized.path;
}

function readStringList(
  value: unknown,
  field: string,
  errors: string[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`"${field}" must be a list of strings.`);
    return undefined;
  }
  return value as string[];
}

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);
