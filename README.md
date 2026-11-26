# React Architect

Create React projects with a clear, feature-based structure, then keep adding components, hooks and features that follow the same conventions. Everything happens inside VS Code.

## Features

### Create a React project

Run **React Architect: Create React Project** from the Command Palette, or click **Create React Project** in the Explorer when no folder is open.

Every project gets React, TypeScript and Vite, a feature-based `src/` layout with a starter `home` feature, and ESLint and Prettier set up to agree with each other. You choose the rest:

| Choice          | Options                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Styling         | CSS Modules, Tailwind CSS, plain CSS, or no CSS files at all                                       |
| Tests           | Vitest and React Testing Library with passing starter tests, or no tests                           |
| Routing         | React Router with a page layout, or none                                                           |
| Imports         | `@/features/home` instead of `../../features/home`, or relative imports                            |
| Folders         | the standard `src/components`, `src/hooks` and `src/features`, or your own names, such as `src/ui` |
| Package manager | npm, pnpm or Yarn (whichever are installed)                                                        |
| Git             | start as a git repository with a first commit, or not                                              |
| Install         | install packages now, or later                                                                     |

Whatever you choose, the project builds, lints and is formatted from the start, and its tests pass if it has them.

Every step shows its progress and can be cancelled. If a step fails, React Architect offers to delete the half-made folder, but only a folder it created itself. If package installation fails, you keep the project and can retry.

### Generate code that fits the project

Right-click a folder in the Explorer and choose **React Architect**, or use the Command Palette:

- **Generate Component:** `UserCard/UserCard.tsx`, with a CSS Module and a test
- **Generate Hook:** `useCart.ts`, with a test
- **Generate Feature:** a folder with a component, hook, API service, types, and an `index.ts` that is the feature's public API

You can type names any way you like (`user card`, `userCard`, `user-card`), and React Architect names files consistently. Before writing anything, it shows every file it will create or change. If files already exist, you choose whether to overwrite or skip them. Names that differ only in capital letters are refused, because they clash on macOS and Windows.

When you generate a component or hook inside a feature, React Architect can also export it from that feature's `index.ts`, without ever adding the same export twice.

- **Generate Page:** `SettingsPage.tsx` in a feature's `pages/` folder, exported from the feature's `index.ts`, and added to your React Router routes (`/settings`). If your routes file looks unusual, the page is still made and you're told the one line to add.

### Keep the structure as the project grows

**Structure rules.** As you type, React Architect flags imports that break the project's structure, with a squiggle and an entry in the Problems panel:

- code that reaches inside another feature instead of using its `index.ts`
- shared components and hooks that depend on a feature

For the first kind, the lightbulb fixes it: the import is changed to use the feature, and anything missing is added to the feature's `index.ts`.

**Project Map.** Click the React Architect icon in the Activity Bar to see every feature: what it shares, which features it uses, who uses it, and its problems. Features that depend on each other in a loop are listed as dependency cycles. Click any entry to jump to the code.

**Rename Feature.** Right-click a feature folder (or a feature in the Project Map) and rename it. The folder, the files and names made from it (`UserProfile`, `useUserProfile`, `userProfileApi.ts`) and every import in the project are updated in one step. You see the full list of changes first.

**Move to Shared Components.** Right-click a component folder inside a feature to move it to your shared components. Imports to and from it are updated, and you're warned if the moved component still depends on the feature.

### Use your own structure

The feature-based layout is only the default. Run **Choose Structure** (in the Command Palette, or the `⋯` menu of the Project Map) to pick another:

- **Feature-based**, with each feature used through its `index.ts`
- **Feature-based with pages**: app → pages → features → shared
- **Layered by kind**: pages → components → hooks → services → utils
- **Feature-Sliced Design**: app → pages → widgets → features → entities → shared, with slices that can't use each other

Or run **Import Structure** to use your own:

