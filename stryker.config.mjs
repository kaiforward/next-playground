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
  // only re-runs mutants whose source or covering tests changed. The saving is
  // proportional to how little changed — a one-file test tweak re-verifies in
  // minutes, but a fix wave that edits big source files and adds tests across the
  // scope invalidates most of the store and still costs hours (cold rate ≈ 2.5 s
  // per mutant at concurrency 4). Estimate the invalidated count from the diff
  // before launching; never quote "minutes" unchecked. Delete the cache file to
  // force a cold run. The first sweep of any new file set is always full price.
  incremental: true,
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress"],
  // 4 leaves the machine usable while you work; overnight batch runs pass
  // --concurrency 8 (16 logical cores) since the box is free.
  concurrency: 4,
  timeoutMS: 60000,
  mutate: [],
};
