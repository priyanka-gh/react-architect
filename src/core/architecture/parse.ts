import * as ts from "typescript";

/**
 * Reads a module's imports and exports with TypeScript's own parser (ADR 11),
 * so comments, strings and unusual formatting can't confuse it. Only syntax
 * is read: nothing is type-checked and no other file is opened.
 */

export interface ImportedName {
  /** The name in the module it comes from: `Avatar` in `{ Avatar as A }`. */
  name: string;
  typeOnly: boolean;
}

export interface ImportRef {
  /** The module specifier as written, e.g. "../../profile/components/Avatar/Avatar". */
  specifier: string;
  /** Offsets of the specifier's text, inside the quotes. */
  start: number;
  end: number;
  /** Zero-based position of `start`, for editors. */
  line: number;
  character: number;
  /**
   * What the statement brings in. "named" lists every name when the statement
   * only uses `{ ... }`; anything else (default, `* as`, side effect, dynamic
   * import, `export *`) can't be rewritten name by name.
   */
  form:
    | { kind: "named"; names: ImportedName[]; reExport: boolean }
    | { kind: "other" };
}

export interface ExportedName {
  name: string;
  line: number;
}

export interface ModuleInfo {
  imports: ImportRef[];
  /** Names this module exports itself or re-exports by name. */
  exports: ExportedName[];
  /** Specifiers of `export * from "..."` statements. */
  starExports: string[];
}

export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

export function isSourceFile(fileName: string): boolean {
  return (
    SOURCE_EXTENSIONS.some((extension) => fileName.endsWith(extension)) &&
    !fileName.endsWith(".d.ts")
  );
}

export function createSourceFile(
  fileName: string,
  text: string,
): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.[mc]?ts$/.test(fileName)) return ts.ScriptKind.TS;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

export function parseModule(fileName: string, text: string): ModuleInfo {
  const sourceFile = createSourceFile(fileName, text);
  const imports: ImportRef[] = [];
  const exports: ExportedName[] = [];
  const starExports: string[] = [];

  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;

  const addImport = (literal: ts.Node, form: ImportRef["form"]) => {
    if (!ts.isStringLiteralLike(literal)) {
      return;
    }
    const start = literal.getStart(sourceFile) + 1;
    const position = sourceFile.getLineAndCharacterOfPosition(start);
    imports.push({
      specifier: literal.text,
      start,
      end: literal.end - 1,
      line: position.line,
      character: position.character,
      form,
    });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      addImport(statement.moduleSpecifier, importForm(statement));
    } else if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          exports.push({ name: element.name.text, line: lineOf(element) });
        }
      } else if (clause !== undefined) {
        // export * as name from "..."
        exports.push({ name: clause.name.text, line: lineOf(clause) });
      }
      if (statement.moduleSpecifier !== undefined) {
        if (
          clause === undefined &&
          ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          starExports.push(statement.moduleSpecifier.text);
        }
        addImport(
          statement.moduleSpecifier,
          clause !== undefined && ts.isNamedExports(clause)
            ? {
                kind: "named",
                reExport: true,
                names: clause.elements.map((element) => ({
                  name: (element.propertyName ?? element.name).text,
                  typeOnly: statement.isTypeOnly || element.isTypeOnly,
                })),
              }
            : { kind: "other" },
        );
      }
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      addImport(statement.moduleReference.expression, { kind: "other" });
    } else if (ts.isExportAssignment(statement)) {
      exports.push({ name: "default", line: lineOf(statement) });
    } else {
      exports.push(...declaredExports(statement, lineOf));
    }
  }

  // Dynamic imports can be anywhere, such as in React.lazy(() => import("...")).
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined
    ) {
      addImport(node.arguments[0], { kind: "other" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  imports.sort((a, b) => a.start - b.start);
  return { imports, exports, starExports };
}

function importForm(statement: ts.ImportDeclaration): ImportRef["form"] {
  const clause = statement.importClause;
  if (
    clause === undefined ||
    clause.name !== undefined ||
    clause.namedBindings === undefined ||
    !ts.isNamedImports(clause.namedBindings)
  ) {
    return { kind: "other" };
  }
  return {
    kind: "named",
    reExport: false,
    names: clause.namedBindings.elements.map((element) => ({
      name: (element.propertyName ?? element.name).text,
      typeOnly: clause.isTypeOnly || element.isTypeOnly,
    })),
  };
}

function declaredExports(
  statement: ts.Statement,
  lineOf: (node: ts.Node) => number,
): ExportedName[] {
  const modifiers = ts.canHaveModifiers(statement)
    ? ts.getModifiers(statement)
    : undefined;
  if (!modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
    return [];
  }
  if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
    return [{ name: "default", line: lineOf(statement) }];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name)
        ? [{ name: declaration.name.text, line: lineOf(declaration) }]
        : [],
    );
  }
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name !== undefined
  ) {
    return [{ name: statement.name.text, line: lineOf(statement) }];
  }
  return [];
}

/** Every identifier in a file, with its offsets. Used to rename names. */
export function identifiers(
  fileName: string,
  text: string,
): { name: string; start: number; end: number }[] {
  const sourceFile = createSourceFile(fileName, text);
  const found: { name: string; start: number; end: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      found.push({
        name: node.text,
        start: node.getStart(sourceFile),
        end: node.end,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}
