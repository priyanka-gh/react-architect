# 4. Generators return file plans; one checked writer applies them

**Status:** Accepted

## Context

Every generator needs the same safety checks: path containment, conflict detection, user consent before overwriting, and a preview. If each generator wrote files itself, each would re-implement those checks, and none could be tested without a filesystem.

## Decision

Generators are pure functions of the form `(input, manifest) => FilePlan`. They never touch the filesystem or VS Code.

```ts
type FileOperation =
  | { kind: "create"; path: string; content: string }
  // Append `line` if it isn't already present; create the file if it's missing.
  | { kind: "ensureLine"; path: string; line: string };

interface FilePlan {
  root: string; // absolute; every operation path is relative to it
  operations: FileOperation[];
}
```

Before anything is written, `core/plan.ts` checks the plan:

1. Every path is relative and normalised, and resolves inside `root`.
2. No two operations target paths that differ only by letter case. macOS and Windows filesystems are case-insensitive by default.
3. Every `create` target that already exists on disk is listed, using a case-insensitive comparison against the parent directory's listing.

Conflicts are resolved once for the whole plan, with one modal: "N files already exist" with the options **Overwrite**, **Skip existing** and **Cancel**. Escape means Cancel. Nothing is written until the conflicts are resolved.

The two writers live in `infra/`:

- **`WorkspaceEditWriter`**, for generating inside an open workspace. It applies the whole plan as a single `WorkspaceEdit`. That makes the write atomic, undoable in one step, aware of unsaved editors, and correct over Remote and WSL. Files changed by `ensureLine` are saved after the edit is applied. In Phase 2, check how `createFile` with contents interacts with undo, and record any adjustment here.
- **`FsWriter`**, for a new project outside the workspace. It uses `fs/promises` with the `wx` flag, so a file that appears after the conflict check is never overwritten.

**Preview:** before applying a plan, show its files in a QuickPick, marking each as created or modified and flagging conflicts. Accepting generates; dismissing cancels. A diff view can come later.

## Consequences

- Generators are tested with snapshot tests and no mocks.
- Path safety, conflict handling and preview are written once and shared by every generator.
