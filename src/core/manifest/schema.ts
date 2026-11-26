import { normalizeRelativePath } from "../paths";
import type { StructureConfig } from "../structure/model";
import { RULE_IDS, type RuleId } from "../structure/rules";
import { readStructure } from "../structure/validate";

/**
 * The project manifest, react-architect.json. See ADR 1.
 *
 * Keep this in sync with schemas/react-architect.schema.json; a unit test
 * checks that both accept and reject the same examples.
 */

export const MANIFEST_FILE_NAME = "react-architect.json";
export const SUPPORTED_MANIFEST_VERSION = 1;

/**
 * How components are styled (ADR 5). "tailwind" and "none" both mean no
 * stylesheet per component; "tailwind" also records that Tailwind is set up.
 */
export const STYLING_OPTIONS = [
  "css-modules",
  "tailwind",
  "plain-css",
  "none",
] as const;

export type Styling = (typeof STYLING_OPTIONS)[number];
export const TEST_FRAMEWORKS = ["vitest", "none"] as const;

/**
 * How strongly a structure rule is reported (ADR 11): "error" and "warning"
 * show squiggles of that severity; "off" turns the rule off.
 */
export const RULE_SEVERITIES = ["warning", "error", "off"] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

export interface Manifest {
  manifestVersion: typeof SUPPORTED_MANIFEST_VERSION;
  language: "typescript";
  architecture: "feature-based";
  styling: Styling;
  paths: {
    components: string;
    hooks: string;
    features: string;
  };
  testing: {
    framework: (typeof TEST_FRAMEWORKS)[number];
    generateTests: boolean;
  };
  /**
   * The structure rules (plans/custom-structure.md). "entry" was called
   * "featureInternals" and "layers" "sharedCode"; the old names still work.
   */
  rules: Record<RuleId, RuleSeverity>;
  /** The project's own structure; without it, the feature-based default applies. */
  structure?: StructureConfig;
}

export const DEFAULT_MANIFEST: Manifest = {
  manifestVersion: SUPPORTED_MANIFEST_VERSION,
  language: "typescript",
  architecture: "feature-based",
  styling: "css-modules",
  paths: {
    components: "src/components",
    hooks: "src/hooks",
    features: "src/features",
  },
  testing: {
    framework: "vitest",
    generateTests: true,
  },
  rules: {
    layers: "warning",
    entry: "warning",
    siblings: "warning",
    placement: "warning",
    naming: "warning",
  },
};

export type ManifestResult =
  | { ok: true; manifest: Manifest; warnings: string[] }
  | { ok: false; errors: string[] };

const TOP_LEVEL_FIELDS = [
  "$schema",
  "manifestVersion",
  "language",
  "architecture",
  "styling",
  "paths",
  "testing",
  "rules",
  "structure",
];
const PATH_FIELDS = ["components", "hooks", "features"] as const;
const TESTING_FIELDS = ["framework", "generateTests"];
/** Old rule names, still accepted: old name -> current name. */
const RULE_ALIASES: Record<string, RuleId> = {
  featureInternals: "entry",
  sharedCode: "layers",
};
const RULE_FIELDS = [...RULE_IDS, ...Object.keys(RULE_ALIASES)];

export function parseManifest(text: string): ManifestResult {
  let value: unknown;
  try {
    // Some Windows editors save JSON with a byte order mark, which JSON.parse rejects.
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [`${MANIFEST_FILE_NAME} isn't valid JSON: ${detail}`],
    };
  }
  return validateManifest(value);
}

/**
 * Checks a parsed manifest and fills in defaults for missing fields.
 * Unknown fields are warnings, not errors, so newer manifests still load.
 */
