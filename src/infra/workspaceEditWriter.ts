import * as vscode from "vscode";
import type { Rename } from "../core/architecture/refactor";
import {
  appendMissingLines,
  type FilePlan,
  type TextChange,
} from "../core/plan";
import { fileExists } from "./fileSystem";

/**
 * Writes a checked plan as one WorkspaceEdit (ADR 4), so it either all
 * happens or none of it does, and one undo reverts it.
 *
 * Returns false when VS Code refused the edit, or when a file to be edited
 * changed after the plan was made; nothing was changed then.
 */
export async function writePlanInWorkspace(plan: FilePlan): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  const encoder = new TextEncoder();
  const uriFor = (relativePath: string) => uriIn(plan.root, relativePath);

  // Documents to save once the edit is in: only ones without unsaved changes
  // of the user's own, which we must not save on their behalf.
  const toSave: vscode.TextDocument[] = [];
  const linesByPath = new Map<string, string[]>();
  for (const operation of plan.operations) {
    if (operation.kind === "create") {
      edit.createFile(uriFor(operation.path), {
        contents: encoder.encode(operation.content),
        overwrite: operation.overwrite === true,
      });
    } else if (operation.kind === "edit") {
      const document = await vscode.workspace.openTextDocument(
        uriFor(operation.path),
      );
      if (document.getText() !== operation.expectedText) {
        return false;
      }
      addChanges(edit, document, operation.changes);
      if (!document.isDirty) {
        toSave.push(document);
      }
    } else {
      const lines = linesByPath.get(operation.path) ?? [];
      linesByPath.set(operation.path, [...lines, operation.line]);
    }
  }

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

/**
 * Applies a rename or move (ADR 11) as one WorkspaceEdit: the renames first,
 * then the text changes on the files at their new paths. Renaming doesn't
 * change a file's text, so the changes (worked out from the old paths) still
 * line up. Editing a file and then renaming it in the same edit can lose the
 * edit, which is why it's this way round.
 *
 * `expected` holds the text each changed file had when the plan was made;
 * if any differs now, or has unsaved changes, nothing is applied and this
 * returns false.
 */
export async function applyRefactorInWorkspace(
  root: string,
  changes: ReadonlyMap<string, TextChange[]>,
  renames: readonly Rename[],
  expected: ReadonlyMap<string, string>,
): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  for (const rename of renames) {
    edit.renameFile(uriIn(root, rename.from), uriIn(root, rename.to));
  }

  const ranges = new Map<string, { range: vscode.Range; text: string }[]>();
  for (const [file, fileChanges] of changes) {
    const document = await vscode.workspace.openTextDocument(uriIn(root, file));
    if (document.isDirty || document.getText() !== expected.get(file)) {
      return false;
    }
    ranges.set(
      file,
      fileChanges.map((change) => ({
        range: new vscode.Range(
          document.positionAt(change.start),
          document.positionAt(change.end),
        ),
        text: change.text,
      })),
    );
  }
  const moved = [...ranges].map(([file, list]) => ({
    uri: uriIn(root, pathAfterRenames(file, renames)),
    list,
  }));
  for (const { uri, list } of moved) {
    for (const { range, text } of list) {
      edit.replace(uri, range, text);
    }
  }

  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) {
    for (const { uri } of moved) {
      const document = await vscode.workspace.openTextDocument(uri);
      if (document.isDirty) {
        await document.save();
      }
    }
  }
  return applied;
}

export function pathAfterRenames(
  file: string,
  renames: readonly Rename[],
): string {
  return renames.reduce(
    (current, { from, to }) =>
      current === from || current.startsWith(from + "/")
        ? to + current.slice(from.length)
        : current,
    file,
  );
}

function addChanges(
  edit: vscode.WorkspaceEdit,
  document: vscode.TextDocument,
  changes: readonly TextChange[],
): void {
  for (const change of changes) {
    edit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(change.start),
        document.positionAt(change.end),
      ),
      change.text,
    );
  }
}

function uriIn(root: string, relativePath: string): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(root), ...relativePath.split("/"));
}
