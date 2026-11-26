import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { buildProjectMap } from "../core/architecture/graph";
import {
  aliasesFromTsconfig,
  type PathAlias,
} from "../core/architecture/modules";
import {
  isSourceFile,
  parseModule,
  type ModuleInfo,
} from "../core/architecture/parse";
import {
  compareWithBaseline,
  createBaseline,
  parseBaseline,
  serializeBaseline,
  type Baseline,
} from "../core/check/baseline";
import { formatGithub, formatText } from "../core/check/format";
import { MANIFEST_FILE_NAME, parseManifest } from "../core/manifest/schema";
import {
  BASELINE_FILE_NAME,
  isSkippedFolder,
  MAX_PROJECT_FILES,
} from "../core/projectFolders";

/**
 * `react-architect check`: the structure rules outside the editor, for CI
 * and pre-commit hooks (plans/custom-structure.md, Phase 6). It uses the
 * same core code as the extension, so the two always agree.
 */

export interface CliIo {
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

const HELP = `Usage: react-architect check [folder] [options]

Checks the project structure rules in every react-architect.json in the
folder (default: the current folder), or the nearest one above it.

Options:
  --format text|github   github prints GitHub Actions annotations (default: text)
  --max-warnings <n>     fail when there are more than n warnings (default: no limit)
  --update-baseline      record the current problems in react-architect-baseline.json,
                         so only new problems fail from now on
  --help                 show this help

Exit codes: 0 when nothing fails, 1 when there are errors (or too many
warnings), 2 when the check couldn't run.`;

interface Options {
  folder: string;
  format: "text" | "github";
  maxWarnings: number | undefined;
  updateBaseline: boolean;
}

function parseArgs(args: string[], cwd: string): Options | string {
  const rest = args[0] === "check" ? args.slice(1) : args;
  const options: Options = {
    folder: cwd,
    format: "text",
    maxWarnings: undefined,
    updateBaseline: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === "--format") {
      const value = rest[++index];
      if (value !== "text" && value !== "github")
        return `--format must be "text" or "github".`;
      options.format = value;
    } else if (arg === "--max-warnings") {
      const value = Number(rest[++index]);
      if (!Number.isInteger(value) || value < 0)
        return "--max-warnings needs a whole number, such as 0.";
      options.maxWarnings = value;
    } else if (arg === "--update-baseline") {
      options.updateBaseline = true;
    } else if (arg.startsWith("-")) {
      return `Unknown option ${arg}.`;
    } else {
      options.folder = path.resolve(cwd, arg);
    }
  }
  return options;
}

