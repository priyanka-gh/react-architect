/**
 * What each package manager is asked to run, as argument arrays (never shell
 * strings). New projects are always scaffolded with npm, which comes with
 * Node.js; the chosen package manager installs and runs scripts (ADR 10).
 */

export const PACKAGE_MANAGER_IDS = ["npm", "pnpm", "yarn"] as const;
export type PackageManagerId = (typeof PACKAGE_MANAGER_IDS)[number];

export interface PackageManager {
  id: PackageManagerId;
  command: string;
  installArgs(): string[];
  /**
   * Environment for installing. In CI, pnpm and Yarn 2+ refuse to create a
   * lockfile by default, and a new project has none yet.
   */
  installEnv: Record<string, string>;
  runScriptArgs(script: string): string[];
  /** How a person would type it, for the generated README. */
  scriptCommand(script: string): string;
}

const npm: PackageManager = {
  id: "npm",
  command: "npm",
  installArgs: () => ["install", "--no-fund", "--no-audit"],
  installEnv: {},
  runScriptArgs: (script) => ["run", script],
  scriptCommand: (script) =>
    script === "test" ? "npm test" : `npm run ${script}`,
};

const pnpm: PackageManager = {
  id: "pnpm",
  command: "pnpm",
  installArgs: () => ["install", "--no-frozen-lockfile"],
  installEnv: {},
  runScriptArgs: (script) => ["run", script],
  scriptCommand: (script) => `pnpm ${script}`,
};

const yarn: PackageManager = {
  id: "yarn",
  command: "yarn",
  // No flags: Yarn 1 and Yarn 2+ accept different ones. Yarn 2+ reads this
  // variable; Yarn 1 ignores it.
  installArgs: () => ["install"],
  installEnv: { YARN_ENABLE_IMMUTABLE_INSTALLS: "false" },
  runScriptArgs: (script) => ["run", script],
  scriptCommand: (script) => `yarn ${script}`,
};

export const PACKAGE_MANAGERS: Record<PackageManagerId, PackageManager> = {
  npm,
  pnpm,
  yarn,
};

/** Runs a package's binary without installing it; only npm is used for this. */
export function npmExecArgs(
  packageSpec: string,
  binary: string,
  args: string[],
): string[] {
  return ["exec", "--yes", `--package=${packageSpec}`, "--", binary, ...args];
}
