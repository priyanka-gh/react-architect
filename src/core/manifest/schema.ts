import { normalizeRelativePath } from "../paths";

/**
 * The project manifest, react-architect.json. See ADR 1.
 *
 * Keep this in sync with schemas/react-architect.schema.json; a unit test
 * checks that both accept and reject the same examples.
 */

export const MANIFEST_FILE_NAME = "react-architect.json";
export const SUPPORTED_MANIFEST_VERSION = 1;

export const STYLING_OPTIONS = ["css-modules", "none"] as const;
export const TEST_FRAMEWORKS = ["vitest", "none"] as const;

export interface Manifest {
  manifestVersion: typeof SUPPORTED_MANIFEST_VERSION;
  language: "typescript";
  architecture: "feature-based";
  styling: (typeof STYLING_OPTIONS)[number];
  paths: {
    components: string;
    hooks: string;
    features: string;
  };
  testing: {
    framework: (typeof TEST_FRAMEWORKS)[number];
    generateTests: boolean;
  };
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
];
const PATH_FIELDS = ["components", "hooks", "features"] as const;
const TESTING_FIELDS = ["framework", "generateTests"];

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
  warnAboutUnknownFields(paths, PATH_FIELDS, "paths.", warnings);
  warnAboutUnknownFields(testing, TESTING_FIELDS, "testing.", warnings);

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
  };

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, manifest, warnings };
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
