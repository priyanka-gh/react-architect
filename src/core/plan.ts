import * as path from "node:path";
import { normalizeRelativePath } from "./paths";

/**
 * A file plan is the list of changes a generator wants to make. Generators
 * only build plans; one writer applies them after checks and user consent.
 * See ADR 4.
 */

/** Replaces `start`..`end` (offsets into the file's text) with `text`. */
export interface TextChange {
  start: number;
  end: number;
  text: string;
}

export type FileOperation =
  | {
      kind: "create";
      /** Relative to the plan's root, using "/". */
      path: string;
      content: string;
      /** Set only after the user agreed to replace an existing file. */
      overwrite?: boolean;
    }
  | {
      /** Append `line` unless the file already contains it; create the file if missing. */
      kind: "ensureLine";
      path: string;
      line: string;
    }
  | {
      /**
       * Change parts of an existing file. `expectedText` is what the changes
       * were worked out from; the writer refuses if the file no longer has it.
       */
      kind: "edit";
      path: string;
      expectedText: string;
      changes: TextChange[];
    };

export interface FilePlan {
  /** Absolute path of the folder the operation paths are relative to. */
  root: string;
  operations: FileOperation[];
}

/**
 * Checks a plan for mistakes that don't need the disk: bad paths, duplicates,
 * names that differ only by letter case, and a path used as both a file and
 * a folder. Any problem here is a generator bug or bad user input, and the
 * plan must not be written.
 *
 * Returns one message per problem; an empty list means the plan is sound.
 */
export function checkPlan(plan: FilePlan): string[] {
  const problems: string[] = [];

  if (!path.isAbsolute(plan.root)) {
    problems.push(`The plan's root "${plan.root}" must be an absolute path.`);
  }

  const valid: FileOperation[] = [];
  for (const operation of plan.operations) {
    const problem = operationProblem(operation);
    if (problem === undefined) {
      valid.push(operation);
    } else {
      problems.push(problem);
    }
  }

  problems.push(...duplicateProblems(valid));
  problems.push(...letterCaseProblems(valid));
  problems.push(...fileAndFolderProblems(valid));
  return problems;
}

function operationProblem(operation: FileOperation): string | undefined {
  const result = normalizeRelativePath(operation.path);
  if (!result.ok) {
    return `"${operation.path}" ${result.reason}.`;
  }
  if (result.path === ".") {
    return `"${operation.path}" must name a file, not the project folder.`;
  }
  if (result.path !== operation.path) {
    return `"${operation.path}" must be written as "${result.path}".`;
  }
  if (operation.kind === "edit" && overlaps(operation.changes)) {
    return `The changes to "${operation.path}" overlap.`;
  }
  if (operation.kind === "ensureLine" && /[\r\n]/.test(operation.line)) {
    return `The line added to "${operation.path}" must be a single line.`;
  }
  return undefined;
}

function overlaps(changes: readonly TextChange[]): boolean {
  const sorted = [...changes].sort((a, b) => a.start - b.start);
  return sorted.some(
    (change, index) =>
      change.start > change.end ||
      (index > 0 && change.start < sorted[index - 1]!.end),
  );
}

/** Applies changes (in any order, not overlapping) to text. */
export function applyChanges(
  text: string,
  changes: readonly TextChange[],
): string {
  return [...changes]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, change) =>
        result.slice(0, change.start) + change.text + result.slice(change.end),
      text,
    );
}

/** The same file twice is only allowed when every operation adds a line to it. */
function duplicateProblems(operations: FileOperation[]): string[] {
  const kindsByPath = new Map<string, FileOperation["kind"][]>();
  for (const { path: filePath, kind } of operations) {
    kindsByPath.set(filePath, [...(kindsByPath.get(filePath) ?? []), kind]);
  }

  const problems: string[] = [];
  for (const [filePath, kinds] of kindsByPath) {
    if (kinds.length > 1 && kinds.some((kind) => kind !== "ensureLine")) {
      problems.push(`"${filePath}" appears more than once in the plan.`);
    }
  }
  return problems;
}

/**
 * "components/Card.tsx" and "Components/Card.tsx" are two paths on Linux but
 * one on macOS and Windows. Checks every folder and file name along the way.
 */
function letterCaseProblems(operations: FileOperation[]): string[] {
  const spellings = new Map<string, string>();
  const problems: string[] = [];

  for (const operation of operations) {
    for (const prefix of pathPrefixes(operation.path)) {
      const key = prefix.toLowerCase();
      const seen = spellings.get(key);
      if (seen === undefined) {
        spellings.set(key, prefix);
      } else if (seen !== prefix) {
        problems.push(
          `"${seen}" and "${prefix}" differ only by letter case, which clashes on macOS and Windows.`,
        );
      }
    }
  }
  // Several files in the same misspelled folder would repeat the same message.
  return [...new Set(problems)];
}

function fileAndFolderProblems(operations: FileOperation[]): string[] {
  const folders = new Set<string>();
  for (const operation of operations) {
    for (const prefix of pathPrefixes(operation.path).slice(0, -1)) {
      folders.add(prefix.toLowerCase());
    }
  }

  const problems = operations
    .filter((operation) => folders.has(operation.path.toLowerCase()))
    .map(
      (operation) =>
        `"${operation.path}" is used as both a file and a folder in the plan.`,
    );
  return [...new Set(problems)];
}

/** "a/b/c.ts" -> ["a", "a/b", "a/b/c.ts"] */
export function pathPrefixes(relativePath: string): string[] {
  const segments = relativePath.split("/");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

/**
 * What an ensureLine operation does to a file's text: appends each line that
 * isn't already there (ignoring surrounding whitespace), keeping the file's
 * line endings. Returns the text unchanged when every line is present.
 */
export function appendMissingLines(text: string, lines: string[]): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const present = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  const missing = [...new Set(lines)].filter(
    (line) => !present.has(line.trim()),
  );
  if (missing.length === 0) {
    return text;
  }
  const separator = text === "" || text.endsWith("\n") ? "" : eol;
  return text + separator + missing.map((line) => line + eol).join("");
}
