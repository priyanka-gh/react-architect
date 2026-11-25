# 4. Generators return file plans; one checked writer applies them

**Status:** Accepted

## Context

Every generator needs the same safety checks: path containment, conflict detection, user consent before overwriting, and a preview. If each generator wrote files itself, each would re-implement those checks, and none could be tested without a filesystem.

## Decision

Generators are pure functions of the form `(input, manifest) => FilePlan`. They never touch the filesystem or VS Code.

```ts
type FileOperation =
  // `overwrite` is set only after the user agrees to replace an existing file.
  | { kind: "create"; path: string; content: string; overwrite?: boolean }
  // Append `line` if it isn't already present; create the file if it's missing.
  | { kind: "ensureLine"; path: string; line: string };

interface FilePlan {
  root: string; // absolute; every operation path is relative to it
  operations: FileOperation[];
}
```

Before anything is written, the plan goes through two checks.

**`checkPlan` (`core/plan.ts`)** needs no disk access. Any problem it finds is a generator bug or bad input, and the plan is not written. It checks that:

1. Every path is relative, already normalised, inside `root`, and valid on Windows: no reserved names such as `con` or `aux`, no `<>"|?*`, and no trailing dot or space. The path rules live in `core/paths.ts` and are shared with the manifest.
2. No file appears twice, unless every operation on it is an `ensureLine`.
3. No two files or folders differ only by letter case. macOS and Windows filesystems are case-insensitive by default.
4. No path is used as both a file and a folder.

**`findConflicts` (`core/conflicts.ts`)** compares the plan with the disk. It receives a `readDirectory` function, so tests use an in-memory disk. Each folder is listed once, and names are compared case-insensitively. There are three kinds of conflict:

- **`exists`**: a file the plan would create is already there. The user decides what to do.
- **`letterCase`**: a file or folder on disk has the same name with different letter case. This blocks the plan.
- **`fileFolderClash`**: the plan needs a file where a folder is, or the other way round. This blocks the plan.

Blocking conflicts are shown as an error naming the files involved. For `exists` conflicts there is one modal for the whole plan: "N files already exist" with the options **Overwrite**, **Skip existing** and **Cancel**. Escape means Cancel. `applyConflictChoice` turns the answer into a new plan. Nothing is written until every conflict is resolved.

The two writers live in `infra/`:

- **`WorkspaceEditWriter`**, for generating inside an open workspace. It applies the whole plan as a single `WorkspaceEdit`. That makes the write atomic, undoable in one step, aware of unsaved editors, and correct over Remote and WSL. Files changed by `ensureLine` are saved after the edit is applied, unless they already had unsaved changes; the user's own unsaved work is never saved for them. **Undo is not verified automatically:** `undo` sent by the test runner (from the Explorer or from the new file's editor) didn't revert the edit, most likely because automated test windows don't route undo the way a real keypress does. Check it by hand before release.
- **`FsWriter`**, for a new project outside the workspace. It uses `fs/promises` with the `wx` flag, so a file that appears after the conflict check is never overwritten.

**Preview:** before applying a plan, show a modal listing each file as New, Replace or Update, with a **Generate** button. Dismissing it cancels. A modal fits better than the QuickPick first planned: it's a yes/no decision, and a QuickPick suggests picking one file. A diff view can come later.

## Consequences

- Generators are tested with snapshot tests and no mocks.
- Path safety, conflict handling and preview are written once and shared by every generator.
