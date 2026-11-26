# Plan: custom project structures

**Status:** All six phases are built. Phase 1 is recorded in [ADR 12](../adr/0012-structure-as-data.md), Phases 2–6 in [ADR 13](../adr/0013-choosing-and-enforcing-structures.md). Still open: publishing the CLI to npm, and with it a `check:structure` script in generated projects.

## Summary

Today React Architect knows one structure: feature-based, with two fixed rules (ADR 11). This plan lets each project define its own structure, with these sources and safeguards:

- **Sources:** a ready-made style, a folder-tree file the user uploads, or an existing project to copy.
- **In the editor:** the rules, the Project Map and the generators all follow that structure from then on.
- **Outside the editor:** a command-line check enforces it, so it holds for a whole team, not just people who have the extension installed.

The work is split into six phases. Each one ships on its own and leaves the extension working.

| Phase | What users get                                                                    | Size         |
| ----- | --------------------------------------------------------------------------------- | ------------ |
| 1     | Nothing visible: the rules engine works from a structure description              | 2 sessions   |
| 2     | **Choose Structure:** ready-made styles, reviewed before they're applied          | 1–2 sessions |
| 3     | **Import Structure:** from an uploaded folder-tree file, or from another project  | 2 sessions   |
| 4     | Files in the wrong place and badly named files are flagged, with a one-click move | 1–2 sessions |
| 5     | Generate Component, Hook, Feature and Page follow the structure                   | 2 sessions   |
| 6     | `react-architect check` for CI, with a baseline so existing projects can adopt it | 2 sessions   |

## Concepts

These terms are used throughout this plan, and later in the docs and messages users see.

- **Layer:** a named part of the project, with one or more folders. For example `shared` = `src/components` + `src/hooks`.
- **Unit:** one folder inside a layer whose path ends in `/*`. Each feature in `src/features/*` is a unit of the `features` layer.
- **Entry:** a unit's front door, usually `index.ts`. Code outside a unit may import only its entry.
- **May import:** which layers a layer may depend on. This sets which way dependencies point.
- **Siblings:** how units of the same layer may use each other: only through their entry, not at all, or freely.
- **Unit template:** the folders every unit should contain (for example `components/`, `hooks/`, `api/`). Generate Feature uses it.

## The structure description

A new optional `structure` section in `react-architect.json`. It doesn't change `manifestVersion`: older versions of the extension warn about the unknown field and keep working.

```jsonc
{
  "manifestVersion": 1,
  "structure": {
    "layers": [
      {
        "name": "app",
        "paths": ["src/app"],
        "mayImport": ["pages", "features", "shared"],
      },
      {
        "name": "pages",
        "paths": ["src/pages/*"],
        "mayImport": ["features", "shared"],
        "entry": "index.ts",
        "siblings": "none",
      },
      {
        "name": "features",
        "paths": ["src/features/*"],
        "mayImport": ["shared"],
        "entry": "index.ts",
        "siblings": "entry",
        "unitTemplate": [
          "components/",
          "hooks/",
          "api/",
          "types.ts",
          "index.ts",
        ],
      },
      {
        "name": "shared",
        "paths": ["src/components", "src/hooks", "src/lib", "src/utils"],
        "mayImport": [],
      },
    ],
    "ignore": ["**/*.test.*", "**/*.stories.*", "src/test/**"],
    "unlisted": "allowed",
    "naming": [{ "files": "**/hooks/*.ts", "pattern": "use[A-Z]*" }],
  },
  "rules": {
    "layers": "error",
    "entry": "error",
    "siblings": "warning",
    "placement": "warning",
    "naming": "warning",
  },
}
```

### Matching rules

- **Paths:** each segment is literal, except a final `*`, which means "each folder here is a unit". Deeper wildcards (`a/*/b/*`) aren't supported in this plan.
- **Which layer a file belongs to:** the longest matching path wins. So with `src/features/*` and `src/features/admin/*` both listed, `src/features/admin/users/x.ts` belongs to the second.
- **Imports always allowed:** within a layer (or a unit) itself, and to and from files matched by `ignore`. Tests and stories can therefore reach anywhere.
- **Unlisted files** (in no layer): `"allowed"` means they're not checked at all, which is today's behaviour for `src/utils` and similar. `"warning"` and `"error"` report them under the `placement` rule.
- **`mayImport` excludes the layer itself:** imports within the same layer are always allowed, so for a layer with units, the `siblings` setting decides how units may use each other.

