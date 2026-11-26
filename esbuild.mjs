import process from "node:process";
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  // Node version shipped with the oldest supported VS Code (engines.vscode).
  target: "node20",
  external: ["vscode"],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: "info",
};

/** `react-architect check` for CI (plans/custom-structure.md, Phase 6). */
const cliOptions = {
  ...options,
  entryPoints: ["src/cli/index.ts"],
  outfile: "dist/cli.js",
  external: [],
  banner: { js: "#!/usr/bin/env node" },
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await Promise.all([esbuild.build(options), esbuild.build(cliOptions)]);
}
