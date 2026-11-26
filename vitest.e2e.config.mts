import { defineConfig } from "vitest/config";

// End-to-end tests create real projects: they need network access and time.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 10 * 60_000,
    hookTimeout: 60_000,
    // The steps of one project depend on each other, so run in order.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
