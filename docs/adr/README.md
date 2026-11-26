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
| [10](0010-project-creation-choices.md)             | Choices when creating a project, and the 7-day rule for pinned versions       | Accepted |
| [11](0011-keeping-the-structure.md)                | Structure rules, Project Map, Generate Page, Rename and Move                  | Accepted |
| [12](0012-structure-as-data.md)                    | The project structure is data, and the rules follow it                        | Accepted |
| [13](0013-choosing-and-enforcing-structures.md)    | Choosing, importing and enforcing a structure, and the CI check               | Accepted |

All records were accepted on 2026-11-26.
