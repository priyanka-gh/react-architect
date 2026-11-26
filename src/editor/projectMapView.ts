import * as path from "node:path";
import * as vscode from "vscode";
import type { Violation } from "../core/architecture/boundaries";
import type { UnitSummary, ImportSite } from "../core/architecture/graph";
import type { IndexedProject, ProjectIndex } from "./projectIndex";

/**
 * The Project Map view (ADR 11): every unit (with the default structure,
 * every feature), what it shares, which use which, rule problems and
 * dependency cycles. Nodes for units are still called "feature" here.
 */

export const PROJECT_MAP_VIEW = "reactArchitect.projectMap";

type Node =
  | { kind: "project"; project: IndexedProject }
  | {
      kind: "problems";
      project: IndexedProject;
      problems: Violation[];
      label?: string;
    }
  | { kind: "problem"; project: IndexedProject; problem: Violation }
  | { kind: "cycles"; project: IndexedProject }
  | { kind: "cycle"; project: IndexedProject; cycle: string[] }
  | { kind: "feature"; project: IndexedProject; feature: UnitSummary }
  | { kind: "shares"; project: IndexedProject; feature: UnitSummary }
  | { kind: "uses"; project: IndexedProject; feature: UnitSummary }
  | { kind: "usedBy"; project: IndexedProject; feature: UnitSummary }
  | {
      kind: "group";
      project: IndexedProject;
      label: string;
      icon: string;
      sites: ImportSite[];
    }
  | { kind: "site"; project: IndexedProject; site: ImportSite }
  | { kind: "layer"; project: IndexedProject; layer: string }
  | {
      kind: "info";
      label: string;
      icon: string;
      tooltip?: string;
      target?: vscode.Uri;
      line?: number;
      command?: vscode.Command;
    };

