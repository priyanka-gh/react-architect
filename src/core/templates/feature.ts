import { code } from "./code";

export interface FeatureTemplate {
  /** PascalCase, e.g. "UserProfile". */
  pascal: string;
  /** kebab-case, e.g. "user-profile". */
  kebab: string;
}

/** The type is called <Name>Data so it can't clash with the <Name> component in index.ts. */
export function featureTypesSource({ pascal }: FeatureTemplate): string {
  return code`
    export interface ${pascal}Data {
      id: string;
    }
  `;
}

export function featureServiceSource({
  pascal,
  kebab,
  typesFrom = "../types",
}: FeatureTemplate & {
  /** Where the service imports the feature's types from. */
  typesFrom?: string;
}): string {
  return code`
    import type { ${pascal}Data } from "${typesFrom}";

    export async function fetch${pascal}() {
      const response = await fetch("/api/${kebab}");
      if (!response.ok) {
        throw new Error(\`Request failed with status \${response.status}\`);
      }
      return (await response.json()) as ${pascal}Data;
    }
  `;
}
