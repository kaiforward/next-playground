# Cohorted Harness Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the simulate report's supply readings by market role and world cohort, so a two-pop frontier rock and a developed homeworld stop being averaged into one number.

**Architecture:** Additive. A new `lib/tick-harness/cohort-analysis.ts` computes the cohorted metrics from the final world at report time; every existing galaxy-wide analyzer keeps its current definition and return shape so figures already measured against them stay quotable. Three existing aggregates gain a one-line annotation. No tick-loop changes, no new per-tick tracking, no gameplay change.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Spec: `docs/planned/cohorted-harness-metrics.md`.

## Global Constraints

- **No `as` type assertions** (except `as const`). No `unknown`. No `Record<string, ...>` where a union key exists.
- **Typed keys**: cohort/role maps use the `MarketRole` / `WorldCohort` unions, never `Record<string, number>`.
- **No `NaN`/`Infinity` in output** — every median/mean over a possibly-empty cohort must guard the divide.
- Engine purity is unaffected; `lib/tick-harness/` is a dev instrument and may import from `lib/engine`, `lib/tick`, `lib/world`.
- Avoid the postfix `!` non-null assertion; `find(...)!` in tests is the accepted exception.
- Comments describe the code, never the plan/phase/PR.
- Reuse `toGoodMarketStates` for role classification — do not re-derive production/demand a second way.

---

### Task 1: Shared stats helpers and an exported floor test

`median` and `quantile` are currently module-private in `market-analysis.ts`, and `nearBandFloor` (the "market is literally empty" test) is private too. The cohort module needs all three. Extract rather than duplicate — the second occurrence is the signal.

**Files:**
- Modify: `lib/utils/math.ts` (add `median`, `quantile`)
- Modify: `lib/tick-harness/market-analysis.ts` (import them; export `nearBandFloor`)
- Test: `lib/utils/__tests__/math.test.ts`

**Interfaces:**
- Produces: `median(xs: number[]): number`, `quantile(xs: number[], q: number): number` from `@/lib/utils/math`; `nearBandFloor(m: WorldMarket, band: { minStock: number; maxStock: number }): boolean` from `@/lib/tick-harness/market-analysis`.

- [ ] **Step 1: Write the failing test**

Append to `lib/utils/__tests__/math.test.ts` (create the file with the imports below if it does not exist):

```ts
import { describe, it, expect } from "vitest";
import { median, quantile } from "../math";

describe("median", () => {
  it("returns the middle value for an odd-length list", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns 0 for an empty list rather than NaN", () => {
    expect(median([])).toBe(0);
  });

  it("does not mutate its input", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("quantile", () => {
  it("returns the value at the requested quantile", () => {
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBe(2);
  });

  it("returns 0 for an empty list rather than NaN", () => {
    expect(quantile([], 0.5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/utils/__tests__/math.test.ts`
Expected: FAIL — `median` / `quantile` are not exported from `../math`.

- [ ] **Step 3: Move the helpers into `lib/utils/math.ts`**

Append to `lib/utils/math.ts` (bodies copied verbatim from `market-analysis.ts` so behaviour is unchanged):

```ts
/**
 * Middle value of `xs`, averaging the two middle entries for an even-length list.
 * Empty input is 0 rather than NaN — harness cohorts can legitimately be empty, and
 * NaN must never reach serialized output.
 */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Value at quantile `q` of `xs`. Empty input is 0, for the same reason as `median`. */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
```

- [ ] **Step 4: Delete the private copies and import instead**

In `lib/tick-harness/market-analysis.ts`, delete the `median` and `quantile` function declarations under the `// ── Distribution helpers ──` comment, and add to the imports:

```ts
import { median, quantile } from "@/lib/utils/math";
```

Then export the floor test by changing its declaration:

```ts
export function nearBandFloor(m: WorldMarket, band: { minStock: number; maxStock: number }): boolean {
```

- [ ] **Step 5: Run the full suite to verify nothing regressed**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, exit 0. The existing `market-analysis.test.ts` must still pass unchanged — this task moves code, it does not change behaviour.

- [ ] **Step 6: Commit**

```bash
git add lib/utils/math.ts lib/utils/__tests__/math.test.ts lib/tick-harness/market-analysis.ts
git commit -m "refactor(harness): share the median/quantile helpers and the floor test"
```

---

### Task 2: Market-role classifier

**Files:**
- Create: `lib/tick-harness/cohort-analysis.ts`
- Modify: `lib/tick-harness/types.ts` (declare the `MarketRole` union)
- Modify: `lib/world/tick.ts` (export the existing `marketRowsBySystem`)
- Test: `lib/tick-harness/__tests__/cohort-analysis.test.ts`

**Interfaces:**
- Consumes: `toGoodMarketStates` from `@/lib/tick/processors/good-market-state`; `MIN_DEMAND` from `@/lib/constants/market-economy`.
- Produces: `type MarketRole = "exporter" | "self-supplier" | "consumer" | "inert"` (in `types.ts`); `classifyMarketRole(state: GoodMarketState, demandRate: number): MarketRole` (in `cohort-analysis.ts`).

**Both cohort unions live in `types.ts`, not in `cohort-analysis.ts`.** `types.ts` holds the result shapes that reference them, and `cohort-analysis.ts` consumes those shapes — declaring the unions in the analysis module would make the two files import each other. Type-only cycles happen to compile, but one direction is the honest structure.

**Why the signature takes `demandRate` separately:** `GoodMarketState.demand` is the unfloored logistics demand and decides exporter status; `WorldMarket.demandRate` is the `MIN_DEMAND`-floored *pricing anchor* and is the only thing that identifies an inert market. Passing both forces the distinction at the call site instead of letting one silently stand in for the other.

- [ ] **Step 1: Write the failing test**

