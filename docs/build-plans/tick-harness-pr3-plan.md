# Tick-harness PR3 (move the harness) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `lib/engine/simulator/` → `lib/tick-harness/`, rename the harness's own symbols (`SimConfig`/`SimResults`/`runSimulation` → `HarnessConfig`/`HarnessResults`/`runTickHarness`), and sweep the remaining Sim-vs-World doc rot out of `lib/`, `docs/`, and `CLAUDE.md`. After this PR the word "Sim" survives only as a verb.

**Architecture:** A directory move plus identifier renames plus comment edits. Nothing executable changes: no function body is touched, no type is added or removed, no string that reaches stdout is edited. The gate is a byte-identical comparison of `npm run simulate -- --json` before and after.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Next.js 16. No new dependencies.

## Global Constraints

- **No behaviour change.** Not a single number the simulation produces may differ, and no output may be added. This is the PR's gate and it is absolute — see Task 0 and Task 6.
- **No stdout string may change.** `formatTable`'s `"Simulation completed in ..."`, the quick-run/experiment banners, and the `--help` text in `scripts/simulate.ts` all stay byte-for-byte as they are. Editing them would fail the gate (and the `--help` banner is verb-usage the spec deliberately keeps).
- **Keep `npm run simulate`.** The verb is honest; only the noun was wrong.
- **No `as` type assertions** — only `as const` and inside `lib/types/guards.ts`.
- **No `unknown`** anywhere.
- **Comments describe the code, not the plan** — no comment may reference this PR, the build plan, or the migration.
- **Never use `cd` in compound commands** — the working directory is already the project root.
- Spec: `docs/build-plans/tick-harness-rename.md`. This plan implements its PR3 row.

---

## The rename table

| Now | Becomes | Where it lives after |
|---|---|---|
| `lib/engine/simulator/` (dir) | `lib/tick-harness/` | — |
| `SimConfig` | `HarnessConfig` | `lib/tick-harness/types.ts` |
| `SimResults` | `HarnessResults` | `lib/tick-harness/types.ts` |
| `runSimulation` | `runTickHarness` | `lib/tick-harness/runner.ts` |
| `experimentToSimConfig` | `experimentToHarnessConfig` | `lib/tick-harness/experiment.ts` |
| `lib/engine/__tests__/experiment.test.ts` | `lib/tick-harness/__tests__/experiment.test.ts` | — |

**Verified free before starting** (grep, 2026-07-16): none of `HarnessConfig`, `HarnessResults`, `runTickHarness`, `experimentToHarnessConfig`, or the path `lib/tick-harness` exists anywhere in the repo. No collision risk.

**Why `experimentToSimConfig` → `experimentToHarnessConfig` is in scope even though the spec's table omits it:** it is the same symbol as `SimConfig`, spelled as a function. Leaving it would ship a `experimentToSimConfig(): { config: HarnessConfig }` — a name asserting a type that no longer exists. It has one production caller (`scripts/simulate.ts:319`) and one test.

**Why `lib/engine/__tests__/experiment.test.ts` moves:** it tests `lib/engine/simulator/experiment.ts`, which is moving. Leaving it in `lib/engine/__tests__/` would make it reach out with `../../tick-harness/experiment` — a test for a module in another layer. Vitest's `unit` project includes `lib/**/__tests__/**/*.test.ts` (`vitest.config.ts:20`), so the new location is picked up with no config change. The three tests already inside `lib/engine/simulator/__tests__/` ride along with the directory move; their `../build-analysis`-style imports stay valid because both sides move together.

**Why the directory leaves `lib/engine/`:** CLAUDE.md reserves `lib/engine/` for pure game logic with zero I/O. `runner.ts` statically imports `@/lib/world/gen` and `@/lib/world/tick`, so the harness was never engine-pure — it is a dev instrument, not game logic. PR2's review accepted the `simulator/* → @/lib/tick/rows` layer inversion **only because this PR closes it**; this PR must land.

---

## Explicitly out of scope (do not touch)

Naming this list is the point — the spec splits this work across four PRs and PR3 must not drift into PR4.

| Thing | Why it stays |
|---|---|
| `npm run simulate` (the script name) | The verb is honest. Renaming it churns CLAUDE.md, docs, and muscle memory for no clarity gain. |
| `scripts/simulate.ts`'s `--help` banner (`Economy Simulator — Stellar Trader`), the quick-run/experiment banners, `formatTable`'s `Simulation completed in ...` | Verb/product-name usage the spec keeps. The stdout ones would fail the gate outright. |
| `EconomySimParams` (`lib/engine/tick.ts`) | Verb usage — these are params for simulating an economy tick. The spec names it as a keeper. |
| "tune against sim equilibrium", "simulator-calibrated", "simulator-tunable" in `lib/constants/*` and `docs/` | Verb/instrument usage — the harness *is* the instrument they name. Correct as written. |
| Historical prose in `docs/planned/*` (`economy-simulation-vision.md`, `negative-space-economy.md`, `economy-specialisation*.md`, …) | Dated findings recording what a sim run showed on a date. Rewriting history is not a doc fix. |
| `ECONOMY_SCALE` print + assert; the logistics-activity metric | PR4. They add output; PR1–3 must stay byte-identical. |
| `docs/build-plans/tick-harness-pr1-plan.md`, `tick-harness-pr2-plan.md`, `tick-harness-rename.md` | PR4 deletes all three together. Deleting the spec this PR is written against, mid-sequence, is the wrong order. |

---

## The doc sweep, and why it is a task and not a chore

**⚠ The method trap this PR exists to avoid:** a move/deletion PR's rot is **not in its own diff**. PR1's review found an active doc documenting a symbol PR1 had just deleted — rot the PR *created*, true on `main` and false on merge, invisible to every diff-scoped reviewer because the file was in no chunk. It surfaced only from a repo-wide grep of the deleted symbols. PR3 moves a whole directory, so this bites hardest here. **The grep in Task 6 is the instrument, not the reviewer.**

**Corollary, learned twice (PR1's review, then PR2's): fix a file's rot wholesale or it re-surfaces.** PR2 shipped a stale "Sim view" sitting *between* two lines it had updated. When a task opens a file, read the whole doc comment, not the matched line.

The sweep splits into three kinds, all in scope:

