# 8. How the extension itself is built, structured and tested

**Status:** Accepted

## Structure

```text
src/
├── extension.ts   # registers commands only
├── commands/      # VS Code UI: prompts → input object → core → show result
├── core/          # pure logic: naming, manifest, plans, generators, templates, project steps
└── infra/         # side effects: processes, package manager, writers, output channel
```

- `core/` never imports `vscode`. An ESLint `no-restricted-imports` rule enforces this.
- Core functions that need side effects receive them as plain parameters, such as a process runner or a writer. There is no dependency-injection container.
- Component, hook and feature generation share a single `generateArtifact` command handler, driven by a generator registry in `core/generators/index.ts`. Adding a generator means adding one file and one registry entry.

## VS Code integration

- **`engines.vscode`:** `^1.100.0`. Integration tests run on both that version and the current stable release. `@types/vscode` must not be newer than the engine floor.
- **Activation:** there are no `activationEvents`. Contributed commands activate the extension automatically, which VS Code has done since 1.74.
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

| Level       | Tool                                                 | Covers                                                                                                                             |
| ----------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                                               | `core/` and `infra/`, with snapshot tests of file plans                                                                            |
| Integration | `@vscode/test-cli` + `@vscode/test-electron` (Mocha) | Commands run against fixture workspaces                                                                                            |
| End to end  | A Node script, without VS Code                       | Creates a project in a temp directory using the same `core/` code, then runs `install`, `build`, `lint`, `test` and `format:check` |

CI runs on GitHub Actions, on Ubuntu, macOS and Windows. It also runs the weekly drift job from [ADR 3](0003-base-scaffold-with-pinned-create-vite.md).

## Publishing

`@vscode/vsce` publishes to the VS Code Marketplace, and `ovsx` publishes to Open VSX. Check that the extension name is available before the first publish.
