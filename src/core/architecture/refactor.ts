import * as path from "node:path";
import * as ts from "typescript";
import type { Manifest } from "../manifest/schema";
import type { NameForms } from "../naming";
import type { TextChange } from "../plan";
import {
  areaOf,
  resolveSpecifier,
  specifierFor,
  usesAlias,
  withoutSourceExtension,
  type PathAlias,
} from "./modules";
import { createSourceFile, isSourceFile, parseModule } from "./parse";

/**
 * Rename Feature and Move to Shared Components (ADR 11). Both compute every
 * change up front from the project's files, so the user can preview them and
 * they can be applied as one edit:
 *
 * 1. text changes, against the files as they are now, then
 * 2. renames, deepest first, so each one's path is still valid when it runs.
 */

export interface Rename {
  from: string;
  to: string;
}

export interface RefactorPlan {
  /** Keyed by each file's current path. */
  changes: Map<string, TextChange[]>;
  /** In the order they must run. */
  renames: Rename[];
  /** Old name -> new name, for names declared in a renamed feature. */
  renamedNames: Map<string, string>;
  /** Files outside the moved folder whose imports change. */
  updatedImporters: string[];
  warnings: string[];
}

export interface ProjectSources {
  /** Every source file in the project: project-relative path -> text. */
  sources: ReadonlyMap<string, string>;
  /** Every file inside the folder being moved, including non-source files. */
  filesInFolder: readonly string[];
  manifest: Manifest;
  aliases: readonly PathAlias[];
}

/**
 * Renames `feature` (a folder under paths.features) to `newName`, including
 * the files and names inside it that were named after it.
 */
export function planFeatureRename(
  project: ProjectSources,
  featureFolder: string,
  oldName: NameForms,
  newName: NameForms,
): RefactorPlan {
  const newFolder = path.posix.join(
    path.posix.dirname(featureFolder),
    newName.kebab,
  );
  const rename = nameRenamer(oldName, newName);
  const mapPath = (file: string): string => {
    if (file !== featureFolder && !file.startsWith(featureFolder + "/")) {
      return file;
    }
    const rest = file.slice(featureFolder.length);
    return newFolder + rest.split("/").map(rename).join("/");
  };

  const plan = planMove(project, mapPath);
  plan.renames = [
    ...segmentRenames(featureFolder, project.filesInFolder, rename),
    { from: featureFolder, to: newFolder },
  ];

  renameDeclaredNames(project, featureFolder, rename, plan);
  return plan;
}

/** Moves `folder` (a component folder inside a feature) to `destination`. */
export function planMoveToShared(
  project: ProjectSources,
  folder: string,
  destination: string,
): RefactorPlan {
  const mapPath = (file: string) =>
    file === folder || file.startsWith(folder + "/")
      ? destination + file.slice(folder.length)
      : file;
  const plan = planMove(project, mapPath);
  plan.renames = [{ from: folder, to: destination }];

  // Once moved, the folder is shared code: its imports from features break the sharedCode rule.
  for (const [file, text] of project.sources) {
    if (mapPath(file) === file) continue;
    for (const ref of parseModule(file, text).imports) {
      const target = resolveSpecifier(file, ref.specifier, project.aliases);
      if (target === undefined) continue;
      const area = areaOf(mapPath(target), project.manifest);
      if (area.kind === "feature") {
        plan.warnings.push(
          `${path.posix.basename(file)} imports "${ref.specifier}" from the "${area.feature}" feature. After the move, shared code would depend on that feature.`,
        );
      }
    }
  }
  return plan;
}

/**
 * Moves or renames one file or folder from `from` to `to` (both
 * project-relative), updating every import of it and in it. Used by the
 * placement and naming quick fixes.
 */