- **From a file:** a folder tree, drawn (`├──`), indented, or one path per line, in a `.txt` or `.md` file. Example units such as `features/auth/components/` teach React Architect what every feature contains. If a folder's name isn't one it knows, you're asked what that folder is.
- **From another project:** its folders, or its `react-architect.json` if it has one.

Either way, you see the change to `react-architect.json` side by side, and how many problems the project would have, before anything is written. From then on:

- the rules follow your layers
- files in the wrong place or with the wrong name are flagged, and the lightbulb moves or renames them
- the Project Map groups by layer
- Generate Feature and Generate Page put files where your structure says

**Show Structure Report** summarises what still doesn't fit.

### Check it in CI

The same rules run from the command line, so a team's structure holds even for people without the extension:

```sh
react-architect check                    # fails on errors; prints each problem
react-architect check --format github    # annotations on the pull request's lines
react-architect check --max-warnings 0   # fail on warnings too
react-architect check --update-baseline  # record today's problems; from now on only new ones fail
```

The command isn't published to npm yet. Until it is, build it with `npm run build` and run `node dist/cli.js check`.

### Works with existing projects

**Set Up Existing Project** looks at your project and suggests settings: which folders you already use, whether you use another styling library, and whether Vitest and Testing Library are installed. You see each suggestion with its reason before anything is written. The same happens the first time you generate code in a project.

## The settings file

Each project has a `react-architect.json` next to its `package.json`. VS Code gives you autocomplete and checks for it.

```json
{
  "manifestVersion": 1,
  "language": "typescript",
  "architecture": "feature-based",
  "styling": "css-modules",
  "paths": {
    "components": "src/components",
    "hooks": "src/hooks",
    "features": "src/features"
  },
  "testing": {
    "framework": "vitest",
    "generateTests": true
  },
  "rules": {
    "layers": "warning",
    "entry": "warning",
    "siblings": "warning"
  }
}
```

| Setting                 | What it controls                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `styling`               | `"css-modules"` adds a `.module.css` to each component, `"plain-css"` a `.css` file; `"tailwind"` and `"none"` add no stylesheet.                                     |
| `paths`                 | Where each kind of code goes, relative to the settings file.                                                                                                          |
| `testing.framework`     | `"vitest"` generates tests; `"none"` turns them off.                                                                                                                  |
| `testing.generateTests` | The default answer when you're asked whether to include a test.                                                                                                       |
| `rules.entry`           | `"warning"` (default), `"error"` or `"off"`: code outside a feature must use its `index.ts`. Was called `featureInternals`, which still works.                        |
| `rules.layers`          | `"warning"` (default), `"error"` or `"off"`: shared components and hooks must not import from features. Was called `sharedCode`, which still works.                   |
| `rules.siblings`        | `"warning"` (default), `"error"` or `"off"`: with a custom `structure`, units of a layer that must stand alone use each other.                                        |
| `rules.placement`       | `"warning"` (default), `"error"` or `"off"`: with a custom `structure`, files outside a unit's template, or outside every layer when `unlisted` is `"reported"`.      |
| `rules.naming`          | `"warning"` (default), `"error"` or `"off"`: with a custom `structure`, file names that break its `naming` patterns.                                                  |
| `structure`             | Optional: your own layers, which may import which, what each unit contains, and naming patterns. Easiest to set with Choose Structure or Import Structure; see below. |

In a monorepo, each package can have its own `react-architect.json`. The nearest one wins.

## Requirements

- VS Code 1.100 or newer
- To create projects: Node.js 22.22.2 or newer on 22.x, 24.15 or newer on 24.x, or 26 and newer. React Architect checks this before it starts.

## Known limitations

- Generated code is TypeScript only.
- Only the feature-based layout is supported so far.
- Generated tests use Vitest; projects that use Jest get no generated tests.
- Rename Feature doesn't change text in strings, comments or stylesheets.
- The structure rules read at most 5000 files per project, and skip `node_modules`, build output and hidden folders.
