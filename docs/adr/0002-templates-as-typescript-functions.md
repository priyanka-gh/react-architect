# 2. Built-in templates are TypeScript functions

**Status:** Accepted

## Context

The original proposal used Handlebars. Handlebars has several problems for generating React code:

- Its `{{ }}` delimiters collide with JSX object literals such as `style={{ color: 'red' }}`.
- It HTML-escapes output by default.
- It doesn't type-check the template context.
- Its `.hbs` files must be copied next to the esbuild bundle and loaded at runtime.

## Decision

Built-in templates are functions of the form `(ctx: SomeContext) => string`, kept in `src/core/templates/`. The extension uses no template engine.

- Templates contain only conditionals on their context. File paths and names are decided by the generators.
- Templates emit code that is already formatted to Prettier's defaults, which is the configuration generated projects use. The end-to-end test runs `prettier --check` on generated code to enforce this.
- A small internal `dedent` helper handles indentation inside template literals. It doesn't need a dependency.

## Consequences

- Templates are type-checked, bundle with the rest of the code, and are tested with plain snapshot tests.
- Users can't customise templates without changing the extension's code. That's acceptable for the MVP.

## Revisit when

User-defined templates are implemented. At that point, choose an engine for user templates only; candidates are Eta, or EJS with delimiters other than `{{`. Built-in templates can stay as functions.