export function planMovePath(
  project: ProjectSources,
  from: string,
  to: string,
): RefactorPlan {
  // Imports usually leave out the extension: "./useCart" for useCart.ts.
  const fromModule = withoutSourceExtension(from);
  const toModule = withoutSourceExtension(to);
  const mapPath = (file: string) =>
    file === from || file.startsWith(from + "/")
      ? to + file.slice(from.length)
      : fromModule !== from && file === fromModule
        ? toModule
        : file;
  const plan = planMove(project, mapPath);
  plan.renames = [{ from, to }];
  return plan;
}

function planMove(
  project: ProjectSources,
  mapPath: (file: string) => string,
): RefactorPlan {
  const changes = new Map<string, TextChange[]>();
  const updatedImporters: string[] = [];

  for (const [file, text] of project.sources) {
    const newFile = mapPath(file);
    for (const ref of parseModule(file, text).imports) {
      const target = resolveSpecifier(file, ref.specifier, project.aliases);
      if (target === undefined) continue;
      const newTarget = mapPath(target);
      if (newFile === file && newTarget === target) continue;

      const query = ref.specifier.includes("?")
        ? ref.specifier.slice(ref.specifier.indexOf("?"))
        : "";
      const specifier =
        specifierFor(
          newFile,
          newTarget,
          project.aliases,
          usesAlias(ref.specifier, project.aliases),
        ) + query;
      if (specifier !== ref.specifier) {
        add(changes, file, { start: ref.start, end: ref.end, text: specifier });
        if (newFile === file && !updatedImporters.includes(file)) {
          updatedImporters.push(file);
        }
      }
    }
  }

  return {
    changes,
    renames: [],
    renamedNames: new Map(),
    updatedImporters: updatedImporters.sort(),
    warnings: [],
  };
}

function add(
  changes: Map<string, TextChange[]>,
  file: string,
  change: TextChange,
) {
  const list = changes.get(file) ?? [];
  if (!list.some((existing) => existing.start === change.start)) {
    list.push(change);
  }
  changes.set(file, list);
}

/**
 * Renames inside the folder for every file or folder named after the feature,
 * deepest first. Each `from` is still valid when it runs, because only things
 * below it have been renamed by then.
 */
function segmentRenames(
  folder: string,
  files: readonly string[],
  rename: (segment: string) => string,
): Rename[] {
  const paths = new Set<string>();
  for (const file of files) {
    const rest = file.slice(folder.length + 1).split("/");
    for (let depth = 1; depth <= rest.length; depth += 1) {
      paths.add(`${folder}/${rest.slice(0, depth).join("/")}`);
    }
  }
  return [...paths]
    .map((current) => {
      const base = path.posix.basename(current);
      return {
        from: current,
        to: `${path.posix.dirname(current)}/${rename(base)}`,
        base,
      };
    })
    .filter(({ base, from, to }) => base !== "" && from !== to)
    .sort(
      (a, b) =>
        b.from.split("/").length - a.from.split("/").length ||
        a.from.localeCompare(b.from),
    )
    .map(({ from, to }) => ({ from, to }));
}

/**
 * Turns names made from the old feature name into the new one, on word
 * boundaries: with "user profile" -> "account", "UserProfile" ->
 * "Account", "useUserProfile" -> "useAccount", "userProfileApi.ts" ->
 * "accountApi.ts", but "UserProfiles" (a different word) stays.
 */
export function nameRenamer(
  oldName: NameForms,
  newName: NameForms,
): (name: string) => string {
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pascal = new RegExp(
    `(?<![A-Z])${escape(oldName.pascal)}(?![a-z])`,
    "g",
  );
  const camel = new RegExp(`^${escape(oldName.camel)}(?![a-z])`);
  return (name) =>
    name.replace(pascal, newName.pascal).replace(camel, newName.camel);
}

const DECLARATION_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.VariableDeclaration,
]);

/**
 * Renames the names declared in the feature that were named after it, there
 * and in the files that import them. Names a file imports from elsewhere are
 * left alone, so a `User` type from shared code keeps its name.
 */
