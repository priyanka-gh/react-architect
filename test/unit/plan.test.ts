import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendMissingLines,
  checkPlan,
  pathPrefixes,
  type FileOperation,
} from "../../src/core/plan";

const root = path.resolve("/work/app");
const create = (filePath: string): FileOperation => ({
  kind: "create",
  path: filePath,
  content: "",
});
const ensureLine = (filePath: string, line = "export {};"): FileOperation => ({
  kind: "ensureLine",
  path: filePath,
  line,
});
const check = (...operations: FileOperation[]) =>
  checkPlan({ root, operations });

describe("checkPlan", () => {
  it("accepts a sound plan", () => {
    expect(
      check(
        create("src/components/Card/Card.tsx"),
        create("src/components/Card/Card.module.css"),
        ensureLine("src/features/shop/index.ts", "export * from './a';"),
        ensureLine("src/features/shop/index.ts", "export * from './b';"),
      ),
    ).toEqual([]);
  });

  it("requires an absolute root", () => {
    expect(
      checkPlan({ root: "relative/app", operations: [create("a.ts")] }),
    ).toEqual(['The plan\'s root "relative/app" must be an absolute path.']);
  });

  it.each([
    ["../outside.ts", '"../outside.ts" must not contain "..".'],
    [
      "/etc/passwd",
      '"/etc/passwd" must be a relative path inside the project folder.',
    ],
    ["src\\Card.tsx", '"src\\Card.tsx" must use forward slashes (/).'],
    ["./src/Card.tsx", '"./src/Card.tsx" must be written as "src/Card.tsx".'],
    [".", '"." must name a file, not the project folder.'],
  ])("rejects the path %j", (filePath, problem) => {
    expect(check(create(filePath))).toEqual([problem]);
  });

  it("rejects a multi-line ensureLine", () => {
    expect(check(ensureLine("index.ts", "a;\nb;"))).toEqual([
      'The line added to "index.ts" must be a single line.',
    ]);
  });

  it.each([
    [create("a.ts"), create("a.ts")],
    [create("a.ts"), ensureLine("a.ts")],
  ])("rejects the same file twice when one creates it", (first, second) => {
    expect(check(first, second)).toEqual([
      '"a.ts" appears more than once in the plan.',
    ]);
  });

  it("rejects file names that differ only by letter case", () => {
    expect(check(create("Card.tsx"), create("card.tsx"))).toEqual([
      '"Card.tsx" and "card.tsx" differ only by letter case, which clashes on macOS and Windows.',
    ]);
  });

  it("rejects folder names that differ only by letter case, once", () => {
    expect(
      check(
        create("components/A.tsx"),
        create("Components/B.tsx"),
        create("Components/C.tsx"),
      ),
    ).toEqual([
      '"components" and "Components" differ only by letter case, which clashes on macOS and Windows.',
    ]);
  });

  it("rejects a path used as both a file and a folder", () => {
    expect(check(create("hooks"), create("hooks/useCart.ts"))).toEqual([
      '"hooks" is used as both a file and a folder in the plan.',
    ]);
  });
});

describe("pathPrefixes", () => {
  it("lists every folder on the way to the file", () => {
    expect(pathPrefixes("a/b/c.ts")).toEqual(["a", "a/b", "a/b/c.ts"]);
  });
});

describe("appendMissingLines", () => {
  const a = 'export { A } from "./A";';
  const b = 'export { B } from "./B";';

  it.each([
    ["an empty file", "", [a], `${a}\n`],
    ["a file ending in a newline", `${a}\n`, [b], `${a}\n${b}\n`],
    ["a file without a final newline", a, [b], `${a}\n${b}\n`],
    ["a Windows file", `${a}\r\n`, [b], `${a}\r\n${b}\r\n`],
  ])("appends to %s", (_, text, lines, expected) => {
    expect(appendMissingLines(text, lines)).toBe(expected);
  });

  it("leaves the file alone when the line is already there", () => {
    const text = `// public API\n  ${a}  \n`;
    expect(appendMissingLines(text, [a])).toBe(text);
  });

  it("adds a repeated line only once", () => {
    expect(appendMissingLines("", [a, a, b])).toBe(`${a}\n${b}\n`);
  });
});
