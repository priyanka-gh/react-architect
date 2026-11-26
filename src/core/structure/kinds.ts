import * as path from "node:path";

/**
 * What kind of code a file holds, guessed from its name, and the folder
 * names each kind usually lives in. Used to suggest where a misplaced file
 * belongs, and where generators put files (plans/custom-structure.md).
 */

export type Kind = "component" | "hook" | "service" | "types" | "page";

/** Folder names for each kind, most common first. */
export const KIND_FOLDERS: Record<Kind, readonly string[]> = {
  component: ["components", "ui"],
  hook: ["hooks", "model"],
  service: ["api", "services"],
  types: ["types", "model"],
  page: ["pages", "ui"],
};

/** The name before its first dot: "Button.module.css" -> "Button". */
export function stem(file: string): string {
  return path.posix.basename(file).split(".")[0] ?? "";
}

export function kindOf(file: string): Kind | undefined {
  const base = path.posix.basename(file);
  const name = stem(file);
  if (name === "types" || /\.types\.[cm]?[jt]sx?$/.test(base)) return "types";
  if (/^use[A-Z0-9]/.test(name)) return "hook";
  if (/(Api|Service|Client)$/.test(name)) return "service";
  const jsx = /\.[jt]sx$/.test(base);
  if (jsx && /^[A-Z]\w*Page$/.test(name)) return "page";
  if (jsx && /^[A-Z]/.test(name)) return "component";
  return undefined;
}

/**
 * The first entry of `template` that suits `kind`, such as "hooks/" for a
 * hook in a template with ["components/", "hooks/", "index.ts"].
 */
export function templateFolderFor(
  kind: Kind,
  template: readonly string[],
): string | undefined {
  return KIND_FOLDERS[kind].find((folder) => template.includes(`${folder}/`));
}
