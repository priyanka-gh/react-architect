import * as path from "node:path";
import { hookName } from "../naming";
import type { FileOperation } from "../plan";
import { code } from "../templates/code";
import { featureServiceSource, featureTypesSource } from "../templates/feature";
import { componentFiles } from "./component";
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
  defaultDirectory: (manifest) => manifest.paths.features,
  canExportFromFeature: false,

  generate(input, manifest) {
    const { pascal, camel, kebab } = input.name;
    const folder = path.posix.join(input.directory, kebab);
    const hook = hookName(input.name);

    const component = componentFiles(
      pascal,
      `${folder}/components`,
      manifest,
      input.includeTests,
    );
    const hookResult = hookFiles(
      hook,
      `${folder}/hooks`,
      manifest,
      input.includeTests,
    );

    const operations: FileOperation[] = [
      ...component.operations,
      ...hookResult.operations,
      {
        kind: "create",
        path: `${folder}/services/${camel}Api.ts`,
        content: featureServiceSource({ pascal, kebab }),
      },
      {
        kind: "create",
        path: `${folder}/types.ts`,
        content: featureTypesSource({ pascal, kebab }),
      },
      {
        kind: "create",
        path: `${folder}/index.ts`,
        content: code`
          export { ${pascal} } from "./components/${pascal}/${pascal}";
          export { ${hook} } from "./hooks/${hook}";
          export { fetch${pascal} } from "./services/${camel}Api";
          export type { ${pascal}Data } from "./types";
        `,
      },
    ];
    return { operations, mainFile: component.mainFile };
  },
};
