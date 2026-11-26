import * as path from "node:path";
import * as vscode from "vscode";
import {
  aliasesFromTsconfig,
  type PathAlias,
} from "../core/architecture/modules";
import { isSourceFile } from "../core/architecture/parse";
import { isSkippedFolder, MAX_PROJECT_FILES } from "../core/projectFolders";
import { readTextFileIfExists } from "./fileSystem";

/**
 * Every file under `folder` (absolute), as paths relative to `root` with "/".
 * Skips dependency and build folders and anything starting with a dot, and
 * stops after MAX_PROJECT_FILES files.
 */
export async function listFiles(
  root: string,
  folder = root,
  filter: (file: string) => boolean = () => true,
): Promise<string[]> {
  const rootUri = vscode.Uri.file(root);
  const start = vscode.Uri.file(folder);
  const prefix = rootUri.path.replace(/\/$/, "") + "/";
  const found: string[] = [];
  const queue = [start];

  while (queue.length > 0 && found.length < MAX_PROJECT_FILES) {
    const directory = queue.shift()!;
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(directory);
    } catch {
      continue;
    }
    for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      const uri = vscode.Uri.joinPath(directory, name);
      if ((type & vscode.FileType.Directory) !== 0) {
        if (!isSkippedFolder(name)) queue.push(uri);
      } else if (name.startsWith(".")) {
        continue;
      } else if ((type & vscode.FileType.File) !== 0) {
        const relative = uri.path.slice(prefix.length);
        if (filter(relative)) found.push(relative);
      }
    }
  }
  return found.sort();
}

export const listSourceFiles = (root: string, folder?: string) =>
  listFiles(root, folder, isSourceFile);

/**
 * The text of each file, from its open document when there is one (so
 * unsaved edits count) and from disk otherwise.
 */
export async function readFiles(
  root: string,
  files: readonly string[],
): Promise<Map<string, string>> {
  const open = new Map(
    vscode.workspace.textDocuments.map((document) => [
      document.uri.toString(),
      document,
    ]),
  );
  const decoder = new TextDecoder();
  const texts = new Map<string, string>();
  await Promise.all(
    files.map(async (file) => {
      const uri = vscode.Uri.joinPath(
        vscode.Uri.file(root),
        ...file.split("/"),
      );
      const document = open.get(uri.toString());
      try {
        texts.set(
          file,
          document?.getText() ??
            decoder.decode(await vscode.workspace.fs.readFile(uri)),
        );
      } catch {
        // Deleted since it was listed.
      }
    }),
  );
  return new Map([...texts].sort(([a], [b]) => a.localeCompare(b)));
}

/** Import shortcuts ("@/...") from the project's tsconfig files, without duplicates. */
export async function readAliases(root: string): Promise<PathAlias[]> {
  const aliases: PathAlias[] = [];
  for (const file of ["tsconfig.json", "tsconfig.app.json"]) {
    const text = await readTextFileIfExists(path.join(root, file));
    if (text !== undefined) aliases.push(...aliasesFromTsconfig(text, "."));
  }
  return aliases.filter(
    (alias, index) =>
      aliases.findIndex((other) => other.prefix === alias.prefix) === index,
  );
}
