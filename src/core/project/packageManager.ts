/**
 * The commands a package manager is asked to run, as argument arrays (never
 * shell strings). Only npm for now (ADR 7); pnpm, yarn or bun would be another
 * object with the same shape.
 */
export interface PackageManager {
  command: string;
  /** Run a package's binary without installing it globally. */
  execArgs(packageSpec: string, binary: string, args: string[]): string[];
  installArgs(): string[];
  runScriptArgs(script: string): string[];
}

export const npm: PackageManager = {
  command: "npm",
  execArgs: (packageSpec, binary, args) => [
    "exec",
    "--yes",
    `--package=${packageSpec}`,
    "--",
    binary,
    ...args,
  ],
  installArgs: () => ["install", "--no-fund", "--no-audit"],
  runScriptArgs: (script) => ["run", script],
};
