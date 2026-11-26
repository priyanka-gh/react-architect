import { code } from "./code";

/** A page: the component a route renders (ADR 11). */
export function pageSource({
  name,
  title,
}: {
  name: string;
  title: string;
}): string {
  return code`
    export function ${name}() {
      return (
        <main>
          <h1>${title}</h1>
        </main>
      );
    }
  `;
}

export function pageTestSource({
  name,
  title,
}: {
  name: string;
  title: string;
}): string {
  return code`
    import { render, screen } from "@testing-library/react";
    import { describe, expect, it } from "vitest";
    import { ${name} } from "./${name}";

    describe("${name}", () => {
      it("shows its heading", () => {
        render(<${name} />);
        const heading = screen.getByRole("heading", { level: 1 });
        expect(heading.textContent).toBe("${title}");
      });
    });
  `;
}
