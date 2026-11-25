import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "out/", ".vscode-test/", "coverage/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // core/ holds pure logic that must run and be tested without VS Code (ADR 8).
    // Side effects are passed in as parameters, so core/ must not reach into infra/ or commands/ either.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vscode",
              message:
                "src/core must not depend on VS Code. Move UI code to src/commands, or pass what you need in as a parameter.",
            },
          ],
          patterns: [
            {
              group: ["**/infra/**", "**/commands/**"],
              message:
                "src/core must not import from infra/ or commands/. Pass side effects in as parameters.",
            },
          ],
        },
      ],
    },
  },
);
