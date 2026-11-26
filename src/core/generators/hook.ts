import * as path from "node:path";
import type { Manifest } from "../manifest/schema";
import { hookName } from "../naming";
import type { FileOperation } from "../plan";
import { hookSource, hookTestSource } from "../templates/hook";
import { enclosingUnit, featureExport, kindLayerFolders } from "./featureIndex";
import type { Generator } from "./types";

/** useCart.ts and useCart.test.ts, side by side (ADR 5). */
export function hookFiles(
  name: string,
  directory: string,
  manifest: Manifest,
  includeTests: boolean,
): { operations: FileOperation[]; mainFile: string } {
  const mainFile = path.posix.join(directory, `${name}.ts`);
  const operations: FileOperation[] = [
    { kind: "create", path: mainFile, content: hookSource({ name }) },
  ];
  if (includeTests && manifest.testing.framework !== "none") {
    operations.push({
      kind: "create",
      path: path.posix.join(directory, `${name}.test.ts`),
      content: hookTestSource({ name }),
    });
  }
  return { operations, mainFile };
}

export const hookGenerator: Generator = {
  id: "hook",
  label: "Hook",
  namePlaceholder: "For example: cart (becomes useCart)",
  displayName: (name) => hookName(name),
  defaultDirectory: (manifest) =>
    kindLayerFolders(manifest, "hook")[0] ?? manifest.paths.hooks,
  directoryChoices: (manifest) => kindLayerFolders(manifest, "hook"),
  canExportFromFeature: true,

  generate(input, manifest) {
    const name = hookName(input.name);
    const { operations, mainFile } = hookFiles(
      name,
      input.directory,
      manifest,
      input.includeTests,
    );

    const unit = enclosingUnit(input.directory, manifest);
    if (input.exportFromFeature && unit !== undefined) {
      operations.push(
        featureExport(
          unit.folder,
          mainFile.replace(/\.ts$/, ""),
          name,
          unit.entry,
        ),
      );
    }
    return { operations, mainFile };
  },
};
