/**
 * Reads a folder tree the way people write one (plans/custom-structure.md,
 * Phase 3): drawn with ├── └── │ (or ASCII |-- `--), indented with spaces or
 * tabs (optionally with - or * bullets), or one path per line. Anything after
 * # or // is a comment. A trailing "/" marks a folder; so does having
 * children. Otherwise a name with a dot is a file.
 *
 * Depth comes from the column where each name starts, so any indent width
 * works, and drawn and indented trees can be mixed.
 */

export interface TreeEntry {
  /** Project-relative, with "/". */
  path: string;
  isFolder: boolean;
}

export type TreeResult =
  { ok: true; entries: TreeEntry[] } | { ok: false; errors: string[] };

const DRAWING = /^[\s│├└─┬┼|`+\-*•>]*/u;
const INVALID = /[<>"|?:\\]/;

export function parseTree(text: string): TreeResult {
  const errors: string[] = [];
  const folders = new Set<string>();
  const files = new Set<string>();
  const stack: { column: number; path: string }[] = [];
  let inFence = false;
  // In a Markdown file with code fences, only what's inside them is the tree.
  const fenced = /^\s*```/m.test(text);

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (fenced && !inFence) return;

    const line = raw
      .replace(/\s(#|\/\/).*$/, "")
      .replace(/^\s*(#|\/\/).*$/, "")
      .trimEnd();
    if (line.trim() === "") return;

    const prefix = DRAWING.exec(line)?.[0] ?? "";
    const column = [...prefix].length;
    let name = line
      .slice(prefix.length)
      .trim()
      .split(/\s{2,}|\s\(|\s-\s|\s←|\s<-/)[0]!
      .trim();
    name = name.replace(/^`|`$/g, "");
    if (name === "" || /^(\.\.\.|…)$/.test(name)) return;
    if (INVALID.test(name)) {
      errors.push(
        `Line ${lineNumber}: "${name}" has characters that can't be in a file name.`,
      );
      return;
    }

    while (stack.length > 0 && stack[stack.length - 1]!.column >= column) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.path;
    const explicitFolder = name.endsWith("/");
    const segments = name
      .replace(/\/+$/, "")
      .replace(/^\.\//, "")
      .split("/")
      .filter(Boolean);
    if (segments.some((segment) => segment === "..")) {
      errors.push(
        `Line ${lineNumber}: "${name}" goes outside the project with "..".`,
      );
      return;
    }
    if (segments.length === 0) return;

    const full = [...(parent ? [parent] : []), ...segments].join("/");
    // Every folder along the way exists, including ones written as a/b/c.
    const parts = full.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      folders.add(parts.slice(0, depth).join("/"));
    }
    const last = segments[segments.length - 1]!;
    if (
      explicitFolder ||
      !/\.[A-Za-z0-9]+$/.test(last) ||
      last.startsWith(".")
    ) {
      folders.add(full);
    } else {
      files.add(full);
    }
    stack.push({ column, path: full });
  });

  if (errors.length > 0) return { ok: false, errors };

  // A "file" that turned out to have children is a folder after all.
  for (const file of [...files]) {
    if ([...folders, ...files].some((other) => other.startsWith(file + "/"))) {
      files.delete(file);
      folders.add(file);
    }
  }
  const entries = stripProjectFolder([
    ...[...folders].map((path) => ({ path, isFolder: true })),
    ...[...files].map((path) => ({ path, isFolder: false })),
  ]);
  if (entries.length === 0) {
    return { ok: false, errors: ["No folders or files were found in it."] };
  }
  return {
    ok: true,
    entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * Trees often start with the project's own folder ("my-app/"). When there's
 * one top-level folder and it contains src (or package.json), drop it.
 */
function stripProjectFolder(entries: TreeEntry[]): TreeEntry[] {
  const tops = new Set(entries.map((entry) => entry.path.split("/")[0]));
  if (tops.size !== 1) return entries;
  const [top] = [...tops];
  if (top === "src") return entries;
  const hasProjectContents = entries.some(
    (entry) =>
      entry.path === `${top}/src` || entry.path === `${top}/package.json`,
  );
  if (!hasProjectContents) return entries;
  return entries
    .filter((entry) => entry.path !== top)
    .map((entry) => ({ ...entry, path: entry.path.slice(top!.length + 1) }));
}
