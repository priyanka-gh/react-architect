/**
 * Tagged template for writing generated code indented like the surrounding
 * TypeScript. Removes the leading newline, the shared indentation and trailing
 * spaces, and ends the result with exactly one newline.
 *
 * Interpolated values must be single-line (names, paths). See ADR 2.
 */
export function code(
  strings: TemplateStringsArray,
  ...values: (string | number)[]
): string {
  const text = strings.reduce(
    (result, part, index) =>
      result + part + (index < values.length ? String(values[index]) : ""),
    "",
  );

  const lines = text.replace(/^\n/, "").trimEnd().split("\n");
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines.map((line) => line.slice(indent).trimEnd()).join("\n") + "\n";
}

/** Prettier's default print width; templates keep every line within it. */
export const PRINT_WIDTH = 80;
