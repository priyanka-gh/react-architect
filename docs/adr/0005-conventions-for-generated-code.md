# 5. Conventions for generated code

**Status:** Accepted

## Names

Users can type a name in any form: `user card`, `userCard`, `UserCard` or `user-card`. `core/naming.ts` splits it into words and derives the PascalCase, camelCase and kebab-case forms.

- Valid input starts with a letter, contains only letters, digits, spaces, `-` and `_`, and is at most 30 characters long. The limit keeps generated lines within Prettier's width (ADR 2) and paths well under Windows' length limit.
- There is no reserved-word check. Every generated identifier is either PascalCase (`Import`) or carries a prefix or suffix (`useImport`, `importApi`), so none can be a JavaScript reserved word. A check would only reject reasonable names, such as an `import` feature.
- For hooks, a leading `use` is accepted and not doubled, so both `cart` and `useCart` give `useCart`.

## Layout

| Artifact  | Input          | Files                                                                                 |
| --------- | -------------- | ------------------------------------------------------------------------------------- |
| Component | `user card`    | `UserCard/UserCard.tsx`, `UserCard/UserCard.module.css`, `UserCard/UserCard.test.tsx` |
| Hook      | `cart`         | `useCart.ts`, `useCart.test.ts`                                                       |
| Feature   | `user profile` | `user-profile/` (shown below)                                                         |

**Where files go:**

- From the command palette, files go under the matching manifest path (`paths.components`, `paths.hooks` or `paths.features`).
- From the Explorer context menu, they go inside the folder the user clicked.

A generated feature looks like this:

```text
features/user-profile/
├── components/UserProfile/UserProfile.tsx   (+ .module.css, .test.tsx)
├── hooks/useUserProfile.ts                  (+ .test.ts)
├── services/userProfileApi.ts
├── types.ts
└── index.ts
```

A feature gets a single `types.ts` until it needs more than one types file. Its main type is called `<Name>Data` (for example `UserProfileData`), so it can't clash with the `<Name>` component in the feature's `index.ts`.

Generated tests use only Vitest and React Testing Library (`expect(...).toBeTruthy()` rather than jest-dom matchers), so they also run in existing projects that don't have jest-dom set up.

The stylesheet is generated only when `styling` is `css-modules`. A test is generated only when `testing.framework` isn't `none` and the user accepts the prompt, which defaults to `testing.generateTests`.

## Code style

- **Named exports only,** with no default exports. Named exports are searchable, safe to rename, and fit the feature index (see [ADR 6](0006-feature-public-api.md)).
- **Components are function declarations.** Each component's props are an interface named `<Name>Props` in the same file.
- **Relative imports only** in v1, with no `@/` alias, so generated code works in any project without tsconfig or Vite alias setup.
- **Tests import from `vitest` explicitly** (`describe`, `it`, `expect`) rather than relying on globals, and use React Testing Library.
