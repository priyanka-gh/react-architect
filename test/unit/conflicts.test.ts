import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyConflictChoice,
  findConflicts,
  isBlocking,
  type Conflict,
  type DirectoryEntry,
  type ReadDirectory,
} from "../../src/core/conflicts";
import type { FileOperation, FilePlan } from "../../src/core/plan";

const root = path.resolve("/work/app");

/**
 * An in-memory disk. Each entry is a project-relative path; a trailing "/"
 * marks a folder. Parent folders are created automatically.
 */
function fakeDisk(...entries: string[]): ReadDirectory & { calls: number } {
  const folders = new Map<string, DirectoryEntry[]>([[root, []]]);
  for (const entry of entries) {
    const isDirectory = entry.endsWith("/");
    const segments = entry.replace(/\/$/, "").split("/");
    let directory = root;
    for (const [index, name] of segments.entries()) {
      const isFolder = isDirectory || index < segments.length - 1;
      const listing = folders.get(directory) ?? [];
      if (!listing.some((e) => e.name === name)) {
        listing.push({ name, isDirectory: isFolder });
      }
      folders.set(directory, listing);
      directory = path.join(directory, name);
      if (isFolder && !folders.has(directory)) {
        folders.set(directory, []);
      }
    }
  }

  const read = async (directory: string) => {
    read.calls++;
    return folders.get(directory);
  };
  read.calls = 0;
  return read;
}

const create = (filePath: string): FileOperation => ({
  kind: "create",
  path: filePath,
  content: "new",
});
const plan = (...operations: FileOperation[]): FilePlan => ({
  root,
  operations,
});

describe("findConflicts", () => {
  it("finds nothing when no planned file exists", async () => {
    const disk = fakeDisk("src/main.tsx");
    await expect(
      findConflicts(plan(create("src/components/Card/Card.tsx")), disk),
    ).resolves.toEqual([]);
  });

  it("reports a file that already exists", async () => {
    const disk = fakeDisk("src/hooks/useCart.ts");
    await expect(
      findConflicts(
        plan(create("src/hooks/useCart.ts"), create("src/hooks/useUser.ts")),
        disk,
      ),
    ).resolves.toEqual([{ kind: "exists", path: "src/hooks/useCart.ts" }]);
  });

  it("allows adding a line to an existing file", async () => {
    const disk = fakeDisk("src/features/shop/index.ts");
    const operation: FileOperation = {
      kind: "ensureLine",
      path: "src/features/shop/index.ts",
      line: "export * from './x';",
    };
    await expect(findConflicts(plan(operation), disk)).resolves.toEqual([]);
  });

  it("blocks a file whose name differs only by letter case", async () => {
    const disk = fakeDisk("src/components/card.tsx");
    await expect(
      findConflicts(plan(create("src/components/Card.tsx")), disk),
    ).resolves.toEqual([
      {
        kind: "letterCase",
        path: "src/components/Card.tsx",
        existingPath: "src/components/card.tsx",
      },
    ]);
  });

  it("blocks a folder whose name differs only by letter case", async () => {
    const disk = fakeDisk("src/Components/");
    await expect(
      findConflicts(plan(create("src/components/Card.tsx")), disk),
    ).resolves.toEqual([
      {
        kind: "letterCase",
        path: "src/components/Card.tsx",
        existingPath: "src/Components",
      },
    ]);
  });

  it("prefers an exact match when the disk has both spellings (Linux)", async () => {
    const disk = fakeDisk("Card.tsx", "card.tsx");
    await expect(
      findConflicts(plan(create("card.tsx")), disk),
    ).resolves.toEqual([{ kind: "exists", path: "card.tsx" }]);
  });

  it("blocks a file where a folder exists", async () => {
    const disk = fakeDisk("src/index.ts/");
    await expect(
      findConflicts(plan(create("src/index.ts")), disk),
    ).resolves.toEqual([
      {
        kind: "fileFolderClash",
        path: "src/index.ts",
        existingPath: "src/index.ts",
      },
    ]);
  });

  it("blocks a folder where a file exists", async () => {
    const disk = fakeDisk("src/hooks");
    await expect(
      findConflicts(plan(create("src/hooks/useCart.ts")), disk),
    ).resolves.toEqual([
      {
        kind: "fileFolderClash",
        path: "src/hooks/useCart.ts",
        existingPath: "src/hooks",
      },
    ]);
  });

  it("lists each folder only once", async () => {
    const disk = fakeDisk("src/components/Card/");
    await findConflicts(
      plan(
        create("src/components/Card/Card.tsx"),
        create("src/components/Card/Card.module.css"),
        create("src/components/Card/Card.test.tsx"),
      ),
      disk,
    );
    // root, src, src/components, src/components/Card
    expect(disk.calls).toBe(4);
  });
});

describe("applyConflictChoice", () => {
  const original = plan(create("a.ts"), create("b.ts"), {
    kind: "ensureLine",
    path: "index.ts",
    line: "export {};",
  });
  const conflicts: Conflict[] = [{ kind: "exists", path: "a.ts" }];

  it("drops existing files when skipping", () => {
    expect(
      applyConflictChoice(original, conflicts, "skip").operations.map(
        (operation) => operation.path,
      ),
    ).toEqual(["b.ts", "index.ts"]);
  });

  it("marks existing files as replaceable when overwriting", () => {
    expect(
      applyConflictChoice(original, conflicts, "overwrite").operations,
    ).toEqual([
      { ...create("a.ts"), overwrite: true },
      create("b.ts"),
      { kind: "ensureLine", path: "index.ts", line: "export {};" },
    ]);
  });

  it("refuses to resolve blocking conflicts", () => {
    const blocking: Conflict = {
      kind: "letterCase",
      path: "a.ts",
      existingPath: "A.ts",
    };
    expect(isBlocking(blocking)).toBe(true);
    expect(() => applyConflictChoice(original, [blocking], "skip")).toThrow(
      /can't be resolved/,
    );
  });

  it("doesn't change the original plan", () => {
    applyConflictChoice(original, conflicts, "overwrite");
    expect(original.operations[0]).toEqual(create("a.ts"));
  });
});
