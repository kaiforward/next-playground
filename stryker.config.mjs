// Mutation testing (StrykerJS) — finds code that can be changed without any test
// noticing (a surviving mutant = a coverage hole or a vacuous test).
//
// ALWAYS scope a run to the files you changed:
//   npm run mutation -- --mutate "lib/engine/foo.ts,lib/tick/processors/bar.ts"
// An unscoped run would mutate all of lib/ — thousands of mutants, not a useful
// instrument. `mutate` is left empty here on purpose so a bare run does nothing.
//
// Reading the output: each survivor shows the code change no test caught. Kill it
// with a test or justify it (equivalent mutant / dev-harness-only) in the PR notes.
export default {
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.mutation.config.ts",
  },
  // Cache mutant results (reports/stryker-incremental.json, gitignored): a re-sweep
  // after writing killing tests only re-runs mutants whose code or covering tests
  // changed — minutes instead of the full price. Delete the cache file to force a
  // cold run. The first sweep of any new file set is always full price.
  incremental: true,
  coverageAnalysis: "perTest",
  reporters: ["clear-text"],
  concurrency: 4,
  timeoutMS: 60000,
  mutate: [],
};