export class ProjectMapProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly index: ProjectIndex) {
    index.onDidChange(() => this.changed.fire(undefined));
  }

  getChildren(node?: Node): Node[] {
    if (node === undefined) {
      const projects = this.index.all;
      if (projects.length === 1) return this.projectChildren(projects[0]!);
      return projects.map((project) => ({ kind: "project", project }));
    }
    const { project } = node as { project: IndexedProject };
    switch (node.kind) {
      case "project":
        return this.projectChildren(node.project);
      case "problems":
        return node.problems.map((problem) => ({
          kind: "problem",
          project,
          problem,
        }));
      case "cycles":
        return project.map.cycles.map((cycle) => ({
          kind: "cycle",
          project,
          cycle,
        }));
      case "cycle":
        return node.cycle.map((name, step) => {
          const next = node.cycle[(step + 1) % node.cycle.length]!;
          const units = project.map.units;
          const nextFolder = units.find((u) => u.name === next)?.folder ?? "";
          const sites =
            units.find((u) => u.name === name)?.uses.get(nextFolder) ?? [];
          return {
            kind: "group",
            project,
            label: `${name} uses ${next}`,
            icon: "arrow-right",
            sites,
          };
        });
      case "feature":
        return [
          { kind: "shares", project, feature: node.feature },
          { kind: "uses", project, feature: node.feature },
          { kind: "usedBy", project, feature: node.feature },
          ...(node.feature.problems.length > 0
            ? [
                {
                  kind: "problems" as const,
                  project,
                  problems: node.feature.problems,
                },
              ]
            : []),
        ];
      case "shares":
        return this.sharesChildren(project, node.feature);
      case "uses":
        return [...node.feature.uses].map(([folder, sites]) => ({
          kind: "group",
          project,
          label: unitName(project, folder),
          icon: "symbol-module",
          sites,
        }));
      case "usedBy": {
        const groups = new Map<string, ImportSite[]>();
        for (const { unit, site } of node.feature.usedBy) {
          const key = unit === undefined ? "" : unitName(project, unit);
          groups.set(key, [...(groups.get(key) ?? []), site]);
        }
        return [...groups]
          .sort(([a], [b]) =>
            a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
          )
          .map(([name, sites]) => ({
            kind: "group",
            project,
            label: name === "" ? "Code outside units" : name,
            icon: name === "" ? "file-code" : "symbol-module",
            sites,
          }));
      }
      case "group":
        return node.sites.map((site) => ({ kind: "site", project, site }));
      case "layer": {
        const units = project.map.units.filter(
          (unit) => unit.layer === node.layer,
        );
        if (units.length > 0) {
          return units.map((feature) => ({
            kind: "feature",
            project,
            feature,
          }));
        }
        const config = project.manifest.structure?.layers.find(
          (l) => l.name === node.layer,
        );
        return (config?.paths ?? []).map((folder) => ({
          kind: "info",
          label: folder,
          icon: "folder",
          tooltip: "Reveal in the Explorer",
          command: {
            title: "Reveal",
            command: "revealInExplorer",
            arguments: [uriIn(project.root, folder.replace(/\/\*$/, ""))],
          },
        }));
      }
      default:
        return [];
    }
  }

  private projectChildren(project: IndexedProject): Node[] {
    const { map } = project;
    const nodes: Node[] = [];
    if (map.problems.length > 0) {
      nodes.push({
        kind: "problems",
        project,
        problems: map.problems,
        label: "Rule problems",
      });
    }
    if (map.cycles.length > 0) {
      nodes.push({ kind: "cycles", project });
    }
    // With a custom structure, group by layer (plans/custom-structure.md, Phase 2).
    if (project.manifest.structure !== undefined) {
      nodes.push(
        ...project.manifest.structure.layers.map((layer): Node => ({
          kind: "layer",
          project,
          layer: layer.name,
        })),
      );
      return nodes;
    }
    nodes.push(
      ...map.units.map((feature): Node => ({
        kind: "feature",
        project,
        feature,
      })),
    );
    if (map.units.length === 0) {
      nodes.push({
        kind: "info",
        label: "No features yet",
        icon: "info",
        tooltip: `Features are folders in ${project.manifest.paths.features}.`,
        command: {
          title: "Generate Feature",
          command: "reactArchitect.generateFeature",
          arguments: [
            vscode.Uri.file(
              path.join(project.root, project.manifest.paths.features),
            ),
          ],
        },
      });
    }
    return nodes;
  }

  private sharesChildren(
    project: IndexedProject,
    feature: UnitSummary,
  ): Node[] {
    if (feature.indexFile === undefined) {
      return [
        {
          kind: "info",
          label: "No index.ts, so nothing is shared",
          icon: "circle-slash",
        },
      ];
    }
    const target = uriIn(project.root, feature.indexFile);
    return [
      ...feature.shares.map((entry): Node => ({
        kind: "info",
        label: entry.name,
        icon: "symbol-field",
        target,
        line: entry.line,
      })),
      ...feature.sharesAllOf.map((specifier): Node => ({
        kind: "info",
        label: `everything from ${specifier}`,
        icon: "symbol-namespace",
        target,
      })),
    ];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const collapsed = vscode.TreeItemCollapsibleState.Collapsed;
    const none = vscode.TreeItemCollapsibleState.None;
    switch (node.kind) {
      case "project": {
        const item = new vscode.TreeItem(
          path.basename(node.project.root),
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.iconPath = new vscode.ThemeIcon("folder-library");
        item.tooltip = node.project.root;
        return item;
      }
      case "problems": {
        const count = node.problems.length;
        const item = new vscode.TreeItem(
          node.label ?? "Problems",
          node.label ? vscode.TreeItemCollapsibleState.Expanded : collapsed,
        );
        item.description = String(count);
        item.iconPath = new vscode.ThemeIcon(
          "warning",
          new vscode.ThemeColor("problemsWarningIcon.foreground"),
        );
        return item;
      }
      case "problem": {
        const { problem } = node;
        const item = new vscode.TreeItem(
          `${path.posix.basename(problem.file)}:${(problem.ref?.line ?? 0) + 1}`,
          none,
        );
        const target = problem.unit ?? problem.layer;
        item.description =
          problem.rule === "placement"
            ? "in the wrong place"
            : problem.rule === "naming"
              ? "doesn't follow the naming rule"
              : problem.rule === "layers"
                ? `${problem.layer} can't be used here`
                : problem.rule === "siblings"
                  ? `uses sibling ${target}`
                  : `reaches inside ${target}`;
        item.tooltip = `${problem.file}\n\n${problem.message}`;
        item.iconPath = new vscode.ThemeIcon(
          problem.severity === "error" ? "error" : "warning",
        );
        item.command = openAt(
          uriIn(node.project.root, problem.file),
          problem.ref?.line ?? 0,
          problem.ref?.character ?? 0,
        );
        return item;
      }
      case "cycles": {
        const item = new vscode.TreeItem(
          "Dependency cycles",
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.description = String(node.project.map.cycles.length);
        item.iconPath = new vscode.ThemeIcon(
          "sync",
          new vscode.ThemeColor("problemsWarningIcon.foreground"),
        );
        item.tooltip =
          "Features that depend on each other in a loop can't be changed, tested or removed on their own.";
        return item;
      }
      case "cycle": {
        const item = new vscode.TreeItem(
          [...node.cycle, node.cycle[0]].join(" → "),
          collapsed,
        );
        item.iconPath = new vscode.ThemeIcon("sync");
        return item;
      }
      case "feature": {
        const { feature } = node;
        const item = new vscode.TreeItem(feature.name, collapsed);
        const parts = [
          `uses ${feature.uses.size}`,
          `used by ${new Set(feature.usedBy.map((u) => u.unit ?? "")).size}`,
        ];
        if (feature.problems.length > 0)
          parts.push(`${feature.problems.length} ⚠`);
        item.description = parts.join(" · ");
        item.tooltip = feature.folder;
        item.iconPath = new vscode.ThemeIcon("symbol-module");
        item.contextValue = "feature";
        item.resourceUri = uriIn(node.project.root, feature.folder);
        return item;
      }
      case "shares": {
        const count =
          node.feature.shares.length + node.feature.sharesAllOf.length;
        const item = new vscode.TreeItem(
          "Shares",
          count > 0 ? collapsed : none,
        );
        item.description =
          node.feature.indexFile === undefined ? "no index.ts" : String(count);
        item.iconPath = new vscode.ThemeIcon("export");
        item.tooltip =
          "What the feature's index.ts exports: the only things other code should use.";
        if (node.feature.indexFile !== undefined) {
          item.command = openAt(
            uriIn(node.project.root, node.feature.indexFile),
            0,
            0,
          );
        }
        return item;
      }
      case "uses": {
        const item = new vscode.TreeItem(
          "Uses",
          node.feature.uses.size > 0 ? collapsed : none,
        );
        item.description = String(node.feature.uses.size);
        item.iconPath = new vscode.ThemeIcon("arrow-right");
        item.tooltip = "Other features this one imports.";
        return item;
      }
      case "usedBy": {
        const count = new Set(node.feature.usedBy.map((u) => u.unit ?? ""))
          .size;
        const item = new vscode.TreeItem(
          "Used by",
          count > 0 ? collapsed : none,
        );
        item.description = String(count);
        item.iconPath = new vscode.ThemeIcon("arrow-left");
        item.tooltip = "Features and other code that import this one.";
        return item;
      }
      case "group": {
        const item = new vscode.TreeItem(node.label, collapsed);
        item.description =
          node.sites.length === 1 ? "1 import" : `${node.sites.length} imports`;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        return item;
      }
      case "site": {
        const { site } = node;
        const item = new vscode.TreeItem(
          `${path.posix.basename(site.file)}:${site.line + 1}`,
          none,
        );
        item.description = path.posix.dirname(site.file);
        item.iconPath = new vscode.ThemeIcon("go-to-file");
        item.command = openAt(
          uriIn(node.project.root, site.file),
          site.line,
          site.character,
        );
        return item;
      }
      case "layer": {
        const config = node.project.manifest.structure?.layers.find(
          (l) => l.name === node.layer,
        );
        const units = node.project.map.units.filter(
          (unit) => unit.layer === node.layer,
        );
        const problems = node.project.map.problems.filter(
          (p) => p.layer === node.layer,
        ).length;
        const item = new vscode.TreeItem(
          node.layer,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        const parts = [config?.paths.join(", ") ?? ""];
        if (units.length > 0)
          parts.unshift(
            `${units.length} ${units.length === 1 ? "unit" : "units"}`,
          );
        item.description = parts.join(" · ");
        item.tooltip = config
          ? `${config.paths.join(", ")}\n\nMay use: ${config.mayImport.length > 0 ? config.mayImport.join(", ") : "no other layer"}${problems > 0 ? `\n${problems} problems involve it.` : ""}`
          : undefined;
        item.iconPath = new vscode.ThemeIcon("layers");
        return item;
      }
      case "info": {
        const item = new vscode.TreeItem(node.label, none);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.tooltip = node.tooltip;
        item.command =
          node.command ??
          (node.target === undefined
            ? undefined
            : openAt(node.target, node.line ?? 0, 0));
        return item;
      }
    }
  }
}

function openAt(
  uri: vscode.Uri,
  line: number,
  character: number,
): vscode.Command {
  const position = new vscode.Position(line, character);
  return {
    title: "Open",
    command: "vscode.open",
    arguments: [uri, { selection: new vscode.Range(position, position) }],
  };
}

function uriIn(root: string, file: string): vscode.Uri {
  return vscode.Uri.file(path.join(root, ...file.split("/")));
}

/** Context keys that menus use to show feature-only commands on the right folders. */
export function updateContextKeys(index: ProjectIndex): void {
  const featureFolders: string[] = [];
  const componentFolders: string[] = [];
  for (const project of index.all) {
    // Rename Feature and Move to Shared Components work on paths.features.
    const features = project.map.units.filter(
      (unit) =>
        path.posix.dirname(unit.folder) === project.manifest.paths.features,
    );
    for (const feature of features) {
      featureFolders.push(uriIn(project.root, feature.folder).fsPath);
    }
    for (const file of project.modules.keys()) {
      const match = /^(.+)\/components\/([^/]+)\/[^/]+$/.exec(file);
      if (match && features.some((f) => match[1] === f.folder)) {
        componentFolders.push(
          uriIn(project.root, `${match[1]}/components/${match[2]}`).fsPath,
        );
      }
    }
  }
  void vscode.commands.executeCommand(
    "setContext",
    "reactArchitect.hasProject",
    index.all.length > 0,
  );
  void vscode.commands.executeCommand(
    "setContext",
    "reactArchitect.featureFolders",
    featureFolders,
  );
  void vscode.commands.executeCommand(
    "setContext",
    "reactArchitect.featureComponentFolders",
    [...new Set(componentFolders)],
  );
}

function unitName(project: IndexedProject, folder: string): string {
  return (
    project.map.units.find((unit) => unit.folder === folder)?.name ?? folder
  );
}
