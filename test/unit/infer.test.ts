import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { DirectoryEntry } from "../../src/core/conflicts";
import {
  inferManifest,
  type ProjectReader,
} from "../../src/core/manifest/infer";
import { DEFAULT_MANIFEST } from "../../src/core/manifest/schema";

const root = path.resolve("/work/app");

/** An in-memory project: relative file paths to contents; a trailing "/" makes an empty folder. */
function project(files: Record<string, string>): ProjectReader {
  const folders = new Map<string, DirectoryEntry[]>([[root, []]]);
  const contents = new Map<string, string>();
  for (const [entry, content] of Object.entries(files)) {
    const isFolder = entry.endsWith("/");
    const segments = entry.replace(/\/$/, "").split("/");
    let folder = root;
    segments.forEach((name, index) => {
      const directory = isFolder || index < segments.length - 1;
      const listing = folders.get(folder) ?? [];
      if (!listing.some((e) => e.name === name)) {
        listing.push({ name, isDirectory: directory });
      }
      folders.set(folder, listing);
      folder = path.join(folder, name);
      if (directory && !folders.has(folder)) {
        folders.set(folder, []);
      }
    });
    if (!isFolder) {
      contents.set(path.join(root, ...segments), content);
    }
  }
  return {
    readDirectory: async (folder) => folders.get(folder),
    readText: async (file) => contents.get(file),
  };
}

const packageJson = (dependencies: Record<string, string>) =>
  JSON.stringify({
    dependencies: { react: "^19.0.0", typescript: "^6.0.0", ...dependencies },
  });

describe("inferManifest", () => {
  it("uses the defaults for a bare Vite project, with tests off", async () => {
    const result = await inferManifest(
      root,
      project({ "package.json": packageJson({}), "src/main.tsx": "" }),
    );
    expect(result.manifest).toEqual({
      ...DEFAULT_MANIFEST,
      testing: { framework: "none", generateTests: false },
    });
    expect(result.notes).toEqual([
      "Components go in src/components (no existing folder found).",
      "Hooks go in src/hooks (no existing folder found).",
      "Features go in src/features (no existing folder found).",
      "Components get a CSS Module (.module.css), which Vite supports without setup.",
      "Tests are off: no test framework found.",
    ]);
  });

  it("follows existing folders", async () => {
    const result = await inferManifest(
      root,
      project({
        "package.json": packageJson({}),
        "src/ui/Button.tsx": "",
        "src/shared/hooks/": "",
        "src/modules/cart/index.ts": "",
      }),
    );
    expect(result.manifest.paths).toEqual({
      components: "src/ui",
      hooks: "src/shared/hooks",
      features: "src/modules",
    });
    expect(result.notes[0]).toBe(
      "Components go in src/ui, which already exists.",
    );
  });

  it("prefers src/components when several candidates exist", async () => {
    const result = await inferManifest(
      root,
      project({
        "package.json": packageJson({}),
        "src/components/": "",
        "src/ui/": "",
      }),
    );
    expect(result.manifest.paths.components).toBe("src/components");
  });

  it("ignores a file that has a candidate folder's name", async () => {
    const result = await inferManifest(
      root,
      project({ "package.json": packageJson({}), "src/hooks": "not a folder" }),
    );
    expect(result.notes[1]).toBe(
      "Hooks go in src/hooks (no existing folder found).",
    );
  });

  it("turns tests on when Vitest and Testing Library are installed", async () => {
    const result = await inferManifest(
      root,
      project({
        "package.json": packageJson({
          vitest: "^5",
          "@testing-library/react": "^16",
        }),
      }),
    );
    expect(result.manifest.testing).toEqual({
      framework: "vitest",
      generateTests: true,
    });
  });

  it.each([
    [{ jest: "^30" }, "the project uses Jest"],
    [{ vitest: "^5" }, "need @testing-library/react"],
  ])("keeps tests off with %j", async (dependencies, reason) => {
    const result = await inferManifest(
      root,
      project({ "package.json": packageJson(dependencies) }),
    );
    expect(result.manifest.testing.framework).toBe("none");
    expect(result.notes.join(" ")).toContain(reason);
  });

  it("records Tailwind when the project uses it", async () => {
    const result = await inferManifest(
      root,
      project({ "package.json": packageJson({ tailwindcss: "^4" }) }),
    );
    expect(result.manifest.styling).toBe("tailwind");
    expect(result.notes).toContain(
      "Components get no stylesheet, because the project uses Tailwind.",
    );
  });

  it("drops the stylesheet when another styling library is used", async () => {
    const result = await inferManifest(
      root,
      project({ "package.json": packageJson({ "styled-components": "^6" }) }),
    );
    expect(result.manifest.styling).toBe("none");
    expect(result.notes).toContain(
      "Components get no stylesheet, because the project uses styled-components.",
    );
  });

  it("notices existing CSS Modules, but not inside node_modules", async () => {
    const withModule = await inferManifest(
      root,
      project({
        "package.json": packageJson({}),
        "src/a/b/Card.module.css": "",
      }),
    );
    expect(withModule.notes).toContain(
      "Components get a CSS Module, like the existing .module.css files.",
    );

    const onlyInDependencies = await inferManifest(
      root,
      project({
        "package.json": packageJson({}),
        "src/node_modules/x/y.module.css": "",
      }),
    );
    expect(onlyInDependencies.notes).not.toContain(
      "Components get a CSS Module, like the existing .module.css files.",
    );
  });

  it("warns about JavaScript projects and projects without React", async () => {
    const result = await inferManifest(
      root,
      project({
        "package.json": JSON.stringify({ dependencies: { vue: "^3" } }),
      }),
    );
    expect(result.notes).toContain("Warning: package.json doesn't list react.");
    expect(result.notes.at(-1)).toMatch(/looks like a JavaScript project/);
  });

  it("treats a tsconfig.json as TypeScript even without the dependency", async () => {
    const result = await inferManifest(
      root,
      project({
        "package.json": JSON.stringify({ dependencies: { react: "^19" } }),
        "tsconfig.json": "{}",
      }),
    );
    expect(result.notes.some((note) => note.includes("JavaScript"))).toBe(
      false,
    );
  });

  it("copes with a broken package.json", async () => {
    const result = await inferManifest(
      root,
      project({ "package.json": "{ nope" }),
    );
    expect(result.manifest.paths).toEqual(DEFAULT_MANIFEST.paths);
    expect(result.notes).toContain("Warning: package.json doesn't list react.");
  });
});
