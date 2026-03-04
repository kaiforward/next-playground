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
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["lib/**/__tests__/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["**/*.integration.test.ts"],
          globalSetup: ["./vitest.integration.setup.ts"],
          env: {
            DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/stellar_trader_test",
          },
          testTimeout: 15_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
