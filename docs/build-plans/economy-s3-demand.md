# S3 Development-Tiered Civilian Demand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Civilian consumption varies by development — skilled work performed adds per-grade consumption baskets on top of the flat per-capita baseline, per `docs/planned/economy-specialisation-s3-demand.md`.

**Architecture:** A new `CivilianDemandBasis` (`{population, technicians, engineers}`) replaces bare `population` in the civilian-demand chokepoint `consumptionRate()`. Technicians/engineers come from the existing `computeLabourAllocation` (skilled work *performed*). A new one-pass helper `computeSystemLabourSnapshot` bundles the production gates (`LabourState`) and the demand basis so adapters compute both per system in one `labourParts` scan. Everything downstream (pricing `demandRate`, satisfaction weights, seed stocks, UI footprint) threads the basis instead of population.

**Tech Stack:** TypeScript 5 strict, Vitest 4 (`unit` project has no `DATABASE_URL` — engine/constants only), Prisma 7.

**Branch:** `feat/economy-s3-demand` (exists; spec committed).

## Global Constraints

- No `as` assertions (except `as const` / guards in `lib/types/guards.ts`); no `unknown`; no postfix `!` outside `find(...)!` in tests.
- Engine functions stay pure — no DB imports; never statically import `@/lib/prisma` into unit-tested module graphs.
- New constants go through `scaleRecord` (ECONOMY_SCALE) exactly like `GOOD_CONSUMPTION`.
- Import-cycle rule for this feature: `lib/engine/physical-economy.ts` must never import `lib/engine/industry.ts` (industry imports the basis type FROM physical-economy).
- Comments describe the code, never the plan/stage that produced it.
- Live and sim must stay identical: every change to a prisma adapter has a mirrored memory-adapter change.
- Commit after each task on `feat/economy-s3-demand`.

**Deliberately unchanged (do NOT "fix" these):**
- `lib/engine/industry.ts:681` — `POP_CENTRE_STORAGE` sizing keys off *base* `GOOD_CONSUMPTION > 0` as a "is this a consumed good" flag. Basket goods are a subset of base-consumed goods (Task 1 test enforces), so the flag stays correct. Storage sizing vs discretionary demand is an S4 calibration question.
- `MarketTickEntry.consumptionRate` (`lib/engine/tick.ts`) — stays a plain number; the basis is resolved at the adapter boundary, the tick body never sees it.
- Satisfaction weights (`lib/tick/processors/economy.ts:139-146`) and the build planner (`lib/engine/directed-build.ts`) — both consume adapter-resolved rates / stored `demandRate`, so they inherit the new demand automatically. No edits.

---

### Task 1: Basket constants

**Files:**
- Modify: `lib/constants/physical-economy.ts` (after `GOOD_CONSUMPTION`, before `LABOUR_HALF_POP`)
- Test: `lib/constants/__tests__/physical-economy.test.ts` (create)

**Interfaces:**
- Produces: `SKILL1_CONSUMPTION: Record<string, number>`, `SKILL2_CONSUMPTION: Record<string, number>` — sparse per-good per-head needs, scaled.

- [ ] **Step 1: Write the failing test**

Create `lib/constants/__tests__/physical-economy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  GOOD_CONSUMPTION,
  SKILL1_CONSUMPTION,
  SKILL2_CONSUMPTION,
} from "../physical-economy";

describe("skill consumption baskets", () => {
  it("every basket good is a base-consumed good (POP_CENTRE_STORAGE flag + demandFootprint filter rely on this)", () => {
    for (const basket of [SKILL1_CONSUMPTION, SKILL2_CONSUMPTION]) {
      for (const goodId of Object.keys(basket)) {
        expect(GOOD_CONSUMPTION[goodId], goodId).toBeGreaterThan(0);
      }
    }
  });

  it("all basket needs are positive", () => {
    for (const basket of [SKILL1_CONSUMPTION, SKILL2_CONSUMPTION]) {
      for (const [goodId, need] of Object.entries(basket)) {
        expect(need, goodId).toBeGreaterThan(0);
      }
    }
  });

  it("luxuries are engineer-exclusive (the top-of-ladder signal)", () => {
    expect(SKILL1_CONSUMPTION.luxuries).toBeUndefined();
    expect(SKILL2_CONSUMPTION.luxuries).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit lib/constants/__tests__/physical-economy.test.ts`
