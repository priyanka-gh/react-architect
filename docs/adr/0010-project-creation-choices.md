# 10. Choices when creating a project

**Status:** Accepted. Extends [ADR 7](0007-generated-project-stack.md).

## Context

The first version made every project the same way: CSS Modules, tests, npm, standard folders. People wanted to leave out tests, use Tailwind, or have no CSS files at all, and to choose more of the setup themselves.

## Decision

**Create React Project** asks for these, in this order:

1. **Name**
2. **Styling**, one of:
   - CSS Modules (recommended): a `.module.css` next to each component
   - Tailwind CSS: utility classes, no stylesheet per component
   - Plain CSS: a `.css` next to each component, with an ordinary class name such as `user-card`
   - No CSS files: no stylesheets at all, not even a global one
3. **One checklist** of yes/no options, all ticked by default: routing, tests, `@/` imports, git repository, install packages. One screen keeps the flow short; anything unticked is off.
4. **Package manager:** only asked when pnpm or Yarn is installed. The choices are whichever of npm, pnpm and Yarn run on the machine.
5. **Folders:** the standard ones, or custom names for components, hooks and features.

The rules behind each choice:

- **Styling** is stored in the manifest (`css-modules`, `tailwind`, `plain-css` or `none`), so later generated components match. `tailwind` and `none` generate the same component files; `tailwind` also records that Tailwind is set up.
- **Tailwind** is Tailwind 4: `tailwindcss` and `@tailwindcss/vite`, the plugin added to `vite.config.ts`, and `@import "tailwindcss";` in `src/styles/global.css`.
- **No tests** means no Vitest, Testing Library or jsdom, no test scripts, no `src/test/`, no test files, `defineConfig` from `vite` rather than `vitest/config`, and `testing.framework: "none"` in the manifest.
- **`@/` imports:** `"@/*": ["./src/*"]` in `tsconfig.app.json` and a matching `resolve.alias` in `vite.config.ts`. Starter files use `@/` only for imports that leave their own folder. `tsconfig.app.json` has comments, so it is replaced wholesale with create-vite 9.3.4's content plus `paths`, never patched (ADR 3).
- **Custom folders** must be inside `src/` (Vite's tsconfig only covers `src/`), mustn't overlap each other, and mustn't use `src/app`, `src/styles`, `src/test` or `src/assets`, which the starter files use. Starter imports are computed from the chosen folders.
- **Package manager:** create-vite always runs through `npm exec`, because npm comes with Node.js. The chosen package manager installs and runs the format script.
  - pnpm installs with `--no-frozen-lockfile`. In CI it otherwise refuses to create the lockfile a new project doesn't have yet.
  - Yarn installs with no flags, because Yarn 1 and Yarn 2+ accept different ones, and with `YARN_ENABLE_IMMUTABLE_INSTALLS=false` for the same CI reason; Yarn 1 ignores that variable.
  - Yarn projects get a `.yarnrc.yml` with `nodeLinker: node-modules`. Yarn 2+ otherwise uses Plug'n'Play, which VS Code's TypeScript and ESLint support doesn't understand without extra setup. Yarn 1 ignores the file. They also get `.gitignore` entries for `.yarn/`.
- **Git** runs last, so the first commit holds the finished, formatted project: `git init`, `git add --all`, `git commit`. It never fails project creation; it produces a warning instead when:
  - git isn't installed
  - the folder is already inside a repository (no nested repository is created)
  - the commit fails, usually because git doesn't know the person's name and email; the warning says how to fix that.

## Pinned versions

New projects get exact versions from `src/core/project/dependencies.ts`. **Only pin versions that are at least 7 days old.**

- Brand-new releases are the likeliest to be broken or tampered with.
- Yarn 2+ refuses versions younger than a day by default (`npmMinimalAgeGate`, 1440 minutes). This came up on 2026-11-26, when `vitest@5.1.2` was 18 hours old.

## Consequences

- The overlay has many combinations. A unit test builds all 32 combinations of styling, tests, routing and `@/` imports, checks each plan, and runs every file through Prettier. The end-to-end test builds, lints, tests and format-checks four real projects that cover every styling option and package manager:
  - **recommended:** CSS Modules, tests, routing, `@/` imports, git, npm
  - **tailwind:** Tailwind, no tests, custom folders, pnpm
  - **plain-css:** plain CSS, relative imports, Yarn
  - **bare:** no CSS files, no tests, no routing

  It skips the pnpm and Yarn projects when those aren't installed. CI installs both.

- Yarn 2+ was tested by hand (4.19, in CI mode). CI only runs Yarn 1, because that's what installs globally from npm.
