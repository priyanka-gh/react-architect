# 12. The project structure is data, and the rules follow it

**Status:** Accepted. This is Phase 1 of [the custom structure plan](../plans/custom-structure.md).

## Context

ADR 11's two rules hard-coded the feature-based structure: "a file in `paths.features/<name>` is in a feature" and "files in `paths.components` and `paths.hooks` are shared". To let projects describe their own structure (the plan's later phases), the rules have to work from a description of the structure instead.

## Decision

- **The description:** a structure is a list of **layers**. Each layer has:
  - folders (`paths`)
  - the layers it may import (`mayImport`)
  - for layers whose paths end in `/*` (each folder inside is a **unit**, such as a feature): an optional `entry` file, and a `siblings` policy (`"entry"`, `"none"` or `"any"`) for how units of the layer may use each other

  `ignore` lists files no rule applies to. All of this lives in `src/core/structure/`, which follows the same no-`vscode` rule as the rest of `core/`.

- **The default:** a project without a `structure` setting gets `defaultStructureConfig(paths)`:
  - `features` = `paths.features/*`, with entry `index.ts`, siblings `"entry"`, and `mayImport: ["shared"]`
  - `shared` = `paths.components` + `paths.hooks`, with `mayImport: []`

  Everything else is in no layer and isn't checked. This gives exactly the problems ADR 11's rules gave: the existing rule tests pass against it, with only the rule names and field names updated.

- **The rules:**
  - `layers`: an import to a layer not in `mayImport`
  - `entry`: an import into another unit that doesn't use its folder or entry file
  - `siblings`: an import between units of a layer whose policy is `"none"`

  Each import is reported once, for the most basic problem, in that order. Imports within the same layer (outside units), within the same unit, and to or from ignored files are never problems.

- **Old names:** the rules were called `featureInternals` (now `entry`) and `sharedCode` (now `layers`). Both old names stay accepted in `rules`. If both an old name and its new name are set, the new one wins, with a warning.
- **Matching:**
  - the most specific path wins
  - a unit match counts as more specific than its folder alone, so `src/features/*` beats `src` for `src/features/cart/x.ts`
  - only a final `/*` is supported
- **Validation:** `src/core/structure/validate.ts` checks what the JSON Schema can't: `mayImport` naming a layer that doesn't exist, the same path in two layers, duplicate layer names, an `entry` on a layer without units, and siblings `"entry"` without an entry. The schema checks the shapes; a unit test keeps the two in step.
- **The map:** it now lists units of every layer (`ProjectMap.units`, each with its `layer`), with `uses` and `usedBy` keyed by unit folder, because two layers can have units with the same name. The view is otherwise unchanged; grouping by layer is Phase 2.

## Consequences

- The `layers` message wording changed. Shared code importing a feature now says "Shared code in src/components uses the "cart" feature. Code in "shared" may only import nothing outside its own layer: …" instead of naming shared components and hooks.
- A project can already write a `structure` section by hand, and the squiggles, quick fix and Project Map follow it. Generators and Rename Feature still use `paths` until Phase 5.
