import * as path from "node:path";
import * as vscode from "vscode";
import {
  checkImports,
  findIndexFile,
  planPublicApiFix,
  type Violation,
} from "../core/architecture/boundaries";
import { parseModule } from "../core/architecture/parse";
import { compareWithBaseline } from "../core/check/baseline";
import { BASELINE_FILE_NAME } from "../core/projectFolders";
import { unitNoun } from "../core/structure/model";
import { readFiles } from "../infra/projectFiles";
import type { IndexedProject, ProjectIndex } from "./projectIndex";

/**
 * Shows structure rule problems as squiggles and in the Problems panel, and
 * offers the quick fix for imports that reach inside a feature (ADR 11).
 */

export const DIAGNOSTIC_SOURCE = "React Architect";

const LANGUAGES = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
];

export function registerStructureRules(index: ProjectIndex): vscode.Disposable {
  const diagnostics =
    vscode.languages.createDiagnosticCollection("react-architect");

  const publish = () => {
    diagnostics.clear();
    for (const project of index.all) {
      // Problems the baseline lists are old ones: shown, but quietly (plans/custom-structure.md, Phase 6).
      const { known } = compareWithBaseline(
        project.map.problems,
        project.baseline,
      );
      const quiet = new Set(known);
      const byFile = new Map<string, vscode.Diagnostic[]>();
      for (const violation of project.map.problems) {
        const list = byFile.get(violation.file) ?? [];
        list.push(toDiagnostic(violation, quiet.has(violation)));
        byFile.set(violation.file, list);
      }
      for (const [file, list] of byFile) {
        diagnostics.set(uriIn(project.root, file), list);
      }
    }
  };

  return vscode.Disposable.from(
    diagnostics,
    registerSaveCommand(),
    index.onDidChange(publish),
    vscode.languages.registerCodeActionsProvider(
      LANGUAGES.map((language) => ({ language, scheme: "file" })),
      new PublicApiFixProvider(index),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
}

function toDiagnostic(
  violation: Violation,
  inBaseline: boolean,
): vscode.Diagnostic {
  const { ref } = violation;
  // Placement and naming problems are about the whole file: show them on its first line.
  const range =
    ref === undefined
      ? new vscode.Range(0, 0, 1, 0)
      : new vscode.Range(
          ref.line,
          ref.character,
          ref.line,
          ref.character + (ref.end - ref.start),
        );
  const diagnostic = new vscode.Diagnostic(
    range,
    inBaseline
      ? `${violation.message} (Existing problem, listed in ${BASELINE_FILE_NAME}.)`
      : violation.message,
    inBaseline
      ? vscode.DiagnosticSeverity.Information
      : violation.severity === "error"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = violation.rule;
  return diagnostic;
}

class PublicApiFixProvider implements vscode.CodeActionProvider {
  constructor(private readonly index: ProjectIndex) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): Promise<vscode.CodeAction[]> {
    const project = this.index.projectFor(document.uri);
    if (project === undefined) return [];
    const fileFixes = fileFixActions(project, document, context);
    const ours = context.diagnostics.filter(
      (diagnostic) =>
        diagnostic.source === DIAGNOSTIC_SOURCE && diagnostic.code === "entry",
    );
    if (ours.length === 0) return fileFixes;

    // Work from the document as it is now: the diagnostics may be a few keystrokes old.
    const file = this.index.relativePath(project, document.uri);
    const current = checkImports(
      file,
      parseModule(file, document.getText()),
      project.manifest,
      project.aliases,
    );

    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of ours) {
      const offset = document.offsetAt(diagnostic.range.start);
      const violation = current.find(
        (candidate) =>
          candidate.rule === "entry" &&
          candidate.ref !== undefined &&
          candidate.ref.start <= offset &&
          offset <= candidate.ref.end,
      );
      if (violation === undefined) continue;
      const action = await fixFor(project, document, violation);
      if (action !== undefined) {
        action.diagnostics = [diagnostic];
        actions.push(action);
      }
    }
    return [...actions, ...fileFixes];
  }
}

/** The command the placement and naming fixes run: moves or renames, updating imports. */
export const MOVE_PATH_COMMAND = "reactArchitect.internal.movePath";

/** Quick fixes for placement and naming problems that have a clear answer. */
function fileFixActions(
  project: IndexedProject,
  document: vscode.TextDocument,
  context: vscode.CodeActionContext,
): vscode.CodeAction[] {
  const file = path
    .relative(project.root, document.uri.fsPath)
    .split(path.sep)
    .join("/");
  const wanted = new Set(
    context.diagnostics
      .filter(
        (d) =>
          d.source === DIAGNOSTIC_SOURCE &&
          (d.code === "placement" || d.code === "naming"),
      )
      .map((d) => d.code),
  );
  if (wanted.size === 0) return [];
  return project.map.problems
    .filter(
      (problem) =>
        problem.file === file &&
        wanted.has(problem.rule) &&
        problem.fix !== undefined,
    )
    .map((problem) => {
      const destination =
        "moveTo" in problem.fix! ? problem.fix.moveTo : problem.fix!.renameTo;
      const title =
        "moveTo" in problem.fix!
          ? `Move to ${path.posix.dirname(destination)}/`
          : `Rename to ${path.posix.basename(destination)}`;
      const action = new vscode.CodeAction(
        title,
        vscode.CodeActionKind.QuickFix,
      );
      action.isPreferred = true;
      action.diagnostics = context.diagnostics.filter(
        (d) => d.code === problem.rule,
      );
      action.command = {
        title,
        command: MOVE_PATH_COMMAND,
        arguments: [document.uri, destination],
      };
      return action;
    });
}

async function fixFor(
  project: IndexedProject,
  document: vscode.TextDocument,
  violation: Violation,
): Promise<vscode.CodeAction | undefined> {
  if (violation.unitFolder === undefined || violation.unit === undefined) {
    return undefined;
  }
  const indexFile = findIndexFile(
    violation.unitFolder,
    project.modules.keys(),
    violation.entry,
  );
  const indexText =
    indexFile === undefined
      ? undefined
      : (await readFiles(project.root, [indexFile])).get(indexFile);
  const fix = planPublicApiFix(
    violation,
    project.aliases,
    indexFile !== undefined && indexText !== undefined
      ? { file: indexFile, text: indexText }
      : undefined,
  );
  if (fix === undefined) return undefined;

  const exportsNote =
    fix.addedExports.length > 0
      ? ` and export ${fix.addedExports.join(", ")} from its ${path.posix.basename(fix.indexFile)}`
      : "";
  const action = new vscode.CodeAction(
    `Import from the "${violation.unit}" ${unitNoun(violation.layer)}${exportsNote}`,
    vscode.CodeActionKind.QuickFix,
  );
  action.isPreferred = true;

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(
      document.positionAt(fix.specifier.start),
      document.positionAt(fix.specifier.end),
    ),
    fix.specifier.text,
  );
  if (fix.indexText !== undefined) {
    const uri = uriIn(project.root, fix.indexFile);
    const before = indexText ?? "";
    if (indexFile === undefined) {
      edit.createFile(uri, {
        contents: new TextEncoder().encode(fix.indexText),
      });
    } else if (fix.indexText.startsWith(before)) {
      const indexDocument = await vscode.workspace.openTextDocument(uri);
      edit.insert(
        uri,
        indexDocument.positionAt(before.length),
        fix.indexText.slice(before.length),
      );
      // The index is changed in the background; save it so it isn't left
      // unsaved out of sight. Not if it already had unsaved edits of the user's.
      if (!indexDocument.isDirty) {
        action.command = {
          title: "Save the entry file",
          command: SAVE_COMMAND,
          arguments: [uri],
        };
      }
    }
  }
  action.edit = edit;
  return action;
}

/** Runs after the quick fix's edit is applied. Not in the Command Palette. */
export const SAVE_COMMAND = "reactArchitect.internal.saveDocument";

export function registerSaveCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    SAVE_COMMAND,
    async (uri: vscode.Uri) => {
      const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === uri.toString(),
      );
      if (document?.isDirty) {
        await document.save();
      }
    },
  );
}

function uriIn(root: string, file: string): vscode.Uri {
  return vscode.Uri.file(path.join(root, ...file.split("/")));
}
