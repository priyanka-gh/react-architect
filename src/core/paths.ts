import * as path from "node:path";

/**
 * Rules for project-relative paths, shared by the manifest and file plans.
 *
 * Paths always use "/" and must stay inside the project folder. They must also
 * be valid on Windows, so a project generated on macOS or Linux still works
 * when someone clones it on Windows.
 */

export type RelativePathResult =
  { ok: true; path: string } | { ok: false; reason: string };

// Windows reserves these names regardless of case or extension ("con.tsx" too).
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const WINDOWS_INVALID_CHARACTERS = '<>"|?*';

/**
 * Checks a project-relative path and returns it in normal form: no "./", no
 * repeated or trailing slashes. The project folder itself is ".".
 *
 * `reason` is a sentence fragment meant to follow the path or field name,
 * e.g. `"paths.components" must not contain "..".`
 */
export function normalizeRelativePath(input: string): RelativePathResult {
  if (input.trim() === "") {
    return { ok: false, reason: "is empty" };
  }
  if (input.includes("\\")) {
    return { ok: false, reason: "must use forward slashes (/)" };
  }
  if (input.startsWith("/") || input.includes(":")) {
    return {
      ok: false,
      reason: "must be a relative path inside the project folder",
    };
  }

  const segments = input.split("/").filter((s) => s !== "" && s !== ".");
  for (const segment of segments) {
    const problem = segmentProblem(segment);
    if (problem !== undefined) {
      return { ok: false, reason: problem };
    }
  }

  return { ok: true, path: segments.length === 0 ? "." : segments.join("/") };
}

function segmentProblem(segment: string): string | undefined {
  if (segment === "..") {
    return 'must not contain ".."';
  }
  for (const character of segment) {
    if (
      character.charCodeAt(0) < 32 ||
      WINDOWS_INVALID_CHARACTERS.includes(character)
    ) {
      return `contains "${segment}", which has a character Windows doesn't allow in file names`;
    }
  }
  if (/[. ]$/.test(segment)) {
    return `contains "${segment}", which ends in a dot or space; Windows doesn't allow that`;
  }
  const baseName = segment.split(".")[0] ?? "";
  if (WINDOWS_RESERVED_NAMES.test(baseName)) {
    return `contains "${segment}"; "${baseName}" is a reserved name on Windows`;
  }
  return undefined;
}

/** True when `candidate` is `directory` itself or somewhere inside it. Both must be absolute. */
export function isInsideDirectory(
  candidate: string,
  directory: string,
): boolean {
  const relative = path.relative(directory, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative))
  );
}
