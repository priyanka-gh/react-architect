# 1. A project manifest is the source of truth for conventions

**Status:** Accepted

## Context

Generators need to know where files go and which options a project uses, such as styling and tests. If they infer this from the folder layout on every run, they are guessing, and their behaviour becomes hard to predict or review.

## Decision

Each React project has a `react-architect.json` file next to its `package.json`. Generators read it and never guess.

- **Lookup:** walk up from the folder the user clicked (or the active editor's folder) to the nearest `react-architect.json`, stopping at the workspace folder root. This handles monorepos without extra configuration.
- **Creation:** the project generator writes the file.
- **Missing manifest (MVP):** offer to create one with the defaults, showing it first. Inference from an existing project's layout comes in Phase 4, and only ever produces a proposal that the user confirms.
- **Editor support:** the extension contributes a JSON Schema through `contributes.jsonValidation`, so the file gets autocomplete and validation.

Version 1 of the schema (the real file is plain JSON, so it has no comments or trailing commas):

<!-- prettier-ignore -->
```jsonc
{
  "manifestVersion": 1,
  "language": "typescript",          // only value in v1
  "architecture": "feature-based",   // only value in v1
  "styling": "css-modules",          // "css-modules" | "none"
  "paths": {
    "components": "src/components",
    "hooks": "src/hooks",
    "features": "src/features"
  },
  "testing": {
    "framework": "vitest",           // "vitest" | "none"
    "generateTests": true            // default answer to "Include a test?"
  }
}
```

Rules:

- Paths are relative to the manifest's directory, use `/`, and must resolve inside it.
- Missing optional fields take their defaults. Unknown fields produce a warning, not an error, for forward compatibility.
- An unsupported `manifestVersion` is an error that names the version this extension supports.
- A field is added only when a second option for it is actually implemented. Naming conventions are therefore fixed in v1 (see [ADR 5](0005-conventions-for-generated-code.md)).

## Consequences

- Generation is predictable, and convention changes are reviewable in a pull request.
- Validation is hand-written in `core/manifest/schema.ts`, since the schema is small and a runtime validation library isn't worth the dependency. A unit test runs the same fixtures through the TypeScript validator and the JSON Schema (with Ajv as a dev dependency) so the two cannot drift.
