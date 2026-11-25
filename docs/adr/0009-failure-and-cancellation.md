# 9. Failure, cancellation and cleanup

**Status:** Accepted

## Project creation

- **Target folder:** it must not exist, or must be empty. Otherwise the command refuses and offers no overwrite option.
- **Progress:** the steps run inside `window.withProgress({ cancellable: true })` and report as they go: scaffold, overlay, write manifest, install, format, open.
- **Stopping a process:** on cancellation or failure while a process is running, kill its whole process tree.
- **Cleanup:**
  - If this run created the target folder, ask in a modal: "Delete the partially created project at `<path>`?" with **Delete** and **Keep**.
  - Never delete a folder that existed before the run started. Whether the run created the folder is recorded at the moment it is created, never inferred afterwards.
- **Failed install:** if `npm install` fails after the scaffold and overlay succeeded, project creation has still succeeded. Keep the project and show "Project created, but npm install failed." with **Show Output**, **Retry Install** and **Open Anyway**.

## Code generation

- The whole plan is applied as one `WorkspaceEdit`, so a write is never left half done (see [ADR 4](0004-file-plans-and-writers.md)).
- Dismissing any prompt writes nothing and exits without an error message.
- If `applyEdit` returns `false`, show an error and don't report any files as created.

## Error messages

User-facing messages say what failed and what to do next. Full detail, including process output and stack traces, goes to the OutputChannel.
