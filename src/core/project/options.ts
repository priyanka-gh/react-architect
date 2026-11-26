import {
  DEFAULT_MANIFEST,
  type Manifest,
  type Styling,
} from "../manifest/schema";
import { normalizeRelativePath } from "../paths";
import type { PackageManagerId } from "./packageManager";

/** Everything a person chooses when creating a project (ADR 10). */
export interface ProjectOptions {
  /** Folder and package name, e.g. "my-app". */
  name: string;
  /** Absolute path of the folder the project is created in. */
  parentDirectory: string;
  styling: Styling;
  /** Vitest, Testing Library and starter tests; off means none of them. */
  tests: boolean;
  routing: boolean;
  /** Imports like "@/features/home" instead of "../../features/home". */
  pathAlias: boolean;
  /** Start a git repository with a first commit. */
  git: boolean;
  install: boolean;
  packageManager: PackageManagerId;
  paths: Manifest["paths"];
}

/** The yes/no choices, which the command asks for as one checklist. */
export type ProjectToggles = Pick<
  ProjectOptions,
  "routing" | "tests" | "pathAlias" | "git" | "install"
>;

export const DEFAULT_TOGGLES: ProjectToggles = {
  routing: true,
  tests: true,
  pathAlias: true,
  git: true,
  install: true,
};

export const DEFAULT_PROJECT_CHOICES: Omit<
  ProjectOptions,
  "name" | "parentDirectory"
> = {
  ...DEFAULT_TOGGLES,
  styling: "css-modules",
  packageManager: "npm",
  paths: DEFAULT_MANIFEST.paths,
};

/** Folders the starter files use, so generated code can't be put there. */
const RESERVED_FOLDERS = ["src/app", "src/styles", "src/test", "src/assets"];

/**
 * Checks a custom folder for components, hooks or features. It must be inside
 * src/ (Vite's tsconfig only covers src/), and must not overlap the other two
 * folders or the starter files' folders.
 *
 * Returns an error message, or undefined when it's fine.
 */
export function projectFolderProblem(
  value: string,
  otherFolders: string[],
): string | undefined {
  const result = normalizeRelativePath(value.trim());
  if (!result.ok) {
    return `The folder ${result.reason}.`;
  }
  const folder = result.path;
  if (!folder.startsWith("src/")) {
    return "Choose a folder inside src/, for example src/ui.";
  }
  const overlaps = (a: string, b: string) => {
    const [x, y] = [a.toLowerCase(), b.toLowerCase()];
    return x === y || x.startsWith(y + "/") || y.startsWith(x + "/");
  };
  const reserved = RESERVED_FOLDERS.find((other) => overlaps(folder, other));
  if (reserved !== undefined) {
    return `${reserved} is used by the starter files; choose another folder.`;
  }
  const clash = otherFolders.find((other) => overlaps(folder, other));
  if (clash !== undefined) {
    return `This overlaps ${clash}; each kind of code needs its own folder.`;
  }
  return undefined;
}

/** The manifest a project created with these options gets. */
export function manifestFor(
  options: Pick<ProjectOptions, "styling" | "tests" | "paths">,
): Manifest {
  return {
    ...DEFAULT_MANIFEST,
    styling: options.styling,
    paths: options.paths,
    testing: options.tests
      ? { framework: "vitest", generateTests: true }
      : { framework: "none", generateTests: false },
  };
}
