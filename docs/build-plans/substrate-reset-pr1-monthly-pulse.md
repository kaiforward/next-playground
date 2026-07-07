# Substrate Reset — PR1: Monthly Pulse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the faction-scale accounting processors from a per-tick *rolling* shard to a synchronized *monthly pulse* — the whole galaxy resolves economy/decay/population/migration/logistics/build together on one tick a month — while ship-arrivals, events, and trade-flow keep running every tick (the daily heartbeat).

**Architecture:** Sharding already lives *inside* each processor via `shardRange(total, tick, interval)` (`lib/tick/shard.ts`). We add a `pulseShard(total, tick, interval)` sibling that returns the *whole* list on the boundary tick (`tick % interval === 0`) and *empty* otherwise, then swap `shardRange → pulseShard` in the four processors that shard by system/faction (economy, migration, directed-logistics, directed-build). Infrastructure-decay and population inherit the economy's coverage automatically (they only act on systems present in the economy's `economySignals`, which is empty off-boundary). Trade-flow keeps `shardRange` (daily diffusion). The two agency `INTERVAL` constants drop from `2 × ECONOMY_UPDATE_INTERVAL` to `ECONOMY_UPDATE_INTERVAL` so logistics/build land on the same monthly boundary as the economy. The orchestrator `runWorldTick` needs no change. Finally, the "next update" cadence display collapses from two staggered countdowns to one monthly-pulse countdown.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Next.js 16. In-memory tick adapters (`lib/tick/adapters/memory/*`), seeded RNG (`mulberry32`/`tickRng`).

