/**
 * The JSON Schema gives editor autocomplete and squiggles; validateManifest is
 * what the extension actually enforces. These tests keep the two in step.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MANIFEST,
  validateManifest,
} from "../../src/core/manifest/schema";

const schema = JSON.parse(
  readFileSync(path.resolve("schemas/react-architect.schema.json"), "utf8"),
) as Record<string, unknown>;
const schemaAccepts = new Ajv({ allErrors: true }).compile(schema);

const withPath = (components: string) => ({
  manifestVersion: 1,
  paths: { components },
});

describe("JSON Schema and validateManifest agree", () => {
  it.each([
    { manifestVersion: 1 },
    { $schema: "./schema.json", manifestVersion: 1 },
    {
      manifestVersion: 1,
      language: "typescript",
      architecture: "feature-based",
      styling: "none",
      paths: { components: "a", hooks: "b", features: "c" },
      testing: { framework: "none", generateTests: false },
    },
    withPath("./src/components/"),
    withPath("..foo/components"),
  ])("both accept %j", (manifest) => {
    expect(schemaAccepts(manifest)).toBe(true);
    expect(validateManifest(manifest)).toMatchObject({
      ok: true,
      warnings: [],
    });
  });

  it.each([
    {},
    { manifestVersion: 2 },
    { manifestVersion: 1, styling: "tailwind" },
    { manifestVersion: 1, testing: { generateTests: "yes" } },
    { manifestVersion: 1, paths: "src" },
    withPath(""),
    withPath("/src/components"),
    withPath("C:/src/components"),
    withPath("src\\components"),
    withPath("../components"),
    withPath("src/../../components"),
  ])("both reject %j", (manifest) => {
    expect(schemaAccepts(manifest)).toBe(false);
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it("flags unknown settings: the editor as a problem, the extension as a warning", () => {
    const manifest = { manifestVersion: 1, stlying: "none" };
    expect(schemaAccepts(manifest)).toBe(false);
    expect(validateManifest(manifest)).toMatchObject({
      ok: true,
      warnings: ['Unknown setting "stlying" was ignored.'],
    });
  });

  it("leaves Windows file name rules to validateManifest", () => {
    // Expressing these in a JSON Schema pattern isn't worth the unreadable regex.
    const manifest = withPath("src/con");
    expect(schemaAccepts(manifest)).toBe(true);
    expect(validateManifest(manifest).ok).toBe(false);
  });

  it("has the same defaults", () => {
    const properties = schema.properties as Record<
      string,
      {
        default?: unknown;
        properties?: Record<string, { default?: unknown }>;
      }
    >;
    const defaults = Object.fromEntries(
      Object.entries(properties)
        .filter(([name]) => name !== "$schema")
        .map(([name, property]) => [
          name,
          property.properties
            ? Object.fromEntries(
                Object.entries(property.properties).map(([key, value]) => [
                  key,
                  value.default,
                ]),
              )
            : (property.default ?? 1),
        ]),
    );
    expect(defaults).toEqual(DEFAULT_MANIFEST);
  });
});
