/**
 * Exact versions used for new projects (ADR 7). Bump them deliberately, one
 * set at a time; the end-to-end test proves each set builds, lints and tests.
 *
 * Checked with `npm view` on 2026-11-26.
 *
 * Only pin versions that are at least 7 days old. Brand-new releases are the
 * likeliest to be broken or tampered with, and Yarn 2+ refuses versions
 * younger than a day by default (`npmMinimalAgeGate`), which fails installs.
 */

export const CREATE_VITE_VERSION = "9.3.4";

export const ROUTING_DEPENDENCIES = {
  "react-router": "8.5.2",
};

/** Every project: formatting, and keeping ESLint out of Prettier's way. */
export const BASE_DEV_DEPENDENCIES = {
  "eslint-config-prettier": "10.1.8",
  prettier: "3.10.1",
};

/** Only when the project has tests. */
export const TEST_DEV_DEPENDENCIES = {
  "@testing-library/dom": "10.4.2",
  "@testing-library/jest-dom": "8.0.0",
  "@testing-library/react": "16.3.3",
  jsdom: "31.0.1",
  vitest: "5.1.1",
};

/** Only with Tailwind styling: Tailwind 4 plugs into Vite directly. */
export const TAILWIND_DEV_DEPENDENCIES = {
  "@tailwindcss/vite": "4.3.5",
  tailwindcss: "4.3.5",
};

/**
 * The Node.js versions every tool above supports. The strictest are jsdom
 * (^22.22.2 || ^24.15.0 || >=26) and react-router (>=22.22.0); vitest also
 * excludes the odd-numbered releases. Checked against every combination of
 * choices, so it doesn't depend on which ones a project uses.
 */
export const SUPPORTED_NODE_VERSIONS =
  "22.22.2 or later 22.x, 24.15 or later 24.x, or 26 and newer";

export function isSupportedNodeVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (match === null) {
    return false;
  }
  const [major, minor, patch] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  if (major === 22) {
    return minor > 22 || (minor === 22 && patch >= 2);
  }
  if (major === 24) {
    return minor >= 15;
  }
  return major >= 26;
}
