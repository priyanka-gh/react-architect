import * as path from "node:path";
import type { Manifest, Styling } from "../manifest/schema";
import type { PackageManager } from "../project/packageManager";
import { code } from "./code";

/**
 * Starter files for new projects (ADR 7 and 10). They replace what
 * create-vite puts in src/ and some of its config files (ADR 3).
 */

export interface ProjectTemplateContext {
  name: string;
  styling: Styling;
  tests: boolean;
  routing: boolean;
  pathAlias: boolean;
  paths: Manifest["paths"];
  packageManager: PackageManager;
}

/**
 * The module specifier for importing `target` (project-relative, without
 * extension) from `fromFile`. Imports within the same folder stay relative;
 * imports that leave it use "@/" when the alias is on.
 */
export function importPath(
  fromFile: string,
  target: string,
  pathAlias: boolean,
): string {
  const relative = path.posix.relative(path.posix.dirname(fromFile), target);
  if (!relative.startsWith("../")) {
    return "./" + relative;
  }
  return pathAlias && target.startsWith("src/")
    ? "@/" + target.slice("src/".length)
    : relative;
}

export const appLayoutFolder = (paths: Manifest["paths"]) =>
  `${paths.components}/layout/AppLayout`;
export const homeFeature = (paths: Manifest["paths"]) =>
  `${paths.features}/home`;

const hasGlobalStyles = (styling: Styling) => styling !== "none";

export function mainSource({ styling }: ProjectTemplateContext): string {
  const globalStyles = hasGlobalStyles(styling)
    ? 'import "./styles/global.css";\n'
    : "";
  return (
    code`
      import { StrictMode } from "react";
      import { createRoot } from "react-dom/client";
      import { App } from "./app/App";
    ` +
    globalStyles +
    "\n" +
    code`
      const container = document.getElementById("root");
      if (container === null) {
        throw new Error('index.html is missing <div id="root">.');
      }

      createRoot(container).render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    `
  );
}

export function appSource(context: ProjectTemplateContext): string {
  if (context.routing) {
    return code`
      import { RouterProvider } from "react-router/dom";
      import { router } from "./routes";

      export function App() {
        return <RouterProvider router={router} />;
      }
    `;
  }
  const home = importPath(
    "src/app/App.tsx",
    homeFeature(context.paths),
    context.pathAlias,
  );
  return code`
    import { Home } from "${home}";

    export function App() {
      return <Home />;
    }
  `;
}

export function appTestSource(): string {
  return code`
    import { render, screen } from "@testing-library/react";
    import { describe, expect, it } from "vitest";
    import { App } from "./App";

    describe("App", () => {
      it("shows the home page", () => {
        render(<App />);
        expect(screen.getByText("Home")).toBeInTheDocument();
      });
    });
  `;
}

export function routesSource(context: ProjectTemplateContext): string {
  const from = "src/app/routes.tsx";
  const layout = importPath(
    from,
    `${appLayoutFolder(context.paths)}/AppLayout`,
    context.pathAlias,
  );
  const home = importPath(from, homeFeature(context.paths), context.pathAlias);
  return code`
    import { createBrowserRouter } from "react-router";
    import { AppLayout } from "${layout}";
    import { Home } from "${home}";

    export const router = createBrowserRouter([
      {
        path: "/",
        element: <AppLayout />,
        children: [{ index: true, element: <Home /> }],
      },
    ]);
  `;
}

/** The layout's stylesheet name, if its styling uses one. */
export function appLayoutStylesheetName(styling: Styling): string | undefined {
  if (styling === "css-modules") return "AppLayout.module.css";
  if (styling === "plain-css") return "AppLayout.css";
  return undefined;
}

export function appLayoutSource({ styling }: ProjectTemplateContext): string {
  const imports: Record<Styling, string> = {
    "css-modules": 'import styles from "./AppLayout.module.css";\n',
    "plain-css": 'import "./AppLayout.css";\n',
    tailwind: "",
    none: "",
  };
  const main: Record<Styling, string> = {
    "css-modules": "<main className={styles.root}>",
    "plain-css": '<main className="app-layout">',
    tailwind: '<main className="mx-auto max-w-5xl px-4 py-8">',
    none: "<main>",
  };
  return (
    'import { Outlet } from "react-router";\n' +
    imports[styling] +
    "\n" +
    code`
      export function AppLayout() {
        return (
          ${main[styling]}
            <Outlet />
          </main>
        );
      }
    `
  );
}