Create `lib/tick-harness/__tests__/cohort-analysis.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyMarketRole } from "../cohort-analysis";
import { MIN_DEMAND } from "@/lib/constants/market-economy";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";

function state(over: Partial<GoodMarketState> = {}): GoodMarketState {
  return {
    goodId: "water",
    stock: 100,
    targetStock: 100,
    demand: 10,
    civilianDemand: 10,
    production: 0,
    capacityProduction: 0,
    ...over,
  };
}

describe("classifyMarketRole", () => {
  it("calls a market an exporter when production exceeds demand", () => {
    expect(classifyMarketRole(state({ production: 20, demand: 10 }), 10)).toBe("exporter");
  });

  it("does not call a suppressed producer an exporter", () => {
    // Strike or maintenance cut output — surplusDrawable excludes it, so this must too.
    expect(
      classifyMarketRole(state({ production: 20, demand: 10, productionSuppressed: true }), 10),
    ).toBe("self-supplier");
  });

  it("calls a producer that cannot cover its own demand a self-supplier", () => {
    expect(classifyMarketRole(state({ production: 5, demand: 10 }), 10)).toBe("self-supplier");
  });

  it("calls a non-producer with real demand a consumer", () => {
    expect(classifyMarketRole(state({ production: 0, demand: 10 }), 10)).toBe("consumer");
  });

  it("calls a market with neither production nor real demand inert", () => {
    // demandRate sitting exactly on the MIN_DEMAND floor is the pricing guard, not demand.
    expect(classifyMarketRole(state({ production: 0, demand: 0 }), MIN_DEMAND)).toBe("inert");
  });

  it("calls a producer whose local demand is floored an exporter, not inert", () => {
    // A mining world producing ore nobody there consumes: floored demandRate AND real
    // production. Precedence must resolve this to exporter — it genuinely ships the good.
    expect(classifyMarketRole(state({ production: 20, demand: 0 }), MIN_DEMAND)).toBe("exporter");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tick-harness/__tests__/cohort-analysis.test.ts`
Expected: FAIL — cannot resolve `../cohort-analysis`.

- [ ] **Step 3: Declare the union in `types.ts`**

Add to `lib/tick-harness/types.ts`:

```ts
/** Which role a market (system × good) plays for that good. Mutually exclusive. */
export type MarketRole = "exporter" | "self-supplier" | "consumer" | "inert";
```

- [ ] **Step 4: Write the classifier**

Create `lib/tick-harness/cohort-analysis.ts`:

