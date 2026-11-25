# 6. The feature `index.ts` is the only barrel file

**Status:** Accepted

## Context

Barrel files (`index.ts` files that re-export other modules) are convenient, but they have costs. In Vite's dev server, importing from a barrel loads every module it re-exports, which slows hot module replacement and test startup. Barrels also hide circular imports. A barrel does earn its place in one spot: at a boundary, where it defines what a module exposes.

## Decision

- `features/<name>/index.ts` is the feature's public API. It is the only barrel the extension generates. Component folders, `components/` and `hooks/` never get an `index.ts`.
- The feature generator writes `index.ts` exporting the feature's main component, its hook, its service function and its types.
- When a component or hook is generated inside an existing feature, it stays internal by default. The user is asked "Export `<Name>` from the `<feature>` public API?", with No as the default. Yes adds an `ensureLine` operation (see [ADR 4](0004-file-plans-and-writers.md)), which never duplicates an export.
- Code outside a feature imports it only through `index.ts`. This is a convention in the MVP. After the MVP, it will be enforced by lint rules generated from the manifest.

## Consequences

The project's module graph stays shallow, and each feature's boundary is explicit and easy to see in review.
