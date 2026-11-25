import { describe, expect, it } from "vitest";
import { hookName, parseName, type NameForms } from "../../src/core/naming";

function parsed(input: string): NameForms {
  const result = parseName(input);
  if (!result.ok) {
    throw new Error(`Expected "${input}" to parse, got: ${result.error}`);
  }
  return result.name;
}

describe("parseName", () => {
  it.each([
    "user card",
    "userCard",
    "UserCard",
    "user-card",
    "user_card",
    "  user card  ",
  ])("normalises %j to the same forms", (input) => {
    expect(parsed(input)).toEqual({
      words: ["user", "card"],
      pascal: "UserCard",
      camel: "userCard",
      kebab: "user-card",
    });
  });

  it("splits acronyms from the following word", () => {
    expect(parsed("HTMLParser").pascal).toBe("HtmlParser");
  });

  it("keeps digits attached to the preceding word", () => {
    expect(parsed("card2Item").kebab).toBe("card2-item");
  });

  it.each([
    ["", "Enter a name."],
    ["   ", "Enter a name."],
    ["2fa", "A name must start with a letter."],
    ["-card", "A name must start with a letter."],
    ["user.card", "Use only letters, digits, spaces, hyphens and underscores."],
    ["../evil", "A name must start with a letter."],
    [
      "card/../../evil",
      "Use only letters, digits, spaces, hyphens and underscores.",
    ],
  ])("rejects %j", (input, error) => {
    expect(parseName(input)).toEqual({ ok: false, error });
  });
});

describe("hookName", () => {
  it.each([
    ["cart", "useCart"],
    ["useCart", "useCart"],
    ["use cart", "useCart"],
    ["user", "useUser"],
    ["use", "useUse"],
    ["shopping cart", "useShoppingCart"],
  ])("%j gives %j", (input, expected) => {
    expect(hookName(parsed(input))).toBe(expected);
  });
});
