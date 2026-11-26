import * as path from "node:path";
import type { Manifest } from "../manifest/schema";
import type { FileOperation } from "../plan";
import {
  componentSource,
  componentStylesheetName,
  componentStylesSource,
  componentTestSource,
} from "../templates/component";
import { enclosingUnit, featureExport, kindLayerFolders } from "./featureIndex";
import type { Generator } from "./types";

/**
 * The files for one component in its own folder (ADR 5): UserCard/UserCard.tsx,
 * its stylesheet if the project's styling uses one, and UserCard.test.tsx.
 */
export function componentFiles(
  name: { pascal: string; kebab: string },
  parentDirectory: string,
  manifest: Manifest,
  includeTests: boolean,
): { operations: FileOperation[]; mainFile: string } {
  const { styling } = manifest;
  const { kebab } = name;
  const folder = path.posix.join(parentDirectory, name.pascal);
  const mainFile = `${folder}/${name.pascal}.tsx`;

  const operations: FileOperation[] = [
    {
      kind: "create",
      path: mainFile,
      content: componentSource({ name: name.pascal, kebab, styling }),
    },
  ];
  const stylesheet = componentStylesheetName({ name: name.pascal, styling });
  if (stylesheet !== undefined) {
    operations.push({
      kind: "create",
      path: `${folder}/${stylesheet}`,
      content: componentStylesSource({ kebab, styling }),
    });
  }
  if (includeTests && manifest.testing.framework !== "none") {
    operations.push({
      kind: "create",
      path: `${folder}/${name.pascal}.test.tsx`,
      content: componentTestSource({ name: name.pascal }),
    });
  }
  return { operations, mainFile };
}

export const componentGenerator: Generator = {
  id: "component",
  label: "Component",
  namePlaceholder: "For example: user card",
  displayName: (name) => name.pascal,
  defaultDirectory: (manifest) =>
    kindLayerFolders(manifest, "component")[0] ?? manifest.paths.components,
  directoryChoices: (manifest) => kindLayerFolders(manifest, "component"),
  canExportFromFeature: true,

  generate(input, manifest) {
    const { operations, mainFile } = componentFiles(
      input.name,
      input.directory,
      manifest,
      input.includeTests,
    );

    const unit = enclosingUnit(input.directory, manifest);
    if (input.exportFromFeature && unit !== undefined) {
      operations.push(
        featureExport(
          unit.folder,
          mainFile.replace(/\.tsx$/, ""),
          input.name.pascal,
          unit.entry,
        ),
      );
    }
    return { operations, mainFile };
  },
};
