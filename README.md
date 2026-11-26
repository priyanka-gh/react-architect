# React Architect

Create React projects with a clear, feature-based structure, then keep adding components, hooks and features that follow the same conventions. Everything happens inside VS Code.

## Features

### Create a React project

Run **React Architect: Create React Project** from the Command Palette, or click **Create React Project** in the Explorer when no folder is open.

You choose a folder, a name, whether to add routing, and whether to install packages. You get a project that builds and passes its tests from the start:

- React, TypeScript and Vite
- a feature-based `src/` layout, with a starter `home` feature
- optional routing with React Router and a page layout
- Vitest and React Testing Library, already set up, with passing starter tests
- ESLint and Prettier, configured to agree with each other

Every step shows its progress and can be cancelled. If a step fails, React Architect offers to delete the half-made folder, but only a folder it created itself. If package installation fails, you keep the project and can retry.

### Generate code that fits the project

Right-click a folder in the Explorer and choose **React Architect**, or use the Command Palette:

- **Generate Component:** `UserCard/UserCard.tsx`, with a CSS Module and a test
- **Generate Hook:** `useCart.ts`, with a test
- **Generate Feature:** a folder with a component, hook, API service, types, and an `index.ts` that is the feature's public API

You can type names any way you like (`user card`, `userCard`, `user-card`), and React Architect names files consistently. Before writing anything, it shows every file it will create or change. If files already exist, you choose whether to overwrite or skip them. Names that differ only in capital letters are refused, because they clash on macOS and Windows.

When you generate a component or hook inside a feature, React Architect can also export it from that feature's `index.ts`, without ever adding the same export twice.

### Works with existing projects

**Set Up Existing Project** looks at your project and suggests settings: which folders you already use, whether you use another styling library, and whether Vitest and Testing Library are installed. You see each suggestion with its reason before anything is written. The same happens the first time you generate code in a project.

## The settings file

Each project has a `react-architect.json` next to its `package.json`. VS Code gives you autocomplete and checks for it.

```json
{
  "manifestVersion": 1,
  "language": "typescript",
  "architecture": "feature-based",
  "styling": "css-modules",
  "paths": {
    "components": "src/components",
    "hooks": "src/hooks",
    "features": "src/features"
  },
  "testing": {
    "framework": "vitest",
    "generateTests": true
  }
}
```

| Setting                 | What it controls                                                          |
| ----------------------- | ------------------------------------------------------------------------- |
| `styling`               | `"css-modules"` adds a `.module.css` to each component; `"none"` doesn't. |
| `paths`                 | Where each kind of code goes, relative to the settings file.              |
| `testing.framework`     | `"vitest"` generates tests; `"none"` turns them off.                      |
| `testing.generateTests` | The default answer when you're asked whether to include a test.           |

In a monorepo, each package can have its own `react-architect.json`. The nearest one wins.

## Requirements

- VS Code 1.100 or newer
- To create projects: Node.js 22.22.2 or newer on 22.x, 24.15 or newer on 24.x, or 26 and newer. React Architect checks this before it starts.

## Known limitations

- Generated code is TypeScript only.
- Only the feature-based layout and npm are supported so far.
- Generated tests use Vitest; projects that use Jest get no generated tests.
