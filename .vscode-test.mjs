import { defineConfig } from "@vscode/test-cli";

const shared = {
  files: "out/integration/**/*.test.js",
  mocha: { ui: "tdd", timeout: 20_000 },
};

// Run against both the oldest supported VS Code (engines.vscode) and the current stable release.
export default defineConfig([
  { label: "minimum", version: "1.100.0", ...shared },
  { label: "stable", version: "stable", ...shared },
]);
