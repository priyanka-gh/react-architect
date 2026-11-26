import type { Manifest } from "../manifest/schema";
import { classify, structureFor } from "../structure/model";
import { checkFile } from "../structure/rules";
import { checkImports, findIndexFile, type Violation } from "./boundaries";
import { resolveSpecifier, type PathAlias } from "./modules";
import type { ExportedName, ModuleInfo } from "./parse";

/**
 * The project map (ADR 11): every unit (such as each feature), what it
 * shares, which units use which, the rule problems, and dependency cycles
 * between units.
 */

export interface ImportSite {
  file: string;
  line: number;
  character: number;
}

export interface UnitSummary {
  name: string;
  /** The layer the unit belongs to, such as "features". */
  layer: string;
  folder: string;
  /** Project-relative, if the unit has an entry file (index.ts). */
  indexFile: string | undefined;
  /** What the entry file exports by name. */
  shares: ExportedName[];
  /** Specifiers of `export * from` lines in the entry file. */
  sharesAllOf: string[];
  /** Other units this one imports, by their folder, with where. */
  uses: Map<string, ImportSite[]>;
  /** Who imports this unit: another unit's folder, or undefined for other code. */
  usedBy: { unit: string | undefined; site: ImportSite }[];
  /** Problems in this unit's own files. */
  problems: Violation[];
}

export interface ProjectMap {
  units: UnitSummary[];
  /** Every problem, including those outside units. */
  problems: Violation[];
  /** Each cycle as unit names: ["cart", "profile"] means cart → profile → cart. */
  cycles: string[][];
}

export function buildProjectMap(
  modules: ReadonlyMap<string, ModuleInfo>,
  manifest: Manifest,
  aliases: readonly PathAlias[],
): ProjectMap {
  const structure = structureFor(manifest);
  const units = new Map<string, UnitSummary>();
  const summary = (name: string, layer: string, folder: string) => {
    let unit = units.get(folder);
    if (unit === undefined) {
      unit = {
        name,
        layer,
        folder,
        indexFile: undefined,
        shares: [],
        sharesAllOf: [],
        uses: new Map(),
        usedBy: [],
        problems: [],
      };
      units.set(folder, unit);
    }
    return unit;
  };
  const unitOf = (file: string) => {
    const place = classify(file, structure);
    return place?.unit && { ...place.unit, layer: place.layer };
  };

  for (const file of modules.keys()) {
    const unit = unitOf(file);
    if (unit) summary(unit.name, unit.layer.name, unit.folder);
  }

  const files = [...modules.keys()];
  for (const unit of units.values()) {
    const entry = structure.layers.find(
      (layer) => layer.name === unit.layer,
    )?.entry;
    unit.indexFile = findIndexFile(unit.folder, files, entry);
    const index = unit.indexFile && modules.get(unit.indexFile);
    if (index) {
      unit.shares = index.exports;
      unit.sharesAllOf = index.starExports;
    }
  }

  const problems: Violation[] = [];
  for (const [file, module] of modules) {
    const fromFolder = unitOf(file)?.folder;

    for (const ref of module.imports) {
      const target = resolveSpecifier(file, ref.specifier, aliases);
      const to = target === undefined ? undefined : unitOf(target);
      if (!to || to.folder === fromFolder) {
        continue;
      }
      const site = { file, line: ref.line, character: ref.character };
      summary(to.name, to.layer.name, to.folder).usedBy.push({
        unit: fromFolder,
        site,
      });
      if (fromFolder !== undefined) {
        const uses = units.get(fromFolder)?.uses;
        uses?.set(to.folder, [...(uses.get(to.folder) ?? []), site]);
      }
    }

    const found = [
      ...checkFile(file, manifest, structure),
      ...checkImports(file, module, manifest, aliases, structure),
    ];
    problems.push(...found);
    if (fromFolder !== undefined) {
      units.get(fromFolder)?.problems.push(...found);
    }
  }

  const sorted = [...units.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.layer.localeCompare(b.layer),
  );
  return { units: sorted, problems, cycles: findCycles(sorted) };
}

/**
 * Dependency cycles between units, one per group of units that all depend on
 * each other (Tarjan's strongly connected components), each shown as one
 * concrete loop through the group, by unit name.
 */
export function findCycles(units: readonly UnitSummary[]): string[][] {
  const nameOf = new Map(units.map((unit) => [unit.folder, unit.name]));
  const edges = new Map(
    units.map((unit) => [unit.folder, [...unit.uses.keys()].sort()]),
  );
  const indexOf = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const groups: string[][] = [];
  let counter = 0;

  const connect = (node: string): void => {
    indexOf.set(node, counter);
    lowLink.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of edges.get(node) ?? []) {
      if (!indexOf.has(next)) {
        connect(next);
        lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(next)!));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node)!, indexOf.get(next)!));
      }
    }

    if (lowLink.get(node) === indexOf.get(node)) {
      const group: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        group.push(member);
      } while (member !== node);
      if (group.length > 1) {
        groups.push(group);
      }
    }
  };

  for (const name of [...edges.keys()].sort()) {
    if (!indexOf.has(name)) {
      connect(name);
    }
  }

  return groups
    .map((group) =>
      loopThrough(group.sort(), edges).map(
        (folder) => nameOf.get(folder) ?? folder,
      ),
    )
    .sort((a, b) => a.join().localeCompare(b.join()));
}

/** The shortest loop from the group's first member back to itself. */
function loopThrough(
  group: string[],
  edges: ReadonlyMap<string, string[]>,
): string[] {
  const members = new Set(group);
  const start = group[0]!;
  const previous = new Map<string, string>();
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of edges.get(node) ?? []) {
      if (!members.has(next)) continue;
      if (next === start) {
        const loop = [node];
        while (loop[0] !== start) loop.unshift(previous.get(loop[0]!)!);
        return loop;
      }
      if (!previous.has(next)) {
        previous.set(next, node);
        queue.push(next);
      }
    }
  }
  return group;
}
