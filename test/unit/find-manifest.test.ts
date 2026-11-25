import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { findManifest } from "../../src/core/manifest/find";

const workspace = path.resolve("/work/repo");
const at = (...segments: string[]) => path.join(workspace, ...segments);
const manifestIn = (...segments: string[]) =>
  at(...segments, "react-architect.json");

function existing(...files: string[]) {
  const set = new Set(files);
  return async (file: string) => set.has(file);
}

describe("findManifest", () => {
  it("finds a manifest in the starting folder", async () => {
    const exists = existing(manifestIn("packages/web"));
    await expect(
      findManifest(at("packages/web"), workspace, exists),
    ).resolves.toBe(manifestIn("packages/web"));
  });

  it("walks up to a parent folder", async () => {
    const exists = existing(manifestIn());
    await expect(
      findManifest(at("src/features/cart"), workspace, exists),
    ).resolves.toBe(manifestIn());
  });

  it("prefers the nearest manifest", async () => {
    const exists = existing(manifestIn(), manifestIn("packages/web"));
    await expect(
      findManifest(at("packages/web/src"), workspace, exists),
    ).resolves.toBe(manifestIn("packages/web"));
  });

  it("doesn't look above the stop folder", async () => {
    const exists = existing(
      path.join(path.dirname(workspace), "react-architect.json"),
    );
    await expect(
      findManifest(at("src"), workspace, exists),
    ).resolves.toBeUndefined();
  });

  it("returns nothing when the start folder is outside the stop folder", async () => {
    const exists = existing(manifestIn());
    await expect(
      findManifest(path.resolve("/elsewhere"), workspace, exists),
    ).resolves.toBeUndefined();
  });
});
