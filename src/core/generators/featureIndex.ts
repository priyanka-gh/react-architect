import * as path from "node:path";
import type { Manifest } from "../manifest/schema";
import type { FileOperation } from "../plan";
import { KIND_FOLDERS, type Kind } from "../structure/kinds";
import { classify, structureFor } from "../structure/model";

/**
 * The unit (with the default structure, the feature) that contains
 * `directory`, if its layer has an entry file to export from. For example,
 * with features in "src/features", "src/features/shop/components" is inside
 * "src/features/shop". The features folder itself is not a feature.
 */
export function enclosingUnit(
  directory: string,
  manifest: Manifest,
): { folder: string; entry: string; layer: string } | undefined {
  const place = classify(directory, structureFor(manifest));
  if (place?.unit === undefined || place.layer.entry === undefined) {
    return undefined;
  }
  return {
    folder: place.unit.folder,
    entry: place.layer.entry,
    layer: place.layer.name,
  };
}

/** The enclosing unit's folder; see enclosingUnit. */
export function enclosingFeature(
  directory: string,
  manifest: Manifest,
): string | undefined {
  return enclosingUnit(directory, manifest)?.folder;
}

/** The folders units can be generated in: each unit layer's folder, features first. */
export function unitLayerFolders(manifest: Manifest): string[] {
  const structure = structureFor(manifest);
  return structure.layers
    .slice()
    .sort(
      (a, b) => Number(b.name === "features") - Number(a.name === "features"),
    )
    .flatMap((layer) =>
      layer.parsedPaths.filter((p) => p.units).map((p) => p.base || "."),
    );
}

/**
 * With a custom structure, the layer folders named for a kind of code, such
 * as src/components and src/ui for components. Empty without a structure,
 * so the manifest's paths apply as before.
 */
export function kindLayerFolders(manifest: Manifest, kind: Kind): string[] {
  if (manifest.structure === undefined) return [];
  return structureFor(manifest).layers.flatMap((layer) =>
    layer.parsedPaths
      .filter(
        (p) =>
          !p.units && KIND_FOLDERS[kind].includes(path.posix.basename(p.base)),
      )
      .map((p) => p.base),
  );
}

/** The unit layer whose units go directly in `folder`, if any. */
export function unitLayerAt(folder: string, manifest: Manifest) {
  const base = folder === "." ? "" : folder;
  return structureFor(manifest).layers.find((layer) =>
    layer.parsedPaths.some((p) => p.units && p.base === base),
  );
}

/**
 * Adds `export { name } from "./relative/path";` to a feature's index.ts.
 * `file` is project-relative and has no extension.
 */
export function featureExport(
  featureFolder: string,
  file: string,
  exportedName: string,
  entry = "index.ts",
): FileOperation {
  const relative = path.posix.relative(featureFolder, file);
  const specifier = relative.startsWith(".") ? relative : "./" + relative;
  return {
    kind: "ensureLine",
    path: `${featureFolder}/${entry}`,
    line: `export { ${exportedName} } from "${specifier}";`,
  };
}