export function appLayoutStylesSource({
  styling,
}: ProjectTemplateContext): string {
  const selector = styling === "plain-css" ? ".app-layout" : ".root";
  return code`
    ${selector} {
      max-width: 64rem;
      margin: 0 auto;
      padding: 2rem 1rem;
    }
  `;
}

export function appLayoutTestSource(): string {
  return code`
    import { render, screen } from "@testing-library/react";
    import { createMemoryRouter } from "react-router";
    import { RouterProvider } from "react-router/dom";
    import { describe, expect, it } from "vitest";
    import { AppLayout } from "./AppLayout";

    describe("AppLayout", () => {
      it("renders the current page", () => {
        const router = createMemoryRouter([
          {
            path: "/",
            element: <AppLayout />,
            children: [{ index: true, element: <p>Page</p> }],
          },
        ]);
        render(<RouterProvider router={router} />);
        expect(screen.getByText("Page")).toBeInTheDocument();
      });
    });
  `;
}

/** Undefined when the project has no global stylesheet (styling "none"). */
export function globalStylesSource({
  styling,
}: ProjectTemplateContext): string | undefined {
  if (!hasGlobalStyles(styling)) {
    return undefined;
  }
  if (styling === "tailwind") {
    return code`
      @import "tailwindcss";
    `;
  }
  return code`
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: system-ui, sans-serif;
      line-height: 1.5;
    }
  `;
}

export function testSetupSource(): string {
  return code`
    /// <reference types="@testing-library/jest-dom/vitest" />
    import * as matchers from "@testing-library/jest-dom/matchers";
    import { cleanup } from "@testing-library/react";
    import { afterEach, expect } from "vitest";

    // Add jest-dom's matchers (toBeInTheDocument and others) to the same
    // \`expect\` the tests import. "@testing-library/jest-dom/vitest" would add
    // them to its own copy of Vitest, which on Windows can be a different one.
    expect.extend(matchers);

    // Tests import from "vitest" explicitly (no globals), so Testing Library
    // can't register its own cleanup; do it here.
    afterEach(() => {
      cleanup();
    });
  `;
}

export function viteConfigSource({
  styling,
  tests,
  pathAlias,
}: ProjectTemplateContext): string {
  const tailwind = styling === "tailwind";
  const imports = [
    tailwind && 'import tailwindcss from "@tailwindcss/vite";',
    'import react from "@vitejs/plugin-react";',
    pathAlias && 'import { fileURLToPath } from "node:url";',
    // Vitest's defineConfig accepts the test block as well as Vite's options.
    tests
      ? 'import { defineConfig } from "vitest/config";'
      : 'import { defineConfig } from "vite";',
  ].filter(Boolean);

  const body = [
    `  plugins: [react()${tailwind ? ", tailwindcss()" : ""}],`,
    pathAlias &&
      [
        "  resolve: {",
        "    alias: {",
        '      "@": fileURLToPath(new URL("./src", import.meta.url)),',
        "    },",
        "  },",
      ].join("\n"),
    tests &&
      [
        "  test: {",
        '    environment: "jsdom",',
        '    setupFiles: ["./src/test/setup.ts"],',
        "  },",
      ].join("\n"),
  ].filter(Boolean);

  const link = tests
    ? "// https://vite.dev/config/ and https://vitest.dev/config/"
    : "// https://vite.dev/config/";

  return `${imports.join("\n")}\n\n${link}\nexport default defineConfig({\n${body.join("\n")}\n});\n`;
}

/**
 * create-vite 9.3.4's tsconfig.app.json plus the "@/" path. Replaced
 * wholesale, never patched (ADR 3): it has comments, so it isn't plain JSON.
 */
export function tsconfigAppSource(): string {
  return code`
    {
      "compilerOptions": {
        "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
        "target": "es2023",
        "lib": ["ES2023", "DOM"],
        "module": "esnext",
        "types": ["vite/client"],
        "allowArbitraryExtensions": true,
        "skipLibCheck": true,

        /* Bundler mode */
        "moduleResolution": "bundler",
        "allowImportingTsExtensions": true,
        "verbatimModuleSyntax": true,
        "moduleDetection": "force",
        "noEmit": true,
        "jsx": "react-jsx",

        /* Imports like "@/features/home" (also set in vite.config.ts) */
        "paths": {
          "@/*": ["./src/*"]
        },

        /* Linting */
        "noUnusedLocals": true,
        "noUnusedParameters": true,
        "erasableSyntaxOnly": true,
        "noFallthroughCasesInSwitch": true
      },
      "include": ["src"]
    }
  `;
}

