import * as path from "node:path";
import type { ReadDirectory } from "../conflicts";
import { DEFAULT_MANIFEST, type Manifest } from "./schema";

/**
 * Suggests a manifest for an existing project that doesn't have one, from
 * its folders and package.json (ADR 1). It only ever proposes: the user sees
 * every choice, with the reason for it, before anything is written.
 */

export interface ProjectReader {
  readDirectory: ReadDirectory;
  /** File contents, or undefined if there is no such file. */
  readText(absolutePath: string): Promise<string | undefined>;
}

export interface InferredManifest {
  manifest: Manifest;
  /** One plain sentence per decision, plus warnings; shown to the user. */
  notes: string[];
}

/** Common layouts, in order of preference. The first folder that exists wins. */
const PATH_CANDIDATES: Record<keyof Manifest["paths"], string[]> = {
  components: [
    "src/components",
    "src/shared/components",
    "src/common/components",
    "src/ui",
    "components",
  ],
  hooks: ["src/hooks", "src/shared/hooks", "src/common/hooks", "hooks"],
  features: ["src/features", "src/modules", "src/domains", "features"],
};

const PATH_LABELS: Record<keyof Manifest["paths"], string> = {
  components: "Components",
  hooks: "Hooks",
  features: "Features",
};

/** Styling libraries that make a .module.css per component the wrong default. */
const OTHER_STYLING = [
  "tailwindcss",
  "styled-components",
  "@emotion/react",
  "@emotion/styled",
  "@vanilla-extract/css",
  "@stitches/react",
];

const SKIPPED_FOLDERS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
]);
const MAX_FOLDERS_SEARCHED = 500;

export async function inferManifest(
  root: string,
  reader: ProjectReader,
): Promise<InferredManifest> {
  const notes: string[] = [];
  const packages = await readDependencies(root, reader);

  // Paths: an existing folder beats the default.
  const paths = { ...DEFAULT_MANIFEST.paths };
  for (const kind of Object.keys(
    PATH_CANDIDATES,
  ) as (keyof Manifest["paths"])[]) {
    let found: string | undefined;
    for (const candidate of PATH_CANDIDATES[kind]) {
      if (await isDirectory(root, candidate, reader)) {
        found = candidate;
        break;
      }
    }
    paths[kind] = found ?? DEFAULT_MANIFEST.paths[kind];
    notes.push(
      found !== undefined
        ? `${PATH_LABELS[kind]} go in ${found}, which already exists.`
        : `${PATH_LABELS[kind]} go in ${paths[kind]} (no existing folder found).`,
    );
  }

  // Styling.
  let styling: Manifest["styling"] = "css-modules";
  const otherStyling = OTHER_STYLING.find((name) => packages.has(name));
  if (otherStyling !== undefined) {
    styling = "none";
    notes.push(
      `Components get no stylesheet, because the project uses ${otherStyling}.`,
    );
  } else if (await containsCssModule(path.join(root, "src"), reader)) {
    notes.push(
      "Components get a CSS Module, like the existing .module.css files.",
    );
  } else {
    notes.push(
      "Components get a CSS Module (.module.css), which Vite supports without setup.",
    );
  }

  // Tests: generated tests use Vitest and React Testing Library (ADR 5).
  let testing: Manifest["testing"];
  const hasVitest = packages.has("vitest");
  const hasTestingLibrary = packages.has("@testing-library/react");
  if (hasVitest && hasTestingLibrary) {
    testing = { framework: "vitest", generateTests: true };
    notes.push(
      "Tests are included, using the project's Vitest and React Testing Library.",
    );
  } else if (packages.has("jest")) {
    testing = { framework: "none", generateTests: false };
    notes.push(
      "Tests are off: the project uses Jest, and React Architect writes Vitest tests only.",
    );
  } else if (hasVitest) {
    testing = { framework: "none", generateTests: false };
    notes.push(
      'Tests are off: generated tests need @testing-library/react, which isn\'t installed. Add it, then set testing.framework to "vitest".',
    );
  } else {
    testing = { framework: "none", generateTests: false };
    notes.push("Tests are off: no test framework found.");
  }

  // Things that make generated code a poor fit.
  if (!packages.has("react")) {
    notes.push("Warning: package.json doesn't list react.");
  }
  const hasTypeScript =
    packages.has("typescript") ||
    (await reader.readText(path.join(root, "tsconfig.json"))) !== undefined;
  if (!hasTypeScript) {
    notes.push(
      "Warning: this looks like a JavaScript project. React Architect generates TypeScript (.tsx) files only for now.",
    );
  }

  return {
    manifest: { ...DEFAULT_MANIFEST, styling, paths, testing },
    notes,
  };
}

async function readDependencies(
  root: string,
  reader: ProjectReader,
): Promise<Set<string>> {
  const text = await reader.readText(path.join(root, "package.json"));
  if (text === undefined) {
    return new Set();
  }
  try {
    const pkg = JSON.parse(text) as Record<string, unknown>;
    const names = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
    ].flatMap((section) => {
      const value = pkg[section];
      return typeof value === "object" && value !== null
        ? Object.keys(value)
        : [];
    });
    return new Set(names);
  } catch {
    return new Set();
  }
}

async function isDirectory(
  root: string,
  relative: string,
  reader: ProjectReader,
): Promise<boolean> {
  const parent = path.dirname(relative);
  const entries = await reader.readDirectory(
    parent === "." ? root : path.join(root, ...parent.split("/")),
  );
  const name = path.posix.basename(relative);
  return (
    entries?.some((entry) => entry.name === name && entry.isDirectory) ?? false
  );
}

/** Breadth-first, skipping build output and dependencies, and stopping after a bounded number of folders. */
async function containsCssModule(
  start: string,
  reader: ProjectReader,
): Promise<boolean> {
  const queue = [start];
  for (
    let searched = 0;
    queue.length > 0 && searched < MAX_FOLDERS_SEARCHED;
    searched++
  ) {
    const folder = queue.shift() as string;
    for (const entry of (await reader.readDirectory(folder)) ?? []) {
      if (entry.isDirectory) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          queue.push(path.join(folder, entry.name));
        }
      } else if (entry.name.endsWith(".module.css")) {
        return true;
      }
    }
  }
  return false;
}
