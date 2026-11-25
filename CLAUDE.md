# React Architect

A VS Code extension (portfolio project) that scaffolds React + Vite projects and generates components, hooks and features that follow a project's declared conventions.

## Before changing anything

- Design decisions are in `docs/adr/`. Follow them; if a change contradicts one, update the ADR in the same change and say so.
- The roadmap and current phase are in `README.md`.

## Structure rules

- `src/core/` is pure logic. It must not import `vscode`, `src/infra/` or `src/commands/` (enforced by ESLint). Side effects are passed in as parameters.
- `src/commands/` is VS Code UI only; `src/infra/` holds side effects (processes, file writers).
- Generators return file plans; they never write files themselves (ADR 4).

## Checks to run before calling work done

```sh
npm run check-types && npm run lint && npm run format:check && npm run test:unit && npm run test:integration
```

## Versions

- `@types/vscode` stays pinned exactly to the `engines.vscode` floor (1.100.0).
- TypeScript is 6.0.x because typescript-eslint doesn't support 7 yet.
- Look up versions with `npm view`; don't pin from memory.

## Working with the owner

- Explain things in plain language.
- Don't commit or push unless asked.
