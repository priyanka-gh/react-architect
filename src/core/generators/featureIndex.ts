import * as path from "node:path";
import type { Manifest } from "../manifest/schema";
import type { FileOperation } from "../plan";

/**
 * The feature folder that contains `directory`, if any. For example, with
 * features in "src/features", "src/features/shop/components" is inside the
 * feature "src/features/shop". The features folder itself is not a feature.
 */
export function enclosingFeature(
  directory: string,
  manifest: Manifest,
): string | undefined {
  const features = manifest.paths.features;
  const prefix = features === "." ? "" : features + "/";
  if (!directory.startsWith(prefix)) {
    return undefined;
  }
  const featureName = directory.slice(prefix.length).split("/")[0];
  return featureName ? prefix + featureName : undefined;
}

/**
 * Adds `export { name } from "./relative/path";` to a feature's index.ts.
 * `file` is project-relative and has no extension.
 */
export function featureExport(
  featureFolder: string,
  file: string,
  exportedName: string,
): FileOperation {
  const relative = path.posix.relative(featureFolder, file);
  const specifier = relative.startsWith(".") ? relative : "./" + relative;
  return {
    kind: "ensureLine",
    path: `${featureFolder}/index.ts`,
    line: `export { ${exportedName} } from "${specifier}";`,
  };
}
