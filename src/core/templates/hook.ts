import { code } from "./code";

export interface HookTemplate {
  /** Hook name including the "use" prefix, e.g. "useCart". */
  name: string;
}

export function hookSource({ name }: HookTemplate): string {
  return code`
    import { useState } from "react";

    export function ${name}() {
      const [value, setValue] = useState("");
      return { value, setValue };
    }
  `;
}

export function hookTestSource({ name }: HookTemplate): string {
  return code`
    import { act, renderHook } from "@testing-library/react";
    import { describe, expect, it } from "vitest";
    import { ${name} } from "./${name}";

    describe("${name}", () => {
      it("updates the value", () => {
        const { result } = renderHook(${name});
        act(() => result.current.setValue("next"));
        expect(result.current.value).toBe("next");
      });
    });
  `;
}
