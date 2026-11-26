/**
 * Folders never worth reading for structure rules: dependencies, build
 * output and tool caches. Shared by the editor's project index and the
 * command-line check, so both see the same files. Folders starting with a
 * dot are skipped too.
 */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "storybook-static",
]);

/** Stops very large repositories from slowing things down. */
export const MAX_PROJECT_FILES = 5000;

export const isSkippedFolder = (name: string) =>
  name.startsWith(".") || SKIPPED_FOLDERS.has(name);

/** The file name of the baseline next to react-architect.json. */
export const BASELINE_FILE_NAME = "react-architect-baseline.json";