```ts
/**
 * Cohorted harness metrics — the report's supply readings split by which role a market
 * plays for a good, and what kind of world a system is.
 *
 * Every galaxy-wide analyzer beside this one keeps its own definition; this module is
 * additive, so a figure measured against the aggregate stays comparable.
 */

import { MIN_DEMAND } from "@/lib/constants/market-economy";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { MarketRole } from "./types";

/**
 * A market's role, tested in a fixed order because one market can satisfy several
 * descriptions. `state.demand` is the unfloored logistics demand and decides exporter
 * status; `demandRate` is the MIN_DEMAND-floored pricing anchor and is the only thing
 * that can identify an inert market. They are different numbers and answer different
 * questions — MIN_DEMAND's own docstring calls it a floor on the cycles-of-supply
 * denominator "so a near-empty system yields a finite cover instead of a divide-by-zero",
 * i.e. a pricing guard, not demand.
 *
 * Precedence matters at one junction: a mining world producing ore nobody there consumes
 * has a floored demandRate and real production. It is an exporter — it genuinely ships the
 * good — so the production tests run first and `inert` means "neither produces nor really
 * demands", a market that is pure pricing-floor artifact.
 */
export function classifyMarketRole(state: GoodMarketState, demandRate: number): MarketRole {
  const production = state.production ?? 0;
  // Mirrors surplusDrawable's own exporter branch, so a market this calls an exporter is
  // exactly one directed logistics would draw from.
  if (production > state.demand && !state.productionSuppressed) return "exporter";
  if (production > 0) return "self-supplier";
  // The floor is assigned from the same constant, not computed, so a floored row lands on
  // it exactly; the epsilon only guards against accumulated float drift in the industrial term.
  if (demandRate > MIN_DEMAND * (1 + 1e-9)) return "consumer";
  return "inert";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/tick-harness/__tests__/cohort-analysis.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Export the shared row builder**

The cohort metrics need `WorldMarket` rows in the shape `toGoodMarketStates` consumes. `lib/world/tick.ts` already has exactly that mapping. Export it rather than writing a third copy — change its declaration:

```ts
export function marketRowsBySystem(markets: WorldMarket[]): Map<string, MarketRowForLogistics[]> {
```

- [ ] **Step 7: Commit**

```bash
git add lib/tick-harness/cohort-analysis.ts lib/tick-harness/types.ts lib/tick-harness/__tests__/cohort-analysis.test.ts lib/world/tick.ts
git commit -m "feat(harness): classify each market by the role it plays for its good"
```

---

### Task 3: Per-good cover and price by role

**Files:**
- Modify: `lib/tick-harness/cohort-analysis.ts`
- Modify: `lib/tick-harness/types.ts`
- Test: `lib/tick-harness/__tests__/cohort-analysis.test.ts`

**Interfaces:**
- Consumes: `classifyMarketRole` (Task 2); `median` from `@/lib/utils/math` and `nearBandFloor` from `@/lib/tick-harness/market-analysis` (Task 1); `marketRowsBySystem` from `@/lib/world/tick` (Task 2).
- Produces: `RoleCoverEntry` (in `types.ts`) and `computeRoleCoverLevels(systems: TickSystem[], markets: WorldMarket[]): RoleCoverEntry[]`.

- [ ] **Step 1: Add the result type**

In `lib/tick-harness/types.ts`, add below `CoverLevelEntry`:

```ts
/** Roles that hold stock — `inert` is excluded: a median cover over pricing-artifact markets means nothing. */
export type StockedRole = Exclude<MarketRole, "inert">;

/** One good's cover and price, split by the role each of its markets plays. */
export interface RoleCoverEntry {
  goodId: string;
  /** Market count in each role, including inert. */
  countByRole: Record<MarketRole, number>;
  /** Median stock / targetStock per role. 0 for a role with no markets. */
  medianCoverByRole: Record<StockedRole, number>;
  /** Share of consumer markets sitting at the stock floor — literally empty, not merely low. */
  consumerEmptyFrac: number;
  /** Median price / basePrice across exporter markets — the resting-price read. */
  exporterMedianPriceRatio: number;
}
```

`MarketRole` is already declared in this file by Task 2 — no import is needed.

- [ ] **Step 2: Write the failing test**

Append to `lib/tick-harness/__tests__/cohort-analysis.test.ts`:

```ts
import { computeRoleCoverLevels } from "../cohort-analysis";
import type { WorldMarket } from "@/lib/world/types";
import type { TickSystem } from "@/lib/tick/rows";

function sys(id: string, over: Partial<TickSystem> = {}): TickSystem {
  return {
    id, name: id, economyType: "agricultural", regionId: "r1", factionId: "f1",
    control: "developed", governmentType: "republic", population: 100, popCap: 200,
    unrest: 0, buildings: {}, buildingIdleCycles: {}, collapseDebt: 0,
    yields: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    slotCap: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    generalSpace: 100, habitableSpace: 50,
    ...over,
  };
}

function mkt(systemId: string, goodId: string, stock: number, demandRate: number): WorldMarket {
  return { systemId, goodId, stock, anchorMult: 1, demandRate, storageCapacity: 0 };
}

describe("computeRoleCoverLevels", () => {
  it("reports one entry per good with every market counted into exactly one role", () => {
    // No buildings anywhere ⇒ zero production ⇒ every market is consumer or inert,
    // separated purely by whether its demandRate cleared the MIN_DEMAND floor.
    const systems = [sys("s1"), sys("s2")];
    const markets = [
      mkt("s1", "water", 50, 10),
      mkt("s2", "water", 0, MIN_DEMAND),
    ];

    const [entry] = computeRoleCoverLevels(systems, markets);

    expect(entry.goodId).toBe("water");
    expect(entry.countByRole.consumer).toBe(1);
    expect(entry.countByRole.inert).toBe(1);
    expect(entry.countByRole.exporter).toBe(0);
    expect(entry.countByRole["self-supplier"]).toBe(0);
  });

  it("reports 0 rather than NaN for a role with no markets", () => {
    const [entry] = computeRoleCoverLevels([sys("s1")], [mkt("s1", "water", 50, 10)]);

    expect(entry.medianCoverByRole.exporter).toBe(0);
    expect(Number.isNaN(entry.medianCoverByRole.exporter)).toBe(false);
    expect(entry.exporterMedianPriceRatio).toBe(0);
  });

  it("counts an empty consumer market in consumerEmptyFrac", () => {
    const systems = [sys("s1"), sys("s2")];
    const markets = [
      mkt("s1", "water", 0, 10),   // empty
      mkt("s2", "water", 500, 10), // stocked
    ];

    const [entry] = computeRoleCoverLevels(systems, markets);

    expect(entry.countByRole.consumer).toBe(2);
    expect(entry.consumerEmptyFrac).toBe(0.5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/tick-harness/__tests__/cohort-analysis.test.ts`
Expected: FAIL — `computeRoleCoverLevels` is not exported.

- [ ] **Step 4: Implement**

Append to `lib/tick-harness/cohort-analysis.ts`:

```ts
import { GOODS } from "@/lib/constants/goods";
import { curveForRow, marketBandForRow, midPriceAt } from "@/lib/engine/market-pricing";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketRowsBySystem } from "@/lib/world/tick";
import { median } from "@/lib/utils/math";
import { nearBandFloor } from "./market-analysis";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import type { RoleCoverEntry, StockedRole } from "./types";

const STOCKED_ROLES: StockedRole[] = ["exporter", "self-supplier", "consumer"];

/** Every market's role, keyed `systemId|goodId`. One pass over the galaxy. */
export function marketRolesByKey(
  systems: TickSystem[],
  markets: WorldMarket[],
): Map<string, MarketRole> {
  const rowsBySystem = marketRowsBySystem(markets);
  const demandRateByKey = new Map(markets.map((m) => [`${m.systemId}|${m.goodId}`, m.demandRate]));
  const roles = new Map<string, MarketRole>();

  for (const s of systems) {
    const rows = rowsBySystem.get(s.id);
    if (!rows) continue;
    const states = toGoodMarketStates({
      buildings: s.buildings, population: s.population, yields: s.yields, markets: rows,
    });
    for (const state of states) {
      const key = `${s.id}|${state.goodId}`;
      roles.set(key, classifyMarketRole(state, demandRateByKey.get(key) ?? 0));
    }
  }
  return roles;
}

/**
 * Per good, cover and price split by market role. This is what separates "every producer is
 * drained flat" from "consumers are never served" — a distinction the galaxy-wide median
 * cannot make, because it medians both populations together.
 */
export function computeRoleCoverLevels(
  systems: TickSystem[],
  markets: WorldMarket[],
): RoleCoverEntry[] {
  const roles = marketRolesByKey(systems, markets);

  const counts = new Map<string, Record<MarketRole, number>>();
  const covers = new Map<string, Record<StockedRole, number[]>>();
  const consumerEmpty = new Map<string, number>();
  const exporterPrices = new Map<string, number[]>();

  for (const m of markets) {
    const good = GOODS[m.goodId];
    if (!good) continue;
    const role = roles.get(`${m.systemId}|${m.goodId}`);
    if (!role) continue;

    let count = counts.get(m.goodId);
    if (!count) {
      count = { exporter: 0, "self-supplier": 0, consumer: 0, inert: 0 };
      counts.set(m.goodId, count);
      covers.set(m.goodId, { exporter: [], "self-supplier": [], consumer: [] });
      consumerEmpty.set(m.goodId, 0);
      exporterPrices.set(m.goodId, []);
    }
    count[role] += 1;

    if (role === "inert") continue;

    const curve = curveForRow(m, good);
    if (curve.targetStock > 0) covers.get(m.goodId)?.[role].push(m.stock / curve.targetStock);

    if (role === "consumer" && nearBandFloor(m, marketBandForRow(m, good))) {
      consumerEmpty.set(m.goodId, (consumerEmpty.get(m.goodId) ?? 0) + 1);
    }
    if (role === "exporter") {
      exporterPrices.get(m.goodId)?.push(midPriceAt(curve, m.stock) / good.basePrice);
    }
  }

  const result: RoleCoverEntry[] = [];
  for (const [goodId, countByRole] of counts) {
    const coverLists = covers.get(goodId);
    const medianCoverByRole: Record<StockedRole, number> = {
      exporter: 0, "self-supplier": 0, consumer: 0,
    };
    for (const role of STOCKED_ROLES) medianCoverByRole[role] = median(coverLists?.[role] ?? []);

    const consumers = countByRole.consumer;
    result.push({
      goodId,
      countByRole,
      medianCoverByRole,
      // Guarded: a good with no consumer markets reports 0, never NaN.
      consumerEmptyFrac: consumers > 0 ? (consumerEmpty.get(goodId) ?? 0) / consumers : 0,
      exporterMedianPriceRatio: median(exporterPrices.get(goodId) ?? []),
    });
  }
  return result.sort((a, b) => a.goodId.localeCompare(b.goodId));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/tick-harness/__tests__/cohort-analysis.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/tick-harness/cohort-analysis.ts lib/tick-harness/types.ts lib/tick-harness/__tests__/cohort-analysis.test.ts
git commit -m "feat(harness): split each good's cover and price by market role"
```

---

### Task 4: Per-system supply state, shared with the galaxy-wide summary

`summarizeSupplyRegimes` already computes each system's dissatisfaction and regime, then immediately folds them into galaxy totals. The cohort table needs the per-system values. Expose them and have the existing summary fold the same map — one definition, so the cohorted and galaxy-wide regime splits cannot drift.

**Files:**
- Modify: `lib/tick-harness/population-analysis.ts`
- Test: `lib/tick-harness/__tests__/population-analysis.test.ts`

**Interfaces:**
- Produces: `interface SystemSupplyState { d: number; regime: SupplyRegime }` and `perSystemSupplyState(systems: TickSystem[], markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>, events?: ReadonlyArray<WorldEvent>): Map<string, SystemSupplyState>`, both from `@/lib/tick-harness/population-analysis`.

- [ ] **Step 1: Write the failing test**

Append to `lib/tick-harness/__tests__/population-analysis.test.ts` (reuse the file's existing system/market builders; if it has none, use the `sys`/`mkt` helpers from Task 3):

```ts
import { perSystemSupplyState, summarizeSupplyRegimes } from "../population-analysis";

describe("perSystemSupplyState", () => {
  it("returns one entry per settled system", () => {
    const systems = [sys("s1"), sys("s2")];
    const markets = [
      { systemId: "s1", goodId: "water", satisfaction: 1 },
      { systemId: "s2", goodId: "water", satisfaction: 0 },
    ];

    const states = perSystemSupplyState(systems, markets);

    expect(states.size).toBe(2);
    expect(states.get("s1")?.d).toBeLessThan(states.get("s2")?.d ?? 0);
  });

  it("agrees with the galaxy-wide summary it feeds", () => {
    const systems = [sys("s1"), sys("s2")];
    const markets = [
      { systemId: "s1", goodId: "water", satisfaction: 1 },
      { systemId: "s2", goodId: "water", satisfaction: 0 },
    ];

    const states = perSystemSupplyState(systems, markets);
    const summary = summarizeSupplyRegimes(systems, markets);

    const meanD = [...states.values()].reduce((a, s) => a + s.d, 0) / states.size;
    expect(meanD).toBeCloseTo(summary.meanDissatisfaction, 10);
    expect(states.size).toBe(summary.counted);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tick-harness/__tests__/population-analysis.test.ts`
Expected: FAIL — `perSystemSupplyState` is not exported.

- [ ] **Step 3: Extract the per-system pass**

In `lib/tick-harness/population-analysis.ts`, add the type and function above `summarizeSupplyRegimes`, and add `SupplyRegime` to the existing `@/lib/engine/population` import:

```ts
/** One settled system's supply reading — the magnitude and the label it folds to. */
export interface SystemSupplyState {
  d: number;
  regime: SupplyRegime;
}

/**
 * Per-system dissatisfaction and regime at the end of the run, keyed by system id. The
 * galaxy-wide summary folds this same map, so a cohorted regime split and the galaxy-wide
 * one cannot drift apart. Settled systems only: an unclaimed rock has no market and no opinion.
 */
export function perSystemSupplyState(
  systems: TickSystem[],
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  events: ReadonlyArray<WorldEvent> = [],
): Map<string, SystemSupplyState> {
  const settledSystems = systems.filter(isSettled);
  const settled = new Map(settledSystems.map((s) => [s.id, s]));
  const modsBySystem = consumptionMultBySystem(settledSystems, events);
  const goodsBySystem = goodSatisfactionsBySystem(settled, markets, (systemId, goodId) => {
    const mods = modsBySystem?.get(systemId);
    return mods ? aggregateModifiers(mods, goodId, MODIFIER_CAPS).consumptionMult : 1;
  });

  const states = new Map<string, SystemSupplyState>();
  for (const systemId of settled.keys()) {
    const goods = goodsBySystem.get(systemId) ?? [];
    const d = dissatisfaction(goods);
    states.set(systemId, { d, regime: foldSupplyState(goods, d).regime });
  }
  return states;
}
```

- [ ] **Step 4: Rewrite `summarizeSupplyRegimes` to fold it**

Replace the body of `summarizeSupplyRegimes` with:

```ts
export function summarizeSupplyRegimes(
  systems: TickSystem[],
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  events: ReadonlyArray<WorldEvent> = [],
): SupplyRegimeSummary {
  const states = perSystemSupplyState(systems, markets, events);

  let supplied = 0, rationing = 0, shortage = 0, dSum = 0;
  for (const { d, regime } of states.values()) {
    dSum += d;
    if (regime === "supplied") supplied++;
    else if (regime === "rationing") rationing++;
    else shortage++;
  }
  const counted = states.size;
  const share = (n: number) => (counted > 0 ? n / counted : 0);
  return {
    counted, supplied, rationing, shortage,
    suppliedShare: share(supplied),
    rationingShare: share(rationing),
    shortageShare: share(shortage),
    meanDissatisfaction: counted > 0 ? dSum / counted : 0,
  };
}
```

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, exit 0. Every pre-existing `summarizeSupplyRegimes` test must pass unchanged — this is a pure extraction.

- [ ] **Step 6: Commit**

```bash
git add lib/tick-harness/population-analysis.ts lib/tick-harness/__tests__/population-analysis.test.ts
git commit -m "refactor(harness): expose the per-system supply state the summary folds"
```

---

### Task 5: World cohorts

**Files:**
- Modify: `lib/tick-harness/cohort-analysis.ts`, `lib/tick-harness/types.ts`
- Test: `lib/tick-harness/__tests__/cohort-analysis.test.ts`

**Interfaces:**
- Consumes: `perSystemSupplyState` (Task 4).
- Produces: `type WorldCohort`, `cohortsForSystem(s: TickSystem, homeworldIds: Set<string>): WorldCohort[]`, `WorldCohortEntry` (in `types.ts`), and `computeWorldCohorts(systems, markets, homeworldIds, strikeThreshold, events): WorldCohortEntry[]`.

**A system belongs to several cohorts at once.** The three groupings are independent views, not one partition: every settled system lands in exactly one population band and exactly one of homeworld/colony, and additionally in `survival-short` if it cannot feed itself. The table's rows therefore overlap by design, and each row's `n` is its own denominator.

- [ ] **Step 1: Add the union and the result type**

In `lib/tick-harness/types.ts`, add:

```ts
/**
 * A settled system's cohorts. The three groupings are independent views, not one
 * partition: a system lands in exactly one population band and exactly one of
 * homeworld/colony, plus `survival-short` if it cannot feed itself. Rows therefore
 * overlap by design and each carries its own denominator.
 */
export type WorldCohort =
  | "pop <10" | "pop 10-100" | "pop 100-1K" | "pop >=1K"
  | "survival-short" | "homeworld" | "colony";

/** One cohort's supply and unrest reading. Cohorts overlap — see cohortsForSystem. */
export interface WorldCohortEntry {
  cohort: WorldCohort;
  /** Settled systems in this cohort — this row's own denominator. */
  n: number;
  meanDissatisfaction: number;
  meanUnrest: number;
  strikingShare: number;
  suppliedShare: number;
  rationingShare: number;
  shortageShare: number;
}
```

Both unions now live in `types.ts`, so no import is needed here.

- [ ] **Step 2: Write the failing test**

Append to `lib/tick-harness/__tests__/cohort-analysis.test.ts`:

```ts
import { cohortsForSystem, computeWorldCohorts } from "../cohort-analysis";

describe("cohortsForSystem", () => {
  it("places a system in exactly one population band", () => {
    const bands = cohortsForSystem(sys("s1", { population: 50 }), new Set());
    expect(bands).toContain("pop 10-100");
    expect(bands).not.toContain("pop <10");
    expect(bands).not.toContain("pop 100-1K");
  });

  it("labels a homeworld a homeworld and everything else a colony", () => {
    expect(cohortsForSystem(sys("s1"), new Set(["s1"]))).toContain("homeworld");
    expect(cohortsForSystem(sys("s2"), new Set(["s1"]))).toContain("colony");
  });

  it("adds survival-short for a world with no arable slot, alongside its other cohorts", () => {
    const rock = sys("s1", {
      population: 5,
      slotCap: { gas: 0, minerals: 0, ore: 3, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    });
    const cohorts = cohortsForSystem(rock, new Set());

    expect(cohorts).toContain("survival-short");
    expect(cohorts).toContain("pop <10");
    expect(cohorts).toContain("colony");
  });

  it("does not call a world with an arable slot survival-short", () => {
    const farm = sys("s1", {
      slotCap: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 2, water: 0, radioactive: 0 },
    });
    expect(cohortsForSystem(farm, new Set())).not.toContain("survival-short");
  });
});

describe("computeWorldCohorts", () => {
  it("omits a cohort with no members rather than emitting a NaN row", () => {
    const entries = computeWorldCohorts([sys("s1", { population: 50 })], [], new Set(), 0.8, []);

    expect(entries.some((e) => e.cohort === "pop 10-100")).toBe(true);
    expect(entries.some((e) => e.cohort === "pop >=1K")).toBe(false);
    for (const e of entries) {
      expect(Number.isNaN(e.meanDissatisfaction)).toBe(false);
      expect(Number.isNaN(e.meanUnrest)).toBe(false);
    }
  });

  it("counts a striking system into its cohort's striking share", () => {
    const systems = [sys("s1", { population: 50, unrest: 0.9 }), sys("s2", { population: 50, unrest: 0 })];
    const entries = computeWorldCohorts(systems, [], new Set(), 0.8, []);
    const band = entries.find((e) => e.cohort === "pop 10-100");

    expect(band?.n).toBe(2);
    expect(band?.strikingShare).toBe(0.5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/tick-harness/__tests__/cohort-analysis.test.ts`
Expected: FAIL — `cohortsForSystem` is not exported.

- [ ] **Step 4: Implement**

Append to `lib/tick-harness/cohort-analysis.ts`:

```ts
import { perSystemSupplyState } from "./population-analysis";
import type { WorldEvent } from "@/lib/world/types";
import type { WorldCohort, WorldCohortEntry } from "./types";

/**
 * Population band edges. Chosen to straddle where the galaxy-wide means were misread — a
 * two-pop frontier rock against a developed homeworld — rather than for round numbers.
 */
const POP_BANDS: { cohort: WorldCohort; below: number }[] = [
  { cohort: "pop <10", below: 10 },
  { cohort: "pop 10-100", below: 100 },
  { cohort: "pop 100-1K", below: 1000 },
  { cohort: "pop >=1K", below: Infinity },
];

/** Order the report renders cohorts in — bands ascending, then the cross-cutting views. */
const COHORT_ORDER: WorldCohort[] = [
  "pop <10", "pop 10-100", "pop 100-1K", "pop >=1K",
  "survival-short", "homeworld", "colony",
];

export function cohortsForSystem(s: TickSystem, homeworldIds: Set<string>): WorldCohort[] {
  const band = POP_BANDS.find((b) => s.population < b.below)?.cohort ?? "pop >=1K";
  const cohorts: WorldCohort[] = [band, homeworldIds.has(s.id) ? "homeworld" : "colony"];
  // No arable slot means the world cannot feed itself at any level of development — the
  // physical limit that separates a deprived rock from a world the economy is failing.
  if (s.slotCap.arable <= 0) cohorts.push("survival-short");
  return cohorts;
}

/**
 * Supply and unrest per world cohort. This is what the galaxy-wide mean cannot answer:
 * whether the unrest band grades anything, or whether its boundaries are being crossed by
 * noise in a population that was never comparable in the first place.
 */
export function computeWorldCohorts(
  systems: TickSystem[],
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
  homeworldIds: Set<string>,
  strikeThreshold: number,
  events: ReadonlyArray<WorldEvent> = [],
): WorldCohortEntry[] {
  const states = perSystemSupplyState(systems, markets, events);

  const acc = new Map<WorldCohort, {
    n: number; dSum: number; unrestSum: number; striking: number;
    supplied: number; rationing: number; shortage: number;
  }>();

  for (const s of systems) {
    const state = states.get(s.id);
    if (!state) continue; // unsettled — perSystemSupplyState already filtered it out

    for (const cohort of cohortsForSystem(s, homeworldIds)) {
      let a = acc.get(cohort);
      if (!a) {
        a = { n: 0, dSum: 0, unrestSum: 0, striking: 0, supplied: 0, rationing: 0, shortage: 0 };
        acc.set(cohort, a);
      }
      a.n += 1;
      a.dSum += state.d;
      a.unrestSum += s.unrest;
      if (s.unrest >= strikeThreshold) a.striking += 1;
      if (state.regime === "supplied") a.supplied += 1;
      else if (state.regime === "rationing") a.rationing += 1;
      else a.shortage += 1;
    }
  }

  const result: WorldCohortEntry[] = [];
  for (const cohort of COHORT_ORDER) {
    const a = acc.get(cohort);
    // A cohort with no members is omitted entirely rather than emitting a divide-by-zero row.
    if (!a || a.n === 0) continue;
    result.push({
      cohort,
      n: a.n,
      meanDissatisfaction: a.dSum / a.n,
      meanUnrest: a.unrestSum / a.n,
      strikingShare: a.striking / a.n,
      suppliedShare: a.supplied / a.n,
      rationingShare: a.rationing / a.n,
      shortageShare: a.shortage / a.n,
    });
  }
  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/tick-harness/__tests__/cohort-analysis.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/tick-harness/cohort-analysis.ts lib/tick-harness/types.ts lib/tick-harness/__tests__/cohort-analysis.test.ts
git commit -m "feat(harness): read supply and unrest per world cohort"
```

---

### Task 6: Wire the cohorts into the harness result

**Files:**
- Modify: `lib/tick-harness/types.ts` (add two fields to `HarnessResults`)
- Modify: `lib/tick-harness/runner.ts`
- Modify: `lib/tick-harness/__tests__/experiment.test.ts` (its `HarnessResults` fixture needs the new fields)

**Interfaces:**
- Consumes: `computeRoleCoverLevels` (Task 3), `computeWorldCohorts` (Task 5).
- Produces: `HarnessResults.roleCoverLevels: RoleCoverEntry[]` and `HarnessResults.worldCohorts: WorldCohortEntry[]`.

- [ ] **Step 1: Add the fields to `HarnessResults`**

In `lib/tick-harness/types.ts`, add beside `marketHealth`:

```ts
  /** Per-good cover and price split by market role. */
  roleCoverLevels: RoleCoverEntry[];
  /** Supply and unrest per world cohort. Cohorts overlap; each row carries its own denominator. */
  worldCohorts: WorldCohortEntry[];
```

- [ ] **Step 2: Compute them in the runner**

In `lib/tick-harness/runner.ts`, add the imports:

```ts
import { computeRoleCoverLevels, computeWorldCohorts } from "./cohort-analysis";
import { STRIKE_PARAMS } from "@/lib/constants/population";
```

Then immediately after the existing `const marketHealth = computeMarketHealth(currentMarkets);`:

```ts
  // Cohorted reads, from the final world only — no per-tick tracking. Reuses the tick rows
  // the report already builds rather than walking the world a second time.
  const finalTickSystems = toTickSystems(world);
  const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
  const roleCoverLevels = computeRoleCoverLevels(finalTickSystems, currentMarkets);
  const worldCohorts = computeWorldCohorts(
    finalTickSystems, currentMarkets, homeworldIds, STRIKE_PARAMS.threshold, world.events,
  );
```

and add both to the returned object beside `marketHealth`:

```ts
    roleCoverLevels,
    worldCohorts,
```

`toTickSystems` is already imported in `runner.ts` (`import { runWorldTick, toTickSystems } from "@/lib/world/tick";`) — do not add a second import. `STRIKE_PARAMS.threshold` is `0.65` and is exactly what `scripts/simulate.ts` already passes to `summarizePopulation`, so the two readings of "striking" agree.

- [ ] **Step 3: Update the experiment fixture**

`lib/tick-harness/__tests__/experiment.test.ts` builds a literal `HarnessResults`. Add to it:

```ts
        roleCoverLevels: [],
        worldCohorts: [],
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, exit 0. A missing-field type error in any other `HarnessResults` literal must be fixed the same way — add the two empty arrays.

- [ ] **Step 5: Commit**

```bash
git add lib/tick-harness/types.ts lib/tick-harness/runner.ts lib/tick-harness/__tests__/experiment.test.ts
git commit -m "feat(harness): return the cohorted reads from the runner"
```

---

### Task 7: Render the two sections and annotate the three aggregates

**Files:**
- Modify: `scripts/simulate.ts`

**Interfaces:**
- Consumes: `HarnessResults.roleCoverLevels`, `HarnessResults.worldCohorts` (Task 6).

- [ ] **Step 1: Destructure the new fields**

In `formatTable`, add `roleCoverLevels` and `worldCohorts` to the existing destructuring on the first line of the function.

- [ ] **Step 2: Render cover and price by market role**

Insert immediately after the existing Market Health section (after its trailing `lines.push("")`):

```ts
  // Cover by market role — separates "producers drained flat" from "consumers never served",
  // which the galaxy-wide median cannot distinguish because it medians both together.
  if (roleCoverLevels.length > 0) {
    lines.push("Cover & price by market role (end of simulation):");

    const rHeaders = ["Good", "Exp n/med", "Self n/med", "Cons n/med", "Cons empty%", "Inert n", "Exp price x"];
    const rWidths = [16, 11, 11, 11, 12, 8, 12];

    lines.push(rHeaders.map((h, i) => (i === 0 ? pad(h, rWidths[i]) : rpad(h, rWidths[i]))).join(" | "));
    lines.push(rWidths.map((w) => "-".repeat(w)).join("-+-"));

    const cell = (n: number, med: number): string => (n === 0 ? "-" : `${n}/${med.toFixed(2)}`);

    for (const e of roleCoverLevels) {
      lines.push([
        pad(e.goodId, rWidths[0]),
        rpad(cell(e.countByRole.exporter, e.medianCoverByRole.exporter), rWidths[1]),
        rpad(cell(e.countByRole["self-supplier"], e.medianCoverByRole["self-supplier"]), rWidths[2]),
        rpad(cell(e.countByRole.consumer, e.medianCoverByRole.consumer), rWidths[3]),
        rpad(e.countByRole.consumer > 0 ? `${(e.consumerEmptyFrac * 100).toFixed(0)}%` : "-", rWidths[4]),
        rpad(String(e.countByRole.inert), rWidths[5]),
        rpad(e.countByRole.exporter > 0 ? e.exporterMedianPriceRatio.toFixed(2) : "-", rWidths[6]),
      ].join(" | "));
    }

    lines.push("  inert = no production and no real demand; the row exists only because MIN_DEMAND");
    lines.push("  floored its denominator. A pricing guard, not a deficit signal.");
    lines.push("");
  }
```

- [ ] **Step 3: Render supply and unrest by world cohort**

Insert immediately after the existing "Supply regimes" section (after its trailing `lines.push("")`):

```ts
  // Cohorts overlap by design: a system is in one population band, one of homeworld/colony,
  // and additionally survival-short if it cannot feed itself. Each row's n is its own denominator.
  if (worldCohorts.length > 0) {
    lines.push("Supply & unrest by world cohort (end of simulation):");

    const wHeaders = ["Cohort", "n", "mean D", "unrest", "strike%", "Sup/Rat/Sho %"];
    const wWidths = [16, 6, 8, 8, 9, 20];

    lines.push(wHeaders.map((h, i) => (i === 0 ? pad(h, wWidths[i]) : rpad(h, wWidths[i]))).join(" | "));
    lines.push(wWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const c of worldCohorts) {
      const split =
        `${(c.suppliedShare * 100).toFixed(0)} / ` +
        `${(c.rationingShare * 100).toFixed(0)} / ` +
        `${(c.shortageShare * 100).toFixed(0)}`;
      lines.push([
        pad(c.cohort, wWidths[0]),
        rpad(String(c.n), wWidths[1]),
        rpad(c.meanDissatisfaction.toFixed(3), wWidths[2]),
        rpad(c.meanUnrest.toFixed(3), wWidths[3]),
        rpad(`${(c.strikingShare * 100).toFixed(1)}%`, wWidths[4]),
        rpad(split, wWidths[5]),
      ].join(" | "));
    }

    lines.push("  cohorts overlap — a system appears in its population band, in homeworld/colony,");
    lines.push("  and in survival-short if it has no arable slot. Each row's n is its own denominator.");
    lines.push("");
  }
```

- [ ] **Step 4: Annotate the three mix-dependent aggregates**

These stay as they are — they are correctly computed answers to a whole-galaxy question. The annotation exists so they cannot be read as claims about a comparable population.

Under the cover-levels table in the Market Health section, add:

```ts
    const inertTotal = roleCoverLevels.reduce((n, e) => n + e.countByRole.inert, 0);
    const marketTotal = roleCoverLevels.reduce(
      (n, e) => n + e.countByRole.exporter + e.countByRole["self-supplier"] + e.countByRole.consumer + e.countByRole.inert,
      0,
    );
    if (marketTotal > 0) {
      lines.push(
        `  medianCover is over ALL markets of a good — ${inertTotal} of ${marketTotal} ` +
        `(${((inertTotal / marketTotal) * 100).toFixed(1)}%) are inert. See "Cover & price by market role".`,
      );
    }
```

After the existing `mean D ... over N settled systems` line in the Supply regimes section, add:

```ts
    lines.push('  mean D and mean unrest average incomparable worlds — see "Supply & unrest by world cohort".');
```

And in the Population & Unrest section, after the table, add:

```ts
    lines.push('  meanUnrest is over all settled systems — see "Supply & unrest by world cohort" for the split.');
```

- [ ] **Step 5: Verify the report renders**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/simulate.ts
git commit -m "feat(harness): report cover by market role and supply by world cohort"
```

---

### Task 8: Acceptance — the instrument must decompose the open questions

Passing tests are not the bar. The instrument exists to answer two questions the galaxy-wide numbers cannot, and this task proves it does.

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Run both horizons**

Run: `npm run simulate`
Expected: exit 0, ~2 minutes, both the STARTUP and EQUILIBRIUM banners render, and both new sections appear under each horizon.

- [ ] **Step 2: Check the fuel regression resolves to a role**

In the EQUILIBRIUM block, read the `fuel` row of "Cover & price by market role". Record the exporter, self-supplier and consumer medians and counts, and compare against the STARTUP block's `fuel` row.

The open question is why fuel's galaxy-wide median cover falls 0.79 → 0.61 between horizons while 24 goods improve. The cohorted row must show *which role moved* — a fall concentrated in consumers means distribution, a fall in exporters means production. If both roles hold steady while the galaxy-wide median falls, the movement is cohort **mix** (the population of fuel markets changed), which is itself the answer and must be recorded as such.

- [ ] **Step 3: Check electronics and luxuries decompose**

Read the `electronics` and `luxuries` rows in the EQUILIBRIUM block. Their galaxy-wide median cover is 0.25 — exactly `EXPORT_RESERVE_COVER ÷ TARGET_COVER`. The cohorted row must distinguish:

- exporter median ≈ 0.25 with a low consumer median ⇒ producers drained flat, consumers unserved: a **production** shortfall.
- consumers near 0 with few or no exporters ⇒ nobody produces it at all: a **build-planner** shortfall.

Record which, in the PR description. This is the reading the `electronics` BACKLOG item is blocked on.

- [ ] **Step 4: Sanity-check the cohort table against known figures**

In the EQUILIBRIUM block, confirm:
- the `homeworld` row's `n` equals the faction count
- summing `n` over the four population-band rows equals the settled-system count printed by the Supply regimes section
- the `survival-short` row exists and its mean D is materially above the `homeworld` row's — the struck-world finding predicts this, and if it is absent the classifier is wrong
- no cell reads `NaN`

- [ ] **Step 5: Run the PR build gate**

Run: `npx next build --webpack`
Expected: exit 0.

This is the project's named PR build gate (`AGENTS.md`) and neither `tsc` nor Vitest substitutes for it. Two failure modes it alone catches: Tailwind's oxide scanner reads every file in the project for class candidates, so a backslash-hex sequence in scanned prose aborts the build at `globals.css:1:1` — and a server-only env read that resolves differently in the client bundle. `docs/` is excluded via `@source not "../docs"`, but the gate is what proves it.

- [ ] **Step 6: Commit any fix, then open the PR**

If steps 2–5 surface a defect, fix it with a test that reproduces it first. Then push and open the PR against `feat/band-reconciliation`, quoting the fuel and electronics readings from steps 2–3 in the description.

```bash
git push -u origin feat/cohorted-harness-metrics
gh pr create --base feat/band-reconciliation --title "feat(harness): cohort the simulate report's supply readings" --body "..."
```

- [ ] **Step 7: Review**

Run `/uber-review` against the PR. Per the project's review rule, each sub-feature is reviewed going into the shared branch so that shared→main needs only a light sanity pass.

---

## Notes for the implementer

- **Do not tune anything.** This PR changes measurement only. If a cohorted reading looks alarming, record it — the decisions it informs are separate, already-booked work.
- The spec writes the empty-cell placeholder as `—`; the report renders ASCII `-` instead, because the tables are fixed-width and an em dash is a width hazard in a terminal. Deliberate, not a drift.
- `lib/tick-harness/__tests__/population-analysis.test.ts` (Task 4) is a different file from the cohort tests and does not have the `sys`/`mkt` builders. Use whatever system builder that file already defines; if it has none, copy the `sys` helper from Task 3 verbatim into it.
- **Never read a startup-horizon number as an equilibrium fault.** The economy's startup transient runs ~300+ cycles; `AGENTS.md` "Verifying changes" has the rule and the three false findings that motivated it.
- The two demand numbers are the thing most likely to be got wrong on a later edit. `GoodMarketState.demand` decides exporter status; `WorldMarket.demandRate` identifies inert markets. They are not interchangeable.
