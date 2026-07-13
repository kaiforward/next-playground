import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    // Pin the economy scale to 1 for tests: their magnitude assertions are written at unit scale, and
    // the code default is 100 (the game's scale). The invariance test overrides this per-case via stubEnv.
    env: { ECONOMY_SCALE: "1" },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "lib/**/__tests__/**/*.test.ts",
            "components/**/__tests__/**/*.test.ts",
          ],
        },
      },
    ],
  },
});
