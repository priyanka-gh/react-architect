import * as path from "node:path";
import type { FileOperation, FilePlan } from "./plan";

/**
 * Compares a plan with what's already on disk. See ADR 4.
 *
 * Comparisons ignore letter case, because macOS and Windows do: on those
 * systems, creating "card.tsx" next to an existing "Card.tsx" would replace it.
 */

export interface DirectoryEntry {
  name: string;
  /** True for folders, including symbolic links that point to folders. */
  isDirectory: boolean;
}

/** Lists a folder, or returns undefined if it doesn't exist. */
export type ReadDirectory = (
  absolutePath: string,
) => Promise<DirectoryEntry[] | undefined>;

export type Conflict =
  /** A file the plan would create already exists. The user can overwrite or skip it. */
  | { kind: "exists"; path: string }
  /** Something on disk has the same name with different letter case. Blocks the plan. */
  | { kind: "letterCase"; path: string; existingPath: string }
  /** The plan needs a file where a folder is, or a folder where a file is. Blocks the plan. */
  | { kind: "fileFolderClash"; path: string; existingPath: string };

export type ConflictChoice = "overwrite" | "skip";

/** Overwriting or skipping can't fix these; the user must rename or move something. */
export function isBlocking(conflict: Conflict): boolean {
  return conflict.kind !== "exists";
}

export async function findConflicts(
  plan: FilePlan,
  readDirectory: ReadDirectory,
): Promise<Conflict[]> {
  // Plans often put several files in one folder; list each folder only once.
  const listings = new Map<string, Promise<DirectoryEntry[] | undefined>>();
  const list = (directory: string) => {
    let listing = listings.get(directory);
    if (listing === undefined) {
      listing = readDirectory(directory);
      listings.set(directory, listing);
    }
    return listing;
  };

  const conflicts: Conflict[] = [];
  for (const operation of plan.operations) {
    const conflict = await conflictFor(operation, plan.root, list);
    if (conflict !== undefined) {
      conflicts.push(conflict);
    }
  }
  return conflicts;
}

async function conflictFor(
  operation: FileOperation,
  root: string,
  list: ReadDirectory,
): Promise<Conflict | undefined> {
  const segments = operation.path.split("/");
  const existing: string[] = [];
  let directory = root;

  for (const [index, segment] of segments.entries()) {
    const entries = await list(directory);
    const match =
      entries?.find((entry) => entry.name === segment) ??
      entries?.find(
        (entry) => entry.name.toLowerCase() === segment.toLowerCase(),
      );
    if (match === undefined) {
      // From here on nothing exists yet, so there is nothing to clash with.
      return undefined;
    }

    existing.push(match.name);
    const existingPath = existing.join("/");
    const isLast = index === segments.length - 1;

    if (match.name !== segment) {
      return { kind: "letterCase", path: operation.path, existingPath };
    }
    if (isLast === match.isDirectory) {
      // A folder where the plan's file should be, or a file where a folder should be.
      return { kind: "fileFolderClash", path: operation.path, existingPath };
    }
    if (isLast) {
      // Adding a line to an existing file is the point of ensureLine.
      return operation.kind === "create"
        ? { kind: "exists", path: operation.path }
        : undefined;
    }
    directory = path.join(directory, match.name);
  }
  return undefined;
}

/**
 * Applies the user's answer to "these files already exist": skipping drops
 * those files from the plan, overwriting marks them as allowed to be replaced.
 */
export function applyConflictChoice(
  plan: FilePlan,
  conflicts: Conflict[],
  choice: ConflictChoice,
): FilePlan {
  if (conflicts.some(isBlocking)) {
    throw new Error(
      "Blocking conflicts can't be resolved by overwriting or skipping.",
    );
  }

  const existing = new Set(conflicts.map((conflict) => conflict.path));
  const operations = plan.operations.flatMap((operation): FileOperation[] => {
    if (operation.kind !== "create" || !existing.has(operation.path)) {
      return [operation];
    }
    return choice === "skip" ? [] : [{ ...operation, overwrite: true }];
  });
  return { ...plan, operations };
}
