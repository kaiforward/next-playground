import { defineConfig } from "vitest/config";
import path from "path";

// Test universe for `npm run mutation` (StrykerJS). Mirrors the `unit` project in
// vitest.config.ts as a single flat config — Stryker's vitest runner drives one
// config directly, without the projects wrapper.
//
// ⚠ The ECONOMY_SCALE pin below is the same load-bearing bridge as in
// vitest.config.ts — see the comment there. Change them together or not at all.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    testTimeout: 30_000,
    env: { ECONOMY_SCALE: "1" },
    include: [
      "lib/**/__tests__/**/*.test.ts",
      "components/**/__tests__/**/*.test.ts",
    ],
  },
});