Expected: FAIL — `SKILL1_CONSUMPTION` has no exported member.

- [ ] **Step 3: Add the constants**

In `lib/constants/physical-economy.ts`, insert after the `GOOD_CONSUMPTION` block:

```ts
/**
 * Per-grade civilian consumption baskets — per skilled head, ADDED on top of the
 * unskilled GOOD_CONSUMPTION baseline (never replacing it). The head counts are
 * skilled work performed (computeLabourAllocation technicians/engineers), so
 * demand concentrates at developed systems and decays with a hub's industry.
 *
 * Sizing rule (first-draft, joint S4 calibration owns finals): skilled heads are
 * a small population share (~15% technicians / ~4% engineers at a mature hub), so
 * per-head needs are large multiples of the per-capita base — targeting total
 * hub demand ≈ 2-3× base demand on basket goods. Basket goods must be a subset
 * of base-consumed goods (see lib/constants/__tests__/physical-economy.test.ts).
 */
export const SKILL1_CONSUMPTION: Record<string, number> = scaleRecord({
  consumer_goods: 0.015,
  medicine: 0.007,
  textiles: 0.005,
  electronics: 0.003,
});

/** Engineer basket — tier-2-centric; luxuries deliberately appear ONLY here. */
export const SKILL2_CONSUMPTION: Record<string, number> = scaleRecord({
  luxuries: 0.025,
  electronics: 0.02,
  consumer_goods: 0.02,
  medicine: 0.01,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit lib/constants/__tests__/physical-economy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/constants/physical-economy.ts lib/constants/__tests__/physical-economy.test.ts
git commit -m "feat(economy): per-grade civilian consumption baskets (S3)"
```

---

### Task 2: `CivilianDemandBasis`, basis-taking `consumptionRate`, `computeSystemLabourSnapshot`, economy adapters

**Files:**
- Modify: `lib/engine/physical-economy.ts`
- Modify: `lib/engine/industry.ts` (after `computeLabourAllocation`, ~line 226)
- Modify: `lib/tick/adapters/prisma/economy.ts`
- Modify: `lib/tick/adapters/memory/economy.ts`
- Test: `lib/engine/__tests__/physical-economy.test.ts` (rewrite), `lib/engine/__tests__/industry.test.ts` (add block)

**Interfaces:**
- Consumes: `SKILL1_CONSUMPTION`/`SKILL2_CONSUMPTION` (Task 1); existing `labourParts`, `labourStateFromParts`, `computeLabourAllocation`, `LabourState` in `lib/engine/industry.ts`.
- Produces (later tasks rely on these EXACT names):
  - `interface CivilianDemandBasis { population: number; technicians: number; engineers: number }` (physical-economy.ts)
  - `consumptionRate(goodId: string, basis: CivilianDemandBasis): number`
  - `interface SystemLabourSnapshot { state: LabourState; basis: CivilianDemandBasis }` (industry.ts)
  - `computeSystemLabourSnapshot(buildings: Record<string, number>, population: number): SystemLabourSnapshot`
- Note: `LabourAllocation` (existing) is structurally assignable to `CivilianDemandBasis` (has all three fields plus extras) — that's how `computeSystemLabourSnapshot` fills `basis` with no mapping code.

- [ ] **Step 1: Rewrite the engine test**

Replace the `consumptionRate` describe block in `lib/engine/__tests__/physical-economy.test.ts` (keep any unrelated blocks):

