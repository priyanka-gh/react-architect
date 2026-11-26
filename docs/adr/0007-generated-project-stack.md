# 7. What a generated project contains

**Status:** Accepted

## Scope of the MVP

- **TypeScript only.** JavaScript output would double the templates and the test matrix. How to support it is decided when it is actually built.
- **Feature-based architecture only.**
- **npm only.** The commands npm is asked to run are described by a small `PackageManager` object in `core/project/packageManager.ts` (argument arrays only), so pnpm, yarn and bun can be added later as another object of the same shape.

## Stack

| Concern            | Choice                                                                                                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base               | create-vite `react-ts`, pinned (see [ADR 3](0003-base-scaffold-with-pinned-create-vite.md))                                                                                                                                                                                                                           |
| Styling            | CSS Modules, plus `src/styles/global.css`                                                                                                                                                                                                                                                                             |
| Routing (optional) | `react-router` 8 with a data router: `createBrowserRouter` from `react-router`, and `RouterProvider` from `react-router/dom` (the browser build). Routes live in `src/app/routes.tsx`, and the layout in `src/components/layout/AppLayout/AppLayout.tsx`, which uses `<Outlet>`.                                      |
| Testing            | Vitest, `@testing-library/react` (with its peer `@testing-library/dom`), `@testing-library/jest-dom` and jsdom. Test config is the `test` block in `vite.config.ts`. `src/test/setup.ts` loads jest-dom and runs Testing Library's cleanup, which it can't register by itself because tests don't use Vitest globals. |
| Linting            | ESLint flat config (create-vite needs `--eslint`; see ADR 3). We replace Vite's `eslint.config.js` with the same base plus `eslint-config-prettier`.                                                                                                                                                                  |
| Formatting         | Prettier with its default options                                                                                                                                                                                                                                                                                     |

## Starter content

- `src/main.tsx` and `src/app/App.tsx`. Without routing, `App` renders the home feature directly.
- `src/features/home/`, produced by the same feature generator users run. That way, project creation exercises the code generation path.
- `src/styles/global.css`, `src/test/setup.ts` and `.env.example`.
- Every starter test passes.
- No empty directories and no placeholder modules. For example, `providers.tsx`, `lib/` and `utils/` are not created until something lives in them.

## Scripts

`dev`, `build`, `preview`, `lint`, `test` (`vitest run`, which runs once), `test:watch`, `format` and `format:check`.

## Dependencies and setup

- **Pinned versions.** The versions of every dependency we add are pinned exactly in `src/core/project/dependencies.ts`. They are bumped deliberately, and the end-to-end test proves each set works together.
- **Node check.** Before creating a project, run `node --version` and compare it with what every pinned tool supports. On 2026-11-26 that is 22.22.2+ on 22.x, 24.15+ on 24.x, or 26+: the strictest are jsdom (`^22.22.2 || ^24.15.0 || >=26`) and react-router (`>=22.22.0`), and Vitest excludes odd-numbered releases. Re-derive it whenever the pins change. If Node is missing or too old, stop and explain what to install.
- **Install and format.** Installation is on by default and can be skipped. After a successful install, run `npm run format` once, so the whole project starts out formatted, including the files Vite produced.