export function validateManifest(value: unknown): ManifestResult {
  if (!isObject(value)) {
    return {
      ok: false,
      errors: [`${MANIFEST_FILE_NAME} must contain a JSON object.`],
    };
  }

  const version = value.manifestVersion;
  if (version === undefined) {
    return {
      ok: false,
      errors: [
        `"manifestVersion" is missing. Add "manifestVersion": ${SUPPORTED_MANIFEST_VERSION}.`,
      ],
    };
  }
  if (version !== SUPPORTED_MANIFEST_VERSION) {
    return {
      ok: false,
      errors: [
        `"manifestVersion" is ${JSON.stringify(version)}, but this version of React Architect only supports ${SUPPORTED_MANIFEST_VERSION}.`,
      ],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  warnAboutUnknownFields(value, TOP_LEVEL_FIELDS, "", warnings);

  const defaults = DEFAULT_MANIFEST;
  const paths = readSection(value, "paths", errors);
  const testing = readSection(value, "testing", errors);
  const rules = readSection(value, "rules", errors);
  warnAboutUnknownFields(paths, PATH_FIELDS, "paths.", warnings);
  warnAboutUnknownFields(testing, TESTING_FIELDS, "testing.", warnings);
  warnAboutUnknownFields(rules, RULE_FIELDS, "rules.", warnings);

  const manifest: Manifest = {
    manifestVersion: SUPPORTED_MANIFEST_VERSION,
    language: readChoice(
      value,
      "language",
      ["typescript"],
      defaults.language,
      errors,
    ),
    architecture: readChoice(
      value,
      "architecture",
      ["feature-based"],
      defaults.architecture,
      errors,
    ),
    styling: readChoice(
      value,
      "styling",
      STYLING_OPTIONS,
      defaults.styling,
      errors,
    ),
    paths: {
      components: readPath(paths, "paths.components", errors),
      hooks: readPath(paths, "paths.hooks", errors),
      features: readPath(paths, "paths.features", errors),
    },
    testing: {
      framework: readChoice(
        testing,
        "testing.framework",
        TEST_FRAMEWORKS,
        defaults.testing.framework,
        errors,
      ),
      generateTests: readBoolean(
        testing,
        "testing.generateTests",
        defaults.testing.generateTests,
        errors,
      ),
    },
    rules: readRules(rules, errors, warnings),
  };
  const structure = readStructure(value.structure, errors, warnings);
  if (structure !== undefined) {
    manifest.structure = structure;
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, manifest, warnings };
}

function readRules(
  section: JsonObject,
  errors: string[],
  warnings: string[],
): Manifest["rules"] {
  const rules = { ...DEFAULT_MANIFEST.rules };
  for (const id of RULE_IDS) {
    const oldName = Object.keys(RULE_ALIASES).find(
      (alias) => RULE_ALIASES[alias] === id,
    );
    if (oldName !== undefined && section[oldName] !== undefined) {
      if (section[id] !== undefined) {
        warnings.push(
          `"rules.${oldName}" is the old name for "rules.${id}", so it was ignored.`,
        );
      } else {
        rules[id] = readChoice(
          section,
          `rules.${oldName}`,
          RULE_SEVERITIES,
          rules[id],
          errors,
        );
        continue;
      }
    }
    rules[id] = readChoice(
      section,
      `rules.${id}`,
      RULE_SEVERITIES,
      rules[id],
      errors,
    );
  }
  return rules;
}

/** The manifest as file contents: 2-space JSON with a final newline, matching Prettier. */
export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The last part of a dotted field name: "paths.hooks" -> "hooks". */
function key(field: string): string {
  return field.slice(field.lastIndexOf(".") + 1);
}

function readSection(
  parent: JsonObject,
  field: string,
  errors: string[],
): JsonObject {
  const value = parent[field];
  if (value === undefined) {
    return {};
  }
  if (!isObject(value)) {
    errors.push(`"${field}" must be an object.`);
    return {};
  }
  return value;
}

function readChoice<T extends string>(
  section: JsonObject,
  field: string,
  allowed: readonly T[],
  fallback: T,
  errors: string[],
): T {
  const value = section[key(field)];
  if (value === undefined) {
    return fallback;
  }
  const match = allowed.find((choice) => choice === value);
  if (match === undefined) {
    const choices = allowed.map((choice) => `"${choice}"`).join(", ");
    const expected = allowed.length === 1 ? choices : `one of ${choices}`;
    errors.push(
      `"${field}" must be ${expected}, not ${JSON.stringify(value)}.`,
    );
    return fallback;
  }
  return match;
}

function readBoolean(
  section: JsonObject,
  field: string,
  fallback: boolean,
  errors: string[],
): boolean {
  const value = section[key(field)];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    errors.push(
      `"${field}" must be true or false, not ${JSON.stringify(value)}.`,
    );
    return fallback;
  }
  return value;
}

function readPath(
  section: JsonObject,
  field: `paths.${(typeof PATH_FIELDS)[number]}`,
  errors: string[],
): string {
  const name = key(field) as (typeof PATH_FIELDS)[number];
  const fallback = DEFAULT_MANIFEST.paths[name];
  const value = section[name];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    errors.push(
      `"${field}" must be a path such as "${fallback}", not ${JSON.stringify(value)}.`,
    );
    return fallback;
  }
  const result = normalizeRelativePath(value);
  if (!result.ok) {
    errors.push(`"${field}" ${result.reason}.`);
    return fallback;
  }
  return result.path;
}

function warnAboutUnknownFields(
  section: JsonObject,
  known: readonly string[],
  prefix: string,
  warnings: string[],
): void {
  for (const name of Object.keys(section)) {
    if (!known.includes(name)) {
      warnings.push(`Unknown setting "${prefix}${name}" was ignored.`);
    }
  }
}
