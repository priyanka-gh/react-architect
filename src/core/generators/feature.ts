import * as path from "node:path";
import { hookName } from "../naming";
import type { FileOperation } from "../plan";
import { code } from "../templates/code";
import { featureServiceSource, featureTypesSource } from "../templates/feature";
import type { Kind } from "../structure/kinds";
import { templateFolderFor } from "../structure/kinds";
import { componentFiles } from "./component";
import { unitLayerAt, unitLayerFolders } from "./featureIndex";
import { hookFiles } from "./hook";
import type { Generator } from "./types";

/**
 * A feature folder (ADR 5):
 *
 *   user-profile/
 *   ├── components/UserProfile/…
 *   ├── hooks/useUserProfile.ts
 *   ├── services/userProfileApi.ts
 *   ├── types.ts
 *   └── index.ts   (the feature's public API, ADR 6)
 */
export const featureGenerator: Generator = {
  id: "feature",
  label: "Feature",
  namePlaceholder: "For example: user profile",
  displayName: (name) => name.kebab,
  defaultDirectory: (manifest) =>
    unitLayerFolders(manifest)[0] ?? manifest.paths.features,
  directoryChoices: (manifest) => unitLayerFolders(manifest),
  canExportFromFeature: false,

  generate(input, manifest) {
    const { pascal, camel, kebab } = input.name;
    const folder = path.posix.join(input.directory, kebab);
    const hook = hookName(input.name);

    // With a custom structure, follow the unit template (plans/custom-structure.md, Phase 5).
    const layer = unitLayerAt(input.directory, manifest);
    const template = layer?.unitTemplate;
    const entry = layer?.entry ?? "index.ts";
    const segment = (kind: Kind, fallback: string) =>
      (template && templateFolderFor(kind, template)) ?? fallback;
    const components = segment("component", "components");
    const hooks = segment("hook", "hooks");
    const services = segment("service", "services");
    const typesFolder =
      template === undefined || template.includes("types.ts")
        ? undefined
        : templateFolderFor("types", template);
    // types.ts, types/index.ts or model/types.ts: imported as "./types" or "./model/types".
    const typesFile =
      typesFolder === undefined
        ? "types.ts"
        : typesFolder === "types"
          ? "types/index.ts"
          : `${typesFolder}/types.ts`;
    const typesModule =
      typesFile === "types/index.ts" ? "types" : typesFile.replace(/\.ts$/, "");
    const relative = (from: string, to: string) => {
      const result = path.posix.relative(from, to);
      return result.startsWith(".") ? result : "./" + result;
    };

    const component = componentFiles(
      input.name,
      `${folder}/${components}`,
      manifest,
      input.includeTests,
    );
    const hookResult = hookFiles(
      hook,
      `${folder}/${hooks}`,
      manifest,
      input.includeTests,
    );

    const operations: FileOperation[] = [
      ...component.operations,
      ...hookResult.operations,
      {
        kind: "create",
        path: `${folder}/${services}/${camel}Api.ts`,
        content: featureServiceSource({
          pascal,
          kebab,
          typesFrom: relative(services, typesModule),
        }),
      },
      {
        kind: "create",
        path: `${folder}/${typesFile}`,
        content: featureTypesSource({ pascal, kebab }),
      },
      {
        kind: "create",
        path: `${folder}/${entry}`,
        content: code`
          export { ${pascal} } from "./${components}/${pascal}/${pascal}";
          export { ${hook} } from "./${hooks}/${hook}";
          export { fetch${pascal} } from "./${services}/${camel}Api";
          export type { ${pascal}Data } from "./${typesModule}";
        `,
      },
    ];
    return { operations, mainFile: component.mainFile };
  },
};
