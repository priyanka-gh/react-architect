import { describe, expect, it } from "vitest";
import {
  DEFAULT_MANIFEST,
  parseManifest,
  serializeManifest,
  validateManifest,
} from "../../src/core/manifest/schema";

function errorsFor(value: unknown): string[] {
  const result = validateManifest(value);
  if (result.ok) {
    throw new Error("Expected the manifest to be rejected");
  }
  return result.errors;
}

describe("validateManifest", () => {
  it("fills in every default when only the version is given", () => {
    expect(validateManifest({ manifestVersion: 1 })).toEqual({
      ok: true,
      manifest: DEFAULT_MANIFEST,
      warnings: [],
    });
  });

  it("keeps values that are set", () => {
    const manifest = {
      manifestVersion: 1,
      language: "typescript",
      architecture: "feature-based",
      styling: "none",
      paths: {
        components: "app/ui",
        hooks: "app/hooks",
        features: "app/modules",
      },
      testing: { framework: "none", generateTests: false },
    };
    expect(validateManifest(manifest)).toEqual({
      ok: true,
      manifest,
      warnings: [],
    });
  });

  it("fills in missing fields inside a section", () => {
    const result = validateManifest({
      manifestVersion: 1,
      paths: { hooks: "lib/hooks" },
      testing: { generateTests: false },
    });
    expect(result).toMatchObject({
      ok: true,
      manifest: {
        paths: {
          components: "src/components",
          hooks: "lib/hooks",
          features: "src/features",
        },
        testing: { framework: "vitest", generateTests: false },
      },
    });
  });

  it("normalises paths", () => {
    const result = validateManifest({
      manifestVersion: 1,
      paths: { components: "./src/ui/" },
    });
    expect(result).toMatchObject({
      ok: true,
      manifest: { paths: { components: "src/ui" } },
    });
  });

  it("warns about unknown settings instead of failing", () => {
    const result = validateManifest({
      $schema: "./node_modules/whatever.json",
      manifestVersion: 1,
      stlying: "none",
      paths: { pages: "src/pages" },
      testing: { coverage: true },
    });
    expect(result).toEqual({
      ok: true,
      manifest: DEFAULT_MANIFEST,
      warnings: [
        'Unknown setting "stlying" was ignored.',
        'Unknown setting "paths.pages" was ignored.',
        'Unknown setting "testing.coverage" was ignored.',
      ],
    });
  });

  it.each([[[]], [null], ["manifest"], [1]])(
    "rejects %j because it isn't an object",
    (value) => {
      expect(errorsFor(value)).toEqual([
        "react-architect.json must contain a JSON object.",
      ]);
    },
  );

  it("rejects a missing version", () => {
    expect(errorsFor({ styling: "none" })).toEqual([
      '"manifestVersion" is missing. Add "manifestVersion": 1.',
    ]);
  });

  it.each([[2], ["1"]])(
    "rejects version %j and reports nothing else",
    (version) => {
      expect(errorsFor({ manifestVersion: version, styling: "bad" })).toEqual([
        `"manifestVersion" is ${JSON.stringify(version)}, but this version of React Architect only supports 1.`,
      ]);
    },
  );

  it("reports every wrong value at once", () => {
    expect(
      errorsFor({
        manifestVersion: 1,
        language: "javascript",
        styling: "tailwind",
        paths: { components: 42, hooks: "../hooks", features: "src\\features" },
        testing: { framework: "jest", generateTests: "yes" },
      }),
    ).toEqual([
      '"language" must be "typescript", not "javascript".',
      '"styling" must be one of "css-modules", "none", not "tailwind".',
      '"paths.components" must be a path such as "src/components", not 42.',
      '"paths.hooks" must not contain "..".',
      '"paths.features" must use forward slashes (/).',
      '"testing.framework" must be one of "vitest", "none", not "jest".',
      '"testing.generateTests" must be true or false, not "yes".',
    ]);
  });

  it("rejects sections that aren't objects", () => {
    expect(
      errorsFor({ manifestVersion: 1, paths: "src", testing: [] }),
    ).toEqual(['"paths" must be an object.', '"testing" must be an object.']);
  });
});

describe("parseManifest", () => {
  it("reports invalid JSON", () => {
    const result = parseManifest("{ manifestVersion: 1 }");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatch(
      /^react-architect\.json isn't valid JSON: /,
    );
  });

  it("accepts a file saved with a byte order mark", () => {
    expect(parseManifest('\uFEFF{ "manifestVersion": 1 }')).toMatchObject({
      ok: true,
    });
  });

  it("reads back what serializeManifest writes", () => {
    const text = serializeManifest(DEFAULT_MANIFEST);
    expect(text.endsWith("}\n")).toBe(true);
    expect(parseManifest(text)).toEqual({
      ok: true,
      manifest: DEFAULT_MANIFEST,
      warnings: [],
    });
  });
});
