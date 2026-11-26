import type { Manifest } from "../manifest/schema";
import { parseName, type NameForms } from "../naming";
import type { FileOperation } from "../plan";
import { pageSource, pageTestSource } from "../templates/page";
import * as path from "node:path";
import { templateFolderFor } from "../structure/kinds";
import { structureFor } from "../structure/model";
import { featureExport } from "./featureIndex";

/**
 * A page lives in a feature, in `pages/`, and is exported from the feature's
 * index.ts, so the routes file imports it through the feature's public API
 * (ADR 11):
 *
 *   features/settings/pages/SettingsPage.tsx   (+ .test.tsx)
 *   features/settings/index.ts                 export { SettingsPage } ...
 */

export interface PageNames {
  /** "SettingsPage" */
  component: string;
  /** "Settings", the page's heading. */
  title: string;
  /** "settings", the folder for a new feature and the default route. */
  kebab: string;
}

/** "settings", "settings page" and "SettingsPage" all give SettingsPage. */
export function pageNames(name: NameForms): PageNames {
  const words =
    name.words.length > 1 && name.words.at(-1) === "page"
      ? name.words.slice(0, -1)
      : name.words;
  const base = parseName(words.join(" "));
  const forms = base.ok ? base.name : name;
  return {
    component: `${forms.pascal}Page`,
    title: forms.words
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join(" "),
    kebab: forms.kebab,
  };
}

/** Where a page goes, and the unit (if any) whose entry file exports it. */
export interface PageLocation {
  folder: string;
  unit?: { folder: string; entry: string };
  /** What the routes file imports: the unit's folder, or the page file itself. */
  importTarget: string;
}

/** In a feature, as without a custom structure: features/settings/pages/. */
export function featurePageLocation(featureFolder: string): PageLocation {
  return {
    folder: `${featureFolder}/pages`,
    unit: { folder: featureFolder, entry: "index.ts" },
    importTarget: featureFolder,
  };
}

/**
 * With a custom structure that has a pages layer (a layer called "pages", or
 * whose folder is pages/routes/screens), pages go there instead: one unit
 * per page when the layer has units (pages/settings/ui/SettingsPage.tsx and
 * pages/settings/index.ts), or one file per page when it doesn't.
 */
export function structurePageLocation(
  names: PageNames,
  manifest: Manifest,
): PageLocation | undefined {
  if (manifest.structure === undefined) return undefined;
  const layer = structureFor(manifest).layers.find(
    (candidate) =>
      candidate.name === "pages" ||
      candidate.parsedPaths.some((p) =>
        PAGE_FOLDERS.includes(path.posix.basename(p.base)),
      ),
  );
  const layerPath = layer?.parsedPaths[0];
  if (layer === undefined || layerPath === undefined) return undefined;
  if (!layerPath.units) {
    return {
      folder: layerPath.base,
      importTarget: `${layerPath.base}/${names.component}`,
    };
  }
  const unitFolder = path.posix.join(layerPath.base, names.kebab);
  const segment =
    layer.unitTemplate && templateFolderFor("page", layer.unitTemplate);
  return {
    folder: segment ? `${unitFolder}/${segment}` : unitFolder,
    unit: { folder: unitFolder, entry: layer.entry ?? "index.ts" },
    importTarget: layer.entry ? unitFolder : `${unitFolder}/${names.component}`,
  };
}

const PAGE_FOLDERS = ["pages", "routes", "screens"];

export function pageFiles(
  names: PageNames,
  featureFolder: string,
  manifest: Manifest,
  includeTests: boolean,
): { operations: FileOperation[]; mainFile: string } {
  return pageFilesAt(
    names,
    featurePageLocation(featureFolder),
    manifest,
    includeTests,
  );
}

export function pageFilesAt(
  names: PageNames,
  location: PageLocation,
  manifest: Manifest,
  includeTests: boolean,
): { operations: FileOperation[]; mainFile: string } {
  const mainFile = `${location.folder}/${names.component}.tsx`;
  const context = { name: names.component, title: names.title };

  const operations: FileOperation[] = [
    { kind: "create", path: mainFile, content: pageSource(context) },
  ];
  if (includeTests && manifest.testing.framework !== "none") {
    operations.push({
      kind: "create",
      path: `${location.folder}/${names.component}.test.tsx`,
      content: pageTestSource(context),
    });
  }
  if (location.unit !== undefined) {
    operations.push(
      featureExport(
        location.unit.folder,
        mainFile.replace(/\.tsx$/, ""),
        names.component,
        location.unit.entry,
      ),
    );
  }
  return { operations, mainFile };
}

const SEGMENT = String.raw`(?:[A-Za-z0-9._~-]+|:[A-Za-z_][A-Za-z0-9_]*|\*)`;
const ROUTE_PATH = new RegExp(`^(?:/${SEGMENT})+$`);

/** Checks a route path such as "/settings" or "/users/:id". */
export function routePathProblem(value: string): string | undefined {
  if (!value.startsWith("/")) {
    return 'A route path starts with "/", for example /settings.';
  }
  if (!ROUTE_PATH.test(value)) {
    return "Use letters, digits, - and _ between slashes, :name for a parameter, or * for the rest.";
  }
  return undefined;
}
