/**
 * Minimal glob matching for project-relative paths with "/":
 * `**` matches any number of folders, `*` anything within one name, `?`
 * one character, and `[A-Z]` one character from a set. Used for `structure.ignore` (plans/custom-structure.md).
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]!;
    if (character === "*" && glob[index + 1] === "*") {
      // "**/" also matches no folders at all: "**/x" matches "x".
      if (glob[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else if (character === "[" && glob.indexOf("]", index + 2) !== -1) {
      const close = glob.indexOf("]", index + 2);
      const set = glob
        .slice(index + 1, close)
        .replace(/^!/, "^")
        .replace(/\\/g, "\\\\");
      source += `[${set}]`;
      index = close;
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}
