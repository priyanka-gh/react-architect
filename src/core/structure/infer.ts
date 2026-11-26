import * as path from "node:path";
import type { LayerConfig, SiblingPolicy, StructureConfig } from "./model";
import { TEST_FILES } from "./presets";
import type { TreeEntry } from "./treeFile";

/**
 * Turns a folder tree (from a file, or another project) into a structure
 * (plans/custom-structure.md, Phase 3). Folder names that mean something
 * become layers; folders under a unit container (features/, modules/...)
 * are examples of units, and what they have in common is the template.
 * Folders with other names are returned to ask the user about.
 */

type Role =
  "app" | "pages" | "widgets" | "features" | "entities" | "shared" | "ignore";

/** Top to bottom: each layer may import the ones after it. */
const ORDER: Role[] = [
  "app",
  "pages",
  "widgets",
  "features",
  "entities",
  "shared",
];

const NAMES: Record<string, Role> = {
  app: "app",
  pages: "pages",
  routes: "pages",
  screens: "pages",
  views: "pages",
  widgets: "widgets",
  features: "features",
  modules: "features",
  domains: "features",
  slices: "features",
  entities: "entities",
  shared: "shared",
  components: "shared",
  ui: "shared",
  hooks: "shared",
  lib: "shared",
  utils: "shared",
  helpers: "shared",
  services: "shared",
  api: "shared",
  types: "shared",
  styles: "shared",
  assets: "shared",
  config: "shared",
  constants: "shared",
  store: "shared",
  context: "shared",
  contexts: "shared",
  providers: "shared",
  i18n: "shared",
  locales: "shared",
  test: "ignore",
  tests: "ignore",
  __tests__: "ignore",
  mocks: "ignore",
  __mocks__: "ignore",
  stories: "ignore",
};

const UNIT_ROLES = new Set<Role>(["pages", "widgets", "features", "entities"]);
const ENTRY_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx"];

export interface InferredStructure {
  config: StructureConfig;
  /** Folders whose role couldn't be guessed, to ask the user about. */
  unknown: string[];
  /** One sentence per decision, for the review. */
  notes: string[];
}

export function inferStructure(
  entries: readonly TreeEntry[],
): InferredStructure {
  const folders = new Set(entries.filter((e) => e.isFolder).map((e) => e.path));
  const childrenOf = (folder: string) =>
    entries.filter(
      (entry) =>
        path.posix.dirname(entry.path) === (folder === "" ? "." : folder),
    );

  const base = folders.has("src") ? "src" : "";
  const notes: string[] = [];
  const unknown: string[] = [];
  const ignore = [...TEST_FILES];
  const byRole = new Map<
    Role,
    {
      name: string;
      paths: string[];
      units: boolean;
      template?: string[];
      entry?: string;
    }
  >();

  for (const child of childrenOf(base)) {
    if (!child.isFolder) continue;
    const name = path.posix.basename(child.path);
    const role = NAMES[name.toLowerCase()];
    if (role === undefined) {
      unknown.push(child.path);
      continue;
    }
    if (role === "ignore") {
      ignore.push(`${child.path}/**`);
      notes.push(`${child.path} holds tests or mocks, so the rules ignore it.`);
      continue;
    }

    const examples = childrenOf(child.path).filter((entry) => entry.isFolder);
    // A pages folder of files (pages/Home.tsx) is one layer; of folders, a layer of units.
    const looksLikeUnits =
      UNIT_ROLES.has(role) && (role !== "pages" || examples.length > 0);

    const existing = byRole.get(role);
    if (looksLikeUnits && existing === undefined) {
      const template = commonTemplate(
        examples.map((example) => childrenOf(example.path)),
      );
      const entry = ENTRY_FILES.find((file) => template.includes(file));
      byRole.set(role, {
        name: role === "features" ? name : role,
        paths: [`${child.path}/*`],
        units: true,
        ...(template.length > 0 && { template }),
        ...(entry && { entry }),
      });
      const shown = examples
        .map((example) => path.posix.basename(example.path))
        .slice(0, 3)
        .join(", ");
      notes.push(
        `Each folder in ${child.path} is a ${singular(name)}${shown ? ` (such as ${shown})` : ""}${template.length > 0 ? `, containing ${template.join(", ")}` : ""}.`,
      );
    } else if (existing === undefined) {
      byRole.set(role, { name: role, paths: [child.path], units: false });
      if (role !== "shared") notes.push(`${child.path} is the ${role} layer.`);
    } else {
      existing.paths.push(existing.units ? `${child.path}/*` : child.path);
    }
  }

  const shared = byRole.get("shared");
  if (shared) {
    notes.push(
      `Shared code: ${shared.paths.join(", ")}. It can't use any other layer.`,
    );
  }
  const sliced = byRole.has("widgets") || byRole.has("entities");
  if (sliced) {
    notes.push(
      "There are widgets or entities, so this looks like Feature-Sliced Design: slices of the same layer can't use each other.",
    );
  }

  const present = ORDER.filter((role) => byRole.has(role));
  const layers: LayerConfig[] = present.map((role, index) => {
    const found = byRole.get(role)!;
    const siblings: SiblingPolicy = !found.units
      ? "any"
      : sliced || role === "pages"
        ? "none"
        : found.entry
          ? "entry"
          : "any";
    return {
      name: found.name,
      paths: found.paths,
      mayImport: present
        .slice(index + 1)
        .map((below) => byRole.get(below)!.name),
      ...(found.entry && { entry: found.entry }),
      siblings: siblings === "entry" && !found.entry ? "any" : siblings,
      ...(found.template && { unitTemplate: found.template }),
    };
  });

  return {
    config: { layers, ignore, unlisted: "allowed", naming: [] },
    unknown,
    notes,
  };
}

