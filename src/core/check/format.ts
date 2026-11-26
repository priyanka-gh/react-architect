import type { Violation } from "../structure/rules";

/** One line per problem, like a compiler: path:line:column  severity  message  [rule] */
export function formatText(problem: Violation, file: string): string {
  const line = (problem.ref?.line ?? 0) + 1;
  const column = (problem.ref?.character ?? 0) + 1;
  return `${file}:${line}:${column}  ${problem.severity}  ${problem.message}  [${problem.rule}]`;
}

/**
 * A GitHub Actions workflow command, which shows the problem on the pull
 * request's changed line. Values are escaped as GitHub requires.
 */
export function formatGithub(problem: Violation, file: string): string {
  const escapeData = (value: string) =>
    value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const escapeProperty = (value: string) =>
    escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const line = (problem.ref?.line ?? 0) + 1;
  const column = (problem.ref?.character ?? 0) + 1;
  const level = problem.severity === "error" ? "error" : "warning";
  return `::${level} file=${escapeProperty(file)},line=${line},col=${column},title=${escapeProperty(`React Architect (${problem.rule})`)}::${escapeData(problem.message)}`;
}
