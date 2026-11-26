export interface PackageJsonAdditions {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** Added after the existing scripts; a script with the same name is replaced. */
  scripts: Record<string, string>;
}

/**
 * Adds dependencies and scripts to a package.json without touching anything
 * else (ADR 3: package.json is merged, never replaced). Dependencies are
 * sorted, as npm itself does.
 */
export function mergePackageJson(
  text: string,
  additions: PackageJsonAdditions,
): string {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("package.json doesn't contain a JSON object.");
  }
  const pkg = parsed as Record<string, unknown>;

  const section = (name: string): Record<string, string> => {
    const value = pkg[name];
    return typeof value === "object" && value !== null
      ? (value as Record<string, string>)
      : {};
  };
  const sorted = (entries: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)),
    );

  const merged: Record<string, unknown> = {
    ...pkg,
    scripts: { ...section("scripts"), ...additions.scripts },
    dependencies: sorted({
      ...section("dependencies"),
      ...additions.dependencies,
    }),
    devDependencies: sorted({
      ...section("devDependencies"),
      ...additions.devDependencies,
    }),
  };
  return JSON.stringify(merged, null, 2) + "\n";
}
