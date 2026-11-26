import { getGenerator } from "../generators";
import {
  DEFAULT_MANIFEST,
  MANIFEST_FILE_NAME,
  serializeManifest,
} from "../manifest/schema";
import { parseName } from "../naming";
import type { FileOperation } from "../plan";
import {
  appLayoutSource,
  appLayoutStylesSource,
  appLayoutTestSource,
  appSource,
  appTestSource,
  envExampleSource,
  eslintConfigSource,
  globalStylesSource,
  mainSource,
  readmeSource,
  routesSource,
  testSetupSource,
  viteConfigSource,
} from "../templates/project";
import { DEV_DEPENDENCIES, ROUTING_DEPENDENCIES } from "./dependencies";
import type { PackageJsonAdditions } from "./packageJson";

export interface ProjectOverlay {
  /** Paths create-vite made that are replaced wholesale, never patched (ADR 3). */
  remove: string[];
  /** Files to write once those are gone. */
  operations: FileOperation[];
  packageJson: PackageJsonAdditions;
}

/** What turns a fresh create-vite project into a React Architect one (ADR 7). */
export function projectOverlay(options: {
  name: string;
  routing: boolean;
}): ProjectOverlay {
  const { name, routing } = options;
  const create = (path: string, content: string): FileOperation => ({
    kind: "create",
    path,
    content,
  });

  const home = parseName("home");
  if (!home.ok) {
    throw new Error(home.error);
  }
  // The starter feature comes from the same generator users run, so project
  // creation exercises the code generation path (ADR 7).
  const homeFeature = getGenerator("feature").generate(
    {
      name: home.name,
      directory: DEFAULT_MANIFEST.paths.features,
      includeTests: true,
      exportFromFeature: false,
    },
    DEFAULT_MANIFEST,
  );

  const layout = `${DEFAULT_MANIFEST.paths.components}/layout/AppLayout`;
  const operations: FileOperation[] = [
    create(MANIFEST_FILE_NAME, serializeManifest(DEFAULT_MANIFEST)),
    create("README.md", readmeSource({ name, routing })),
    create(".env.example", envExampleSource()),
    create(".prettierrc", "{}\n"),
    create(".prettierignore", "package-lock.json\n"),
    create("eslint.config.js", eslintConfigSource()),
    create("vite.config.ts", viteConfigSource()),
    create("src/main.tsx", mainSource()),
    create("src/app/App.tsx", appSource({ routing })),
    create("src/app/App.test.tsx", appTestSource()),
    ...(routing
      ? [
          create("src/app/routes.tsx", routesSource()),
          create(`${layout}/AppLayout.tsx`, appLayoutSource()),
          create(`${layout}/AppLayout.module.css`, appLayoutStylesSource()),
          create(`${layout}/AppLayout.test.tsx`, appLayoutTestSource()),
        ]
      : []),
    ...homeFeature.operations,
    create("src/styles/global.css", globalStylesSource()),
    create("src/test/setup.ts", testSetupSource()),
  ];

  return {
    remove: ["src", "README.md", "eslint.config.js", "vite.config.ts"],
    operations,
    packageJson: {
      dependencies: routing ? ROUTING_DEPENDENCIES : {},
      devDependencies: DEV_DEPENDENCIES,
      scripts: {
        test: "vitest run",
        "test:watch": "vitest",
        format: "prettier --write .",
        "format:check": "prettier --check .",
      },
    },
  };
}
