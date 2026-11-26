import { code } from "./code";

/**
 * Starter files for new projects (ADR 7). They replace what create-vite puts
 * in src/ and its config files (ADR 3). Paths inside them assume the default
 * manifest: src/components, src/features.
 */

export function mainSource(): string {
  return code`
    import { StrictMode } from "react";
    import { createRoot } from "react-dom/client";
    import { App } from "./app/App";
    import "./styles/global.css";

    const container = document.getElementById("root");
    if (container === null) {
      throw new Error('index.html is missing <div id="root">.');
    }

    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  `;
}

export function appSource({ routing }: { routing: boolean }): string {
  if (routing) {
    return code`
      import { RouterProvider } from "react-router/dom";
      import { router } from "./routes";

      export function App() {
        return <RouterProvider router={router} />;
      }
    `;
  }
  return code`
    import { Home } from "../features/home";

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

export function routesSource(): string {
  return code`
    import { createBrowserRouter } from "react-router";
    import { AppLayout } from "../components/layout/AppLayout/AppLayout";
    import { Home } from "../features/home";

    export const router = createBrowserRouter([
      {
        path: "/",
        element: <AppLayout />,
        children: [{ index: true, element: <Home /> }],
      },
    ]);
  `;
}

export function appLayoutSource(): string {
  return code`
    import { Outlet } from "react-router";
    import styles from "./AppLayout.module.css";

    export function AppLayout() {
      return (
        <main className={styles.root}>
          <Outlet />
        </main>
      );
    }
  `;
}

export function appLayoutStylesSource(): string {
  return code`
    .root {
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

export function globalStylesSource(): string {
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
    import "@testing-library/jest-dom/vitest";
    import { cleanup } from "@testing-library/react";
    import { afterEach } from "vitest";

    // Tests import from "vitest" explicitly (no globals), so Testing Library
    // can't register its own cleanup; do it here.
    afterEach(() => {
      cleanup();
    });
  `;
}

export function viteConfigSource(): string {
  return code`
    import react from "@vitejs/plugin-react";
    import { defineConfig } from "vitest/config";

    // https://vite.dev/config/ and https://vitest.dev/config/
    export default defineConfig({
      plugins: [react()],
      test: {
        environment: "jsdom",
        setupFiles: ["./src/test/setup.ts"],
      },
    });
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

export function envExampleSource(): string {
  return code`
    # Copy this file to .env.local for settings on your machine; .env.local isn't committed.
    # Only variables that start with VITE_ reach the browser, through import.meta.env.
    # VITE_API_URL=http://localhost:3000
  `;
}

export function readmeSource({
  name,
  routing,
}: {
  name: string;
  routing: boolean;
}): string {
  const appLine = routing
    ? "- `app/`: the `App` component and the routes (`routes.tsx`)"
    : "- `app/`: the `App` component";
  return code`
    # ${name}

    A React and TypeScript app built with Vite and organised by feature.

    ## Scripts

    - \`npm run dev\`: start the development server
    - \`npm run build\`: type-check and build for production
    - \`npm run lint\`: check the code with ESLint
    - \`npm test\`: run the tests once (\`npm run test:watch\` to keep them running)
    - \`npm run format\`: format every file with Prettier

    ## Where things go

    Inside \`src/\`:

    ${appLine}
    - \`components/\`: components shared by several features
    - \`features/\`: one folder per feature, with its own components, hooks and services
    - \`styles/\`: global styles
    - \`test/\`: test setup

    Code outside a feature should import it only through the feature's \`index.ts\`.

    \`react-architect.json\` records these conventions for the React Architect VS Code extension.
  `;
}
