# React Architect

A VS Code extension that scaffolds React + Vite projects and generates components, hooks and features that follow the project's declared conventions.

**Status:** Phase 2 (generate component, hook and feature in existing projects) done; Phase 3 next.

## Development

Requires Node.js 22.12 or newer.

```sh
npm install
npm run build            # bundle into dist/
npm run check-types      # TypeScript, no output
npm run lint
npm run format:check
npm run test:unit        # Vitest, no VS Code needed
npm run test:integration # downloads VS Code 1.100.0 and stable, runs tests inside both
```

Press F5 in VS Code to launch a window with the extension loaded.

## Design

The design decisions are recorded as architecture decision records in [docs/adr/](docs/adr/README.md). Read them before changing how generation, file writing or project creation works.

## Roadmap

| Phase | Work                                                                                                                 | Done when                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0     | Extension skeleton: esbuild, TypeScript, ESLint boundary rule, Vitest, `@vscode/test-cli`, CI on Windows/macOS/Linux | CI is green on a hello-world command                                          |
| 1     | `core/`: naming, manifest, file plans, path safety, conflict detection                                               | Core is unit-tested, with no UI                                               |
| 2     | Component, hook and feature generators; workspace writer; preview; Explorer context menu                             | Generating into an existing project works and can be undone                   |
| 3     | Project creation: process runner, pinned create-vite, overlay, install, cancellation                                 | The end-to-end test builds, lints and tests a generated app on all three OSes |
| 4     | Infer a manifest for existing projects that don't have one                                                           | The inferred manifest is shown, confirmed and saved                           |
| 5     | README with GIF, Marketplace and Open VSX publish                                                                    | v0.1.0 released                                                               |

Post-MVP: JavaScript output, layered architecture, Tailwind, route registration, context/Redux/API service generators, pnpm/yarn/bun, user templates, generated lint rules for feature boundaries.
