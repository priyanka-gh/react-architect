import * as vscode from "vscode";

/**
 * Read-only documents for proposed changes, so Choose Structure and Import
 * Structure can show a diff before anything is written
 * (plans/custom-structure.md, Phase 2).
 */

export const PROPOSAL_SCHEME = "react-architect-proposal";

const contents = new Map<string, string>();
const changed = new vscode.EventEmitter<vscode.Uri>();

export function registerProposals(): vscode.Disposable {
  return vscode.Disposable.from(
    changed,
    vscode.workspace.registerTextDocumentContentProvider(PROPOSAL_SCHEME, {
      onDidChange: changed.event,
      provideTextDocumentContent: (uri) => contents.get(uri.toString()) ?? "",
    }),
  );
}

/** A read-only document with `text`, named like `fileName`. */
export function proposalUri(fileName: string, text: string): vscode.Uri {
  const uri = vscode.Uri.from({
    scheme: PROPOSAL_SCHEME,
    path: `/${fileName}`,
    query: String(Date.now()),
  });
  contents.set(uri.toString(), text);
  changed.fire(uri);
  return uri;
}
