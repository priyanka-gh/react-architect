import * as path from "node:path";
import type { Manifest } from "../manifest/schema";
import type { FileOperation } from "../plan";
import {
  componentSource,
  componentStylesSource,
  componentTestSource,
} from "../templates/component";
import { enclosingFeature, featureExport } from "./featureIndex";
import type { Generator } from "./types";

/**
 * The files for one component in its own folder (ADR 5):
 * UserCard/UserCard.tsx, UserCard.module.css and UserCard.test.tsx.
 */
export function componentFiles(
  name: string,
  parentDirectory: string,
  manifest: Manifest,
  includeTests: boolean,
): { operations: FileOperation[]; mainFile: string } {
  const folder = path.posix.join(parentDirectory, name);
  const mainFile = `${folder}/${name}.tsx`;
  const withStyles = manifest.styling === "css-modules";

  const operations: FileOperation[] = [
    {
      kind: "create",
      path: mainFile,
      content: componentSource({ name, withStyles }),
    },
  ];
  if (withStyles) {
    operations.push({
      kind: "create",
      path: `${folder}/${name}.module.css`,
      content: componentStylesSource(),
    });
  }
  if (includeTests && manifest.testing.framework !== "none") {
    operations.push({
      kind: "create",
      path: `${folder}/${name}.test.tsx`,
      content: componentTestSource({ name }),
    });
  }
  return { operations, mainFile };
}

export const componentGenerator: Generator = {
  id: "component",
  label: "Component",
  namePlaceholder: "For example: user card",
  displayName: (name) => name.pascal,
  defaultDirectory: (manifest) => manifest.paths.components,
  canExportFromFeature: true,

  generate(input, manifest) {
    const { operations, mainFile } = componentFiles(
      input.name.pascal,
      input.directory,
      manifest,
      input.includeTests,
    );

    const feature = enclosingFeature(input.directory, manifest);
    if (input.exportFromFeature && feature !== undefined) {
      operations.push(
        featureExport(
          feature,
          mainFile.replace(/\.tsx$/, ""),
          input.name.pascal,
        ),
      );
    }
    return { operations, mainFile };
  },
};
