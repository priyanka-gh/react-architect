import * as path from "node:path";
import { isInsideDirectory } from "../paths";
import { MANIFEST_FILE_NAME } from "./schema";

export type FileExists = (absolutePath: string) => Promise<boolean>;

/**
 * Finds the nearest react-architect.json, starting in `startDirectory` and
 * walking up to `stopDirectory` (normally the workspace folder). The nearest
 * one wins, so each package in a monorepo can have its own. See ADR 1.
 *
 * Returns the manifest's absolute path, or undefined when there is none.
 */
export function findManifest(
  startDirectory: string,
  stopDirectory: string,
  fileExists: FileExists,
): Promise<string | undefined> {
  return findNearestFile(
    MANIFEST_FILE_NAME,
    startDirectory,
    stopDirectory,
    fileExists,
  );
}

/**
 * Finds the nearest file called `fileName` in `startDirectory` or a parent,
 * never looking above `stopDirectory`. A start folder outside the stop folder
 * gives undefined.
 */
export async function findNearestFile(
  fileName: string,
  startDirectory: string,
  stopDirectory: string,
  fileExists: FileExists,
): Promise<string | undefined> {
  const stop = path.resolve(stopDirectory);
  let directory = path.resolve(startDirectory);

  if (!isInsideDirectory(directory, stop)) {
    return undefined;
  }

  for (;;) {
    const candidate = path.join(directory, fileName);
    if (await fileExists(candidate)) {
      return candidate;
    }
    const parent = path.dirname(directory);
    if (directory === stop || parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}
