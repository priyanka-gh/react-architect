import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@vscode/test-cli";

// Tests generate files, so give each run a fresh, empty workspace folder.
const workspaceFolder = mkdtempSync(join(tmpdir(), "react-architect-test-"));

const shared = {
  files: "out/test/integration/**/*.test.js",
  workspaceFolder,
  mocha: { ui: "tdd", timeout: 20_000 },
};

// Run against both the oldest supported VS Code (engines.vscode) and the current stable release.
export default defineConfig([
  { label: "minimum", version: "1.100.0", ...shared },
  { label: "stable", version: "stable", ...shared },
]);