```ts
import { describe, it, expect } from "vitest";
import { consumptionRate } from "../physical-economy";
import type { CivilianDemandBasis } from "../physical-economy";
import {
  GOOD_CONSUMPTION,
  SKILL1_CONSUMPTION,
  SKILL2_CONSUMPTION,
} from "@/lib/constants/physical-economy";

const popOnly = (population: number): CivilianDemandBasis => ({
  population,
  technicians: 0,
  engineers: 0,
});

describe("consumptionRate", () => {
  it("scales linearly with population at zero skilled work (baseline preserved)", () => {
    const single = consumptionRate("food", popOnly(100));
    const triple = consumptionRate("food", popOnly(300));
    expect(single).toBeCloseTo(GOOD_CONSUMPTION.food * 100, 10);
    expect(triple).toBeCloseTo(single * 3, 10);
  });

  it("clamps negative population and skilled counts to zero", () => {
    expect(consumptionRate("food", popOnly(0))).toBe(0);
    expect(consumptionRate("food", popOnly(-100))).toBe(0);
    expect(
      consumptionRate("food", { population: 100, technicians: -5, engineers: -5 }),
    ).toBeCloseTo(GOOD_CONSUMPTION.food * 100, 10);
  });

  it("returns 0 for unknown goods", () => {
    expect(consumptionRate("not_a_good", { population: 1000, technicians: 100, engineers: 50 })).toBe(0);
  });

  it("technicians add their basket on top of the baseline", () => {
    const base = consumptionRate("consumer_goods", popOnly(1000));
    const withTech = consumptionRate("consumer_goods", { population: 1000, technicians: 100, engineers: 0 });
    expect(withTech).toBeCloseTo(base + SKILL1_CONSUMPTION.consumer_goods * 100, 10);
  });

  it("engineers add luxuries demand; technicians do not", () => {
    const base = consumptionRate("luxuries", popOnly(1000));
    const withTech = consumptionRate("luxuries", { population: 1000, technicians: 200, engineers: 0 });
    const withEng = consumptionRate("luxuries", { population: 1000, technicians: 0, engineers: 40 });
    expect(withTech).toBeCloseTo(base, 10);
    expect(withEng).toBeCloseTo(base + SKILL2_CONSUMPTION.luxuries * 40, 10);
  });

  it("non-basket goods ignore skilled work entirely", () => {
    const base = consumptionRate("food", popOnly(1000));
    const skilled = consumptionRate("food", { population: 1000, technicians: 200, engineers: 40 });
    expect(skilled).toBeCloseTo(base, 10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit lib/engine/__tests__/physical-economy.test.ts`
Expected: FAIL — type error / wrong arity on `consumptionRate`.

- [ ] **Step 3: Implement the basis + chokepoint**

Replace the top of `lib/engine/physical-economy.ts` (keep `SubstrateGoodRate` as-is):

```ts
/**
 * Pure physical-economy primitives — zero DB dependency.
 *
 * Civilian consumption derives from a demand basis: the flat per-capita baseline
 * plus additive per-grade baskets weighted by skilled work performed. The
 * per-good production/consumption snapshot shape is shared by the live tick,
 * the simulator, and the read service so there is one source of truth.
 * Production itself is capacity-driven and lives in `industry.ts`.
 */
import {
  GOOD_CONSUMPTION,
  SKILL1_CONSUMPTION,
  SKILL2_CONSUMPTION,
} from "@/lib/constants/physical-economy";

/**
 * Civilian demand basis for one system: headcount plus skilled work performed.
 * Technicians/engineers are jobs being worked (bounded by built jobs, academy
 * licence, and population — computeLabourAllocation), not a population stratum;
 * a hub that loses its industry sheds the discretionary demand with it.
 */
export interface CivilianDemandBasis {
  population: number;
  /** People working skill-1 (technician) heads. */
  technicians: number;
  /** People working skill-2 (engineer) heads. */
  engineers: number;
}

/** Civilian consumption rate: per-capita baseline + additive per-grade baskets. */
export function consumptionRate(goodId: string, basis: CivilianDemandBasis): number {
  return (
    (GOOD_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.population) +
    (SKILL1_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.technicians) +
    (SKILL2_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.engineers)
  );
}
```

- [ ] **Step 4: Add the snapshot helper to `lib/engine/industry.ts`**

After `computeLabourAllocation` (~line 226). Add `import type { CivilianDemandBasis } from "@/lib/engine/physical-economy";` to the imports (industry.ts may already import `SubstrateGoodRate` from there — extend that import).

```ts
/**
 * Per-system labour snapshot shared across all of a system's goods: the
 * production fulfilment gates plus the civilian demand basis, derived from one
 * labourParts pass. Cache one per system and reuse across its goods — the
 * pattern every tick adapter and the seed path follow.
 */
export interface SystemLabourSnapshot {
  state: LabourState;
  basis: CivilianDemandBasis;
}

export function computeSystemLabourSnapshot(
  buildings: Record<string, number>,
  population: number,
): SystemLabourSnapshot {
  const parts = labourParts(buildings);
  return {
    state: labourStateFromParts(parts, population),
    basis: computeLabourAllocation(parts, population),
  };
}
```

