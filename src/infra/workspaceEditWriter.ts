import * as vscode from "vscode";
import { appendMissingLines, type FilePlan } from "../core/plan";
import { fileExists } from "./fileSystem";

/**
 * Writes a checked plan as one WorkspaceEdit (ADR 4), so it either all
 * happens or none of it does, and one undo reverts it.
 *
 * Returns false when VS Code refused the edit; nothing was changed then.
 */
export async function writePlanInWorkspace(plan: FilePlan): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  const encoder = new TextEncoder();
  const uriFor = (relativePath: string) =>
    vscode.Uri.joinPath(vscode.Uri.file(plan.root), ...relativePath.split("/"));

  const linesByPath = new Map<string, string[]>();
  for (const operation of plan.operations) {
    if (operation.kind === "create") {
      edit.createFile(uriFor(operation.path), {
        contents: encoder.encode(operation.content),
        overwrite: operation.overwrite === true,
      });
    } else {
      const lines = linesByPath.get(operation.path) ?? [];
      linesByPath.set(operation.path, [...lines, operation.line]);
    }
  }

  // Documents to save once the edit is in: only ones without unsaved changes
  // of the user's own, which we must not save on their behalf.
  const toSave: vscode.TextDocument[] = [];
  for (const [relativePath, lines] of linesByPath) {
    const uri = uriFor(relativePath);
    if (!(await fileExists(uri.fsPath))) {
      edit.createFile(uri, {
        contents: encoder.encode(appendMissingLines("", lines)),
      });
      continue;
    }
    // Reading through the document includes edits the user hasn't saved yet.
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const updated = appendMissingLines(text, lines);
    if (updated !== text) {
      edit.insert(
        uri,
        document.positionAt(text.length),
        updated.slice(text.length),
      );
      if (!document.isDirty) {
        toSave.push(document);
      }
    }
  }

  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) {
    await Promise.all(toSave.map((document) => document.save()));
  }
  return applied;
}
