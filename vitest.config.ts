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
          include: [
            "lib/**/__tests__/**/*.test.ts",
            "components/**/__tests__/**/*.test.ts",
          ],
        },
      },
    ],
  },
});
