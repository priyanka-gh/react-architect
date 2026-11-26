import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { appendMissingLines, type FilePlan } from "../core/plan";
import type { ProjectDisk } from "../core/project/createProject";

/**
 * Disk access for new projects, which live outside the open workspace, so
 * this uses Node's fs rather than WorkspaceEdit (ADR 4). Doesn't use VS Code,
 * so the end-to-end test can use it too.
 */
export const nodeProjectDisk: ProjectDisk = {
  async folderState(absolutePath) {
    try {
      const entries = await readdir(absolutePath);
      // create-vite also treats a folder holding only .git as empty.
      return entries.every((entry) => entry === ".git") ? "empty" : "notEmpty";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return "missing";
      }
      if (code === "ENOTDIR") {
        return "notEmpty"; // A file has that name.
      }
      throw error;
    }
  },
  readText: (absolutePath) => readFile(absolutePath, "utf8"),
  writeText: (absolutePath, text) => writeFile(absolutePath, text),
  remove: (absolutePath) => rm(absolutePath, { recursive: true, force: true }),
  writePlan: writePlanToDisk,
};

/**
 * Writes a checked plan. Files are created with the "wx" flag unless the plan
 * marks them as replaceable, so a file that appeared after the conflict check
 * is never overwritten (ADR 4).
 */
export async function writePlanToDisk(plan: FilePlan): Promise<void> {
  for (const operation of plan.operations) {
    const file = path.join(plan.root, ...operation.path.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    if (operation.kind === "create") {
      await writeFile(file, operation.content, {
        flag: operation.overwrite === true ? "w" : "wx",
      });
    } else {
      const existing = await readFile(file, "utf8").catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return "";
        }
        throw error;
      });
      await writeFile(file, appendMissingLines(existing, [operation.line]));
    }
  }
}