1. **Broken references** — a path or symbol this PR moves. Non-negotiable.
2. **False-split prose** — comments asserting a two-backend world that does not exist. Per the spec: *"doc rot is not cosmetic here — each 'Live: X. Sim: Y.' comment marks a place where the split left real unreachable code behind, and the comment is what stopped anyone noticing."*
3. **Nothing outside the keeper list**, which is exhaustive for the *symbol* class.

### The fiction has two spellings, and the sweep must cover both

**The split is written down as `Sim`-vs-`World` in some files and `Prisma`-vs-`memory` in others. They are the same fossil** — a second backend that does not exist — and the Prisma spelling is the more brazen, because `lib/tick/adapters/` contains exactly one directory (`memory`; verified 2026-07-16). Prisma was deleted wholesale in the Phase-2 pivot.

Sweeping one spelling and not the other is not a defensible scope line, it is a cherry-pick: `lib/tick/processors/economy.ts:26` and `lib/tick/processors/relations.ts:28` contain **the same sentence**, and a PR that fixes the first while shipping the second hasn't made the codebase honest — it has made the remaining rot harder to find. Task 3 covers both spellings. All of it is comment-only and gate-neutral.

**Five comments in this class are false rather than stale** — they name a thing that does not exist, not a thing that changed:

| File | The fiction |
|---|---|
| `lib/engine/market-tick-builder.ts:4,52` | Names the harness as a second caller of `resolveMarketTickEntry`. It has exactly one caller (`lib/tick/processors/economy.ts:102`). |
| `lib/engine/industry.ts:14` | "The same functions feed the live tick, **the simulator**, and the substrate read service." No harness file imports it. |
| `lib/engine/physical-economy.ts:7` | Same claim, same file-set, equally false. |
| `lib/tick/world/relations-world.ts:8` | "**Both the Prisma adapter and the memory adapter** enforce this on every read and write." There is one adapter. |
| `lib/tick/adapters/memory/directed-build.ts:12`, `directed-logistics.ts:9` | Describe the live game's own backend as a fixture "for unit tests + the simulator". |

**Two of the spec's doc-fix targets are already done — this is not a gap.** The spec's *Doc fixes* section (written before PR1) lists `lib/tick/adapters/memory/events.ts:27` ("DB vs SimWorld") and `lib/tick/world/events-world.ts:113-117` ("Live: X. Sim: Y."). Both were fixed in PR1/PR2.5 and are clean on `main` today (verified by reading them, 2026-07-16). No task below touches them. Task 6's grep is what proves this rather than trusting it.

---

## Task 0: Capture the byte-identical baseline

There is no failing test to write first — this PR adds no behaviour. The baseline **is** the test, and it must be captured before a single file moves. Capturing it after would prove nothing.

**Files:**
- Create: `../../Users/kaifo/AppData/Local/Temp/claude/C--source-next-playground/e0170c32-d94b-4287-918a-6b78e6853ebc/scratchpad/baseline.norm` (scratch — never committed)

- [ ] **Step 1: Branch off a clean `main`**

