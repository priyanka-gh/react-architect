import * as path from "node:path";
import * as vscode from "vscode";
import { specifierFor, usesAlias } from "../core/architecture/modules";
import { parseModule } from "../core/architecture/parse";
import { addRoute } from "../core/architecture/routes";
import { findConflicts } from "../core/conflicts";
import { enclosingFeature } from "../core/generators/featureIndex";
import {
  featurePageLocation,
  pageFilesAt,
  pageNames,
  routePathProblem,
  structurePageLocation,
} from "../core/generators/page";
import { parseName } from "../core/naming";
import { normalizeRelativePath } from "../core/paths";
import { checkPlan, type FileOperation, type FilePlan } from "../core/plan";
import { readDirectory, readTextFileIfExists } from "../infra/fileSystem";
import { listSourceFiles, readAliases, readFiles } from "../infra/projectFiles";
import { writePlanInWorkspace } from "../infra/workspaceEditWriter";
import { loadProject, startFolder } from "./generateArtifact";
import { vscodePrompts, type Prompts } from "./prompts";

export interface FeatureChoice {
  /** Project-relative feature folder. */
  folder: string;
  isNew: boolean;
}

/** Generate Page asks these on top of the generate commands' questions. */
export interface PagePrompts extends Prompts {
  pickFeature(
    page: string,
    choices: FeatureChoice[],
  ): Promise<FeatureChoice | undefined>;
  askRoutePath(
    defaultPath: string,
    validate: (value: string) => string | undefined,
  ): Promise<string | undefined>;
}

