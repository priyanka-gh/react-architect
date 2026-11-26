import { normalizeRelativePath } from "../paths";

export const MAX_PROJECT_NAME_LENGTH = 50;

/**
 * A project name becomes both a folder name and the package.json "name", so
 * it follows the stricter of the two rules: lowercase letters, digits and
 * hyphens, starting with a letter. That also means it can never carry shell
 * syntax into a command line.
 *
 * Returns an error message, or undefined when the name is fine.
 */
export function projectNameProblem(input: string): string | undefined {
  const name = input.trim();
  if (name === "") {
    return "Enter a project name.";
  }
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return `Use a shorter name (${MAX_PROJECT_NAME_LENGTH} characters at most).`;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return "Use lowercase letters, digits and hyphens, starting with a letter (for example: my-app).";
  }
  if (name.endsWith("-")) {
    return "A project name can't end with a hyphen.";
  }
  const asPath = normalizeRelativePath(name);
  if (!asPath.ok) {
    return `"${name}" can't be used as a folder name: it ${asPath.reason}.`;
  }
  return undefined;
}
