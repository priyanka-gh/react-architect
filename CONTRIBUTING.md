# Contributing

## Setup

Requires Node.js 22.12 or newer.

```sh
npm install
npm run build            # bundle into dist/
npm run check-types      # TypeScript, no output
npm run lint
npm run format:check
npm run test:unit        # Vitest, no VS Code needed
npm run test:integration # downloads VS Code 1.100.0 and stable, runs tests inside both
npm run test:e2e         # creates real projects with create-vite and npm (needs network, about a minute)
npm run package:vsix     # builds react-architect-<version>.vsix
```

Press F5 in VS Code to launch a window with the extension loaded.

## How the code is organised

- `src/core/`: pure logic (naming, the settings file, file plans, generators, templates, project creation steps). It must not import `vscode`, `src/infra/` or `src/commands/`; ESLint enforces this.
- `src/infra/`: side effects (running programs, writing files).
- `src/commands/`: VS Code UI. All the questions go through a `Prompts` interface, so integration tests can answer them with a script.

## Design

The design decisions are recorded as architecture decision records in [docs/adr/](docs/adr/README.md). Read them before changing how generation, file writing or project creation works. If a change contradicts one, update the record in the same change.

## Roadmap

| Phase | Work                                                                                                                 | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| 0     | Extension skeleton: esbuild, TypeScript, ESLint boundary rule, Vitest, `@vscode/test-cli`, CI on Windows/macOS/Linux | Done   |
| 1     | `core/`: naming, manifest, file plans, path safety, conflict detection                                               | Done   |
| 2     | Component, hook and feature generators; workspace writer; preview; Explorer context menu                             | Done   |
| 3     | Project creation: process runner, pinned create-vite, overlay, install, cancellation                                 | Done   |
| 4     | Suggest a manifest for existing projects that don't have one                                                         | Done   |
| 5     | Marketplace README, licence, packaging, release workflow; publishing needs the owner's accounts                      | Ready  |

Post-MVP: JavaScript output, layered architecture, Tailwind, route registration, context/Redux/API service generators, pnpm/yarn/bun, user templates, generated lint rules for feature boundaries.
