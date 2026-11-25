# 3. New projects start from create-vite at a pinned version

**Status:** Accepted

## Context

Vite already maintains a working React + TypeScript base: build config, tsconfig files and `index.html`. Re-creating that base means maintaining it. Running `create-vite@latest`, on the other hand, means upstream changes to templates or prompts can break our overlay without warning.

## Decision

Run create-vite at an exact pinned version with the `react-ts` template, then apply our overlay.

- **Invocation:** run from the parent directory, with the project name as its own argv element and no shell string. The planned form is `npm exec --yes --package=create-vite@<exact> -- create-vite <name> --template react-ts`, plus the version's non-interactive flag. Third-party sources disagree about what `-i` means, so we use long-form flags only. In Phase 3, confirm the exact argv against `--help` for the pinned version and record it here.
- **Overlay policy:** files we change are replaced wholesale, never patched with string edits. The one exception is `package.json`, which is parsed as JSON, merged (dependencies, devDependencies, scripts) and written back with 2-space indentation.
- **Files we keep as generated:** `index.html`, `public/`, `tsconfig*.json`, `.gitignore`.
- **Files we replace:** `src/**`, `vite.config.ts`, `eslint.config.js`.
- **Drift detection:** a weekly scheduled CI job runs the end-to-end test against `create-vite@latest`. A failure means the pin needs a deliberate update; it never updates silently.

## Consequences

- We get Vite's maintained build configuration for free.
- Project creation needs network access to the npm registry. Dependency installation needs it anyway, so this adds no new requirement.

## Revisit when

The overlay replaces most of what create-vite produces, or drift forces two breaking overlay changes within six months. Either one means it's time to ship our own base template instead.