/** create-vite's ESLint config, plus eslint-config-prettier so ESLint and Prettier never disagree. */
export function eslintConfigSource(): string {
  return code`
    import js from "@eslint/js";
    import prettier from "eslint-config-prettier/flat";
    import reactHooks from "eslint-plugin-react-hooks";
    import reactRefresh from "eslint-plugin-react-refresh";
    import { defineConfig, globalIgnores } from "eslint/config";
    import globals from "globals";
    import tseslint from "typescript-eslint";

    export default defineConfig([
      globalIgnores(["dist"]),
      {
        files: ["**/*.{ts,tsx}"],
        extends: [
          js.configs.recommended,
          tseslint.configs.recommended,
          reactHooks.configs.flat.recommended,
          reactRefresh.configs.vite,
        ],
        languageOptions: {
          globals: globals.browser,
        },
      },
      prettier,
    ]);
  `;
}

/** create-vite 9.3.4's .gitignore, plus Yarn's folder when Yarn is used. */
export function gitignoreSource({
  packageManager,
}: ProjectTemplateContext): string {
  const vite = code`
    # Logs
    logs
    *.log
    npm-debug.log*
    yarn-debug.log*
    yarn-error.log*
    pnpm-debug.log*
    lerna-debug.log*

    node_modules
    dist
    dist-ssr
    *.local

    # Editor directories and files
    .vscode/*
    !.vscode/extensions.json
    .idea
    .DS_Store
    *.suo
    *.ntvs*
    *.njsproj
    *.sln
    *.sw?
  `;
  if (packageManager.id !== "yarn") {
    return vite;
  }
  return (
    vite +
    "\n" +
    code`
      # Yarn
      .yarn/*
      !.yarn/patches
      !.yarn/plugins
      !.yarn/releases
      !.yarn/versions
    `
  );
}

export function prettierIgnoreSource(): string {
  return code`
    package-lock.json
    pnpm-lock.yaml
    yarn.lock
    .yarn
  `;
}

/** Makes Yarn 2+ install into node_modules, which editors understand; Yarn 1 ignores it. */
export function yarnrcSource(): string {
  return code`
    nodeLinker: node-modules
  `;
}

export function envExampleSource(): string {
  return code`
    # Copy this file to .env.local for settings on your machine; .env.local isn't committed.
    # Only variables that start with VITE_ reach the browser, through import.meta.env.
    # VITE_API_URL=http://localhost:3000
  `;
}

export function readmeSource(context: ProjectTemplateContext): string {
  const run = (script: string) =>
    `\`${context.packageManager.scriptCommand(script)}\``;
  const scripts = [
    `- ${run("dev")}: start the development server`,
    `- ${run("build")}: type-check and build for production`,
    `- ${run("lint")}: check the code with ESLint`,
    context.tests &&
      `- ${run("test")}: run the tests once (${run("test:watch")} to keep them running)`,
    `- ${run("format")}: format every file with Prettier`,
  ].filter(Boolean);

  const { paths } = context;
  const folders = [
    context.routing
      ? "- `src/app/`: the `App` component and the routes (`routes.tsx`)"
      : "- `src/app/`: the `App` component",
    `- \`${paths.components}/\`: components shared by several features`,
    `- \`${paths.hooks}/\`: hooks shared by several features`,
    `- \`${paths.features}/\`: one folder per feature, with its own components, hooks and services`,
    hasGlobalStyles(context.styling) && "- `src/styles/`: global styles",
    context.tests && "- `src/test/`: test setup",
  ].filter(Boolean);

  const stylingNote: Record<Styling, string> = {
    "css-modules":
      "Each component has a CSS Module (`.module.css`) next to it.",
    "plain-css": "Each component has a `.css` file next to it.",
    tailwind: "Styling uses Tailwind CSS utility classes.",
    none: "There are no stylesheets; add whatever styling you prefer.",
  };
  const aliasNote = context.pathAlias
    ? ` Import across folders with \`@/\`, for example \`@/${paths.features.replace(/^src\//, "")}/home\`.`
    : "";

  return (
    `# ${context.name}\n\n` +
    "A React and TypeScript app built with Vite and organised by feature.\n\n" +
    "## Scripts\n\n" +
    scripts.join("\n") +
    "\n\n## Where things go\n\n" +
    folders.join("\n") +
    "\n\n" +
    "Code outside a feature should import it only through the feature's `index.ts`. " +
    stylingNote[context.styling] +
    aliasNote +
    "\n\n" +
    "`react-architect.json` records these conventions for the React Architect VS Code extension.\n"
  );
}