export async function runCli(args: string[], io: CliIo): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.out(HELP);
    return 0;
  }
  if (
    args[0] !== undefined &&
    !args[0].startsWith("-") &&
    args[0] !== "check" &&
    !existsSync(path.resolve(io.cwd, args[0]))
  ) {
    io.err(`Unknown command "${args[0]}". Try: react-architect check --help`);
    return 2;
  }
  const options = parseArgs(args, io.cwd);
  if (typeof options === "string") {
    io.err(options);
    return 2;
  }

  const roots = findProjects(options.folder);
  if (roots.length === 0) {
    io.err(
      `No ${MANIFEST_FILE_NAME} found in ${options.folder}, its subfolders or the folders above it.`,
    );
    return 2;
  }

  let errors = 0;
  let warnings = 0;
  let known = 0;
  for (const root of roots) {
    const manifest = parseManifest(
      readFileSync(path.join(root, MANIFEST_FILE_NAME), "utf8"),
    );
    if (!manifest.ok) {
      io.err(
        `${path.relative(io.cwd, path.join(root, MANIFEST_FILE_NAME)) || MANIFEST_FILE_NAME}: ${manifest.errors.join(" ")}`,
      );
      return 2;
    }
    const aliases = readAliases(root);
    const modules = readModules(root);
    const problems = buildProjectMap(
      modules,
      manifest.manifest,
      aliases,
    ).problems;
    const baselinePath = path.join(root, BASELINE_FILE_NAME);

    if (options.updateBaseline) {
      writeFileSync(baselinePath, serializeBaseline(createBaseline(problems)));
      io.out(
        `${path.relative(io.cwd, baselinePath) || BASELINE_FILE_NAME}: recorded ${problems.length} existing ${problems.length === 1 ? "problem" : "problems"}.`,
      );
      continue;
    }

    let baseline: Baseline | undefined;
    if (existsSync(baselinePath)) {
      const parsed = parseBaseline(readFileSync(baselinePath, "utf8"));
      if (!parsed.ok) {
        io.err(`${BASELINE_FILE_NAME} can't be read: ${parsed.error}.`);
        return 2;
      }
      baseline = parsed.baseline;
    }
    const split = compareWithBaseline(problems, baseline);
    known += split.known.length;
    for (const problem of split.fresh) {
      const display = path
        .relative(io.cwd, path.join(root, ...problem.file.split("/")))
        .split(path.sep)
        .join("/");
      io.out(
        options.format === "github"
          ? formatGithub(problem, display)
          : formatText(problem, display),
      );
      if (problem.severity === "error") errors += 1;
      else warnings += 1;
    }
  }
  if (options.updateBaseline) return 0;

  const knownNote = known > 0 ? ` (${known} more in the baseline)` : "";
  if (options.format === "text") {
    io.out(
      errors + warnings === 0
        ? `No structure problems${knownNote}.`
        : `${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}${knownNote}.`,
    );
  }
  const tooManyWarnings =
    options.maxWarnings !== undefined && warnings > options.maxWarnings;
  return errors > 0 || tooManyWarnings ? 1 : 0;
}

/** Every react-architect.json in or below `folder`, or else the nearest above it. */
function findProjects(folder: string): string[] {
  const found: string[] = [];
  const walk = (directory: string, depth: number) => {
    if (existsSync(path.join(directory, MANIFEST_FILE_NAME)))
      found.push(directory);
    if (depth >= 6) return;
    for (const entry of safeReaddir(directory)) {
      if (entry.isDirectory() && !isSkippedFolder(entry.name)) {
        walk(path.join(directory, entry.name), depth + 1);
      }
    }
  };
  walk(folder, 0);
  if (found.length > 0) return found.sort();

  for (
    let directory = path.dirname(folder);
    ;
    directory = path.dirname(directory)
  ) {
    if (existsSync(path.join(directory, MANIFEST_FILE_NAME)))
      return [directory];
    if (path.dirname(directory) === directory) return [];
  }
}

function safeReaddir(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return [];
  }
}

function readAliases(root: string): PathAlias[] {
  const aliases: PathAlias[] = [];
  for (const file of ["tsconfig.json", "tsconfig.app.json"]) {
    const full = path.join(root, file);
    if (existsSync(full))
      aliases.push(...aliasesFromTsconfig(readFileSync(full, "utf8"), "."));
  }
  return aliases.filter(
    (alias, index) =>
      aliases.findIndex((other) => other.prefix === alias.prefix) === index,
  );
}

/** The same files the editor reads (see infra/projectFiles.ts). */
function readModules(root: string): Map<string, ModuleInfo> {
  const modules = new Map<string, ModuleInfo>();
  const queue = [""];
  while (queue.length > 0 && modules.size < MAX_PROJECT_FILES) {
    const relative = queue.shift()!;
    for (const entry of safeReaddir(path.join(root, relative))) {
      const file = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        // A nested project is checked on its own, with its own settings.
        if (
          !isSkippedFolder(entry.name) &&
          !existsSync(path.join(root, file, MANIFEST_FILE_NAME))
        ) {
          queue.push(file);
        }
      } else if (
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        isSourceFile(file)
      ) {
        try {
          modules.set(
            file,
            parseModule(file, readFileSync(path.join(root, file), "utf8")),
          );
        } catch {
          // Unreadable or unparsable: no imports, as in the editor.
        }
      }
    }
  }
  return new Map([...modules].sort(([a], [b]) => a.localeCompare(b)));
}
