/**
 * Turns whatever the user typed ("user card", "userCard", "user-card") into the
 * name forms generators need. See ADR 5.
 */

export interface NameForms {
  /** Lower-case words, e.g. ["user", "card"]. */
  words: string[];
  /** UserCard: components, types. */
  pascal: string;
  /** userCard: variables, functions. */
  camel: string;
  /** user-card: feature folders. */
  kebab: string;
}

export type ParseNameResult =
  { ok: true; name: NameForms } | { ok: false; error: string };

const ALLOWED_CHARACTERS = /^[A-Za-z0-9 _-]+$/;

export function parseName(input: string): ParseNameResult {
  const trimmed = input.trim();

  if (trimmed === "") {
    return { ok: false, error: "Enter a name." };
  }
  if (!/^[A-Za-z]/.test(trimmed)) {
    return { ok: false, error: "A name must start with a letter." };
  }
  if (!ALLOWED_CHARACTERS.test(trimmed)) {
    return {
      ok: false,
      error: "Use only letters, digits, spaces, hyphens and underscores.",
    };
  }

  return { ok: true, name: fromWords(splitWords(trimmed)) };
}

/**
 * The hook name for a parsed name. A leading "use" is kept rather than doubled,
 * so "cart" and "useCart" both give "useCart".
 */
export function hookName(name: NameForms): string {
  const [first, ...rest] = name.words;
  const hasUsePrefix = first === "use" && rest.length > 0;
  return "use" + fromWords(hasUsePrefix ? rest : name.words).pascal;
}

function splitWords(input: string): string[] {
  return (
    input
      // "userCard" -> "user Card", "card2Item" -> "card2 Item"
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      // "HTMLParser" -> "HTML Parser"
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/[\s_-]+/)
      .filter((word) => word !== "")
      .map((word) => word.toLowerCase())
  );
}

function fromWords(words: string[]): NameForms {
  const capitalised = words.map(
    (word) => word.charAt(0).toUpperCase() + word.slice(1),
  );
  const pascal = capitalised.join("");
  return {
    words,
    pascal,
    camel: pascal.charAt(0).toLowerCase() + pascal.slice(1),
    kebab: words.join("-"),
  };
}
