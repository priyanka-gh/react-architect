import * as ts from "typescript";
import type { TextChange } from "../plan";
import { createSourceFile } from "./parse";

/**
 * Adds a route to a React Router routes file by reading it as code, not
 * text (ADR 11). It handles the data-router style generated projects use:
 *
 *   createBrowserRouter([
 *     { path: "/", element: <AppLayout />, children: [ ...routes... ] },
 *   ])
 *
 * When a single layout route holds child routes, the new route goes among
 * the children, with a relative path. Otherwise it goes in the top-level
 * list. Anything the function doesn't recognise is reported, never guessed.
 */

export interface RouteRequest {
  /** "SettingsPage" */
  component: string;
  /** Where to import the component from, as the routes file should write it. */
  importFrom: string;
  /** "/settings" or "/users/:id" */
  path: string;
}

export type AddRouteResult =
  | { ok: true; changes: TextChange[]; routePath: string }
  | { ok: false; reason: string };

const ROUTER_FUNCTIONS = new Set([
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
  "useRoutes",
]);

export function addRoute(
  fileName: string,
  text: string,
  request: RouteRequest,
): AddRouteResult {
  const sourceFile = createSourceFile(fileName, text);
  const routes = findRoutesArray(sourceFile);
  if (routes === undefined) {
    return {
      ok: false,
      reason: `couldn't find a createBrowserRouter([...]) call or a routes array in ${fileName}`,
    };
  }

  const layout = singleLayoutChildren(routes);
  const list = layout ?? routes;
  const routePath = layout ? request.path.replace(/^\/+/, "") : request.path;
  const normalize = (value: string) => value.replace(/^\/+|\/+$/g, "");

  for (const element of list.elements) {
    const existing = ts.isObjectLiteralExpression(element)
      ? stringProperty(element, "path")
      : undefined;
    if (
      existing !== undefined &&
      normalize(existing) === normalize(request.path)
    ) {
      return {
        ok: false,
        reason: `there is already a route for "${request.path}"`,
      };
    }
  }

  const imported = importedNames(sourceFile);
  if (imported.has(request.component)) {
    return {
      ok: false,
      reason: `${fileName} already imports something called ${request.component}`,
    };
  }

  const route = `{ path: ${JSON.stringify(routePath)}, element: <${request.component} /> }`;
  return {
    ok: true,
    routePath: request.path,
    changes: [
      importChange(sourceFile, request),
      insertIntoArray(sourceFile, text, list, route),
    ].sort((a, b) => b.start - a.start),
  };
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function findRoutesArray(
  sourceFile: ts.SourceFile,
): ts.ArrayLiteralExpression | undefined {
  const variables = new Map<string, ts.Expression>();
  let routerArgument: ts.Expression | undefined;
  let routesVariable: ts.Expression | undefined;

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      variables.set(node.name.text, node.initializer);
      if (node.name.text === "routes") {
        routesVariable = node.initializer;
      }
    }
    if (
      routerArgument === undefined &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ROUTER_FUNCTIONS.has(node.expression.text) &&
      node.arguments[0] !== undefined
    ) {
      routerArgument = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  let candidate = routerArgument ?? routesVariable;
  if (candidate !== undefined && ts.isIdentifier(unwrap(candidate))) {
    candidate = variables.get((unwrap(candidate) as ts.Identifier).text);
  }
  if (candidate === undefined) {
    return undefined;
  }
  const array = unwrap(candidate);
  return ts.isArrayLiteralExpression(array) ? array : undefined;
}

/** The children of the only route that has children, if there is exactly one. */
function singleLayoutChildren(
  routes: ts.ArrayLiteralExpression,
): ts.ArrayLiteralExpression | undefined {
  const layouts = routes.elements.flatMap((element) => {
    if (!ts.isObjectLiteralExpression(element)) return [];
    const path = stringProperty(element, "path");
    if (path !== undefined && path !== "/" && path !== "") return [];
    const children = property(element, "children");
    return children !== undefined &&
      ts.isArrayLiteralExpression(unwrap(children))
      ? [unwrap(children) as ts.ArrayLiteralExpression]
      : [];
  });
  return layouts.length === 1 ? layouts[0] : undefined;
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const entry of object.properties) {
    if (
      ts.isPropertyAssignment(entry) &&
      (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
      entry.name.text === name
    ) {
      return entry.initializer;
    }
  }
  return undefined;
}

function stringProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const value = property(object, name);
  return value !== undefined && ts.isStringLiteralLike(value)
    ? value.text
    : undefined;
}

function importedNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    const clause = ts.isImportDeclaration(statement)
      ? statement.importClause
      : undefined;
    if (clause === undefined) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      bindings.elements.forEach((element) => names.add(element.name.text));
    } else if (bindings) {
      names.add(bindings.name.text);
    }
  }
  return names;
}

/** Adds the component to an existing `import { ... } from` the same place, or a new import line. */
function importChange(
  sourceFile: ts.SourceFile,
  request: RouteRequest,
): TextChange {
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  for (const statement of imports) {
    const bindings = statement.importClause?.namedBindings;
    if (
      !statement.importClause?.isTypeOnly &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === request.importFrom &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0
    ) {
      const last = bindings.elements[bindings.elements.length - 1]!;
      return { start: last.end, end: last.end, text: `, ${request.component}` };
    }
  }
  const line = `import { ${request.component} } from ${JSON.stringify(request.importFrom)};`;
  const lastImport = imports[imports.length - 1];
  return lastImport === undefined
    ? { start: 0, end: 0, text: line + "\n" }
    : { start: lastImport.end, end: lastImport.end, text: "\n" + line };
}

function indentationAt(text: string, position: number): string {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

function insertIntoArray(
  sourceFile: ts.SourceFile,
  text: string,
  array: ts.ArrayLiteralExpression,
  route: string,
): TextChange {
  const open = array.getStart(sourceFile);
  const close = array.end - 1;
  const outer = indentationAt(text, open);
  const lineOf = (position: number) =>
    sourceFile.getLineAndCharacterOfPosition(position).line;
  const elements = array.elements;
  const last = elements[elements.length - 1];

  // One element per line already: add another line after the last one.
  if (
    last !== undefined &&
    lineOf(elements[0]!.getStart(sourceFile)) !== lineOf(open)
  ) {
    const inner = indentationAt(text, last.getStart(sourceFile));
    if (elements.hasTrailingComma) {
      const comma = text.indexOf(",", last.end);
      return { start: comma + 1, end: comma + 1, text: `\n${inner}${route},` };
    }
    return { start: last.end, end: last.end, text: `,\n${inner}${route}` };
  }

  // Empty or all on one line: rewrite it with one element per line, the way
  // Prettier would once it no longer fits.
  const inner = outer + "  ";
  const items = [
    ...elements.map((element) => element.getText(sourceFile)),
    route,
  ];
  return {
    start: open,
    end: close + 1,
    text: `[\n${items.map((item) => `${inner}${item},`).join("\n")}\n${outer}]`,
  };
}