function renameDeclaredNames(
  project: ProjectSources,
  featureFolder: string,
  rename: (name: string) => string,
  plan: RefactorPlan,
): void {
  const inFeature = (file: string) => file.startsWith(featureFolder + "/");
  const parsed = new Map<string, ts.SourceFile>();
  const parse = (file: string) => {
    let sourceFile = parsed.get(file);
    if (sourceFile === undefined) {
      sourceFile = createSourceFile(file, project.sources.get(file) ?? "");
      parsed.set(file, sourceFile);
    }
    return sourceFile;
  };

  // 1. Which names does the feature declare that should change?
  for (const file of project.sources.keys()) {
    if (!inFeature(file) || !isSourceFile(file)) continue;
    const visit = (node: ts.Node): void => {
      if (DECLARATION_KINDS.has(node.kind)) {
        const name = (node as ts.DeclarationStatement).name;
        if (
          name !== undefined &&
          ts.isIdentifier(name) &&
          rename(name.text) !== name.text
        ) {
          plan.renamedNames.set(name.text, rename(name.text));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  if (plan.renamedNames.size === 0) return;

  // 2. Rename them where they're used.
  for (const file of project.sources.keys()) {
    const sourceFile = parse(file);
    const fromFeature = new Set<string>();
    const fromElsewhere = new Set<string>();
    const keepPublicName: ts.ExportSpecifier[] = [];
    const renameOnlyProperty: ts.Identifier[] = [];

    for (const statement of sourceFile.statements) {
      const specifier =
        ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
          ? statement.moduleSpecifier
          : undefined;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
      const target = resolveSpecifier(file, specifier.text, project.aliases);
      const fromThisFeature =
        target !== undefined && (target === featureFolder || inFeature(target));

      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        // A default import's local name is the importer's choice; leave it.
        if (clause?.name) fromElsewhere.add(clause.name.text);
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          fromElsewhere.add(bindings.name.text);
        } else if (bindings) {
          for (const element of bindings.elements) {
            const original = (element.propertyName ??
              element.name) as ts.Identifier;
            if (!fromThisFeature || !plan.renamedNames.has(original.text)) {
              fromElsewhere.add(element.name.text);
            } else if (element.propertyName !== undefined) {
              renameOnlyProperty.push(original);
            } else {
              fromFeature.add(element.name.text);
            }
          }
        }
      } else if (
        ts.isExportDeclaration(statement) &&
        fromThisFeature &&
        !inFeature(file) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          const original = (element.propertyName ??
            element.name) as ts.Identifier;
          if (!plan.renamedNames.has(original.text)) continue;
          if (element.propertyName !== undefined)
            renameOnlyProperty.push(original);
          else keepPublicName.push(element);
        }
      }
    }

    const handled = new Set<number>();
    for (const identifier of renameOnlyProperty) {
      handled.add(identifier.getStart(sourceFile));
      add(plan.changes, file, {
        start: identifier.getStart(sourceFile),
        end: identifier.end,
        text: plan.renamedNames.get(identifier.text)!,
      });
    }
    for (const element of keepPublicName) {
      // Other code imports this re-export by its old name, so keep that name public.
      handled.add(element.name.getStart(sourceFile));
      add(plan.changes, file, {
        start: element.name.getStart(sourceFile),
        end: element.name.end,
        text: `${plan.renamedNames.get(element.name.text)!} as ${element.name.text}`,
      });
    }

    const renameHere = (name: string) =>
      plan.renamedNames.has(name) &&
      !fromElsewhere.has(name) &&
      (inFeature(file) || fromFeature.has(name));
    if (!inFeature(file) && fromFeature.size === 0) continue;

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && renameHere(node.text)) {
        const start = node.getStart(sourceFile);
        if (!handled.has(start)) {
          add(plan.changes, file, {
            start,
            end: node.end,
            text: plan.renamedNames.get(node.text)!,
          });
          if (!inFeature(file) && !plan.updatedImporters.includes(file)) {
            plan.updatedImporters.push(file);
            plan.updatedImporters.sort();
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}
