# Changelog

## 0.1.0

First release.

- **Create React Project:** React, TypeScript and Vite with a feature-based layout, ESLint and Prettier. Choose the styling (CSS Modules, Tailwind CSS, plain CSS or no CSS files), tests, routing, `@/` imports, folder names, package manager (npm, pnpm or Yarn) and a git repository with a first commit. Progress can be cancelled, a half-made folder can be deleted, and a failed install can be retried.
- **Generate Component, Hook, Feature and Page** from the Command Palette or the Explorer's folder menu, with a preview before writing, overwrite or skip for existing files, and optional exports from a feature's `index.ts`. Generate Page also adds the page to the React Router routes.
- **Set Up Existing Project:** suggests a `react-architect.json` based on the project's folders and tools.
- **Structure rules:** warnings (or errors, if you choose) for imports that reach inside another feature, or make shared code depend on a feature, shown as you type. A quick fix imports from the feature instead and updates its `index.ts`. Configure them under `rules` in `react-architect.json`.
- **Project Map:** a view listing every feature, what it shares, which features use which, rule problems and dependency cycles.
- **Rename Feature** and **Move to Shared Components**, which update every import in the project in one step.
- **Custom structures:** describe the project's layers in `react-architect.json` under `structure`, and the rules, Project Map and generators follow them. The rules are `layers`, `entry`, `siblings`, `placement` and `naming`.
  - **Choose Structure:** four ready-made styles (feature-based, feature-based with pages, layered, Feature-Sliced Design), shown as a diff with a problem count before anything changes.
  - **Import Structure:** from a folder-tree file (drawn, indented, path list or Markdown), a JSON structure, or another project.
  - **Placement and naming:** files in the wrong place or with the wrong name are flagged, and the lightbulb moves or renames them, updating imports.
  - **Show Structure Report:** a summary of problems by rule, layer and file.
- **`react-architect check`:** the same rules from the command line for CI, with GitHub annotations and a baseline so only new problems fail. It's in the repository; it isn't published to npm yet.
- Autocomplete and checking for `react-architect.json`.
