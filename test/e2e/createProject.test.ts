/**
 * Creates real projects with the real create-vite and npm, then checks that
 * they build, lint, test and are formatted (ADR 8). Needs network access and
 * takes a few minutes; run with `npm run test:e2e`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createProject,
  type StepId,
} from "../../src/core/project/createProject";
import { runProcess } from "../../src/infra/process";
import { nodeProjectDisk } from "../../src/infra/projectDisk";

const parent = mkdtempSync(path.join(tmpdir(), "react-architect-e2e-"));
afterAll(() => {
  if (!process.env.KEEP_E2E_PROJECTS) {
    rmSync(parent, { recursive: true, force: true });
  }
});

const run = (
  command: string,
  args: string[],
  options: { cwd: string; signal: AbortSignal },
) => runProcess(command, args, options);

const check = (cwd: string, command: string, ...args: string[]) =>
  runProcess(command, args, { cwd, signal: new AbortController().signal });

describe.each([
  { name: "with-routing", routing: true },
  { name: "without-routing", routing: false },
])("a new project $name", ({ name, routing }) => {
  const root = path.join(parent, name);

  it("is created and installed", async () => {
    const result = await createProject(
      { name, parentDirectory: parent, routing, install: true },
      {
        run,
        disk: nodeProjectDisk,
        signal: new AbortController().signal,
        // Set by the weekly drift check to try the newest create-vite (ADR 3).
        createViteVersion: process.env.CREATE_VITE_VERSION,
      },
    );
    expect(result).toEqual({
      status: "created",
      root,
      installed: true,
      warnings: [],
    });
  });

  it("builds", async () => {
    await check(root, "npm", "run", "build");
  });

  it("passes ESLint with no warnings", async () => {
    await check(root, "npx", "eslint", ".", "--max-warnings", "0");
  });

  it("passes its own tests", async () => {
    const { output } = await check(root, "npm", "test");
    expect(output).toMatch(/Test Files\s+\d+ passed/);
  });

  it("is formatted", async () => {
    await check(root, "npm", "run", "format:check");
  });
});

describe("cancelling", () => {
  it("stops npm install and reports the project as cancelled", async () => {
    const controller = new AbortController();
    const started = Date.now();
    let cancelledAfter = 0;

    const result = await createProject(
      {
        name: "cancelled",
        parentDirectory: parent,
        routing: false,
        install: true,
      },
      {
        run,
        disk: nodeProjectDisk,
        signal: controller.signal,
        onStep: (step: StepId) => {
          if (step === "install") {
            setTimeout(() => {
              cancelledAfter = Date.now();
              controller.abort();
            }, 1_000);
          }
        },
      },
    );

    expect(result).toMatchObject({
      status: "cancelled",
      step: "install",
      createdFolder: true,
    });
    // npm was killed rather than left to finish the install.
    expect(Date.now() - cancelledAfter).toBeLessThan(10_000);
    expect(cancelledAfter).toBeGreaterThan(started);
  });
});
