# Architecture decision records

Each record states one decision, why it was made, and when to revisit it. To change a decision, add a new record that supersedes the old one; don't rewrite history.

| #                                                  | Decision                                                                      | Status   |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| [1](0001-project-manifest.md)                      | A `react-architect.json` manifest is the source of truth for conventions      | Accepted |
| [2](0002-templates-as-typescript-functions.md)     | Built-in templates are TypeScript functions, not a template engine            | Accepted |
| [3](0003-base-scaffold-with-pinned-create-vite.md) | New projects start from create-vite at a pinned version, then get our overlay | Accepted |
| [4](0004-file-plans-and-writers.md)                | Generators return file plans; one checked writer applies them                 | Accepted |
| [5](0005-conventions-for-generated-code.md)        | Naming, layout and code style of generated code                               | Accepted |
| [6](0006-feature-public-api.md)                    | The feature `index.ts` is the only barrel file                                | Accepted |
| [7](0007-generated-project-stack.md)               | What a generated project contains                                             | Accepted |
| [8](0008-extension-tooling.md)                     | How the extension itself is built, structured and tested                      | Accepted |
| [9](0009-failure-and-cancellation.md)              | Failure, cancellation and cleanup behaviour                                   | Accepted |

All records were accepted on 2026-11-26.
