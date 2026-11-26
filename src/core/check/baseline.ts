import type { Violation } from "../structure/rules";

/**
 * A baseline lists the problems a project already had when it adopted its
 * rules (plans/custom-structure.md, Phase 6). The check then fails only on
 * new problems, and the editor shows the old ones quietly.
 *
 * Problems are matched by rule, file and what they're about (the import
 * target, or the file itself), not by line, so editing a file doesn't make
 * its old problems look new. Counts let the same problem appear twice.
 */

export interface Baseline {
  version: 1;
  problems: { rule: string; file: string; target: string; count: number }[];
}

const keyOf = (problem: { rule: string; file: string; target: string }) =>
  `${problem.rule}\u0000${problem.file}\u0000${problem.target}`;

export function createBaseline(problems: readonly Violation[]): Baseline {
  const counts = new Map<string, Baseline["problems"][number]>();
  for (const problem of problems) {
    const key = keyOf(problem);
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, {
        rule: problem.rule,
        file: problem.file,
        target: problem.target,
        count: 1,
      });
    }
  }
  return {
    version: 1,
    problems: [...counts.values()].sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.rule.localeCompare(b.rule) ||
        a.target.localeCompare(b.target),
    ),
  };
}

export function serializeBaseline(baseline: Baseline): string {
  return JSON.stringify(baseline, null, 2) + "\n";
}

export type BaselineResult =
  { ok: true; baseline: Baseline } | { ok: false; error: string };

export function parseBaseline(text: string): BaselineResult {
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, "")) as Partial<Baseline>;
    const valid =
      value.version === 1 &&
      Array.isArray(value.problems) &&
      value.problems.every(
        (entry) =>
          typeof entry?.rule === "string" &&
          typeof entry.file === "string" &&
          typeof entry.target === "string" &&
          Number.isInteger(entry.count) &&
          entry.count > 0,
      );
    return valid
      ? { ok: true, baseline: value as Baseline }
      : {
          ok: false,
          error:
            'it must be { "version": 1, "problems": [...] }, as written by `react-architect check --update-baseline`',
        };
  } catch (error) {
    return {
      ok: false,
      error: `it isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Splits problems into new ones and ones the baseline already lists. */
export function compareWithBaseline(
  problems: readonly Violation[],
  baseline: Baseline | undefined,
): { fresh: Violation[]; known: Violation[] } {
  const remaining = new Map(
    (baseline?.problems ?? []).map((entry) => [keyOf(entry), entry.count]),
  );
  const fresh: Violation[] = [];
  const known: Violation[] = [];
  for (const problem of problems) {
    const key = keyOf(problem);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      known.push(problem);
    } else {
      fresh.push(problem);
    }
  }
  return { fresh, known };
}