export const vscodePagePrompts: PagePrompts = {
  ...vscodePrompts,

  async pickFeature(page, choices) {
    const items = choices.map((choice) => ({
      label: choice.isNew
        ? `$(add) New feature: ${path.posix.basename(choice.folder)}`
        : `$(symbol-module) ${path.posix.basename(choice.folder)}`,
      description: choice.folder,
      choice,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      title: `Generate Page: which feature does ${page} belong to?`,
      placeHolder: "Pages live in a feature and are exported from its index.ts",
      ignoreFocusOut: true,
    });
    return picked?.choice;
  },

  async askRoutePath(defaultPath, validate) {
    return vscode.window.showInputBox({
      title: "Generate Page: route",
      prompt: "The page's address in the app",
      value: defaultPath,
      validateInput: validate,
      ignoreFocusOut: true,
    });
  },
};

export type PageOutcome =
  | {
      status: "generated";
      root: string;
      files: string[];
      /** The routes file the page was added to, or why it wasn't. */
      route: { file: string; path: string } | { notAdded: string };
    }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

const ROUTES_FILE_CANDIDATES = [
  "src/app/routes.tsx",
  "src/app/router.tsx",
  "src/routes.tsx",
  "src/router.tsx",
  "src/app/routes.ts",
  "src/routes/index.tsx",
  "src/main.tsx",
  "src/App.tsx",
];

/**
 * Generate Page (ADR 11): a page component in a feature, exported from the
 * feature's index.ts and added to the app's React Router routes.
 */
export async function generatePage(
  clickedFolder: vscode.Uri | undefined,
  prompts: PagePrompts = vscodePagePrompts,
): Promise<PageOutcome> {
  const fail = (message: string): PageOutcome => {
    prompts.showError(message);
    return { status: "failed", message };
  };
  const cancelled: PageOutcome = { status: "cancelled" };

  const start = await startFolder(clickedFolder, prompts);
  const workspaceFolder =
    start && vscode.workspace.getWorkspaceFolder(start)?.uri.fsPath;
  if (start === undefined || workspaceFolder === undefined) {
    return fail("Open a React project first: pages are generated inside one.");
  }
  const project = await loadProject(start.fsPath, workspaceFolder, prompts);
  if (project.status !== "loaded") {
    return project.status === "failed" ? fail(project.message) : cancelled;
  }
  const { root, manifest, extraOperations } = project;

  // 1. The page's name.
  const rawName = await prompts.askName({
    title: "Generate Page",
    placeholder: "For example: settings",
    validate: (value) => {
      const result = parseName(value);
      return result.ok ? undefined : result.error;
    },
  });
  if (rawName === undefined) return cancelled;
  const parsed = parseName(rawName);
  if (!parsed.ok) return fail(parsed.error);
  const names = pageNames(parsed.name);

  // 2. Where it goes: the structure's pages layer if it has one
  // (plans/custom-structure.md, Phase 5), otherwise a feature.
  let location = structurePageLocation(names, manifest);
  if (location === undefined) {
    let featureFolder: string | undefined;
    if (clickedFolder !== undefined) {
      const relative = normalizeRelativePath(
        path.relative(root, clickedFolder.fsPath).split(path.sep).join("/") ||
          ".",
      );
      featureFolder = relative.ok
        ? enclosingFeature(relative.path, manifest)
        : undefined;
    }
    if (featureFolder === undefined) {
      const existing = (
        (await readDirectory(path.join(root, manifest.paths.features))) ?? []
      )
        .filter((entry) => entry.isDirectory && !entry.name.startsWith("."))
        .map((entry) => path.posix.join(manifest.paths.features, entry.name))
        .sort();
      const sameName = path.posix.join(manifest.paths.features, names.kebab);
      const choices: FeatureChoice[] = existing.includes(sameName)
        ? [
            { folder: sameName, isNew: false },
            ...existing
              .filter((f) => f !== sameName)
              .map((folder) => ({ folder, isNew: false })),
          ]
        : [
            { folder: sameName, isNew: true },
            ...existing.map((folder) => ({ folder, isNew: false })),
          ];
      const picked = await prompts.pickFeature(names.component, choices);
      if (picked === undefined) return cancelled;
      featureFolder = picked.folder;
    }
    location = featurePageLocation(featureFolder);
  }

  // 3. A test, and the route.
  let includeTests = false;
  if (manifest.testing.framework !== "none") {
    const answer = await prompts.askYesNo(
      `Include a test for ${names.component}?`,
      manifest.testing.generateTests,
    );
    if (answer === undefined) return cancelled;
    includeTests = answer;
  }

  const usesRouter = await projectUsesReactRouter(root);
  let routePath: string | undefined;
  if (usesRouter) {
    routePath = await prompts.askRoutePath(`/${names.kebab}`, routePathProblem);
    if (routePath === undefined) return cancelled;
    const problem = routePathProblem(routePath);
    if (problem !== undefined) return fail(problem);
  }

  // 4. The plan: the page, its export, and the routes change if it can be made.
  const page = pageFilesAt(names, location, manifest, includeTests);
  const operations: FileOperation[] = [...extraOperations, ...page.operations];
  let route: { file: string; path: string } | { notAdded: string };
  if (routePath === undefined) {
    route = { notAdded: "this project doesn't use React Router" };
  } else {
    const found = await routeChange(
      root,
      location.importTarget,
      names.component,
      routePath,
    );
    if ("operation" in found) {
      operations.push(found.operation);
      route = { file: found.operation.path, path: routePath };
    } else {
      route = { notAdded: found.reason };
    }
  }

  const plan: FilePlan = { root, operations };
  const problems = checkPlan(plan);
  if (problems.length > 0) {
    return fail(`Can't generate ${names.component}: ${problems.join(" ")}`);
  }
  const conflicts = await findConflicts(plan, readDirectory);
  if (conflicts.length > 0) {
    return fail(
      `Can't generate ${names.component}: ${conflicts.map((c) => c.path).join(", ")} already exists.`,
    );
  }

  const lines = operations.map((operation) =>
    operation.kind === "create"
      ? `New  ${operation.path}`
      : operation.kind === "edit"
        ? `Update  ${operation.path}  (adds the ${routePath} route)`
        : `Update  ${operation.path}`,
  );
  if ("notAdded" in route) {
    lines.push("", `Not added to any routes: ${route.notAdded}.`);
  }
  if (
    !(await prompts.confirmPlan(`Generate page ${names.component}?`, lines))
  ) {
    return cancelled;
  }
  if (!(await writePlanInWorkspace(plan))) {
    return fail(
      "VS Code couldn't write the files (one may have changed meanwhile), so nothing was changed.",
    );
  }

  await vscode.window.showTextDocument(
    vscode.Uri.file(path.join(root, ...page.mainFile.split("/"))),
  );
  if ("notAdded" in route && usesRouter) {
    prompts.showWarning(
      `${names.component} wasn't added to the routes: ${route.notAdded}. Add { path: "${routePath}", element: <${names.component} /> } to them yourself.`,
    );
  }
  return {
    status: "generated",
    root,
    files: operations.map((operation) => operation.path),
    route,
  };
}

async function projectUsesReactRouter(root: string): Promise<boolean> {
  const text = await readTextFileIfExists(path.join(root, "package.json"));
  try {
    const json = JSON.parse(text ?? "{}") as Record<
      string,
      Record<string, string> | undefined
    >;
    return ["dependencies", "devDependencies"].some(
      (field) =>
        json[field]?.["react-router"] !== undefined ||
        json[field]?.["react-router-dom"] !== undefined,
    );
  } catch {
    return false;
  }
}

/**
 * Finds the routes file and works out the change: the likely files first,
 * then any source file that creates a router.
 */
async function routeChange(
  root: string,
  /** What the routes file should import: a unit's folder, or the page file. */
  importTarget: string,
  component: string,
  routePath: string,
): Promise<{ operation: FileOperation } | { reason: string }> {
  const aliases = await readAliases(root);
  const candidates = await readFiles(root, ROUTES_FILE_CANDIDATES);
  const tried = new Set(candidates.keys());
  const others = (await listSourceFiles(root)).filter(
    (file) => !tried.has(file),
  );
  for (const [file, text] of await readFiles(root, others)) {
    candidates.set(file, text);
  }

  let firstReason: string | undefined;
  for (const [file, text] of candidates) {
    if (!/create(Browser|Hash|Memory)Router\s*\(|useRoutes\s*\(/.test(text))
      continue;
    const preferAlias = parseModule(file, text).imports.some((ref) =>
      usesAlias(ref.specifier, aliases),
    );
    const result = addRoute(file, text, {
      component,
      importFrom: specifierFor(file, importTarget, aliases, preferAlias),
      path: routePath,
    });
    if (result.ok) {
      return {
        operation: {
          kind: "edit",
          path: file,
          expectedText: text,
          changes: result.changes,
        },
      };
    }
    firstReason ??= `${result.reason} (${file})`;
  }
  return { reason: firstReason ?? "no routes file was found" };
}
