# 11. Keeping the structure: rules, map, pages and refactoring

**Status:** Accepted

## Context

The extension helps a project start well organised, but a project's structure usually erodes over time. Features import each other's private files, shared components start depending on features, and renaming or moving code is risky enough that people stop doing it. Four features address this. They all need to understand a project's imports, and some need to edit code safely.

## Decisions

### Reading code: TypeScript's parser, bundled

All four features read source files with the `typescript` package's parser (`ts.createSourceFile`). The parser only reads syntax: nothing is type-checked, and no other file is opened. That makes it fast and independent of the project's own TypeScript setup, and it handles comments, strings, JSX, type-only imports and dynamic `import()` correctly, which regular expressions wouldn't.

`typescript` becomes a runtime dependency, bundled by esbuild. The bundle grows from a few kilobytes to about 3.5 MB (roughly 1 MB inside the `.vsix`). Using the project's own TypeScript instead was rejected because a project might not have TypeScript installed, might have a different version, or might be untrusted.

Imports are resolved from their paths alone: relative paths, plus the shortcuts in `compilerOptions.paths` of `tsconfig.json` and `tsconfig.app.json` (for example `@/*`). No disk access is needed to decide which feature an import points to.

### Structure rules

Two rules (renamed `entry` and `layers`, and generalised, in [ADR 12](0012-structure-as-data.md)), each configurable in `react-architect.json` under `rules` as `"warning"` (the default), `"error"` or `"off"`:

- **`featureInternals`:** code outside a feature may only import the feature itself, meaning its folder or its `index.ts`, never a file inside it.
- **`sharedCode`:** files in `paths.components` and `paths.hooks` must not import from any feature.

The default is a warning rather than an error, because the rules also run on existing projects that never followed them, and a wall of red would be discouraging.

Problems appear as squiggles and in the Problems panel for every file in the project, not just open ones, and they update as you type. The quick fix for `featureInternals` rewrites the import to point at the feature, and adds any missing names to the feature's `index.ts` (creating it if needed). It's offered only for `import { ... }` and `export { ... } from` statements; for other forms the fix would have to change more than the path.

### Project Map

A view in its own activity bar container lists every feature with what it shares (its `index.ts` exports), which features it uses, who uses it, and its rule problems. It also lists dependency cycles between features, found with Tarjan's strongly connected components algorithm and shown as one concrete loop per cycle. Everything links to the line of code involved.

The index behind the squiggles and the map (`editor/projectIndex.ts`) reads every source file once, then updates single files when they change on disk or in an editor. It skips `node_modules`, build output and hidden folders, and stops after 5000 files.

### Generate Page

A page lives in a feature, at `features/<name>/pages/<Name>Page.tsx`, and is exported from the feature's `index.ts`. That way the routes file imports it through the feature's public API, which keeps the `featureInternals` rule satisfied. The route is added by reading the routes file as code:

- It finds the array passed to `createBrowserRouter` (or `createHashRouter`, `createMemoryRouter`, `useRoutes`), following a variable if needed.
- When exactly one layout route has `children`, the new route goes there, with a relative path. Otherwise it goes in the top-level list.
- It keeps the file's indentation and trailing commas. A list that was all on one line is rewritten one route per line, the way Prettier would.
- If the route already exists, or the file isn't recognised, the page is still created, and the user is told what to add by hand. It never guesses.

The change to the routes file is a new file plan operation, `edit`, which records the text it was worked out from. The writer refuses to apply it if the file has changed since.

### Rename Feature and Move to Shared Components

Both compute every change up front from the files on disk (unsaved files must be saved first), show a preview, and apply everything as a single `WorkspaceEdit`.

- **Paths:** every import that points into the moved folder, and every relative import inside it, is rewritten for the new locations. The specifier's style is kept, relative or `@/`.
- **Names (Rename Feature only):** files, folders and declared names made from the old feature name are renamed on word boundaries: `UserProfile` → `Account`, `useUserProfile` → `useAccount`, `userProfileApi.ts` → `accountApi.ts`. `UserProfiles` stays, because it's a different word. Names a file imports from outside the feature are never renamed. A re-export elsewhere keeps its public name (`export { Account as UserProfile }`), so code further away doesn't break.
- **Order:** renames come first in the edit, then the text changes on the files at their new paths. The other way round, VS Code can lose the text changes to a file renamed in the same edit, which the integration tests caught.
- **Warnings (Move to Shared Components):** the preview warns when the moved code imports from a feature, because shared code would then depend on that feature.

Strings, comments and stylesheets are not changed. The preview says so.

## Consequences

- The extension is about 3.5 MB larger.
- The structure rules run only when a project has a `react-architect.json`, and the extension activates for workspaces that contain one.
- Renaming is name-based rather than type-based. It covers what generated code and ordinary projects do, but a shadowed local variable with the same name as a renamed export would also be renamed. The preview lists every name that changes.
