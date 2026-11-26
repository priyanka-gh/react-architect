import type { Styling } from "../manifest/schema";
import { code, PRINT_WIDTH } from "./code";

export interface ComponentTemplate {
  /** PascalCase component name, e.g. "UserCard". */
  name: string;
  /** kebab-case, e.g. "user-card"; the class name for plain CSS. */
  kebab: string;
  styling: Styling;
}

/** The stylesheet that goes with a component, if its styling uses one. */
export function componentStylesheetName({
  name,
  styling,
}: Pick<ComponentTemplate, "name" | "styling">): string | undefined {
  switch (styling) {
    case "css-modules":
      return `${name}.module.css`;
    case "plain-css":
      return `${name}.css`;
    case "tailwind":
    case "none":
      return undefined;
  }
}

export function componentSource({
  name,
  kebab,
  styling,
}: ComponentTemplate): string {
  const signature = functionSignature(name);
  const props = code`
    export interface ${name}Props {
      className?: string;
    }
  `;

  // The signature and class lines can span lines, so they're joined on
  // rather than interpolated (see code()).
  switch (styling) {
    case "css-modules":
      return (
        code`
          import styles from "./${name}.module.css";
        ` +
        "\n" +
        props +
        "\n" +
        signature +
        "\n" +
        classesLine("styles.root") +
        code`
            return <div className={classes}>${name}</div>;
          }
        `
      );
    case "plain-css":
      return (
        code`
          import "./${name}.css";
        ` +
        "\n" +
        props +
        "\n" +
        signature +
        "\n" +
        classesLine(`"${kebab}"`) +
        code`
            return <div className={classes}>${name}</div>;
          }
        `
      );
    case "tailwind":
    case "none":
      return (
        props +
        "\n" +
        signature +
        "\n" +
        code`
            return <div className={className}>${name}</div>;
          }
        `
      );
  }
}

/** Long names push the signature past the print width; Prettier then wraps the destructured props. */
function functionSignature(name: string): string {
  const oneLine = `export function ${name}({ className }: ${name}Props) {`;
  if (oneLine.length <= PRINT_WIDTH) {
    return oneLine;
  }
  return `export function ${name}({\n  className,\n}: ${name}Props) {`;
}

/** `const classes = [base, className]...`, wrapped the way Prettier wraps it when too long. */
function classesLine(base: string): string {
  const oneLine = `  const classes = [${base}, className].filter(Boolean).join(" ");`;
  if (oneLine.length <= PRINT_WIDTH) {
    return oneLine + "\n";
  }
  return `  const classes = [${base}, className]\n    .filter(Boolean)\n    .join(" ");\n`;
}

export function componentStylesSource({
  kebab,
  styling,
}: Pick<ComponentTemplate, "kebab" | "styling">): string {
  const selector = styling === "plain-css" ? `.${kebab}` : ".root";
  return code`
    ${selector} {
      display: block;
    }
  `;
}

export function componentTestSource({ name }: { name: string }): string {
  return code`
    import { render, screen } from "@testing-library/react";
    import { describe, expect, it } from "vitest";
    import { ${name} } from "./${name}";

    describe("${name}", () => {
      it("renders", () => {
        render(<${name} />);
        expect(screen.getByText("${name}")).toBeTruthy();
      });
    });
  `;
}