`docs/stacked-pr-rule` (PR #176) is open and unmerged. Per CLAUDE.md, never branch off another open PR's branch: a squash-merge of the base permanently auto-closes the stacked PR. PR #176 touches only CLAUDE.md's *Git Workflow* section; this PR touches its *Commands* and *Project Structure* sections, so the two merge cleanly in either order.

```bash
git checkout main
git pull
git checkout -b refactor/tick-harness-move
```

- [ ] **Step 2: Confirm the tree is clean and the harness is where the plan expects**

```bash
git status --short
ls lib/engine/simulator/
```
Expected: no output from `git status`; `ls` lists `__tests__/ build-analysis.ts event-analysis.ts experiment.ts market-analysis.ts population-analysis.ts runner.ts types.ts`.

- [ ] **Step 3: Capture the normalized baseline**

Use this recipe **verbatim**. It took two corrections to get right. Two wall-clock sources leak to stdout, not one: `"elapsedMs"` (the only wall-clock field) and the `[events]` spawn log's `in <N>ms`, which the events processor `console.log`s to **stdout**, so `2>/dev/null` does not remove it. Normalise the durations rather than dropping the lines — the rest of each line is real signal worth diffing.

```bash
npm run simulate -- --json 2>/dev/null \
  | grep -v '"elapsedMs"' \
  | sed -E 's/[0-9]+ms/Xms/g' \
  > "$SCRATCH/baseline.norm"
```

Where `$SCRATCH` is `C:/Users/kaifo/AppData/Local/Temp/claude/C--source-next-playground/e0170c32-d94b-4287-918a-6b78e6853ebc/scratchpad`.

Expected: ~1,221,348 lines / ~28MB at 600 systems / 500 ticks / seed 42. Takes a few minutes.

- [ ] **Step 4: Verify the baseline is self-consistent (the recipe actually normalises)**

Run it a second time and diff the two. If this fails, the recipe is wrong and every later gate is meaningless — stop and fix it before touching code.

```bash
npm run simulate -- --json 2>/dev/null \
  | grep -v '"elapsedMs"' \
  | sed -E 's/[0-9]+ms/Xms/g' \
  > "$SCRATCH/baseline2.norm"
diff -q "$SCRATCH/baseline.norm" "$SCRATCH/baseline2.norm"
```
Expected: no output (files identical). Two independent runs match under this filter — the simulation is deterministic; only its diagnostics were not.

- [ ] **Step 5: Record the pre-change test count**

```bash
npx vitest run --project unit 2>&1 | tail -5
```
Expected: a passing run; note the test count. **This PR must not change it** — unlike PR1 (which deleted `sim-constants.test.ts` along with its mechanism), PR3 deletes no tests. It only moves one file and renames identifiers inside two. A changed count here means something was lost.

No commit — nothing has changed yet.

---

## Task 1: Move the directory

Pure path change. No symbol is renamed in this task, so the diff is a move plus six import lines, and a reviewer can check it by reading the import lines alone.

**Files:**
- Move: `lib/engine/simulator/` → `lib/tick-harness/` (7 files + `__tests__/` with 3 files)
- Modify: `scripts/simulate.ts:22,27,28,29,33`
- Modify: `lib/engine/__tests__/experiment.test.ts:5`

**Interfaces:**
- Consumes: nothing (first code task).
- Produces: the path `@/lib/tick-harness/*` / `../lib/tick-harness/*`. Task 2 renames the symbols *at* that path; Tasks 3–5 reference it in prose.

- [ ] **Step 1: Move the directory with `git mv`**

`git mv` (not a delete + create) so git records a rename and the diff stays reviewable.

```bash
git mv lib/engine/simulator lib/tick-harness
git status --short
```
Expected: ten `R` (renamed) entries, no `A`/`D`.

- [ ] **Step 2: Confirm nothing else in the repo imports the old path**

The only two importers are `scripts/simulate.ts` and `lib/engine/__tests__/experiment.test.ts`. Confirm — do not assume. **Two greps, because one pattern cannot catch both**: the test imports via a relative path (`"../simulator/experiment"`) that contains no `engine/` prefix.

```bash
grep -rn "engine/simulator" --include="*.ts" --include="*.tsx" lib/ scripts/ app/ components/
grep -rn "simulator/experiment" --include="*.ts" lib/
```

Expected from the first: **seven** lines — the five `simulate.ts` imports (`:22,27,28,29,33`) **plus two comment references at `lib/world/tick.ts:7` and `:120`**. Those two are **Task 3's**, not this task's — leave them alone here. Editing them now would contaminate a commit advertised as a move plus import lines, and would make Task 3 Step 1's old-text match fail.

Expected from the second: one line, `lib/engine/__tests__/experiment.test.ts:5`.

Anything beyond those eight lines is a new importer that appeared since this plan was written — update it in whichever task owns it.

- [ ] **Step 3: Update `scripts/simulate.ts`'s five import lines**

Replace the paths on lines 22–33. **Only the paths.** The imported names stay `runSimulation`/`experimentToSimConfig`/`SimConfig`/`SimResults` in this task — Task 2 renames them, and keeping the two apart is what makes each diff readable. Write exactly:

```typescript
import { runSimulation } from "../lib/tick-harness/runner";
import {
  ExperimentConfigSchema,
  experimentToSimConfig,
  buildExperimentResult,
} from "../lib/tick-harness/experiment";
import { summarizePopulation, detectPingPong, summarizeInfrastructure } from "../lib/tick-harness/population-analysis";
import { summarizeColonisation } from "../lib/tick-harness/build-analysis";
```

and at line 33:

```typescript
import type { SimConfig, SimResults } from "../lib/tick-harness/types";
```

- [ ] **Step 4: Update `lib/engine/__tests__/experiment.test.ts`'s import path**

Change line 5 from `} from "../simulator/experiment";` to:

```typescript
} from "@/lib/tick-harness/experiment";
```

(The file itself moves in Task 2 — this keeps it green in the meantime. Use the `@/` alias, not `../../tick-harness/experiment`: the relative form is about to be deleted anyway and the alias reads correctly at both locations.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no output (clean).

- [ ] **Step 6: Run the unit suite**

```bash
npx vitest run --project unit
```
Expected: all pass, same count as Task 0 Step 5.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(harness): move lib/engine/simulator to lib/tick-harness

The harness is a dev instrument, not pure game logic: runner.ts statically
imports lib/world/gen and lib/world/tick, so it never met lib/engine/'s
zero-I/O rule. Path change only; no symbol renamed."
```

---

## Task 2: Rename the harness's own symbols

**Files:**
- Modify: `lib/tick-harness/types.ts:16,129,130`
- Modify: `lib/tick-harness/runner.ts:5,20,21,41`
- Modify: `lib/tick-harness/experiment.ts:1-9,13,28,29,30,44,45,46,51,53`
- Modify: `scripts/simulate.ts:22,25,33,83,319,326,389,399`
- Move: `lib/engine/__tests__/experiment.test.ts` → `lib/tick-harness/__tests__/experiment.test.ts`
- Modify: the moved test at `:4,5,45,46,54,62`

**Interfaces:**
- Consumes: the `lib/tick-harness/*` path from Task 1.
- Produces:
  - `HarnessConfig` — `{ systemCount: number; seed: number; tickCount: number }` (`lib/tick-harness/types.ts`)
  - `HarnessResults` — unchanged shape, renamed (`lib/tick-harness/types.ts`)
  - `runTickHarness(config: HarnessConfig, label?: string): Promise<HarnessResults>` (`lib/tick-harness/runner.ts`)
  - `experimentToHarnessConfig(exp: ExperimentConfig): { config: HarnessConfig; label?: string }` (`lib/tick-harness/experiment.ts`)

- [ ] **Step 1: Rename in `lib/tick-harness/types.ts`**

Line 16: `export interface SimConfig {` → `export interface HarnessConfig {`

Line 129–130:
```typescript
export interface HarnessResults {
  config: HarnessConfig;
```

Then fix the file's header comment (lines 1–8) — it says "Calibration-harness types", which is already right, but it must not be left half-correct. Read it and confirm it names no moved path. It currently reads:

```typescript
/**
 * Calibration-harness types — the config it takes, the results it returns, and
 * the market/event/region health shapes its analyzers compute.
 *
 * The tick's own row types live in `lib/tick/rows.ts`; the one world model is
 * `World` (`lib/world/types.ts`) and the one tick pipeline is `runWorldTick`
 * (`lib/world/tick.ts`).
 */
```
That is accurate as-is. Leave it.

- [ ] **Step 2: Rename in `lib/tick-harness/runner.ts`**

Lines 19–25's type import:
```typescript
import type {
  HarnessConfig,
  HarnessResults,
  MarketSnapshot,
  EventLifecycle,
  RegionOverviewEntry,
} from "./types";
```

Lines 38–41:
```typescript
/**
 * Run the full calibration harness and return results.
 */
export async function runTickHarness(config: HarnessConfig, label?: string): Promise<HarnessResults> {
```

And the file header (lines 1–8), which names `runSimulation` and is otherwise correct. Replace the whole comment:

```typescript
/**
 * Calibration harness runner — generate a world, loop `runWorldTick`,
 * snapshot/analyze. A thin wrapper over the shared tick pipeline
 * (`lib/world/tick.ts`): `runTickHarness` exists to drive the real engine for
 * calibration health checks, not to simulate player trading. There is no bot
 * layer and no per-run constants override — it runs the same code constants
 * the live game does.
 */
```
(The old text's "see `experiment.ts`'s doc comment" pointer goes: Step 3 rewrites that comment, and the claim now stands on its own.)

- [ ] **Step 3: Rename in `lib/tick-harness/experiment.ts` and fix its stale build-plan pointer**

Replace the file header (lines 1–9). It cites `docs/build-plans/pivot-phase2-engine-extraction.md`, a build plan that no longer exists — build plans are deleted when their feature ships:

```typescript
/**
 * Experiment system — YAML config parsing, validation, and result serialization.
 *
 * The calibration harness is a thin wrapper over `generateWorld` +
 * `runWorldTick`: there is no per-run constants-override channel —
 * `runWorldTick` reads the same code constants the live game does — so an
 * experiment config only names the world to generate and how long to run it.
 */
```

Line 13:
```typescript
import type { HarnessConfig, HarnessResults } from "./types";
```

Lines 28–37:
```typescript
/** Convert a validated experiment config to HarnessConfig. */
export function experimentToHarnessConfig(exp: ExperimentConfig): {
  config: HarnessConfig;
  label?: string;
} {
  return {
    config: { systemCount: exp.systemCount, seed: exp.seed, tickCount: exp.ticks },
    label: exp.label,
  };
}
```

Lines 41–53:
```typescript
export interface ExperimentResult {
  label?: string;
  timestamp: string;
  config: HarnessConfig;
  marketHealth: HarnessResults["marketHealth"];
  eventImpacts: HarnessResults["eventImpacts"];
  elapsedMs: number;
}

/**
 * Wrap HarnessResults into a self-documenting experiment result for saving.
 */
export function buildExperimentResult(results: HarnessResults): ExperimentResult {
```

- [ ] **Step 4: Rename in `scripts/simulate.ts`**

Eight sites, none of which touches a printed string — every one is an import, a type annotation, or a call site. The `--help` banner (`:357-378`), the experiment banner (`:321-324`), the quick-run banner (`:396`), and `formatTable`'s `"Simulation completed in ..."` (`:114`) are **not** among them and must not move.

Line 22: `import { runTickHarness } from "../lib/tick-harness/runner";`

Line 25 (inside the `experiment` import block): `experimentToHarnessConfig,`

Line 33: `import type { HarnessConfig, HarnessResults } from "../lib/tick-harness/types";`

Line 83: `function formatTable(results: HarnessResults): string {`

Line 319: `const { config, label } = experimentToHarnessConfig(validated.data);`

Line 326: `const results = await runTickHarness(config, label);`

Line 389: `const config: HarnessConfig = {`

Line 399: `const results = await runTickHarness(config);`

- [ ] **Step 5: Move the experiment test and rename inside it**

```bash
git mv lib/engine/__tests__/experiment.test.ts lib/tick-harness/__tests__/experiment.test.ts
```

Then edit the moved file. Lines 2–5:
```typescript
import {
  ExperimentConfigSchema,
  experimentToHarnessConfig,
} from "../experiment";
```
(Back to a relative import — the test now sits next to its subject, matching the three sibling analyzer tests.)

Lines 45–64:
```typescript
  describe("experimentToHarnessConfig", () => {
    it("maps config fields directly onto HarnessConfig", () => {
      const exp = ExperimentConfigSchema.parse({
        label: "test",
        seed: 99,
        ticks: 200,
        systemCount: 120,
      });

      const { config, label } = experimentToHarnessConfig(exp);

      expect(label).toBe("test");
      expect(config).toEqual({ systemCount: 120, seed: 99, tickCount: 200 });
    });

    it("omits label when none is specified", () => {
      const exp = ExperimentConfigSchema.parse({});
      const { label } = experimentToHarnessConfig(exp);
      expect(label).toBeUndefined();
    });
  });
```

- [ ] **Step 6: Prove no `Sim` symbol survives in the moved tree or its callers**

```bash
grep -rn "SimConfig\|SimResults\|runSimulation\|experimentToSimConfig" --include="*.ts" lib/ scripts/ app/ components/
```
Expected: no output.

- [ ] **Step 7: Typecheck and test**

```bash
npx tsc --noEmit
npx vitest run --project unit
```
Expected: tsc clean; all tests pass at the Task 0 count (the moved test file keeps its 6 tests — the count must not drop).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(harness): rename Sim* harness symbols to Harness*

SimConfig/SimResults/runSimulation/experimentToSimConfig become
HarnessConfig/HarnessResults/runTickHarness/experimentToHarnessConfig, and
experiment.test.ts moves next to its subject. 'Sim' as a noun named a separate
backend that does not exist; the verb (npm run simulate) stays."
```

---

## Task 3: Sweep the two-backend fiction out of `lib/`

Each of these comments describes a second backend that does not exist, in one of its two spellings (`Sim` or `Prisma`). Five are false rather than stale — see the table above. Fix each doc comment **wholesale**: read the full comment, not the grepped line. This task is comment-only: no identifier, signature, or statement changes.

**Files:**
- Modify: `lib/world/tick.ts:7,16,120,161`
- Modify: `lib/engine/tick.ts:113-117`
- Modify: `lib/engine/directed-build.ts:8,45`
- Modify: `lib/engine/market-tick-builder.ts:1-9,50-55`
- Modify: `lib/engine/industry.ts:14`
- Modify: `lib/engine/physical-economy.ts:5-7`
- Modify: `lib/tick/processors/economy.ts:25-29`
- Modify: `lib/tick/processors/relations.ts:27-30`
- Modify: `lib/tick/world/economy-world.ts:17-21,73`
- Modify: `lib/tick/world/population-world.ts:31`
- Modify: `lib/tick/world/relations-world.ts:1-10`
- Modify: `lib/tick/world/directed-build-world.ts:1-6`
- Modify: `lib/tick/adapters/memory/directed-build.ts:12`
- Modify: `lib/tick/adapters/memory/directed-logistics.ts:9`
- Modify: `lib/tick/adapters/memory/population.ts:56`
- Modify: `lib/tick/adapters/memory/relations.ts:270`
- Modify: `lib/tick/processors/__tests__/events.test.ts:313`
- Modify: `lib/constants/economy-scale.ts:27`

**Interfaces:**
- Consumes: the `lib/tick-harness/runner.ts` path from Task 1.
- Produces: nothing — comments only. No identifier changes.

- [ ] **Step 1: `lib/world/tick.ts` — two moved paths, one dead symbol, one dead adapter**

**Four sites, not three.** This file is where the "fix it wholesale or it re-surfaces" corollary was learned, and it has a fourth hit at line 161 that a line-numbered sweep of the header would sail straight past.

Line 7 — the path moved:
```
 * calibration harness (`lib/tick-harness/runner.ts`) both call it.
```

Line 16 — **`Sim*` no longer exists**; PR2 renamed those rows to `Tick*` in `lib/tick/rows.ts` and left this line behind. This is PR2's rot, and this file is the one place it is load-bearing:
```
 * adapters' `Tick*` row shapes field-for-field (see the join/merge helpers
```

Lines 118–122 — the path moved:
```typescript
/**
 * Exported alongside `toTickSystems`/`toTickMarkets` — the calibration harness
 * (`lib/tick-harness/runner.ts`) reuses these same joins to build the
 * tick-row views its (pre-existing) health analyzers read.
 */
```

Lines 160–161 — a guard attributed to an adapter deleted in the Phase-2 pivot. The edge case is real; only its attribution is fiction:
```typescript
    // Every seeded system has a non-null factionId; the fallback covers a
    // mid-write gap.
```

- [ ] **Step 2: `lib/engine/tick.ts:113-117` — "DB vs SimWorld"**

Neither a DB nor a `SimWorld` exists; `SimWorld` never existed outside prose. Replace the whole comment:

```typescript
/**
 * Pre-resolved inputs for building a MarketTickEntry — the caller resolves its
 * own row shape into this common shape, and the builder handles the shared
 * computation (gov consumption boost).
 */
```

- [ ] **Step 3: `lib/engine/directed-build.ts` — "DB/sim rows" and "live/sim path"**

Line 8:
```
 * The processor maps tick rows into BuildSystemState and applies the returned PlannedBuild[].
```

Lines 42–48 — fix only the `live/sim` clause; the rest of the comment is accurate and load-bearing:
```typescript
  /**
   * Local production rate of this good. A self-supplier (production ≥ demand) is never a
   * structural deficit — its low standing stock is throughput, not need (mirrors the logistics
   * matcher's self-supply gate). Optional for engine-test fixtures; the tick path always
   * supplies it via toGoodMarketStates (a GoodMarketState, which carries production).
   */
```

- [ ] **Step 4: `lib/engine/market-tick-builder.ts` — a comment that is simply false**

`resolveMarketTickEntry` has **exactly one caller**: `lib/tick/processors/economy.ts:102` (verified by grep). The harness does not call it at all — its analyzers reach for `spotPrice`/`curveForGood` instead. So "Both the live economy processor and the simulator build MarketTickEntry objects through the same pipeline" names a second caller that does not exist and never will. This is the fossil class exactly.

Replace lines 1–9:
```typescript
/**
 * Shared market tick entry builder.
 *
 * The economy processor builds its MarketTickEntry objects through this
 * pipeline: good constants → event production/consumption modifiers.
 * (The legacy equilibrium-spread / self-sufficiency steps are gone — there is
 * no equilibrium target in the stock model.)
 */
```

Replace lines 50–55:
```typescript
/**
 * Resolve a market tick from data-source-agnostic inputs. Returns the
 * stock-sim `entry` and the pricing `anchorMult` (derived from the same
 * modifier aggregation) so the caller never re-aggregates.
 */
```
(**"stock-sim" stays** in both this comment and the `ResolvedMarketTick` one at line 17 — verb usage, and the spec keeps the verb. The only edit here is dropping the false second caller. Unabbreviating it would be churn on text that was never wrong, in a file whose rot this task is supposed to be *reducing*.)

- [ ] **Step 5: `lib/tick/processors/economy.ts:25-29` — a Prisma adapter that no longer exists**

The comment names a Prisma backend deleted in the Phase-2 pivot, plus a live/sim split. Replace lines 25–29 — the block through the trailing ` *` separator, keeping the monthly-pulse paragraph below untouched:

```typescript
/**
 * Pure processor body, run against the in-memory adapter by `runWorldTick`.
 * Per-run knobs the body must not hard-code (the production cover, modifier
 * caps, the strike regime) come in via `params`.
 *
```

⚠ **The old comment says "(RNG, sim params)" and it is wrong about the RNG too** — `EconomyProcessorParams` has no `rng` field. The body destructures `{ interval, simParams, modifierCaps, strikeParams }` (`economy.ts:42`); the economy processor takes no RNG at all. Don't carry that error forward into the replacement: name what the params actually are. (`simParams` keeps its name — `EconomySimParams` is verb usage the spec explicitly keeps — which is why the replacement describes the knobs rather than listing field names.)

- [ ] **Step 5b: `lib/tick/processors/relations.ts:27-30` — the same sentence, in the sibling processor**

This is the verbatim twin of the comment Step 5 just fixed. Replace lines 27–30, keeping the per-tick-sequence list below untouched:

```typescript
/**
 * Pure processor body, run against the in-memory adapter by `runWorldTick`.
 * All knobs that vary come in via `params`.
 *
```

- [ ] **Step 6: `lib/tick/world/economy-world.ts` — two sites**

Lines 17–20 — there is one adapter, so there is no "live: … sim: …" fork:
```typescript
/**
 * Flat market row + the system context the processor needs. The adapter
 * resolves `goodId` to its canonical key so the processor body never thinks
 * about that.
 */
```

Line 73 — match the phrasing PR1 already shipped on the sibling file (`events-world.ts:110`), which says the honest thing: there is one source, and it is `runWorldTick` (verified — `lib/world/tick.ts:571-576` builds every field):
```typescript
/** Per-tick params passed alongside the world, all sourced by `runWorldTick`. */
```

- [ ] **Step 7: `lib/tick/world/population-world.ts:31`**

Same source, same phrasing (verified — `lib/world/tick.ts:598-602`). Keep "Per-run" and the `calibratable` note; only the dead split goes:
```typescript
/** Per-run params passed alongside the world, all sourced by `runWorldTick`; calibratable. */
```

- [ ] **Step 8: The two memory adapters — comments that describe the live game as a test fixture**

Both are imported and driven by `runWorldTick` (`lib/world/tick.ts:68-69`) — they are *the* adapters the live game ticks through, not test doubles. "For unit tests + the simulator" is the false split at its most misleading: it reads as if the real game used something else.

`lib/tick/adapters/memory/directed-build.ts:12`:
```typescript
/** The DirectedBuildWorld adapter — the only backend. Captures writes for assertions + write-back. */
```

`lib/tick/adapters/memory/directed-logistics.ts:9`:
```typescript
/** The DirectedLogisticsWorld adapter — the only backend. Captures writes for assertions. */
```

- [ ] **Step 8b: The two World interfaces that name a `{prisma,memory}` fork**

`lib/tick/adapters/` contains exactly one directory: `memory`. Both of these headers point a reader at a path that does not exist, and `relations-world.ts` also cites `docs/design/active/processor-architecture.md` — there is no `docs/design/` tree (the doc lives at `docs/active/engineering/processor-architecture.md`).

`lib/tick/world/relations-world.ts:1-10` — replace the whole header:
```typescript
/**
 * RelationsWorld — data interface for the relations processor.
 *
 * The adapter in `lib/tick/adapters/memory/relations.ts` implements it.
 * See `docs/active/engineering/processor-architecture.md` for the broader pattern.
 *
 * Pair convention: unordered pairs are stored with `factionAId < factionBId`.
 * The adapter enforces this on every read and write; callers see the same
 * canonical ordering everywhere.
 */
```

`lib/tick/world/directed-build-world.ts:1-6` — replace the whole header. Note the old text also violates CLAUDE.md's "comments describe the code, not the plan" by promising what a follow-on plan will land:
```typescript
/**
 * DirectedBuildWorld — data interface for the directed-build processor.
 * The adapter in `lib/tick/adapters/memory/directed-build.ts` implements it.
 * Sharding is PER-FACTION (the build planner needs all of a faction's systems
 * at once), matching logistics.
 */
```

- [ ] **Step 8c: Three stray "mirrors the Prisma adapter" comments**

Each explains a behaviour by reference to a deleted implementation. The behaviour stays; the dead referent goes.

`lib/tick/adapters/memory/population.ts:56`:
```typescript
    // computeSystemLabourSnapshot scans the whole building set.
```

`lib/tick/adapters/memory/relations.ts:270`:
```typescript
        // startTick == phaseStartTick on create.
```

`lib/tick/processors/__tests__/events.test.ts:313`:
```typescript
    // the contract.
```

- [ ] **Step 8d: Two `lib/engine/` comments naming the harness as a consumer that never existed**

Neither module is imported by any harness file (verified: `grep -rn "engine/industry\|engine/physical-economy" lib/tick-harness/ scripts/` returns nothing). These are the same defect as Step 4's, one layer over — and they sit outside Task 6 Step 2's `lib/tick/`-and-`lib/world/` survivor net, so they must be fixed here or not at all.

`lib/engine/industry.ts:14-15`:
```
 * supply-chain cascade. The same functions feed the live tick and the
 * substrate read service.
```

`lib/engine/physical-economy.ts:5-7`:
```
 * Civilian consumption derives from a demand basis: the flat per-capita baseline
 * plus additive per-grade baskets weighted by skilled work performed. The
 * per-good production/consumption snapshot shape is shared by the live tick and
 * the read service so there is one source of truth.
```

- [ ] **Step 9: `lib/constants/economy-scale.ts:27` — "the headless sim"**

The sentence already says "calibration harness" one line up; this is the noun re-entering by the back door. Change only that clause:
```
 * (the dev server auto-loads `.env`; the headless harness doesn't). Tests pin this to 1 via the vitest
```

- [ ] **Step 10: Typecheck and test**

Comments only, so this must be a no-op — which is exactly why it is worth confirming (a mangled block comment silently swallows code).

```bash
npx tsc --noEmit
npx vitest run --project unit
```
Expected: tsc clean; all tests pass at the Task 0 count.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "docs(tick): drop the two-backend fiction from the tick's comments

The split is spelled Sim-vs-World in some files and Prisma-vs-memory in others;
both name a backend that does not exist (lib/tick/adapters/ has one directory).
Five comments were false rather than stale: market-tick-builder, industry, and
physical-economy each name the harness as a consumer that never imported them;
relations-world claims both adapters enforce its pair ordering; and the two
memory adapters describe the live game's own backend as a test fixture."
```

---

## Task 4: Sweep `docs/` and `CLAUDE.md`

**Files:**
- Modify: `docs/SPEC.md:60`
- Modify: `docs/active/engineering/processor-architecture.md:23,27`
- Modify: `docs/active/gameplay/economy-equilibrium-rework.md:136`
- Modify: `docs/active/gameplay/economy-specialisation-s3-demand.md:92`
- Modify: `CLAUDE.md:16,19,28-31`

**Interfaces:**
- Consumes: `lib/tick-harness/runner.ts` (Task 1), `HarnessResults` (Task 2).
- Produces: nothing — prose only.

- [ ] **Step 0: `docs/SPEC.md:60` — the split, asserted in the most-read doc in the repo**

CLAUDE.md's first instruction is to read `docs/SPEC.md` at the start of every session, and line 60 tells that reader the game has *"live/sim tick adapters"*. There is one adapter set. This is the single highest-traffic statement of the fiction in the tree, and it is one phrase:

```markdown
Threaded through the single `consumptionRate` chokepoint so pricing, satisfaction weights, seed, and the tick adapters all inherit it;
```
(Edit only that clause — line 60 is a long paragraph and the rest of it is accurate.)

- [ ] **Step 0b: `docs/active/gameplay/economy-specialisation-s3-demand.md:92`**

```markdown
   basis, computed once per system. There is one code path, so this is identical everywhere.
```
The original — *"Live and sim stay identical."* — was making a true and useful point (the demand basis isn't recomputed differently anywhere) via the dead split. Keep the point, drop the split.

- [ ] **Step 1: `docs/active/engineering/processor-architecture.md:23` — the moved path**

```markdown
The body depends **only** on its World interface, never on concrete row storage. `runWorldTick` (`lib/world/tick.ts`) constructs an `InMemoryXxxWorld` over the current `World` and calls `run<Name>Processor(world, ctx, params)`. That single pipeline is what both the live `TickLoop` and the calibration harness (`lib/tick-harness/runner.ts`) invoke — see [tick-engine.md](./tick-engine.md) and [single-player-runtime.md](./single-player-runtime.md).
```

- [ ] **Step 2: `docs/active/engineering/processor-architecture.md:27` — "live/sim abstraction"**

The section heading above it ("Why keep the interface with one backend?") is already honest; the line beneath it reaches for the dead split to say what the seam *isn't*:

```markdown
With a single backend, the World interface isn't a multi-backend abstraction — it's a thin, useful seam:
```

- [ ] **Step 3: `docs/active/gameplay/economy-equilibrium-rework.md:136` — `SimResults`**

```markdown
*stdev*, not the price-level distribution we need. Port the audit's signals into `HarnessResults.marketHealth`:
```
Leave lines 132 ("Simulator dispersion metric") and 134 ("The simulator already runs…") — instrument usage, and the doc records a shipped design.

- [ ] **Step 4: `CLAUDE.md:16` — the moved path**

```markdown
- `npm run simulate` — Quick headless sanity check over the real tick (`lib/tick-harness/runner.ts`). Reports intrinsic economy-health metrics.
```

- [ ] **Step 5: `CLAUDE.md:19` — the harness paragraph**

It already says the right thing ("There is only one tick body…"). The one edit it needs is the name of the thing it describes — the paragraph opens by calling it "The simulator", the noun this project retires:

```markdown
The calibration harness (`lib/tick-harness/`) is a dev instrument, not a game feature — it runs `runWorldTick` (the exact tick the live loop runs) headlessly and reports economy-health metrics for validating changes before they ship. There is only one tick body, so the harness and the live game run literally the same code (no harness-only "bots" or strategies). World generation is `generateWorld(systemCount, seed)` (`lib/world/gen.ts`) invoked in-process on **New game**; there is no seed script and no database.
```

- [ ] **Step 6: `CLAUDE.md` Project Structure — add the new layer**

`lib/engine/`'s own description ("Pure game logic. Zero I/O") needs no edit — it becomes *more* true once its one impure resident leaves. What the section is missing is the resident's new home. Insert a bullet after the `lib/tick/` line (line 31), so the tick and its test bench read together:

```markdown
- `lib/tick-harness/` — The calibration harness: a dev instrument that runs `generateWorld` + `runWorldTick` headlessly for N ticks and reports economy-health metrics (`npm run simulate`). Not game logic and not engine-pure — it drives the real tick and analyzes its output. Its scope is the tick processors and the data they consume/produce, nothing else.
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: point the harness docs at lib/tick-harness

CLAUDE.md gains a layer entry for the harness; lib/engine/'s zero-I/O
description needed no change — it is now simply true."
```

---

## Task 5: Purge the leftover build artifacts of the move

**Files:**
- Verify only: `lib/engine/` no longer contains a `simulator/` directory or a stray empty `__tests__/`

- [ ] **Step 1: Confirm the old directory is gone and `lib/engine/__tests__/` still has other tests**

`git mv` of the last file out of a directory leaves nothing behind in git, but an editor or a stale `.next` cache can leave an empty dir on disk that greps and imports will not see but a human will.

```bash
ls lib/engine/ | grep -i simulator
ls lib/engine/__tests__/ | head -20
```
Expected: the first command prints nothing (grep exits 1 — that is success here). The second still lists the other engine tests (`tick.test.ts`, `directed-logistics.test.ts`, …) — `experiment.test.ts` must **not** be among them.

- [ ] **Step 2: If an empty `lib/engine/simulator/` remains on disk, remove it**

```bash
rmdir lib/engine/simulator 2>/dev/null || true
git status --short
```
Expected: `git status` shows nothing new (git never tracked the empty dir).

No commit unless Step 2 changed something tracked (it should not).

---

## Task 6: The repo-wide grep audit — the trap instrument

**⚠ This task is the reason PR3's review can be trusted.** A move PR's rot is not in its own diff: the file that documents the old path is not in any chunk, so no diff-scoped reviewer will ever see it. The grep is the instrument. Run it against the **whole repo**, not the diff, and not just `.ts`.

**Files:**
- Verify only (fix anything found, in the file where it is found)

- [ ] **Step 1: Grep every moved path and renamed symbol across code AND docs**

```bash
grep -rn "engine/simulator\|SimConfig\|SimResults\|runSimulation\|experimentToSimConfig\|SimWorld\|SimSystem\|SimMarketEntry\|SimEvent\|SimConstants\|SimRegion\|SimFlowEvent\|toSimSystems\|toSimMarkets\|toSimConnections\|prisma\|Prisma" \
  --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" --include="*.yaml" --include="*.yml" \
  lib/ scripts/ app/ components/ docs/ CLAUDE.md
```
Expected: **only** hits inside `docs/build-plans/` (the three plan files — `tick-harness-pr1-plan.md`, `tick-harness-pr2-plan.md`, `tick-harness-rename.md`, plus this one). Those are the spec and its history; PR4 deletes them together. **Any hit outside `docs/build-plans/` is rot this PR created and must be fixed now** — do not defer it, and do not assume a `.md` hit is harmless.

Ignore `.claude/reviews/`, `.git/`, and `.superpowers/` — those are dated session artifacts, not repo docs, and are excluded by the paths above.

- [ ] **Step 2: Grep the false-split *phrasings* — across code AND docs**

Catches whatever Task 3's line-numbered list missed — the "fix it wholesale or it re-surfaces" corollary, mechanised.

**⚠ Note the file scope: this grep must cover `docs/` and `CLAUDE.md`, not just `.ts`.** An earlier draft of this plan restricted Step 1 to symbols and Step 2 to `*.ts`, leaving a hole exactly at *prose patterns in `docs/*.md`* — and two real hits (`docs/SPEC.md:60`, `economy-specialisation-s3-demand.md:92`) lived in it. The trap does not care which grep you thought was covering the file.

```bash
grep -rni "live/sim\|live and sim\|sim and live\|sim-only\|the simulator\b\|headless sim\|vs SimWorld\|prisma" \
  --include="*.ts" --include="*.tsx" --include="*.md" \
  lib/ scripts/ app/ components/ docs/ CLAUDE.md
```
Review **every** hit against the keeper list in **Explicitly out of scope** — there is no directory this task waves through unread. Expected survivors:
- `lib/constants/*` — "simulator-calibrated" / "tune against sim equilibrium" (verb/instrument usage: keepers).
- `docs/planned/*` and dated findings in `docs/active/*` — historical prose (keepers).
- `docs/build-plans/*` — the spec and its history; PR4 deletes them.
- **`prisma`: zero hits outside `docs/planned/` and `docs/build-plans/` history.** `lib/tick/adapters/` has one directory. Any live `lib/` hit is rot Task 3 missed.

If a hit is neither a keeper nor already fixed, fix it — and if that happens more than once or twice, stop and fix Task 3's file list rather than accreting edits inside the verification task.

- [ ] **Step 3: Confirm no stdout string moved**

The gate in Step 5 would catch this, but 28MB of diff is a bad way to learn it. Check the cheap way first.

```bash
git diff main -- scripts/simulate.ts | grep -E "^[-+].*(console\.log|lines\.push|Simulation completed|Running quick-run|Running experiment)"
```
Expected: no output. Every changed line in `simulate.ts` should be an import, a type annotation, or a call site.

- [ ] **Step 4: Full static gates**

```bash
npx tsc --noEmit
npx vitest run --project unit
npx next build --webpack
```
Expected: tsc clean; tests pass at the Task 0 count; build succeeds. Use `--webpack` — the Turbopack build has unrelated quirks and webpack is this repo's PR gate.

- [ ] **Step 5: The byte-identical gate**

The whole PR rests on this. Same recipe as Task 0, same seed, same normalisation.

```bash
npm run simulate -- --json 2>/dev/null \
  | grep -v '"elapsedMs"' \
  | sed -E 's/[0-9]+ms/Xms/g' \
  > "$SCRATCH/after.norm"
diff -q "$SCRATCH/baseline.norm" "$SCRATCH/after.norm"
```
Expected: **no output.** Any diff is a real behaviour change this refactor smuggled in — do not rationalise it, do not normalise it away. Find it (`diff "$SCRATCH/baseline.norm" "$SCRATCH/after.norm" | head -40`) and fix the cause.

- [ ] **Step 6: Commit anything Steps 1–2 turned up**

If the greps were clean, there is nothing to commit and that is the expected outcome.

```bash
git status --short
```

---

## Task 7: Open the PR

- [ ] **Step 1: Push and open against `main`**

Base is `main`, not `docs/stacked-pr-rule` — see Task 0 Step 1.

```bash
git push -u origin refactor/tick-harness-move
gh pr create --base main --title "refactor(harness): move lib/engine/simulator to lib/tick-harness (PR3)" --body "$(cat <<'EOF'
## What

PR3 of 4 retiring the Sim-vs-World concept (spec: `docs/build-plans/tick-harness-rename.md`).

- Moves `lib/engine/simulator/` → `lib/tick-harness/`. The harness is a dev instrument, not pure game logic — `runner.ts` statically imports `lib/world/gen` and `lib/world/tick`, so it never met `lib/engine/`'s zero-I/O rule.
- Renames the harness's own symbols: `SimConfig`/`SimResults`/`runSimulation`/`experimentToSimConfig` → `HarnessConfig`/`HarnessResults`/`runTickHarness`/`experimentToHarnessConfig`.
- Sweeps the remaining two-backend doc rot from `lib/`, `docs/`, and `CLAUDE.md`.

`npm run simulate` stays: the verb is honest, it was the noun that was wrong.

**This PR closes the layer inversion PR2's review accepted on the condition that PR3 lands** (`lib/engine/simulator/*` importing `@/lib/tick/rows`).

## The fiction had two spellings

The split is written as `Sim`-vs-`World` in some files and `Prisma`-vs-`memory` in others. They are the same fossil, and `lib/tick/adapters/` contains exactly one directory (`memory`) — so the sweep covers both. Fixing `processors/economy.ts` while shipping its verbatim twin in `processors/relations.ts` would have made the rot harder to find, not easier.

## Five comments were false, not merely stale

The spec's thesis is that this rot is not cosmetic — each "Live: X. Sim: Y." comment marks where the split left something real behind. Five name things that do not exist:

- `market-tick-builder.ts`, `engine/industry.ts`, `engine/physical-economy.ts` — each names the harness as a direct consumer. No harness file imports any of them, and `resolveMarketTickEntry` has exactly one caller (`lib/tick/processors/economy.ts:102`).
- `tick/world/relations-world.ts` — "Both the Prisma adapter and the memory adapter enforce this on every read and write." There is one adapter. It also pointed at `docs/design/`, a tree that does not exist.
- The two memory adapters — "In-memory DirectedBuildWorld for unit tests + the simulator." Both are driven by `runWorldTick`: they are the live game's own backend, described as a test double.

Two of these were found only because a reviewer re-ran the sweep's own grep with a wider file scope than the sweep used. That is the trap this project keeps documenting: **a move PR's rot is not in its own diff**, so the grep is the instrument, not the reviewer.

## Gates

- **Byte-identical**: `npm run simulate -- --json` (600 systems / 500 ticks / seed 42), normalised for the two wall-clock leaks, diffs clean against a baseline captured from `main` before any file moved.
- `npx tsc --noEmit` clean; `npx vitest run --project unit` passing at an unchanged test count; `npx next build --webpack` succeeds.
- Repo-wide grep of every moved path and renamed symbol across `*.ts`/`*.md`: no hit outside `docs/build-plans/`. (A move PR's rot is not in its own diff — the grep, not the reviewer, is the instrument.)

## Next

PR4 — make the harness say what it ran (ECONOMY_SCALE print + import-order assert, logistics-activity metric). It is the only PR permitted to change output, and it deletes the three build plans.
EOF
)"
```

- [ ] **Step 2: Review**

Per CLAUDE.md, `/uber-review` against `main`. This is a rename/move-heavy diff: strip pure-deletion/rename noise where it helps and pass the moved-file list as context rather than as chunks.

**Tell the reviewer what a diff cannot show them:** the byte-identical gate passed, and the rot this PR fixes is rot that is invisible to a diff-scoped read. Ask specifically whether any *remaining* doc in the repo describes the harness at its old path.
