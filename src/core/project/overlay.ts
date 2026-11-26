import { getGenerator } from "../generators";
import { MANIFEST_FILE_NAME, serializeManifest } from "../manifest/schema";
import { parseName } from "../naming";
import type { FileOperation } from "../plan";
import {
  appLayoutFolder,
  appLayoutSource,
  appLayoutStylesheetName,
  appLayoutStylesSource,
  appLayoutTestSource,
  appSource,
  appTestSource,
  envExampleSource,
  eslintConfigSource,
  gitignoreSource,
  globalStylesSource,
  mainSource,
  prettierIgnoreSource,
  readmeSource,
  routesSource,
  testSetupSource,
  tsconfigAppSource,
  viteConfigSource,
  yarnrcSource,
  type ProjectTemplateContext,
} from "../templates/project";
import {
  BASE_DEV_DEPENDENCIES,
  ROUTING_DEPENDENCIES,
  TAILWIND_DEV_DEPENDENCIES,
  TEST_DEV_DEPENDENCIES,
} from "./dependencies";
import { manifestFor, type ProjectOptions } from "./options";
import { PACKAGE_MANAGERS } from "./packageManager";
import type { PackageJsonAdditions } from "./packageJson";

export interface ProjectOverlay {
  /** Paths create-vite made that are replaced wholesale, never patched (ADR 3). */
  remove: string[];
  /** Files to write once those are gone. */
  operations: FileOperation[];
  packageJson: PackageJsonAdditions;
}

/** What turns a fresh create-vite project into a React Architect one (ADR 7 and 10). */
export function projectOverlay(
  options: Omit<ProjectOptions, "parentDirectory" | "git" | "install">,
): ProjectOverlay {
  const manifest = manifestFor(options);
  const packageManager = PACKAGE_MANAGERS[options.packageManager];
  const context: ProjectTemplateContext = { ...options, packageManager };
  const files: FileOperation[] = [];
  const add = (path: string, content: string | undefined) => {
    if (content !== undefined) {
      files.push({ kind: "create", path, content });
    }
  };

  add(MANIFEST_FILE_NAME, serializeManifest(manifest));
  add("README.md", readmeSource(context));
  add(".env.example", envExampleSource());
  add(".gitignore", gitignoreSource(context));
  add(".prettierrc", "{}\n");
  add(".prettierignore", prettierIgnoreSource());
  if (packageManager.id === "yarn") {
    add(".yarnrc.yml", yarnrcSource());
  }
  add("eslint.config.js", eslintConfigSource());
  add("vite.config.ts", viteConfigSource(context));
  if (options.pathAlias) {
    add("tsconfig.app.json", tsconfigAppSource());
  }

  add("src/main.tsx", mainSource(context));
  add("src/app/App.tsx", appSource(context));
  if (options.tests) {
    add("src/app/App.test.tsx", appTestSource());
    add("src/test/setup.ts", testSetupSource());
  }
  add("src/styles/global.css", globalStylesSource(context));

  if (options.routing) {
    const layout = appLayoutFolder(options.paths);
    add("src/app/routes.tsx", routesSource(context));
    add(`${layout}/AppLayout.tsx`, appLayoutSource(context));
    const stylesheet = appLayoutStylesheetName(options.styling);
    if (stylesheet !== undefined) {
      add(`${layout}/${stylesheet}`, appLayoutStylesSource(context));
    }
    if (options.tests) {
      add(`${layout}/AppLayout.test.tsx`, appLayoutTestSource());
    }
  }

  // The starter feature comes from the same generator people run, so project
  // creation exercises the code generation path (ADR 7).
  const home = parseName("home");
  if (!home.ok) {
    throw new Error(home.error);
  }
  const homeFeature = getGenerator("feature").generate(
    {
      name: home.name,
      directory: manifest.paths.features,
      includeTests: options.tests,
      exportFromFeature: false,
    },
    manifest,
  );
  files.push(...homeFeature.operations);

  return {
    remove: [
      "src",
      "README.md",
      ".gitignore",
      "eslint.config.js",
      "vite.config.ts",
      ...(options.pathAlias ? ["tsconfig.app.json"] : []),
    ],
    operations: files,
    packageJson: {
      dependencies: options.routing ? ROUTING_DEPENDENCIES : {},
      devDependencies: {
        ...BASE_DEV_DEPENDENCIES,
        ...(options.tests ? TEST_DEV_DEPENDENCIES : {}),
        ...(options.styling === "tailwind" ? TAILWIND_DEV_DEPENDENCIES : {}),
      },
      scripts: {
        ...(options.tests
          ? { test: "vitest run", "test:watch": "vitest" }
          : {}),
        format: "prettier --write .",
        "format:check": "prettier --check .",
      },
    },
  };
}
