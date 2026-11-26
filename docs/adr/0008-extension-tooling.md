# 8. How the extension itself is built, structured and tested

**Status:** Accepted

## Structure

```text
src/
├── extension.ts   # registers commands only
├── commands/      # VS Code UI: prompts → input object → core → show result
├── editor/        # long-lived VS Code integrations: project index, squiggles, quick fix, Project Map (ADR 11)
├── core/          # pure logic: naming, manifest, plans, generators, templates, project steps, code reading
└── infra/         # side effects: processes, package manager, writers, output channel
```

- `core/` never imports `vscode`. An ESLint `no-restricted-imports` rule enforces this.
- Core functions that need side effects receive them as plain parameters, such as a process runner or a writer. There is no dependency-injection container.
- Component, hook and feature generation share a single `generateArtifact` command handler, driven by a generator registry in `core/generators/index.ts`. Adding a generator means adding one file and one registry entry.

## VS Code integration

- **`engines.vscode`:** `^1.100.0`. Integration tests run on both that version and the current stable release. `@types/vscode` must not be newer than the engine floor.
- **Activation:** contributed commands and views activate the extension automatically, which VS Code has done since 1.74. The one `activationEvents` entry, `workspaceContains:**/react-architect.json`, starts the structure rules when a project is opened (ADR 11).
- **Contributions:**
  - commands in the command palette
  - an `explorer/context` submenu, "React Architect", containing Generate Component, Generate Hook and Generate Feature (`when: explorerResourceIsFolder`)
  - `jsonValidation` for `react-architect.json`
- **`extensionKind: ["workspace"]`:** the extension needs the filesystem and processes on the machine where the project lives.
- **Capabilities:**
  - `virtualWorkspaces: false`
  - `untrustedWorkspaces: { supported: "limited" }`: generating files is allowed in Restricted Mode, but anything that runs the project's own tooling is disabled there.

## Build and dependencies

- **Build:** esbuild bundles the extension into `dist/extension.js` (CommonJS, with `vscode` external). `tsc --noEmit` does type checking.
- **Runtime dependencies:** only `cross-spawn` and `tree-kill`.
  - `cross-spawn` passes argument arrays safely on Windows. Since the April 2024 Node security release (CVE-2024-27980), spawning `npm.cmd` without `shell: true` throws `EINVAL`, and `shell: true` would reintroduce injection risk.
  - `tree-kill` kills the whole process tree on cancel, which matters on Windows because `child.kill()` doesn't.
- **Process output:** each process's output is streamed to a "React Architect" OutputChannel.

## Tests

| Level       | Tool                                                 | Covers                                                                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                                               | `core/` and `infra/`, with snapshot tests of file plans                                                                                                                                                                                        |
| Integration | `@vscode/test-cli` + `@vscode/test-electron` (Mocha) | Commands run against fixture workspaces                                                                                                                                                                                                        |
| End to end  | Vitest (`npm run test:e2e`), without VS Code         | Creates projects in a temp directory with the real create-vite and npm, using the same `core/` and `infra/` code as the command, then runs `build`, ESLint with zero warnings allowed, `test` and `format:check`. Also cancels during install. |

CI runs on GitHub Actions, on Ubuntu, macOS and Windows, with the end-to-end test as a separate job on all three. The weekly drift job from [ADR 3](0003-base-scaffold-with-pinned-create-vite.md) is in `.github/workflows/drift.yml`.

The integration tests for Create React Project fake the programs it runs, so they check the command's questions, cleanup and retry quickly. The end-to-end test covers the real programs.

## Publishing

`@vscode/vsce` publishes to the VS Code Marketplace, and `ovsx` publishes to Open VSX. Both run from `.github/workflows/release.yml` when a `v*` tag is pushed: it checks that the tag matches `package.json`, runs every test including end-to-end, builds the `.vsix` once and publishes that same file to both registries, then attaches it to a GitHub release. Open VSX is skipped when its token isn't configured. The steps that need the owner's accounts are in [docs/PUBLISHING.md](../PUBLISHING.md).

The `.vsix` holds only the bundle, `package.json`, README, changelog, licence, schema and icon (`.vscodeignore` is an allowlist). Runtime dependencies are bundled by esbuild, so packaging uses `--no-dependencies`. The integration tests also pass against the minified production bundle.