/**
 * What the example units have in common: folders as "name/", files as
 * "name". With one example, all of its contents. Test files aren't part of a
 * template.
 */
function commonTemplate(examples: TreeEntry[][]): string[] {
  const items = examples.map(
    (children) =>
      new Set(
        children
          .filter(
            (child) =>
              child.isFolder || !/\.(test|spec|stories)\./.test(child.path),
          )
          .map(
            (child) =>
              path.posix.basename(child.path) + (child.isFolder ? "/" : ""),
          ),
      ),
  );
  const [first, ...rest] = items.filter((set) => set.size > 0);
  if (first === undefined) return [];
  return [...first]
    .filter((item) => rest.every((set) => set.has(item)))
    .sort(
      (a, b) =>
        Number(!a.endsWith("/")) - Number(!b.endsWith("/")) ||
        a.localeCompare(b),
    );
}

const singular = (name: string) =>
  name.endsWith("ies")
    ? name.slice(0, -3) + "y"
    : name.endsWith("s")
      ? name.slice(0, -1)
      : name;

export type UnknownFolderAnswer = "shared" | "top" | "bottom" | "ignore";

/**
 * Applies the user's answer for a folder `inferStructure` didn't recognise:
 * add it to shared code, make it its own layer at the top (may use every
 * other layer) or bottom (may use none), or ignore it.
 */
export function placeUnknownFolder(
  config: StructureConfig,
  folder: string,
  answer: UnknownFolderAnswer,
): StructureConfig {
  const name =
    path.posix
      .basename(folder)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^[^a-z]+/, "") || "layer";
  const others = config.layers.map((layer) => layer.name);
  const unique = others.includes(name) ? `${name}-layer` : name;

  switch (answer) {
    case "ignore":
      return { ...config, ignore: [...config.ignore, `${folder}/**`] };
    case "shared": {
      const shared = config.layers.find((layer) => layer.name === "shared");
      if (shared) {
        return {
          ...config,
          layers: config.layers.map((layer) =>
            layer === shared
              ? { ...layer, paths: [...layer.paths, folder] }
              : layer,
          ),
        };
      }
      return {
        ...config,
        layers: [
          ...config.layers.map((layer) => ({
            ...layer,
            mayImport: [...layer.mayImport, "shared"],
          })),
          { name: "shared", paths: [folder], mayImport: [], siblings: "any" },
        ],
      };
    }
    case "top":
      return {
        ...config,
        layers: [
          { name: unique, paths: [folder], mayImport: others, siblings: "any" },
          ...config.layers,
        ],
      };
    case "bottom":
      return {
        ...config,
        layers: [
          ...config.layers.map((layer) => ({
            ...layer,
            mayImport: [...layer.mayImport, unique],
          })),
          { name: unique, paths: [folder], mayImport: [], siblings: "any" },
        ],
      };
  }
}
