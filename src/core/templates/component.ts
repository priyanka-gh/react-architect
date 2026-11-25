import { code, PRINT_WIDTH } from "./code";

export interface ComponentTemplate {
  /** PascalCase component name, e.g. "UserCard". */
  name: string;
  withStyles: boolean;
}

export function componentSource({
  name,
  withStyles,
}: ComponentTemplate): string {
  const signature = functionSignature(name);
  const props = code`
    export interface ${name}Props {
      className?: string;
    }
  `;

  // The signature can span lines, so it's joined on rather than interpolated (see code()).
  if (!withStyles) {
    const body = code`
        return <div className={className}>${name}</div>;
      }
    `;
    return props + "\n" + signature + "\n" + body;
  }

  const imports = code`
    import styles from "./${name}.module.css";
  `;
  const body = code`
      const classes = [styles.root, className].filter(Boolean).join(" ");
      return <div className={classes}>${name}</div>;
    }
  `;
  return imports + "\n" + props + "\n" + signature + "\n" + body;
}

/** Long names push the signature past the print width; Prettier then wraps the destructured props. */
function functionSignature(name: string): string {
  const oneLine = `export function ${name}({ className }: ${name}Props) {`;
  if (oneLine.length <= PRINT_WIDTH) {
    return oneLine;
  }
  return `export function ${name}({\n  className,\n}: ${name}Props) {`;
}

export function componentStylesSource(): string {
  return code`
    .root {
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
