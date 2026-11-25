import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { isInsideDirectory, normalizeRelativePath } from "../../src/core/paths";

describe("normalizeRelativePath", () => {
  it.each([
    ["src/components", "src/components"],
    ["./src/components/", "src/components"],
    ["src//hooks", "src/hooks"],
    [".", "."],
    ["./", "."],
    ["..foo/bar", "..foo/bar"],
    ["conference/room.tsx", "conference/room.tsx"],
    ["my folder/Card.tsx", "my folder/Card.tsx"],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeRelativePath(input)).toEqual({ ok: true, path: expected });
  });

  it.each([
    ["", "is empty"],
    ["   ", "is empty"],
    ["src\\components", "must use forward slashes (/)"],
    ["/src", "must be a relative path inside the project folder"],
    ["C:/src", "must be a relative path inside the project folder"],
    ["../outside", 'must not contain ".."'],
    ["src/../../outside", 'must not contain ".."'],
  ])("rejects %j: %s", (input, reason) => {
    expect(normalizeRelativePath(input)).toEqual({ ok: false, reason });
  });

  it.each(["src/a<b", 'src/a"b', "src/what?", "src/star*", "src/tab\tname"])(
    "rejects %j because Windows doesn't allow the character",
    (input) => {
      expect(normalizeRelativePath(input)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("character Windows doesn't allow"),
      });
    },
  );

  it.each(["src/name.", "src/name "])(
    "rejects %j because Windows doesn't allow a trailing dot or space",
    (input) => {
      expect(normalizeRelativePath(input)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("ends in a dot or space"),
      });
    },
  );

  it.each(["con", "src/CON.tsx", "features/Aux/index.ts", "nul.txt", "lpt1"])(
    "rejects %j because it uses a reserved Windows name",
    (input) => {
      expect(normalizeRelativePath(input)).toMatchObject({
        ok: false,
        reason: expect.stringContaining("reserved name on Windows"),
      });
    },
  );
});

describe("isInsideDirectory", () => {
  const project = path.resolve("/work/app");

  it.each([
    [project, true],
    [path.join(project, "src"), true],
    [path.join(project, "..foo"), true],
    [path.resolve("/work"), false],
    [path.resolve("/work/application"), false],
    [path.resolve("/elsewhere"), false],
  ])("%s inside the project folder: %s", (candidate, expected) => {
    expect(isInsideDirectory(candidate, project)).toBe(expected);
  });
});