## Global Constraints

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown`** anywhere (except `JSON.parse` at true boundaries, narrowed immediately).
- **No postfix `!`** except `find(...)!` in tests (accepted project idiom).
- **Determinism:** never read `Date.now`/`Math.random`/`new Date()` in a processor body; RNG is seeded via `tickRng(seed, tick)`.
- **`World` stays JSON-serializable:** no `Map`/`Set`/`Date`/`Infinity`/`NaN` in world state. (PR1 does not change `World` shape, so no `SAVE_FORMAT_VERSION` bump.)
- **Unit tests:** `npx vitest run <path>` for one file; `npx vitest run` for all.
- **Build gate:** `npx next build --webpack` (the webpack build is the stable PR gate; Turbopack build has other quirks).
- **Calibration bar this PR:** coarse only — no `NaN`/`Infinity`/runaway/pinning. No precise tuning (deferred).
- Branch off the shared `feat/substrate-reset` branch. Commit after every task.

---

## File-by-file map

| File | Change |
|---|---|
| `lib/constants/tick-cadence.ts` | Add `MONTH_LENGTH` (= `ECONOMY_UPDATE_INTERVAL`). |
| `lib/tick/shard.ts` | Add `pulseShard(total, tick, interval)`. |
| `lib/tick/__tests__/shard.test.ts` | Add `pulseShard` unit tests. |
| `lib/tick/processors/economy.ts` | `shardRange → pulseShard` (keep `catchUpFactor`). |
| `lib/tick/processors/__tests__/economy.test.ts` | Replace the `fixed-interval system shard` block with pulse-coverage tests. |
| `lib/tick/processors/migration.ts` | `shardRange → pulseShard` (keep `catchUpFactor`). |
| `lib/tick/processors/__tests__/migration.test.ts` | `EDGE_TICK = 0` (pulse boundary), refresh shard-coverage assertions. |
| `lib/tick/processors/directed-logistics.ts` | `shardRange → pulseShard`. |
| `lib/constants/directed-logistics.ts` | `INTERVAL: ECONOMY_UPDATE_INTERVAL`. |
| `lib/tick/processors/__tests__/directed-logistics.test.ts` | `DUE_TICK = 0`. |
| `lib/tick/processors/directed-build.ts` | `shardRange → pulseShard`. |
| `lib/constants/directed-build.ts` | `INTERVAL: ECONOMY_UPDATE_INTERVAL`. |
| `lib/tick/processors/__tests__/directed-build.test.ts` | Align due-tick to the pulse boundary. |
| `lib/world/__tests__/tick-monthly-pulse.test.ts` | New: `runWorldTick` proves population moves only on boundary ticks. |
| `lib/services/system-cadence.ts` | Collapse to one monthly-pulse group. |
| `lib/services/universe.ts` | `economyShardGroup` → `0` (monthly pulse). |
| `lib/types/api.ts` | `SystemCadence` → single `pulseGroup` field. |
| `components/system/system-cadence-countdown.tsx` | One "next update" countdown. |
| `lib/services/__tests__/system-cadence.test.ts` | Update to the single pulse group. |
| `docs/active/engineering/tick-engine.md` | Rewrite the cadence description to the monthly pulse. |

---

## Task 1: `MONTH_LENGTH` constant + `pulseShard` helper

**Files:**
- Modify: `lib/constants/tick-cadence.ts`
- Modify: `lib/tick/shard.ts`
- Test: `lib/tick/__tests__/shard.test.ts`

**Interfaces:**
- Produces: `MONTH_LENGTH: number` (= 24); `pulseShard(total: number, tick: number, interval: number): ShardWindow` — `{start:0, end:total}` when `tick % interval === 0`, else `{start:0, end:0}`.

- [ ] **Step 1: Write the failing test.** Append to `lib/tick/__tests__/shard.test.ts` (add `pulseShard` to the existing import on line 1):

```ts
import { shardRange, catchUpFactor, shardGroupForIndex, ticksUntilShard, pulseShard } from "@/lib/tick/shard";
```

```ts
it("pulseShard: whole list on the boundary tick, empty otherwise", () => {
  const total = 100, interval = 24;
  expect(pulseShard(total, 0, interval)).toEqual({ start: 0, end: total });   // tick 0 → boundary
  expect(pulseShard(total, 24, interval)).toEqual({ start: 0, end: total });  // 24 % 24 = 0
  expect(pulseShard(total, 48, interval)).toEqual({ start: 0, end: total });
  for (let t = 1; t < interval; t++) {
    expect(pulseShard(total, t, interval)).toEqual({ start: 0, end: 0 });     // every off-boundary tick empty
  }
});
it("pulseShard: degenerates safely (total 0 → empty; interval ≤ 1 → whole list every tick)", () => {
  expect(pulseShard(0, 0, 24)).toEqual({ start: 0, end: 0 });
  expect(pulseShard(50, 5, 1)).toEqual({ start: 0, end: 50 }); // interval 1 → every tick is a boundary
  expect(pulseShard(50, 7, 1)).toEqual({ start: 0, end: 50 });
});
it("pulseShard: covers the whole list exactly once per interval (one boundary per period)", () => {
  const total = 100, interval = 24;
  let covered = 0;
  for (let t = 0; t < interval; t++) {
    const { start, end } = pulseShard(total, t, interval);
    covered += end - start;
  }
  expect(covered).toBe(total); // exactly one full pass per interval
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/tick/__tests__/shard.test.ts`
Expected: FAIL — `pulseShard is not exported` / `is not a function`.

- [ ] **Step 3: Implement `pulseShard`.** Append to `lib/tick/shard.ts` (after `catchUpFactor`):

```ts
/**
 * Pulse coverage: the whole item list on the resolution-pulse tick
 * (`tick % interval === 0`), empty on every other tick — the monthly-pulse
 * counterpart to {@link shardRange}'s rolling slice. Processors that resolve the
 * entire galaxy at once on the month boundary (economy, migration,
 * directed-logistics, directed-build) use this; trade-flow keeps `shardRange`
 * for daily diffusion. Half-open [start, end).
 */
export function pulseShard(total: number, tick: number, interval: number): ShardWindow {
  if (total <= 0) return { start: 0, end: 0 };
  const iv = Math.max(1, Math.floor(interval));
  const g = ((tick % iv) + iv) % iv; // non-negative group index
  return g === 0 ? { start: 0, end: total } : { start: 0, end: 0 };
}
```

- [ ] **Step 4: Add `MONTH_LENGTH`.** Append to `lib/constants/tick-cadence.ts`:

```ts
/**
 * One "month" = the resolution-pulse period, in ticks. All faction-scale
 * accounting (economy, infrastructure decay, population, migration, directed
 * logistics, directed build) resolves for the whole galaxy on ticks where
 * `tick % MONTH_LENGTH === 0`. Equal to the economy interval, so each system's
 * magnitude-per-resolution is unchanged from the old rolling shard — only
 * staggered → synchronized changes.
 */
export const MONTH_LENGTH = ECONOMY_UPDATE_INTERVAL;
```

- [ ] **Step 5: Run test to verify it passes.**

Run: `npx vitest run lib/tick/__tests__/shard.test.ts`
Expected: PASS (all `pulseShard` cases plus the pre-existing `shardRange`/`catchUpFactor` cases).

- [ ] **Step 6: Commit.**

```bash
git add lib/tick/shard.ts lib/tick/__tests__/shard.test.ts lib/constants/tick-cadence.ts
git commit -m "$(cat <<'EOF'
feat(tick): add pulseShard + MONTH_LENGTH for the monthly resolution pulse

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Economy processor → pulse coverage

The economy processor already no-ops when its shard window is empty (returns `emptyPayload` with no `economySignals`, which makes infrastructure-decay and population skip). Swapping to `pulseShard` therefore makes the *whole* economy — and, via `economySignals`, decay + population — resolve only on the month boundary, with `catchUpFactor(interval)` unchanged (interval 24 → factor 1 → full-month magnitude per system, identical to today's per-system total).

**Files:**
- Modify: `lib/tick/processors/economy.ts:21,44`
- Test: `lib/tick/processors/__tests__/economy.test.ts`

**Interfaces:**
- Consumes: `pulseShard` (Task 1).
- Produces: unchanged `runEconomyProcessor` signature; behavior is now pulse-gated.

- [ ] **Step 1: Rewrite the shard test block.** In `lib/tick/processors/__tests__/economy.test.ts`, delete the entire `describe("economy processor: fixed-interval system shard", …)` block (the "covers every system exactly once over `interval` ticks" test and the "scales the per-update step by catchUpFactor(interval)" test) and replace it with the pulse-coverage suite below. Update the file's shard import to add `pulseShard`:

```ts
// (top-of-file import, alongside shardRange if still referenced elsewhere in the file)
import { shardRange, pulseShard } from "@/lib/tick/shard";
```

```ts
// ── Monthly pulse: whole-galaxy on the boundary, empty off it ──────
describe("economy processor: monthly pulse coverage", () => {
  it("processes every system on the boundary tick and none off-boundary", async () => {
    const interval = 4; // small MONTH_LENGTH stand-in for the test
    const systems = Array.from({ length: 10 }, (_, i) => makeProducerSystem(`sys-${i}`, 0));
    const sortedIds = systems.map((s) => s.id).sort((a, b) => a.localeCompare(b));
    const markets = systems.map((s) => makeMarket(s.id, "food", 100));

    // Boundary tick (tick % interval === 0): the signal covers ALL systems.
    const wOn = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
    const onResult = await runEconomyProcessor(wOn, makeCtx(interval), { ...ECON_PARAMS, interval, rng: mulberry32(1) });
    const processed = [...onResult.economySignals!.dissatisfactionBySystem.keys()].sort((a, b) => a.localeCompare(b));
    expect(processed).toEqual(sortedIds);
    expect(onResult.globalEvents!.economyTick![0].systemCount).toBe(systems.length);

    // Off-boundary ticks: no economySignals at all (decay + population then skip).
    for (let t = 1; t < interval; t++) {
      const wOff = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
      const offResult = await runEconomyProcessor(wOff, makeCtx(t), { ...ECON_PARAMS, interval, rng: mulberry32(1) });
      expect(offResult.economySignals).toBeUndefined();
      expect(offResult.globalEvents!.economyTick![0].systemCount).toBe(0);
    }
  });

  it("interval=1 still resolves the whole list every tick (each tick is a boundary)", async () => {
    const systems = Array.from({ length: 5 }, (_, i) => makeProducerSystem(`s-${i}`, 0));
    const markets = systems.map((s) => makeMarket(s.id, "food", 100));
    const world = new InMemoryEconomyWorld({ systems, markets, modifiers: [] });
    const result = await runEconomyProcessor(world, makeCtx(3), { ...ECON_PARAMS, interval: 1, rng: mulberry32(1) });
    expect(result.economySignals!.dissatisfactionBySystem.size).toBe(systems.length);
  });
});
```

> Note: the pre-existing strike/dissatisfaction suites use `interval: 1`, where `pulseShard` and `shardRange` are identical (every tick is a boundary) — they need no change. Keep the `shardRange` import if any surviving test references it; otherwise drop it.

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/tick/processors/__tests__/economy.test.ts`
Expected: FAIL — off-boundary ticks still return signals (economy currently uses the rolling `shardRange`).

- [ ] **Step 3: Swap `shardRange → pulseShard`.** In `lib/tick/processors/economy.ts`:

Line 21, change the import:
```ts
import { pulseShard, catchUpFactor } from "@/lib/tick/shard";
```
Line 44, change the coverage call:
```ts
  const { start, end } = pulseShard(allSystemIds.length, ctx.tick, interval);
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run lib/tick/processors/__tests__/economy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/tick/processors/economy.ts lib/tick/processors/__tests__/economy.test.ts
git commit -m "$(cat <<'EOF'
feat(tick): economy resolves whole-galaxy on the monthly pulse

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migration processor → pulse coverage

**Files:**
- Modify: `lib/tick/processors/migration.ts` (import + the `shardRange` call on line ~26)
- Test: `lib/tick/processors/__tests__/migration.test.ts`

**Interfaces:**
- Consumes: `pulseShard` (Task 1).

- [ ] **Step 1: Update the test to the pulse boundary.** In `lib/tick/processors/__tests__/migration.test.ts`:

Change `EDGE_TICK` (currently `REFERENCE_INTERVAL - 1`) so the single edge processes on the pulse boundary:
```ts
// Migration is now a monthly pulse: all edges process on ticks where tick % interval === 0.
const EDGE_TICK = 0;
```
In the "scales the migrated amount by catchUpFactor(interval)" test, the two runs pass `ctx(REFERENCE_INTERVAL - 1)` / `ctx(2 * REFERENCE_INTERVAL - 1)`; under the pulse those are off-boundary and move nothing. Change both to a boundary tick for their interval — tick `0` is a boundary for any interval:
```ts
    await runMigrationProcessor(w1, ctx(0), { ...PARAMS, interval: REFERENCE_INTERVAL });
    // …
    await runMigrationProcessor(w2, ctx(0), { ...PARAMS, interval: 2 * REFERENCE_INTERVAL });
```
Add a coverage test asserting nothing moves off-boundary:
```ts
it("moves nothing on an off-boundary tick (monthly pulse)", async () => {
  const world = new InMemoryMigrationWorld(
    { systems: [sys("a", "f1", 1000, 2000, 0.5), sys("b", "f1", 100, 2000, 0)] },
    [conn("a", "b")],
  );
  const before = world.systems.find((s) => s.id === "a")!.population;
  await runMigrationProcessor(world, ctx(1), { ...PARAMS, interval: REFERENCE_INTERVAL }); // tick 1 %24 ≠ 0
  expect(world.systems.find((s) => s.id === "a")!.population).toBe(before);
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/tick/processors/__tests__/migration.test.ts`
Expected: FAIL — the new off-boundary test fails (rolling shard still moves the lone edge on tick 1 when it lands in that group), and/or the amount tests move nothing at the old `EDGE_TICK` under the not-yet-changed body. (Exact failure depends on step order; the point is red before the swap.)

- [ ] **Step 3: Swap `shardRange → pulseShard`.** In `lib/tick/processors/migration.ts`:

Change the shard import to `pulseShard` (keep `catchUpFactor`):
```ts
import { pulseShard, catchUpFactor } from "@/lib/tick/shard";
```
Change the coverage call (line ~26):
```ts
  const { start, end } = pulseShard(total, ctx.tick, params.interval);
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `npx vitest run lib/tick/processors/__tests__/migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/tick/processors/migration.ts lib/tick/processors/__tests__/migration.test.ts
git commit -m "$(cat <<'EOF'
feat(tick): migration resolves on the monthly pulse

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Directed-logistics → pulse + monthly interval

Directed-logistics shards over *factions*. Under the pulse, all factions redistribute on the month boundary. Its `INTERVAL` drops from `2 × ECONOMY_UPDATE_INTERVAL` (48) to `ECONOMY_UPDATE_INTERVAL` (24) so the boundary aligns with the economy pulse. Logistics is a level-fill (no `catchUpFactor`), so doubling its frequency just tops up toward the anchor each month — a coarse-sanity item, not a magnitude bug.

**Files:**
- Modify: `lib/tick/processors/directed-logistics.ts` (import + the `shardRange` call on line ~58)
- Modify: `lib/constants/directed-logistics.ts:9-10`
- Test: `lib/tick/processors/__tests__/directed-logistics.test.ts:42`

**Interfaces:**
- Consumes: `pulseShard` (Task 1).

- [ ] **Step 1: Update the test due-tick.** In `lib/tick/processors/__tests__/directed-logistics.test.ts`, change:
```ts
const DUE_TICK = 0; // monthly pulse: all factions redistribute on ticks where tick % interval === 0
```
Add an off-boundary no-op assertion. **Reuse the exact world + params the file's first test already constructs** (copy its world-building lines and its `{ interval: DIRECTED_LOGISTICS.INTERVAL, routeCost: () => 1 }` param object verbatim — do not invent a new fixture shape); the only change is the tick (`1`, off-boundary) and asserting zero effect:
```ts
it("moves nothing on an off-boundary tick (monthly pulse)", async () => {
  // ↓ paste the SAME world construction the first test in this file uses.
  const world = /* the file's existing single-faction surplus→deficit world */;
  await runDirectedLogisticsProcessor(world, { tick: 1 }, { interval: DIRECTED_LOGISTICS.INTERVAL, routeCost: () => 1 });
  expect(world.flows).toHaveLength(0);
  expect(world.stockUpdates.size).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: FAIL — at `DUE_TICK = 0` the rolling shard for `interval = 48` does not select the lone faction (its window is not group 0 at tick 0 for 48… it is group 0, but the constant is still 48 so `DUE_TICK` alignment and the off-boundary test disagree with rolling behavior); red before the swap.

- [ ] **Step 3: Align the interval constant.** In `lib/constants/directed-logistics.ts`, change lines 9-10:
```ts
  /** Ticks between agency sweeps: every faction redistributes on the monthly resolution pulse. */
  INTERVAL: ECONOMY_UPDATE_INTERVAL,
```

- [ ] **Step 4: Swap `shardRange → pulseShard`.** In `lib/tick/processors/directed-logistics.ts`, change the shard import to `pulseShard` and the call on line ~58:
```ts
  const { start, end } = pulseShard(factionKeys.length, ctx.tick, params.interval);
```

- [ ] **Step 5: Run test to verify it passes.**

Run: `npx vitest run lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/tick/processors/directed-logistics.ts lib/constants/directed-logistics.ts lib/tick/processors/__tests__/directed-logistics.test.ts
git commit -m "$(cat <<'EOF'
feat(tick): directed-logistics runs on the monthly pulse (interval → MONTH_LENGTH)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Directed-build → pulse + monthly interval

Mirror of Task 4, over factions, in the build processor.

**Files:**
- Modify: `lib/tick/processors/directed-build.ts:2,49`
- Modify: `lib/constants/directed-build.ts:9-10`
- Test: `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `pulseShard` (Task 1).

- [ ] **Step 1: Update the test.** In `lib/tick/processors/__tests__/directed-build.test.ts`, set any due-tick constant to the pulse boundary (`0`) exactly as Task 4 did, and add an off-boundary no-op test asserting `world.buildingUpdates` is empty at `tick: 1`. **Reuse the exact world the file's first test already constructs** (copy its world-building lines verbatim — do not invent a new fixture shape):
```ts
it("builds nothing on an off-boundary tick (monthly pulse)", async () => {
  // ↓ paste the SAME world construction the first test in this file uses.
  const world = /* the file's existing buildable world */;
  await runDirectedBuildProcessor(world, { tick: 1 }, { interval: DIRECTED_BUILD.INTERVAL, routeCost: () => 1 });
  expect(world.buildingUpdates).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: FAIL (off-boundary build still occurs under the rolling shard).

- [ ] **Step 3: Align the interval constant.** In `lib/constants/directed-build.ts`, change lines 9-10:
```ts
  /** Ticks between agency sweeps: every faction plans builds on the monthly resolution pulse (matches logistics). */
  INTERVAL: ECONOMY_UPDATE_INTERVAL,
```

- [ ] **Step 4: Swap `shardRange → pulseShard`.** In `lib/tick/processors/directed-build.ts`, line 2:
```ts
import { pulseShard } from "@/lib/tick/shard";
```
Line 49:
```ts
  const { start, end } = pulseShard(factionKeys.length, ctx.tick, params.interval);
```

- [ ] **Step 5: Run test to verify it passes.**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add lib/tick/processors/directed-build.ts lib/constants/directed-build.ts lib/tick/processors/__tests__/directed-build.test.ts
git commit -m "$(cat <<'EOF'
feat(tick): directed-build runs on the monthly pulse (interval → MONTH_LENGTH)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `runWorldTick` integration test — pulse witness

No orchestrator code changes are needed: `tick.ts` already passes `ECONOMY_UPDATE_INTERVAL` to economy/migration and the (now-monthly) `DIRECTED_*.INTERVAL` to the agency processors, and the processors now pulse-gate internally. Lock the composed behavior with an integration test. **Witness:** population is mutated *only* by the population + migration processors (both now monthly), so a system's population is unchanged on every off-boundary tick and first changes on the first boundary tick (`tick === MONTH_LENGTH`). (Market stock is *not* a valid witness — trade-flow moves it daily by design.)

**Files:**
- Create: `lib/world/__tests__/tick-monthly-pulse.test.ts`

**Interfaces:**
- Consumes: `generateWorld` (`lib/world/gen.ts`), `runWorldTick` (`lib/world/tick.ts`), `MONTH_LENGTH` (`lib/constants/tick-cadence.ts`).

- [ ] **Step 1: Write the failing test.** Create `lib/world/__tests__/tick-monthly-pulse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";
import type { World } from "@/lib/world/types";

function totalPopulation(w: World): number {
  return w.systems.reduce((sum, s) => sum + s.population, 0);
}

describe("runWorldTick: monthly pulse", () => {
  it("changes population only on the month boundary tick", async () => {
    let world = generateWorld({ systemCount: 40, seed: 7 });
    const startPop = totalPopulation(world);

    // Ticks 1..MONTH_LENGTH-1 are off-boundary: population is untouched.
    for (let t = 1; t < MONTH_LENGTH; t++) {
      world = (await runWorldTick(world)).world;
      expect(world.meta.currentTick).toBe(t);
      expect(totalPopulation(world)).toBeCloseTo(startPop, 6);
    }

    // Tick MONTH_LENGTH is the first boundary: the population processor runs.
    world = (await runWorldTick(world)).world;
    expect(world.meta.currentTick).toBe(MONTH_LENGTH);
    expect(totalPopulation(world)).not.toBeCloseTo(startPop, 6);
  });

  it("produces no NaN/Infinity in population or stock across a full month", async () => {
    let world = generateWorld({ systemCount: 40, seed: 7 });
    for (let t = 0; t < MONTH_LENGTH + 1; t++) world = (await runWorldTick(world)).world;
    for (const s of world.systems) expect(Number.isFinite(s.population)).toBe(true);
    for (const m of world.markets) expect(Number.isFinite(m.stock)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes.**

Run: `npx vitest run lib/world/__tests__/tick-monthly-pulse.test.ts`
Expected: PASS once Tasks 2–5 are merged (this test asserts the *composed* result). If it FAILS with population changing before `MONTH_LENGTH`, a processor still uses the rolling shard — recheck Tasks 2–5. (This task adds no production code; it's the regression lock.)

> If the generated 40-system world happens to produce a zero net population delta at the first boundary (unlikely but possible if growth and decline cancel), switch the boundary assertion to a per-system check: assert at least one system's `population` differs after the boundary tick.

- [ ] **Step 3: Commit.**

```bash
git add lib/world/__tests__/tick-monthly-pulse.test.ts
git commit -m "$(cat <<'EOF'
test(tick): lock the monthly pulse — population moves only on the boundary tick

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Collapse the cadence display to one monthly pulse

Under the pulse, every system's economy and every faction's logistics/build fire on the *same* boundary (`tick % MONTH_LENGTH === 0`). The two staggered per-system/per-faction shard groups collapse to a single group `0`. The "next update" UI becomes one countdown.

**Files:**
- Modify: `lib/types/api.ts:125-130` (`SystemCadence`) and `SystemDetailData.economyShardGroup`
- Modify: `lib/services/system-cadence.ts`
- Modify: `lib/services/universe.ts:196-200,237`
- Modify: `components/system/system-cadence-countdown.tsx`
- Test: `lib/services/__tests__/system-cadence.test.ts`

**Interfaces:**
- Produces: `SystemCadence = { pulseGroup: number }` (`pulseGroup` is always `0` under the pulse; kept as a field so the client's `ticksUntilShard(pulseGroup, tick, MONTH_LENGTH)` math is unchanged).

- [ ] **Step 1: Update the service test.** Rewrite `lib/services/__tests__/system-cadence.test.ts` assertions that expect per-system/per-faction `shardGroupForIndex` values so they expect the single `pulseGroup: 0`. Concretely, replace the block that computes `shardGroupForIndex(index, total, DIRECTED_LOGISTICS.INTERVAL)` and asserts `economyShardGroup`/`logisticsShardGroup` with:
```ts
it("returns pulseGroup 0 for every system (all resolve on the monthly boundary)", () => {
  const world = /* the test's existing generated/fixture world */;
  for (const s of world.systems) {
    expect(getSystemCadence(s.id)).toEqual({ pulseGroup: 0 });
  }
});
```
(Keep the file's existing world setup; only the expectation shape changes.)

- [ ] **Step 2: Run test to verify it fails.**

Run: `npx vitest run lib/services/__tests__/system-cadence.test.ts`
Expected: FAIL — `getSystemCadence` still returns `{ economyShardGroup, logisticsShardGroup }`.

- [ ] **Step 3: Collapse the `SystemCadence` type.** In `lib/types/api.ts`, replace lines 125-130:
```ts
export interface SystemCadence {
  /** Group in [0, MONTH_LENGTH): when the whole galaxy resolves. Under the monthly pulse this is always 0; kept so the client counts down with ticksUntilShard(pulseGroup, tick, MONTH_LENGTH). */
  pulseGroup: number;
}
```

- [ ] **Step 4: Rewrite `getSystemCadence`.** Replace `lib/services/system-cadence.ts` bodies with the single pulse group:
```ts
import { getWorld } from "@/lib/world/store";
import { ServiceError } from "./errors";
import type { SystemCadence } from "@/lib/types/api";

/**
 * The system's single "next update" cadence group. Under the monthly resolution
 * pulse the whole galaxy resolves together on `tick % MONTH_LENGTH === 0`, so the
 * group is uniformly 0; the client pairs it with the live tick via
 * `ticksUntilShard(pulseGroup, tick, MONTH_LENGTH)` to render the countdown.
 */
export function getSystemCadence(systemId: string): SystemCadence {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);
  return { pulseGroup: 0 };
}
```

- [ ] **Step 5: Update `universe.ts`.** In `lib/services/universe.ts`, drop the `shardGroupForIndex`/`economyShardRankById` economy-cadence computation (lines ~15-16 imports, ~196-200) and set the field to the pulse group. Replace the `economyShardGroup` computation with:
```ts
  // Monthly pulse: every system's economy resolves on tick % MONTH_LENGTH === 0.
  const economyShardGroup = 0;
```
Remove the now-unused `shardGroupForIndex` import and the `economyShardRankById` import if nothing else in the file uses them (check with `npx tsc --noEmit` in Step 7). Leave `SystemDetailData.economyShardGroup` in place (value 0).

- [ ] **Step 6: Collapse the countdown component.** Replace `components/system/system-cadence-countdown.tsx`:
```tsx
"use client";

import { Clock } from "lucide-react";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { useSystemCadence } from "@/lib/hooks/use-system-cadence";
import { ticksUntilShard } from "@/lib/tick/shard";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";

function label(ticks: number): string {
  return ticks === 0 ? "now" : `${ticks}t`;
}

/**
 * Compact "next update in N ticks" countdown for the system panel header. Under
 * the monthly resolution pulse the whole galaxy — this system's economy plus its
 * faction's logistics and build — resolves together on the month boundary, so it
 * is one countdown. Pure clock math off the live tick; no refetch.
 */
export function SystemCadenceCountdown({ systemId }: { systemId: string }) {
  const cadence = useSystemCadence(systemId);
  const { currentTick } = useTickContext();
  if (!cadence) return null;

  const next = ticksUntilShard(cadence.pulseGroup, currentTick, MONTH_LENGTH);

  return (
    <div className="hidden items-center gap-2.5 font-mono text-xs text-text-tertiary sm:flex">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span title="Next monthly update — the whole galaxy's economy, logistics and build resolve">
        <span className="text-text-secondary">next update</span> <span className="text-accent">{label(next)}</span>
      </span>
    </div>
  );
}
```

- [ ] **Step 7: Verify types + tests pass.**

Run: `npx tsc --noEmit`
Expected: no errors (confirms no dangling `economyShardGroup`/`logisticsShardGroup`/`shardGroupForIndex` references remain).
Run: `npx vitest run lib/services/__tests__/system-cadence.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add lib/types/api.ts lib/services/system-cadence.ts lib/services/universe.ts components/system/system-cadence-countdown.tsx lib/services/__tests__/system-cadence.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): collapse the system cadence display to one monthly-pulse countdown

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Docs + full verification gate

**Files:**
- Modify: `docs/active/engineering/tick-engine.md`

- [ ] **Step 1: Update the tick-engine doc.** In `docs/active/engineering/tick-engine.md`, rewrite the cadence description so it reads (present tense, no change-history): the tick engine runs a **daily heartbeat** (ship arrivals, event progression, trade-flow diffusion every tick) and a **monthly resolution pulse** every `MONTH_LENGTH` (24) ticks, on which the whole galaxy resolves in dependency order — economy → infrastructure decay → population → migration → directed logistics → directed build — synchronized, not round-robin. Remove any wording that says the economy processes a *rolling* per-system shard each tick or that logistics/build run on a `2 × ECONOMY_UPDATE_INTERVAL` clock. Search the doc for "shard", "ECONOMY_UPDATE_INTERVAL", and "48" and reconcile each mention.

- [ ] **Step 2: Run the full unit suite.**

Run: `npx vitest run`
Expected: PASS (all projects green).

- [ ] **Step 3: Run the calibration harness for coarse sanity.**

Run: `npm run simulate`
Expected: completes without throwing; reported economy-health metrics contain no `NaN`/`Infinity` and no runaway/pinning. (This is a coarse check, not a tuning pass — record the numbers in the PR description; do not tune.)

- [ ] **Step 4: Run the build gate.**

Run: `npx next build --webpack`
Expected: build succeeds.

- [ ] **Step 5: Commit.**

```bash
git add docs/active/engineering/tick-engine.md
git commit -m "$(cat <<'EOF'
docs(tick-engine): describe the daily heartbeat + monthly resolution pulse

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (against the spec's 0a)

- **"24 ticks = 1 month"** → `MONTH_LENGTH = ECONOMY_UPDATE_INTERVAL` (Task 1). ✅
- **Monthly, synchronized, whole galaxy, dependency order (economy→decay→pop→migration→logistics→build)** → economy/migration/logistics/build pulse-gated (Tasks 2–5); decay + population inherit economy's coverage via `economySignals` (unchanged, verified by Task 6). ✅
- **Daily: ship-arrivals, events, trade-flow** → untouched; trade-flow keeps `shardRange` (Task 2 note; no trade-flow file in the change set). ✅
- **Logistics/build move off the 48-tick clock onto the boundary** → `INTERVAL: ECONOMY_UPDATE_INTERVAL` (Tasks 4–5). ✅
- **No round-robin; one coherent run** → `pulseShard` (Task 1), witnessed by Task 6. ✅
- **Coarse sanity, no tuning** → Task 8 Step 3. ✅
- **No `World`-shape change / no save bump** → confirmed; PR1 touches processors, constants, one service shape (API only), and docs. ✅

**Placeholder scan:** the two agency processor-test steps (Tasks 4–5) reference the files' *existing* fixture factories (`makeSurplusDeficitWorld`/`makeBuildableWorld`) rather than reproducing them — the executing engineer reuses whatever fixture the file already defines; the note forbids inventing new shapes. All production-code steps carry complete code.

**Type consistency:** `SystemCadence.pulseGroup` (Task 7) is consumed only by the countdown component (Task 7) via `ticksUntilShard(pulseGroup, tick, MONTH_LENGTH)`; `pulseShard`'s `ShardWindow` return matches `shardRange`'s. No signature drift.

## Deferred to later PRs (not PR1)

PR2 (world-gen inversion + outpost/station + expansion) and PR3 (penalised cross-unowned logistics + profiling/coarse-calibration) get their own plans, authored once PR1 lands — their exact code depends on PR1's shape and on PR1's profiling numbers.
