# 13. Choosing, importing and enforcing a structure

**Status:** Accepted. This covers Phases 2–6 of [the custom structure plan](../plans/custom-structure.md); ADR 12 covers Phase 1.

## Decisions

### Choose Structure and Import Structure (Phases 2–3)

- **Ready-made styles** live in `core/structure/presets.ts`:
  - Feature-based (what new projects use)
  - Feature-based with pages
  - Layered by kind
  - Feature-Sliced Design

  A unit test checks that each one survives being saved and read back. Generating one of everything under each style produces no problems; so does a new project under the first three. Feature-Sliced Design uses a different layout, so a feature-based project gets placement problems under it, as expected.

- **Review before applying.** Both commands show the proposed `react-architect.json` as a diff against the current one, through a read-only `react-architect-proposal:` document. Next to it, a modal shows the layers and how many problems the project has now and would have.
  - **Apply** keeps the rule severities.
  - **Apply as Errors** sets every rule to `"error"`.

  The settings file is edited as JSON, so other fields (such as `$schema`) are kept.

- **Folder trees** (`core/structure/treeFile.ts`) can be drawn (`├──`, or ASCII), indented (with or without bullets), one path per line, or inside Markdown code fences, where only the fenced part is read. Depth comes from the column where each name starts. A single top-level folder containing `src` is taken to be the project folder and dropped. Bad lines are reported with their line number.
- **Turning a tree into a structure** (`core/structure/infer.ts`):
  - **Known names:** folder names map to roles in a fixed order (app, pages, widgets, features, entities, shared), and each layer may use the layers below it.
  - **Units:** children of a unit container (features, modules, entities…) are example units. What they all have in common becomes the unit template, and an index file they all have becomes the entry.
  - **Feature-Sliced Design:** if there are widgets or entities, siblings become `"none"`, as that methodology requires.
  - **Unknown names:** folders with other names are asked about, at most 10 (shared, top layer, bottom layer, or ignore); any beyond 10 are ignored.
- **JSON input:** a `.json` file, or another project whose `react-architect.json` has a `structure`, is used as it is, after validation.

### Placement and naming (Phase 4)

- **Settings:** the structure gains `unitTemplate` (per layer), `unlisted` (`"allowed"` by default, or `"reported"`) and `naming` (`files` and `pattern` globs; globs now support `[A-Z]` sets). Two rules go with them, `placement` and `naming`.
- **Kinds of file:** `core/structure/kinds.ts` guesses what a file is from its name (a component, hook, service, types or page), and which template folders suit it. That's how the rules suggest a destination.
- **Quick fixes:**
  - for placement: move the file
  - for naming: rename it (when the pattern is a lower-case prefix, such as `use[A-Z]*`)

  Both run a command that previews the move and updates every import, using `planMovePath`. That function also maps extension-less imports (`./useCart` for `useCart.ts`), which the integration test caught.

- **Show Structure Report** opens a Markdown summary: problems by rule and by layer, the files with the most problems, and what to do about each kind.

### Generators follow the structure (Phase 5)

- **Asking where:** generators can offer `directoryChoices`. When there's more than one (for example every unit layer, for Generate Feature), the command asks.
- **Generate Feature** puts each file in the unit template's folder for its kind: `ui/` and `model/` under Feature-Sliced Design, `components/` and `hooks/` under feature-based. It falls back to today's folder names when the template has no folder for a kind.
- **Generate Page** uses a pages layer when the structure has one (a layer named `pages`, or one whose folder is pages, routes or screens). With units, that's one unit per page, exported from its entry; otherwise one file per page. Without a pages layer, pages go in a feature, as before.
- **Exporting from a unit:** "export from the feature's index" now works for any unit whose layer has an entry file, and uses that file's name.

### The CI check (Phase 6)

- **The command:** `src/cli/check.ts` reuses `core/` unchanged. esbuild bundles it into `dist/cli.js`, declared as `bin.react-architect`.
- **Which projects:** it checks every `react-architect.json` in or below the folder, or else the nearest one above. A nested project is checked with its own settings.
- **Output:** text by default, GitHub annotations with `--format github`, and `--max-warnings` like ESLint.
- **Exit codes:** 0 when nothing fails, 1 for failures, 2 when it couldn't run.
- **Baseline:** `react-architect-baseline.json` lists existing problems by rule, file and target, with counts, not by line. With a baseline, the check fails only on new problems, and the editor shows baselined problems as Information with a note.
- **Same files as the editor:** the list of skipped folders is shared in `core/projectFolders.ts`, so the editor and the CLI read the same files.
- **Reliability fix:** the project index now replays file changes that arrive while it re-reads every project. Before, an edit made during a re-read could be lost until the next edit. An integration test showed this as a squiggle that didn't clear.

## Not done yet

- **Publishing the CLI:** it isn't on npm. Its package name is still to be chosen (ADR 8 lists the check as part of publishing). Until it's published, generated projects don't get a `check:structure` script, because `npm install` would fail on a package that doesn't exist.
- **Ignored folders in the editor:** template folders and unknown folders that are ignored don't show up in the Project Map.
