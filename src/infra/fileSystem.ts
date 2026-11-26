import * as vscode from "vscode";
import type { DirectoryEntry } from "../core/conflicts";

/**
 * Disk access through VS Code's file system API rather than Node's, so it
 * also works in Remote, WSL and container workspaces.
 */

export async function readDirectory(
  absolutePath: string,
): Promise<DirectoryEntry[] | undefined> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(
      vscode.Uri.file(absolutePath),
    );
    return entries.map(([name, type]) => ({
      name,
      // Symbolic links to folders report Directory | SymbolicLink.
      isDirectory: (type & vscode.FileType.Directory) !== 0,
    }));
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absolutePath));
    return (stat.type & vscode.FileType.File) !== 0;
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

export async function readTextFile(absolutePath: string): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(absolutePath),
  );
  return new TextDecoder().decode(bytes);
}

/** File contents, or undefined if the file doesn't exist. */
export async function readTextFileIfExists(
  absolutePath: string,
): Promise<string | undefined> {
  try {
    return await readTextFile(absolutePath);
  } catch (error) {
    if (isMissing(error) || isDirectoryError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isDirectoryError(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError && error.code === "FileIsADirectory"
  );
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof vscode.FileSystemError &&
    (error.code === "FileNotFound" || error.code === "FileNotADirectory")
  );
}