Add a snapshot test block to `lib/engine/__tests__/industry.test.ts` (import `computeSystemLabourSnapshot` alongside the existing industry imports):

```ts
describe("computeSystemLabourSnapshot", () => {
  it("bundles the same state and allocation the standalone helpers produce", () => {
    const buildings = { electronics: 4, vocational_school: 2, research_institute: 1 };
    const snap = computeSystemLabourSnapshot(buildings, 500);
    const parts = labourParts(buildings);
    expect(snap.state).toEqual(labourStateFromParts(parts, 500));
    const alloc = computeLabourAllocation(parts, 500);
    expect(snap.basis.population).toBe(alloc.population);
    expect(snap.basis.technicians).toBe(alloc.technicians);
    expect(snap.basis.engineers).toBe(alloc.engineers);
  });
});
```

(If `labourParts`/`labourStateFromParts` aren't already imported by the test file, add them.)

- [ ] **Step 5: Update the two economy adapters**

`lib/tick/adapters/prisma/economy.ts`:

```ts
// imports: replace
import { computeLabourState, buildingProduction } from "@/lib/engine/industry";
import type { LabourState } from "@/lib/engine/industry";
// with
import { computeSystemLabourSnapshot, buildingProduction } from "@/lib/engine/industry";
import type { SystemLabourSnapshot } from "@/lib/engine/industry";
```

Replace the cache and per-market resolution inside `getMarketsForSystems` (currently lines 74, 81-85, 100-101):

```ts
    const labourBySystem = new Map<string, SystemLabourSnapshot>();
```

```ts
      let snap = labourBySystem.get(sys.id);
      if (snap === undefined) {
        snap = computeSystemLabourSnapshot(buildings, sys.population);
        labourBySystem.set(sys.id, snap);
      }
```

```ts
      const production = buildingProduction(buildings, goodKey, snap.state, yields);
      const consumption = consumptionRate(goodKey, snap.basis);
```

`lib/tick/adapters/memory/economy.ts` — the identical three changes (imports; the `labourStateBySystem` map at line 52 becomes `labourBySystem: Map<string, SystemLabourSnapshot>`; lines 58-64 become the snapshot lookup + `buildingProduction(sys.buildings, m.goodId, snap.state, sys.yields)` + `consumptionRate(m.goodId, snap.basis)`).

- [ ] **Step 6: Run engine + adapter-adjacent tests**

Run: `npx vitest run --project unit lib/engine/__tests__/physical-economy.test.ts lib/engine/__tests__/industry.test.ts lib/engine/__tests__/tick.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/physical-economy.ts lib/engine/industry.ts lib/tick/adapters/prisma/economy.ts lib/tick/adapters/memory/economy.ts lib/engine/__tests__/physical-economy.test.ts lib/engine/__tests__/industry.test.ts
git commit -m "feat(economy): civilian demand basis — consumption from population + skilled work performed"
```

---

### Task 3: `capacityGoodRates` consumes the basis

**Files:**
- Modify: `lib/engine/industry.ts:391-403` (`capacityGoodRates`)
- Test: `lib/engine/__tests__/industry.test.ts`

**Interfaces:**
- Consumes: `computeSystemLabourSnapshot`, `consumptionRate` (Task 2). Signature of `capacityGoodRates` is UNCHANGED (it already receives buildings + population).

- [ ] **Step 1: Write the failing test** (add to the existing `capacityGoodRates` describe block, or a new one)

```ts
  it("a developed system consumes more basket goods than an academy-less one at equal population", () => {
    // electronics factories demand skilled heads; academies licence them.
    const developed = { electronics: 6, vocational_school: 3, research_institute: 2 };
    const frontier = {};
    const pop = 2000;
    const devRates = capacityGoodRates(developed, pop, unitResourceVector());
    const froRates = capacityGoodRates(frontier, pop, unitResourceVector());
    const get = (rates: SubstrateGoodRate[], id: string) => rates.find((r) => r.goodId === id)!;
    expect(get(devRates, "luxuries").consumption).toBeGreaterThan(get(froRates, "luxuries").consumption);
    expect(get(devRates, "consumer_goods").consumption).toBeGreaterThan(get(froRates, "consumer_goods").consumption);
    // non-basket goods stay population-only
    expect(get(devRates, "food").consumption).toBeCloseTo(get(froRates, "food").consumption, 10);
  });
```

(Adjust the `developed` building counts if the fixture yields zero technicians — pick counts where `computeLabourAllocation` produces technicians > 0 and engineers > 0; the existing S1 constants make `electronics` a skill-demanding good and the two academies licence skill-1/skill-2.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit lib/engine/__tests__/industry.test.ts`
Expected: the new test FAILS (consumptions equal — flat formula), existing tests PASS.

- [ ] **Step 3: Implement**

Replace `capacityGoodRates` (and update its doc comment's "consumption stays perCapitaNeed × population" line):

```ts
/**
 * Per-good production + consumption for one system from its industrial base.
 * The read-service shape (one `SubstrateGoodRate` per good), capacity-driven on
 * the production axis; consumption is the civilian demand basis (per-capita
 * baseline + per-grade skilled baskets — see consumptionRate).
 * Tier-0 production is multiplied by `yields[resource]`.
 */
export function capacityGoodRates(
  buildings: Record<string, number>,
  population: number,
  yields: ResourceVector,
): SubstrateGoodRate[] {
  const snap = computeSystemLabourSnapshot(buildings, population);
  return GOOD_NAMES.map((goodId) => ({
    goodId,
    production: buildingProduction(buildings, goodId, snap.state, yields),
    consumption: consumptionRate(goodId, snap.basis),
  }));
}
```

Add `consumptionRate` to the physical-economy import in industry.ts. If `GOOD_CONSUMPTION` is now only used at line ~681 (`POP_CENTRE_STORAGE` flag), keep that import.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit lib/engine/__tests__/industry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/industry.ts lib/engine/__tests__/industry.test.ts
git commit -m "feat(economy): capacityGoodRates consumption uses the civilian demand basis"
```

---

### Task 4: Thread the basis through pricing, population processor, seed paths, and the population panel

One compile unit — every signature change and every caller together.

**Files:**
- Modify: `lib/constants/market-economy.ts` (`demandRateForGood`, `totalDemandRateForGood`, `demandFootprint`, `getInitialStock`)
- Modify: `lib/tick/adapters/prisma/population.ts:93-116`
- Modify: `lib/tick/adapters/memory/population.ts:46-71`
- Modify: `lib/tick/world/population-world.ts:27` (comment only)
- Modify: `prisma/seed.ts:207-225`
- Modify: `lib/engine/simulator/world.ts:103-122`
- Modify: `lib/test-utils/fixtures.ts:305-312`
- Modify: `lib/services/system-population.ts`
- Test: `lib/constants/__tests__/market-economy.test.ts`, `lib/tick/processors/__tests__/population.test.ts`, `lib/engine/__tests__/economy-scale-invariance.test.ts`, `lib/services/__tests__/integration/market.integration.test.ts`

**Interfaces:**
- Consumes: `CivilianDemandBasis`, `consumptionRate` (Task 2), `computeSystemLabourSnapshot` (Task 2).
- Produces (final signatures):
  - `demandRateForGood(goodId: string, basis: CivilianDemandBasis): number`
  - `totalDemandRateForGood(goodId: string, basis: CivilianDemandBasis, buildings: Record<string, number>, yields: ResourceVector, labourState?: LabourState): number`
  - `demandFootprint(basis: CivilianDemandBasis): Array<{ goodId: string; demandRate: number }>`
  - `getInitialStock` signature UNCHANGED (derives the snapshot internally).

- [ ] **Step 1: Update the market-economy unit tests first (failing)**

In `lib/constants/__tests__/market-economy.test.ts`, add a local basis helper at the top of the file and mechanically wrap every `demandRateForGood(good, N)` / `totalDemandRateForGood(good, N, ...)` / `demandFootprint(N)` population argument:

```ts
import type { CivilianDemandBasis } from "@/lib/engine/physical-economy";

const popOnly = (population: number): CivilianDemandBasis => ({
  population,
  technicians: 0,
  engineers: 0,
});
```

e.g. `demandRateForGood("water", 1000)` → `demandRateForGood("water", popOnly(1000))`; `totalDemandRateForGood("ore", 1000, {}, unitResourceVector())` → `totalDemandRateForGood("ore", popOnly(1000), {}, unitResourceVector())`; `demandFootprint(10_000)` → `demandFootprint(popOnly(10_000))`; `demandFootprint(0)` → `demandFootprint(popOnly(0))`.

Then add new behaviour tests:

```ts
describe("demandRateForGood with skilled work", () => {
  it("skilled heads raise basket-good demand above the population-only rate", () => {
    const flat = demandRateForGood("luxuries", popOnly(1000));
    const skilled = demandRateForGood("luxuries", { population: 1000, technicians: 150, engineers: 40 });
    expect(skilled).toBeGreaterThan(flat);
  });

  it("non-basket goods are unchanged by skilled work", () => {
    const flat = demandRateForGood("food", popOnly(1000));
    const skilled = demandRateForGood("food", { population: 1000, technicians: 150, engineers: 40 });
    expect(skilled).toBeCloseTo(flat, 10);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit lib/constants/__tests__/market-economy.test.ts`
Expected: FAIL (type errors / arity).

- [ ] **Step 3: Implement `lib/constants/market-economy.ts`**

Imports: add `consumptionRate` + type `CivilianDemandBasis` from `@/lib/engine/physical-economy`; add `computeSystemLabourSnapshot` to the industry import; `GOOD_CONSUMPTION` stays (demandFootprint's filter). Then:

```ts
/**
 * Days-of-supply demand denominator for one good: max(civilian consumption,
 * MIN_DEMAND). Civilian-only (base per-capita + skilled baskets — see
 * consumptionRate); the population processor recomputes it as population and
 * the labour allocation move.
 */
export function demandRateForGood(goodId: string, basis: CivilianDemandBasis): number {
  return Math.max(consumptionRate(goodId, basis), MIN_DEMAND);
}
```

```ts
export function totalDemandRateForGood(
  goodId: string,
  basis: CivilianDemandBasis,
  buildings: Record<string, number>,
  yields: ResourceVector,
  labourState?: LabourState,
): number {
  const civilian = consumptionRate(goodId, basis);
  const state = labourState ?? computeLabourState(buildings, basis.population);
  const industrial = inputDemandForGood(buildings, goodId, state, yields);
  return Math.max(civilian + industrial, MIN_DEMAND);
}
```

(Keep the existing doc comment, updating "civilian (population)" → "civilian (demand basis)".)

```ts
export function demandFootprint(basis: CivilianDemandBasis): Array<{ goodId: string; demandRate: number }> {
  return Object.keys(GOOD_CONSUMPTION)
    .filter((goodId) => GOOD_CONSUMPTION[goodId] > 0)
    .map((goodId) => ({ goodId, demandRate: demandRateForGood(goodId, basis) }))
    .sort((a, b) => b.demandRate - a.demandRate);
}
```

(The base-need filter still covers basket goods — Task 1's subset test is the guard. Update the doc comment: "Pure, population-only" → "Pure — driven by the civilian demand basis".)

In `getInitialStock`, replace lines 119-123:

```ts
  const snap = computeSystemLabourSnapshot(buildings, population);
  const production = buildingProduction(buildings, goodId, snap.state, yields);
  const consumption = consumptionRate(goodId, snap.basis);

  const demandRate = demandRateForGood(goodId, snap.basis);
```

(`computeLabourState` import may now be unused except via `totalDemandRateForGood` — keep only what's used.)

- [ ] **Step 4: Update the two population adapters**

`lib/tick/adapters/prisma/population.ts` — swap the imports as in Task 2 (`computeSystemLabourSnapshot` + `SystemLabourSnapshot` instead of `computeLabourState` + `LabourState`), then replace lines 97 and 108-113:

```ts
    const labourBySystem = new Map<string, SystemLabourSnapshot>();
```

```ts
      let snap = labourBySystem.get(systemId);
      if (snap === undefined) {
        snap = computeSystemLabourSnapshot(buildings, population);
        labourBySystem.set(systemId, snap);
      }
      const rate = totalDemandRateForGood(goodKey, snap.basis, buildings, yields, snap.state);
```

`lib/tick/adapters/memory/population.ts` — identical change at lines 57 and 63-68.

Update the `population-world.ts:27` doc comment: `demandRateForGood(good, population)` → `the civilian demand basis (population + skilled work) plus industrial input draw`.

- [ ] **Step 5: Update the three seed-path callers**

Each computes the basis ONCE per system, outside the per-good loop.

`prisma/seed.ts` (add `computeSystemLabourSnapshot` to the industry imports; the `flatMap` at line 207):

```ts
  const marketData = universe.systems.flatMap((sys) => {
    const stationId = stationIdBySystemId.get(systemIds[sys.index]);
    if (!stationId) throw new Error(`Station missing for system "${sys.name}"`);
    const demandBasis = computeSystemLabourSnapshot(sys.buildings, sys.population).basis;
    return Object.entries(goodRecords).map(([goodKey, goodRec]) => {
      ...
        demandRate: demandRateForGood(goodKey, demandBasis),
      ...
    });
  });
```

`lib/engine/simulator/world.ts` (inside `for (const sys of systems)`, before the goods loop):

```ts
  for (const sys of systems) {
    const demandBasis = computeSystemLabourSnapshot(sys.buildings, sys.population).basis;
    for (const [goodKey, goodDef] of goodEntries) {
      ...
        demandRate: demandRateForGood(goodKey, demandBasis),
      ...
    }
  }
```

`lib/test-utils/fixtures.ts` (inside the `flatMap` callback):

```ts
  const marketData = stationSystems.flatMap(({ stationId, buildings, yieldMult, population }) => {
    const demandBasis = computeSystemLabourSnapshot(buildings, population).basis;
    return Object.keys(GOODS).map((key) => ({
      stationId,
      goodId: goodIds[key],
      stock: getInitialStock(buildings, yieldMult, population, key),
      demandRate: demandRateForGood(key, demandBasis),
    }));
  });
```

- [ ] **Step 6: Update `lib/services/system-population.ts`**

Fetch buildings alongside the dynamic fields (single relation — no `relationLoadStrategy` concern) and build the basis:

```ts
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
```

```ts
    prisma.starSystem.findUnique({
      where: { id: systemId },
      select: {
        population: true,
        popCap: true,
        unrest: true,
        buildings: { select: { buildingType: true, count: true } },
      },
    }),
```

```ts
  const buildings: Record<string, number> = {};
  for (const b of system.buildings) buildings[b.buildingType] = b.count;
  const basis = computeSystemLabourSnapshot(buildings, system.population).basis;

  // Full consumption footprint (already filtered to consumed goods, demand-sorted).
  const demand = demandFootprint(basis).map((e) => ({
```

(The population panel's footprint now includes discretionary demand — display flows through unchanged types.)

- [ ] **Step 7: Update the remaining tests**

- `lib/tick/processors/__tests__/population.test.ts` — lines 45, 67-68 use `food`/`ore` (non-basket goods): wrap the population argument with a local `popOnly()` helper as in Step 1. The memory adapter may now produce a basis with technicians > 0 for systems with academies — `food`/`ore` values are unaffected (non-basket), so assertions hold.
- `lib/engine/__tests__/economy-scale-invariance.test.ts` — lines 26-27: `market.demandRateForGood("food", pop)` → `market.demandRateForGood("food", { population: pop, technicians: 0, engineers: 0 })` (same for `ship_frames`). Add one basket-scale case mirroring the file's pattern: `consumptionRate`/`demandRateForGood` for `luxuries` with `engineers > 0` must scale with `ECONOMY_SCALE` like the others (the baskets go through `scaleRecord`).
- `lib/services/__tests__/integration/market.integration.test.ts` — line 88: `demandRateForGood("food", AGRI_POPULATION)` → pass `{ population: AGRI_POPULATION, technicians: 0, engineers: 0 }`. Food is non-basket, so the seeded value matches regardless of the agri system's actual allocation.

- [ ] **Step 8: Run the full unit project + typecheck**

Run: `npx vitest run --project unit`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/constants/market-economy.ts lib/tick/adapters/prisma/population.ts lib/tick/adapters/memory/population.ts lib/tick/world/population-world.ts prisma/seed.ts lib/engine/simulator/world.ts lib/test-utils/fixtures.ts lib/services/system-population.ts lib/constants/__tests__/market-economy.test.ts lib/tick/processors/__tests__/population.test.ts lib/engine/__tests__/economy-scale-invariance.test.ts lib/services/__tests__/integration/market.integration.test.ts
git commit -m "feat(economy): thread the civilian demand basis through pricing, seed, and the population panel"
```

---

### Task 5: Comment sweep, quality checklist, full verification

**Files:**
- Modify (comments only): `lib/tick/world/economy-world.ts:39`, `lib/tick/world/trade-flow-world.ts:44`, `lib/tick/world/snapshots-world.ts:35`, `lib/engine/market-tick-builder.ts:32`, `lib/engine/snapshot.ts:12`, `lib/engine/market-pricing.ts:152`, `lib/constants/physical-economy.ts:9` (header), `lib/constants/market-economy.ts:55-58` (if not already done in Task 4)

- [ ] **Step 1: Sweep stale formula comments**

Every doc comment reading "perCapitaNeed × population" describes the old civilian formula. Update each to "civilian demand (per-capita baseline + skilled baskets)" — keep the "floored at seed" / denominator wording intact. Verify with:

Run: `grep -rn "perCapitaNeed" lib/ --include=*.ts`
Expected: zero hits outside genuinely-still-true contexts (inspect each survivor).

- [ ] **Step 2: Quality checklist pass**

Per CLAUDE.md: typed keys (the two baskets are `Record<string, number>` matching `GOOD_CONSUMPTION`'s established shape — consistent, fine); no leftover dead imports (`computeLabourState`/`LabourState` in the four adapters and market-economy.ts — remove any now-unused); no duplication (all civilian demand routes through `consumptionRate`; all snapshot derivation through `computeSystemLabourSnapshot`); no `as`/`unknown`/`!` introduced.

- [ ] **Step 3: Full verification**

Run: `npx vitest run`
Expected: ALL projects pass (unit + integration; integration needs the dev Postgres up).
Run: `npm run build`
Expected: clean production build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(economy): align demand-formula comments with the civilian demand basis"
```

---

### Task 6: Simulation validation (structural, S2-style)

Per the spec's "Sim validation" section. Not TDD — an evidence-gathering session.

- [ ] **Step 1: Sanity** — `npm run simulate` (500 ticks, seed 42). Expected: completes, no NaN/runaway warnings, greedy ≫ random.
- [ ] **Step 2: A/B trajectory runs** — reuse the S2 experiment configs (`experiments/` YAMLs used for `s2-complexes-{4000,8000}`; 600 systems, seed 42, no overrides) on this branch at 4000 and 8000 ticks via `npm run simulate -- --config <file>`. The pre-S3 baseline = the saved S2 runs (`experiments/s2-complexes-{4000,8000}-*.json`).
- [ ] **Step 3: Evaluate against the spec's checks** —
  - mature (8000-tick) price spread p90 / expensive-fraction holds or widens vs S2's 1.79 / 39%;
  - discretionary goods (luxuries, consumer_goods, electronics, medicine) show price dispersion correlated with skilled-work concentration (dear at hubs or their neighbours, cheap at frontier);
  - the electronics×anchor interaction: does any system now clear `ANCHOR_MIN_THROUGHPUT` for electronics?
  - hub self-supply check: do hubs import their discretionary basket or build it locally?
  - coarse health bar (no NaN/runaway/pinning, dispersion, liquid).
- [ ] **Step 4: Record findings** — append an "S3 first-cut findings" section to `docs/planned/economy-specialisation.md` (mirroring the S2 findings section): what held, what's calibration input for S4. Do NOT tune constants in isolation.
- [ ] **Step 5: Commit** — `git add docs/planned/economy-specialisation.md && git commit -m "docs(economy): S3 first-cut sim findings"`

---

### Task 7: Ship checklist

- [ ] **Step 1:** User smoke (population panel demand footprint on a developed vs frontier system; Industry Labour card unchanged). Wait for go-ahead — do not launch review before it (feedback-smoke-before-review).
- [ ] **Step 2:** `/uber-review` on the branch (diff vs main).
- [ ] **Step 3:** Fix findings, re-verify (`npx vitest run`, `npm run build`).
- [ ] **Step 4:** PR to main (branch-protected; green `test-and-build` required). Squash-merge.
- [ ] **Step 5:** On merge: move the functional spec `docs/planned/economy-specialisation-s3-demand.md` → `docs/active/gameplay/economy-specialisation-s3-demand.md` (rewrite status header as as-built), update the umbrella stage table (S3 ✅) and `docs/SPEC.md`, **delete this build plan**, clean up branches.