### The rules

| Rule        | Problem it reports                                                                     | Replaces (ADR 11)          |
| ----------- | -------------------------------------------------------------------------------------- | -------------------------- |
| `layers`    | `A` imports from layer `B`, which isn't in `A.mayImport`                               | `sharedCode`               |
| `entry`     | An import into another unit doesn't go through its entry                               | `featureInternals`         |
| `siblings`  | Units of the same layer use each other in a way the layer's `siblings` setting forbids | part of `featureInternals` |
| `placement` | A file is in no layer (when `unlisted` isn't `"allowed"`), or breaks the unit template | new                        |
| `naming`    | A file name doesn't match its `naming` pattern                                         | new                        |

### Staying compatible

- **No `structure` section:** the engine builds a default structure from `paths`. `features` = `paths.features/*` with entry `index.ts` and siblings `"entry"`, and `shared` = `paths.components` + `paths.hooks` with `mayImport: []`. Everything else stays unlisted and allowed.
- **Same results as today:** with the default structure, the new engine must report exactly what the current rules report. Phase 1's main test proves it by running the existing rule tests unchanged against the new engine.
- **Old setting names:** `rules.featureInternals` and `rules.sharedCode` stay accepted as aliases for `entry` and `layers`. If both an alias and the new name are set, the new name wins, and the user gets a warning.

## Phase 1: the engine works from a structure (done)

The goal is a refactor with no visible change: the same problems are reported, but they're computed from a `Structure`.

**Code:**

- `src/core/structure/model.ts`: the `Structure` and `Layer` types, `defaultStructure(manifest)`, and `classify(file, structure)`, which returns `{ layer, unit?, ignored }`.
- `src/core/structure/rules.ts`: the `layers`, `entry` and `siblings` rules (placement and naming come in Phase 4), replacing `checkImports` in `core/architecture/boundaries.ts`. The `Violation` type gains a `rule` from the new list, and keeps everything else, so the quick fix, squiggles and map don't change.
- `src/core/manifest/schema.ts` and `schemas/react-architect.schema.json`: the `structure` section, its validation, and the old rule names as aliases.
- `core/architecture/graph.ts`: groups by unit and layer instead of "feature", keeping the `features` list for the default structure.

**Validation errors to report clearly:**

- a `mayImport` entry naming a layer that doesn't exist
- the same path listed in two layers
- a path that is invalid (same rules as `paths` today)
- `entry` set on a layer without `*`

**Tests:**

- every existing test in `architecture.test.ts` passes against the new engine, through the default structure
- unit tests for `classify`: longest match, ignored files, unlisted files
- each rule, with an example of it firing and an example where it doesn't
- JSON Schema and validator agreement for the new section (as in `manifest-schema.test.ts`)

**Done when:** all existing unit and integration tests pass unchanged, and the new tests pass.

## Phase 2: Choose Structure (ready-made styles) (done)

**What the user does:** runs **React Architect: Choose Structure**, picks a style, reviews the change, and applies it.

**The styles** live in `src/core/structure/presets.ts` and are tested like templates:

| Style                    | Layers, from top to bottom                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Feature-based (today)    | features (units, entry, siblings through entry) → shared                                  |
| Feature-based with pages | app → pages → features → shared                                                           |
| Layered (by kind)        | pages → components → hooks → services → utils, all without units                          |
| Feature-Sliced Design    | app → pages → widgets → features → entities → shared; slices are units, siblings `"none"` |

**Reviewing before applying:**

1. The command builds the new `react-architect.json` text with `structure` filled in.
2. It opens `vscode.diff` between the current file and the proposed one, served by a read-only `TextDocumentContentProvider` under the `react-architect-proposal:` scheme.
3. A notification asks **Apply** or **Cancel**. Apply writes the file through the normal file plan writer.
4. Before applying, it counts how many problems the project would have under the new structure, and shows that count in the notification: "Apply? 14 existing files would break the new rules." That way the user isn't surprised by a wall of squiggles.

**Project Map:** with a custom structure, the top level shows layers, and each layer shows its units or folders. The default structure keeps today's view.

**Create React Project:** this phase doesn't change project creation. Adding a style choice there is a follow-up, because the overlay templates (ADR 7) only produce the feature-based layout.

**Done when:** each style applies cleanly to a fresh generated project, and an integration test covers the diff-and-apply flow.

## Phase 3: Import Structure (uploaded file or another project) (done)

**What the user does:** runs **React Architect: Import Structure…** and picks one:

- **From a file…:** an open-file dialog for `.txt`, `.md` or `.json`.
- **From another project…:** a folder picker.

Both go through the same pipeline:

```
input → folder list → classify folders → ask about unknown folders → Structure → review (Phase 2) → apply
```

### Reading a tree file

`src/core/structure/treeFile.ts` accepts the formats people actually paste:

- **Drawn trees,** as printed by the `tree` command or written in docs, using `├──`, `└──`, `│` or ASCII `|--` and `` `-- ``. Depth comes from where the name starts in the line.
- **Indented lists:** spaces or tabs, optionally with `-` or `*` bullets.
- **One path per line:** `src/features/auth/components`.
- **Comments and decorations:** anything after `#` or `//` is ignored. A trailing `/` marks a folder; a name containing a dot is a file.
- **A JSON file** containing a `structure` object, or a whole `react-architect.json`, is used as-is, after validation.

The parser returns the folders and files with their full paths. It never guesses depth from a malformed line: it reports the line number and what it expected.

### Reading another project

`infra/projectFiles.ts` lists folders (not files) up to 5 levels deep, plus the file names directly inside unit folders, skipping the same folders as the project index. The result is the same folder list a tree file produces.

### Classifying folders

`src/core/structure/infer.ts` turns the folder list into layers:

1. **Units:** a folder named like a unit container (`features`, `modules`, `domains`, `entities`, `widgets`, `slices`, `pages` when its children have their own subfolders) has its children treated as example units. The layer path becomes `parent/*`, and the unit template is the folders and files that the example units have in common. If there's only one example, all of its contents are used.
2. **Known folder names** map to layers in this order, top to bottom:
   `app` → `pages`/`routes`/`screens` → `widgets` → `features`/`modules`/`domains` → `entities` → `shared`, where `shared` covers `components`, `ui`, `hooks`, `lib`, `utils`, `services`, `api`, `types`, `styles`, `assets`, `config` and `constants`. Each layer may import every layer below it.
3. **Entry:** an `index.ts`, `index.tsx` or `index.js` appearing in every example unit becomes the entry.
4. **Ignore list:** test and story file patterns are added to `ignore` by default.
5. **Unknown folders** (names not in the list): the user is asked, one QuickPick per folder, at most 10:
   - "Part of shared code"
   - "Its own layer, above … / below …"
   - "Ignore it"

The inferred structure always goes through the Phase 2 review, so nothing is applied without the user seeing the exact JSON.

**Tests:**

- a fixture tree file for each supported format, all producing the same folder list
- the folder tree from the original proposal, which must infer `app → features → shared` with a `features/*` unit template of `components/ hooks/ services/ types/ index.ts`
- a Feature-Sliced Design example tree, which must infer the six layers in order
- malformed input, which must produce line-numbered errors

**Done when:** importing the original proposal's tree into a fresh generated project gives a structure with zero problems, and an integration test covers the file and folder pickers with scripted answers.

## Phase 4: placement and naming (done)

**Rules:** the `placement` and `naming` rules from the table above. Placement also checks the unit template: a unit missing a template folder is not a problem, but a file in a unit outside every template folder is. For example, a hook at `features/cart/useCart.ts` when the template says `hooks/`.

**Quick fixes:**

- **Wrong place:** "Move to `features/cart/hooks/`". The suggestions are the template folders and the layers whose names fit the file's kind. It reuses the move engine from ADR 11, generalised from `planMoveToShared(folder, destination)` to `planMove(source, destination)` for both files and folders, so every import is updated.
- **Wrong name:** "Rename to `useCart.ts`", using Rename Feature's name machinery for the file and its declared name.

**Structure report:** a **React Architect: Show Structure Report** command opens a Markdown preview with:

- problem counts per rule and per layer
- the files with the most problems
- for each kind of problem, the fix

It's generated from the same project map, and is mainly useful right after Choose or Import Structure on an existing project.

**Done when:** the fixes have integration tests, and a moved file has no remaining problems.

## Phase 5: generators follow the structure (done)

- **Which folder:** Generate Component, Hook and Page use the layer folders. When more than one layer could hold a component (for example `shared/ui` and `widgets/*`), the command asks which, with the clicked folder's layer first.
- **Generate Feature:** creates a unit in the layer the user picks (or the only unit layer). It creates every folder in the unit template, and puts each generated file in the template folder for its kind:
  - component → `components`/`ui`
  - hook → `hooks`/`model`
  - API service → `api`/`services`
  - types → `types`/`model`, or `types.ts` when the template has that file
  - the entry → the layer's `entry`
- **Missing template folders:** if the template has no folder for a kind, the generator falls back to today's folder names and says so in the preview.
- **No dead code:** empty template folders get no placeholder files. Git doesn't keep empty folders, so they're created only when something goes in them (ADR 7).
- **Respecting the rules:** generated imports must satisfy the structure. A test generates every artifact under each preset and checks there are zero problems.

**Done when:** for each preset, generating one of everything produces zero problems.

## Phase 6: the CI check (done)

**Why:** squiggles only appear for people who have the extension. To make a structure strict "from now on" for a team, the same check has to run where code is merged.

**The command:** `npx react-architect check`.

- **How it's built:** `src/cli/check.ts`, bundled by esbuild into `dist/cli.js`. It reuses `core/` as-is; the ESLint rule that keeps `vscode` out of `core/` is what makes this possible. It reads files with `node:fs`, using the same skip list as the project index.
- **What it prints:** each problem as `path:line:column  message  [rule]`. `--format github` prints GitHub Actions annotations instead (`::error file=…,line=…::…`), so problems appear on the pull request's changed lines.
- **Exit codes:** 1 when there's an error-severity problem, 0 otherwise. `--max-warnings 0` makes warnings fail too.
- **How it's distributed:** an npm package, separate from the `.vsix`. Its name is still to be decided, since `react-architect` may be taken on npm.

**Baseline**, so existing projects can adopt it:

- `react-architect check --update-baseline` writes `react-architect-baseline.json`, listing current problems by file, rule and import target (not line numbers, which shift).
- `check` then fails only on problems that aren't in the baseline. Problems that get fixed are dropped the next time the baseline is updated.
- The editor shows baselined problems with a lower severity (Information) and the note "existing problem, in the baseline".

**Generated projects** get a `check:structure` script. Their README explains how to add it to CI.

**Done when:**

- the e2e test runs `check` on each generated project and it passes
- a fixture with a known problem makes it fail, with the expected output in both formats
- the baseline lets old problems pass and new ones fail

## Decisions to make before starting

| Question                                                                | Recommendation                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Default severity for a newly chosen or imported structure?              | `"warning"`, with the review step offering "Make the rules errors" as a second button                                  |
| Should `unlisted` default to `"allowed"`?                               | Yes. Flagging every file outside the listed layers is too noisy for a first run                                        |
| npm package name for the CLI?                                           | Check availability when Phase 6 starts; fall back to a scoped name                                                     |
| Support deeper wildcards (`a/*/b/*`)?                                   | No, until someone needs it. Longest-match on single-level units covers the presets                                     |
| Generate ESLint rules (e.g. eslint-plugin-boundaries) instead of a CLI? | No. A CLI reuses the exact engine, so the editor and CI can never disagree, and it adds no dependency to user projects |

## Risks

| Risk                                                     | How the plan handles it                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Inference guesses a structure wrong                      | Every inferred structure is shown as a diff before it's applied, and unknown folders are always asked about |
| A new structure floods an existing project with problems | The problem count is shown before applying; warnings by default; baseline (Phase 6)                         |
| The new engine changes today's behaviour                 | Phase 1 runs the existing rule tests unchanged against the default structure                                |
| Large repositories get slow                              | Same 5000-file limit and skip list as the index; classification is a path lookup per file                   |
| Monorepos with different structures per package          | Each `react-architect.json` has its own `structure`; the nearest one wins, as today (ADR 1)                 |
| Path aliases (`@/`) hide which layer an import points to | Imports are already resolved through tsconfig `paths` before classification (ADR 11)                        |
