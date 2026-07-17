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
    // the code default is 100 (the game's scale).
    //
    // ⚠ LOAD-BEARING BRIDGE: testing at S=1 is only SOUND because the economy is proven S-invariant —
    // every goods-magnitude term scales linearly in S, so a value asserted at S=1 holds at S=100. Two
    // tests are that proof, and the whole suite's magnitude assertions rest on them:
    //   • lib/engine/__tests__/economy-scale-invariance.test.ts          (static: constants + seed/pricing)
    //   • lib/world/__tests__/economy-scale-dynamic-invariance.test.ts   (dynamic: the whole tick, S=1 vs S=100)
    // If either is weakened, deleted, or its coverage narrows past a real break, every magnitude
    // assertion in this suite silently becomes meaningless with nothing detecting it (exactly what
    // happened when a directed-logistics Math.floor quantised invariance away). Touch this pin — or
    // those two tests — only together. (They each override this pin per-case via stubEnv.)
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
