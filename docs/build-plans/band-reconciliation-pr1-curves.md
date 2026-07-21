# Band Reconciliation PR1 — Curves, Floor Retirement, Persisted Satisfaction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the knee'd curve geometry (§1 consume/produce), retire `minStock` as a goods wall
(§4), and make satisfaction a measured-once, persisted flow that the needs display and the
planner's fed-proxy both read.

> **Rationing amendment (2026-07-21):** The original task text below called the consumption
> threshold `COMFORT_COVER × targetStock`. The accepted functional amendment is
> `docs/planned/economy-rationing-amendment.md`: current access remains full until
> `RATION_COVER × demandRate` (initially 2 cycles), independent of the 40-cycle pricing anchor.
> Initial seed reserve and PR3's exporter reserve remain separate strategic policies at the prior
> 0.75 × T level. Where the historical steps below say comfort/`COMFORT_COVER`, execute and review
> them against this amendment instead.

**Architecture:** Two new pure curve primitives in `lib/engine/tick.ts` replace every
`selfLimitingFactor` call except the decay-side `outputUptake` (which PR2 rewires). The
supply-chain sim tracks civilian `delivered` per entry; the economy processor turns that into
per-(system, good) satisfaction, persists it on `WorldMarket` (optional field, missing ⇒ 1), and
feeds the same value into the unrest dissatisfaction fold. Every `minStock` floor/clamp site moves
to 0 (or comfort, for seeds); `minStock` keeps only its price-saturation job in `marketBand`.

**Tech Stack:** TypeScript strict, Vitest 4. Engine-pure changes + one processor + two adapters +
world-gen; no UI, no API shape changes.

**Spec:** `docs/planned/economy-band-reconciliation.md` §1 (consumption/production knees,
satisfaction-as-flow), §4 (floor retirement, shared scarcity ramp, seed clamp). Umbrella:
`band-reconciliation-umbrella.md` (cross-PR interfaces this PR produces).

**Branch / PR:** create shared branch `feat/band-reconciliation` off `main`, then
`feat/band-recon-pr1-curves` off it; PR targets `feat/band-reconciliation`. This plan + the
umbrella ride PR1's branch.

## Global Constraints

- No `as` assertions (only `as const` / guards in `lib/types/guards.ts`); no `unknown`; no postfix
  `!` (exception: `find(...)!` in tests).
- Engine purity: `lib/engine/tick.ts` stays **constant-free** — cover knees arrive via
  `EconomySimParams` / call-site arguments, never imported constants.
- `World` stays JSON-serializable — no `NaN`/`Infinity` may reach a persisted field; guard at the
  adapter write exactly like `stock`/`anchorMult`.
- Determinism: no `Date.now`/`Math.random`/`new Date()` in processor bodies.
- `WorldMarket.satisfaction` is **additive optional** (missing ⇒ 1 at every read) — no
  `SAVE_FORMAT_VERSION` bump (see `lib/world/save.ts:1-16` contract).
- `ECONOMY_SCALE` invariance: all knees are band-relative (fractions of `targetStock`); never
  introduce an absolute-stock constant. The two invariance bridges
  (`economy-scale-invariance.test.ts`, `economy-scale-dynamic-invariance.test.ts`) must stay green
  unmodified.
- Magnitude assertions in updated tests stay **range-y** (coarse-health standard), never re-pinned
  to exact post-change values.
- Comments describe the code, never the plan/PR that produced it.
- Interim state (documented in the PR body, not chased here): the decay signal still reads the old
  storage-band `outputUptake`, so producers at the new resting point read uptake ≈ 0.8 and big
  stacks shed levels. PR2 removes this; PR1's sim checks are satisfaction/price/no-NaN only.
- Build gate: `npx next build --webpack`. Tests: `npx vitest run`.

---

### Task 1: Curve primitives + `COMFORT_COVER`

**Files:**
- Modify: `lib/constants/economy.ts` (add `COMFORT_COVER` to `ECONOMY_CONSTANTS`)
- Modify: `lib/engine/tick.ts` (add `consumptionFactor`, `productionCeiling`; extend
  `EconomySimParams`)
- Modify: `lib/world/tick.ts:644` (thread `comfortCover` into `simParams`)
- Create: `lib/constants/__tests__/band-constants.test.ts`
- Test: `lib/engine/__tests__/tick.test.ts` (new describes; existing sim-level tests are reworked
  in Task 2)

**Interfaces:**
- Consumes: `ECONOMY_CONSTANTS.HOLD_COVER` (1.3, `lib/constants/economy.ts:13`),
  `DIRECTED_LOGISTICS.DEFICIT_FRACTION` (0.8, `lib/constants/directed-logistics.ts:13`).
- Produces: `ECONOMY_CONSTANTS.COMFORT_COVER = 0.75`;
  `consumptionFactor(stock: number, comfortStock: number): number`;
  `productionCeiling(stock: number, targetStock: number, holdCover: number): number`;
  `EconomySimParams` gains `comfortCover: number`. Tasks 2, 3, 8 and PR2/PR5 consume all four.

- [ ] **Step 1: Branch setup**

```bash
git checkout main && git pull
git checkout -b feat/band-reconciliation && git push -u origin feat/band-reconciliation
git checkout -b feat/band-recon-pr1-curves
git add docs/build-plans/band-reconciliation-umbrella.md docs/build-plans/band-reconciliation-pr1-curves.md
git commit -m "docs(economy): band-reconciliation umbrella + PR1 build plan"
```

- [ ] **Step 2: Write the failing curve tests**

Append to `lib/engine/__tests__/tick.test.ts`:

```ts
import { consumptionFactor, productionCeiling } from "@/lib/engine/tick";

describe("consumptionFactor — comfort knee", () => {
  it("delivers in full at and above the comfort stock", () => {
    expect(consumptionFactor(75, 75)).toBe(1);
    expect(consumptionFactor(200, 75)).toBe(1);
  });
  it("ramps as sqrt below the knee — gentle just under it, brutal near empty", () => {
    expect(consumptionFactor(75 * 0.81, 75)).toBeCloseTo(0.9); // sqrt(0.81)
    expect(consumptionFactor(75 * 0.04, 75)).toBeCloseTo(0.2); // sqrt(0.04)
  });
  it("reaches 0 at empty and never goes negative", () => {
    expect(consumptionFactor(0, 75)).toBe(0);
    expect(consumptionFactor(-5, 75)).toBe(0);
  });
  it("treats a non-positive comfort stock as unconstrained when stock exists", () => {
    expect(consumptionFactor(10, 0)).toBe(1);
    expect(consumptionFactor(0, 0)).toBe(0);
  });
});

describe("productionCeiling — knee at the anchor", () => {
  it("runs at full rate at and below the anchor", () => {
    expect(productionCeiling(0, 100, 1.3)).toBe(1);
    expect(productionCeiling(100, 100, 1.3)).toBe(1);
  });
  it("ramps linearly to 0 across [T, holdCover×T]", () => {
    expect(productionCeiling(115, 100, 1.3)).toBeCloseTo(0.5);
    expect(productionCeiling(130, 100, 1.3)).toBe(0);
    expect(productionCeiling(200, 100, 1.3)).toBe(0);
  });
  it("returns 0 for a non-positive anchor (no band to produce into)", () => {
    expect(productionCeiling(10, 0, 1.3)).toBe(0);
  });
});
```

- [ ] **Step 3: Run them to verify failure**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts`
Expected: FAIL — `consumptionFactor` / `productionCeiling` not exported.

- [ ] **Step 4: Implement the primitives**

In `lib/engine/tick.ts`, after `selfLimitingFactor` (line 64), add:

```ts
/**
 * Consumption/delivery factor ∈ [0,1] with a comfort knee. Full delivery (1)
 * while stock ≥ comfortStock; below the knee it ramps as √(stock / comfortStock)
 * — gentle just under the knee, brutal near empty — reaching 0 at stock = 0.
 * The same ramp rations civilian consumption and industrial input draws (the
 * shared scarcity ramp), so every drawer of a scarce good slows at one rate.
 * A non-positive comfortStock means the good has no meaningful comfort band:
 * any stock delivers freely, empty delivers nothing.
 */
export function consumptionFactor(stock: number, comfortStock: number): number {
  if (comfortStock <= 0) return stock > 0 ? 1 : 0;
  if (stock >= comfortStock) return 1;
  return Math.sqrt(Math.max(0, stock) / comfortStock);
}

/**
 * Production ceiling factor ∈ [0,1] with a knee at the anchor. Full rate (1)
 * while stock ≤ targetStock; ramps linearly to 0 across
 * [targetStock, holdCover × targetStock] — the deceleration zone that absorbs
 * shocks. A self-supplier with margin capacity rests just above the anchor, so
 * a healthy price sits near base.
 */
export function productionCeiling(stock: number, targetStock: number, holdCover: number): number {
  if (targetStock <= 0) return 0;
  const ceiling = targetStock * holdCover;
  if (stock <= targetStock) return 1;
  if (stock >= ceiling) return 0;
  return (ceiling - stock) / (ceiling - targetStock);
}
```

Extend `EconomySimParams` (line 37):

```ts
export interface EconomySimParams {
  /**
   * Operating-ceiling cover multiple on targetStock: the production ceiling
   * ramps from full rate at the anchor to 0 at holdCover × targetStock.
   * Passed in (not imported) so this module stays constant-free.
   */
  holdCover: number;
  /**
   * Comfort-knee cover fraction of targetStock: consumption and input draws
   * deliver in full at/above comfortCover × targetStock and ration on the
   * scarcity ramp below it. Passed in (not imported) — same rule as holdCover.
   */
  comfortCover: number;
}
```

In `lib/constants/economy.ts`, extend `ECONOMY_CONSTANTS`:

```ts
export const ECONOMY_CONSTANTS = {
  /** (existing HOLD_COVER doc unchanged) */
  HOLD_COVER: 1.3,
  /**
   * Comfort knee as a fraction of the days-of-supply anchor: full civilian
   * delivery and full industrial input draws at/above COMFORT_COVER ×
   * targetStock; the shared scarcity ramp runs below it. One constant shared
   * by the sim, the seed clamp, the planners, and the regime classification so
   * mechanics and UI cannot disagree about where "comfortable" ends.
   */
  COMFORT_COVER: 0.75,
} as const;
```

In `lib/world/tick.ts:644`:

```ts
simParams: { holdCover: ECONOMY_CONSTANTS.HOLD_COVER, comfortCover: ECONOMY_CONSTANTS.COMFORT_COVER },
```

Create `lib/constants/__tests__/band-constants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

describe("band constant dependencies", () => {
  it("keeps the logistics deficit trigger above the comfort knee", () => {
    // Imports must arrive before rationing starts: receivers classify as
    // deficits (cover < DEFICIT_FRACTION) while still above the comfort knee
    // (cover ≥ COMFORT_COVER), so the matcher refills them before pops feel it.
    expect(DIRECTED_LOGISTICS.DEFICIT_FRACTION).toBeGreaterThan(ECONOMY_CONSTANTS.COMFORT_COVER);
  });
  it("keeps the comfort knee below the anchor and the anchor below the hold ceiling", () => {
    expect(ECONOMY_CONSTANTS.COMFORT_COVER).toBeLessThan(1);
    expect(ECONOMY_CONSTANTS.HOLD_COVER).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts lib/constants/__tests__/band-constants.test.ts`
Expected: the new describes PASS. (Pre-existing `simulateEconomyTick` tests in the same file may
now fail to compile against the extended `EconomySimParams` — if their local `PARAMS` fixture lacks
`comfortCover`, add `comfortCover: 0.75` to it; their behavioural rework is Task 2.)

- [ ] **Step 6: Commit**

```bash
git add lib/constants/economy.ts lib/engine/tick.ts lib/world/tick.ts lib/constants/__tests__/band-constants.test.ts lib/engine/__tests__/tick.test.ts
git commit -m "feat(economy): comfort/anchor curve primitives + COMFORT_COVER"
```

---

### Task 2: Flat tick on the new geometry

**Files:**
- Modify: `lib/engine/tick.ts:84-109` (`simulateEconomyTick`)
- Test: `lib/engine/__tests__/tick.test.ts`

**Interfaces:**
- Consumes: `consumptionFactor`, `productionCeiling` (Task 1).
- Produces: `simulateEconomyTick` unchanged signature, new behaviour: production knee at the
  anchor, consumption knee at comfort with availability cap, clamp `[0, maxStock]`. The flat tick
  stays the curve-reference implementation the coupled engine mirrors (Task 3).

- [ ] **Step 1: Rework the failing behavioural tests**

In `lib/engine/__tests__/tick.test.ts`, the existing `simulateEconomyTick` describes assert the
old √ geometry (e.g. production still throttled at mid-band, consumption slowing at the anchor).
Rewrite them to the knee'd expectations. The fixture `entry()` builds
`{ minStock: 50, targetStock: 100, maxStock: 200 }`-shaped entries (read the file's actual helper
and keep it); `PARAMS = { holdCover: 1.3, comfortCover: 0.75 }`. New expectations:

```ts
describe("simulateEconomyTick — production", () => {
  it("produces at the FULL rate at and below the anchor", () => {
    const atAnchor = simulateEconomyTick([entry({ productionRate: 10, stock: 100 })], PARAMS);
    expect(atAnchor[0].stock).toBeCloseTo(110); // no throttle at the anchor
    const low = simulateEconomyTick([entry({ productionRate: 10, stock: 20 })], PARAMS);
    expect(low[0].stock).toBeCloseTo(30);
  });
  it("ramps linearly to zero across the deceleration zone [T, 1.3T]", () => {
    const mid = simulateEconomyTick([entry({ productionRate: 10, stock: 115 })], PARAMS);
    expect(mid[0].stock).toBeCloseTo(115 + 10 * 0.5);
    const atCeiling = simulateEconomyTick([entry({ productionRate: 10, stock: 130 })], PARAMS);
    expect(atCeiling[0].stock).toBeCloseTo(130);
  });
});

describe("simulateEconomyTick — consumption", () => {
  it("delivers in full at and above the comfort knee", () => {
    const atComfort = simulateEconomyTick([entry({ consumptionRate: 10, stock: 75 })], PARAMS);
    expect(atComfort[0].stock).toBeCloseTo(65); // full draw, no ration
    const deep = simulateEconomyTick([entry({ consumptionRate: 10, stock: 150 })], PARAMS);
    expect(deep[0].stock).toBeCloseTo(140);
  });
  it("rations on the scarcity ramp below comfort and can draw below the old minStock", () => {
    const scarce = simulateEconomyTick([entry({ consumptionRate: 10, stock: 30 })], PARAMS);
    // factor = sqrt(30/75) ≈ 0.632 → draw ≈ 6.32; ends ≈ 23.7, below the old 50 floor
    expect(scarce[0].stock).toBeCloseTo(30 - 10 * Math.sqrt(30 / 75), 1);
    expect(scarce[0].stock).toBeLessThan(50);
  });
  it("never draws more than the stock that exists (stock floors at 0, not minStock)", () => {
    const nearEmpty = simulateEconomyTick([entry({ consumptionRate: 1000, stock: 5 })], PARAMS);
    expect(nearEmpty[0].stock).toBeGreaterThanOrEqual(0);
  });
});
```

Keep the immutability / per-entry-band / zero-rate describes, updating any old-floor expectations
(a per-entry-band test asserting the clamp at `minStock` now asserts the clamp at 0).

- [ ] **Step 2: Run to verify the reworked tests fail**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts`
Expected: FAIL — old geometry still implemented.

- [ ] **Step 3: Implement**

Replace the body of `simulateEconomyTick` (lines 90-108):

```ts
  return markets.map((entry) => {
    let stock = entry.stock;
    const { maxStock, targetStock } = entry;

    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0) {
      stock += effectiveProduction * productionCeiling(stock, targetStock, holdCover);
    }

    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      const factor = consumptionFactor(stock, comfortCover * targetStock);
      stock -= Math.min(effectiveConsumption * factor, Math.max(0, stock));
    }

    stock = clamp(stock, 0, maxStock);

    return { ...entry, stock };
  });
```

with `const { holdCover, comfortCover } = params;` at the top. Update the module doc header
(lines 1-11): producers add stock at full rate to the anchor and decelerate to the hold ceiling;
consumers deliver in full above the comfort knee and ration on the scarcity ramp below it; stock
clamps to `[0, maxStock]` — `minStock` is the price-saturation point, not a draw floor. Update the
`MarketTickEntry.minStock` field doc (line 18): `/** Price-saturation point (price hits its
ceiling here). Not a draw floor — retained for the decay-uptake band read. */`

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/tick.ts lib/engine/__tests__/tick.test.ts
git commit -m "feat(economy): flat tick on the knee'd curve geometry"
```

---

### Task 3: Supply-chain cascade — scarcity-ramped draws + delivered tracking

**Files:**
- Modify: `lib/engine/supply-chain.ts`
- Test: `lib/engine/__tests__/supply-chain.test.ts` (locate with
  `npx vitest run lib/engine/__tests__ --list` if named differently)

**Interfaces:**
- Consumes: `consumptionFactor`, `productionCeiling`, `EconomySimParams.comfortCover` (Task 1).
- Produces: `SimulatedMarketEntry.delivered: number` (civilian delivered this run; 0 for
  non-consumers) — Task 4's satisfaction numerator. `inputGate(goodId, effectiveProduction,
  stockOf, comfortOf)` — **signature change**: 4th param is now `comfortOf: (g: string) => number`
  (comfort stock per good), not `minStockOf`. `inputDrawRatio(stock, comfortStock, desired)` —
  shared per-input ratio, reused by the industry readout (Task 8).

- [ ] **Step 1: Write the failing tests**

Add/rework in the supply-chain test file (keep its existing fixtures for recipes/entries; the
entries carry `minStock: 0.5×T` — leave the field, the engine just stops flooring on it):

```ts
describe("inputGate — scarcity ramp", () => {
  it("gates at 1 when every input sits at/above its comfort stock", () => { /* inputs at comfort → gate 1 */ });
  it("rations an input below comfort at the shared consumptionFactor rate", () => {
    // input stock = 0.25 × comfort → ramp = 0.5 → gate ≈ 0.5 (not drawable/desired)
  });
  it("draws below the old minStock — a crisis drains toward empty, not to the floor", () => {
    // run the cascade with input stock between 0 and old minStock; expect output > 0 and
    // input stock strictly decreasing toward 0
  });
  it("never draws an input negative", () => { /* huge desired vs tiny stock → input ends ≥ 0 */ });
});

describe("simulateSystemEconomyTick — delivered flow", () => {
  it("reports delivered = full demand above the comfort knee", () => {
    // consumer entry at stock ≥ comfort: result.delivered ≈ effectiveConsumption
  });
  it("reports rationed delivered below the knee and 0 at empty", () => {});
  it("reports delivered = 0 for pure producers", () => {});
  it("clamps post-tick stock to [0, maxStock] (no minStock floor)", () => {});
});
```

Write these as real tests against the file's existing entry-builder helpers — every assertion
concrete (the ramp values are exact: `sqrt(stock/comfort)`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run` on the supply-chain test file. Expected: FAIL (no `delivered`, old gate).

- [ ] **Step 3: Implement**

In `lib/engine/supply-chain.ts`:

1. Imports: swap `selfLimitingFactor` for `consumptionFactor, productionCeiling`.
2. `SimulatedMarketEntry` (line 26):

```ts
export interface SimulatedMarketEntry extends MarketTickEntry {
  /** Output actually produced this run — post input-gate and operating-ceiling. 0 for non-producers. */
  realized: number;
  /** Civilian consumption actually delivered this run (≤ demanded). 0 for non-consumers. */
  delivered: number;
}
```

3. Add the shared per-input ratio and rework `inputGate` (lines 31-54):

```ts
/**
 * Per-input draw ratio ∈ [0,1]: the shared scarcity ramp below the input's
 * comfort stock, capped by the stock that physically exists. Above comfort the
 * draw is unconstrained (1); below it every drawer — civilian or industrial —
 * slows at the same consumptionFactor rate, so scarcity is shared pro-rata by
 * demand instead of gated behind a reserve floor.
 */
export function inputDrawRatio(stock: number, comfortStock: number, desired: number): number {
  if (desired <= 0) return 1;
  const allowed = Math.min(consumptionFactor(stock, comfortStock) * desired, Math.max(0, stock));
  return Math.max(0, Math.min(1, allowed / desired));
}

/**
 * Input-availability throttle in [0, 1] for one producing good. Returns 1 for
 * tier-0 / no-recipe goods and for zero production. The binding input's
 * inputDrawRatio gates output; draws run toward empty on the scarcity ramp —
 * there is no reserve floor.
 */
export function inputGate(
  goodId: string,
  effectiveProduction: number,
  stockOf: (g: string) => number,
  comfortOf: (g: string) => number,
): number {
  const recipe = GOOD_RECIPES[goodId];
  if (!recipe || effectiveProduction <= 0) return 1;
  let gate = 1;
  for (const [input, perOutput] of Object.entries(recipe)) {
    const desired = effectiveProduction * perOutput;
    if (desired <= 0) continue;
    const ratio = inputDrawRatio(stockOf(input), comfortOf(input), desired);
    if (ratio < gate) gate = ratio;
  }
  return Math.max(0, gate);
}
```

4. In `simulateSystemEconomyTick`: replace the `minStockMap`/`minStockOf` build (lines 72-77) with
a comfort map:

```ts
  // Per-good comfort stock (the scarcity-ramp knee) from entry data.
  const comfortMap = new Map<string, number>();
  for (const e of entries) {
    comfortMap.set(e.goodId, comfortCover * e.targetStock);
  }
  const comfortOf = (g: string): number => comfortMap.get(g) ?? 0;
```

(`const { holdCover, comfortCover } = params;` at the top.) `stockOf` fallback becomes
`stock.get(g) ?? 0` (a good with no entry has nothing to draw). Add
`const deliveredByGood = new Map<string, number>();` beside `realizedByGood`.

5. Production block (lines 96-116): gate call passes `comfortOf`; ceiling becomes
`productionCeiling(s, entry.targetStock, holdCover)`; the recipe-draw floor drops to zero:

```ts
      const recipe = GOOD_RECIPES[entry.goodId];
      if (recipe) {
        for (const [input, perOutput] of Object.entries(recipe)) {
          const draw = perOutput * actualOutput;
          stock.set(input, Math.max(0, stockOf(input) - draw));
        }
      }
```

Rewrite the in-block comment: draws are ramp-and-availability capped (gate ≤ each input's
inputDrawRatio), so the actual draw never exceeds the stock that exists; the Math.max guard covers
floating-point rounding and same-tick multi-consumer draws.

6. Consumption block (lines 118-121):

```ts
    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      const factor = consumptionFactor(s, comfortCover * entry.targetStock);
      const delivered = Math.min(effectiveConsumption * factor, Math.max(0, s));
      s -= delivered;
      deliveredByGood.set(entry.goodId, delivered);
    }
```

7. Clamp: `s = clamp(s, 0, maxStock);` — drop the unused `minStock` destructure.
8. Return: `delivered: deliveredByGood.get(e.goodId) ?? 0` alongside `realized`.
9. Module doc header (lines 1-13): rewrite — draws run toward empty on the shared scarcity ramp
   (comfort knee), production decelerates from the anchor to the hold ceiling, stock clamps to
   `[0, maxStock]`; civilian and industrial draws of one good share the ramp at their moment of
   draw (civilian draws in the good's own entry pass, industrial draws when downstream producers
   process — topological order, so a scarce good rations every drawer at the same curve).

- [ ] **Step 4: Run tests**

Run: `npx vitest run` on the supply-chain + tick test files. Expected: PASS.

- [ ] **Step 5: Compile-check the gate's external callers**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `lib/engine/industry.ts` (read-path `inputGate` callers — fixed in Task
8) and possibly `lib/tick/processors/economy.ts` (`delivered` unused is fine; satisfaction rework
is Task 4). If `industry.ts` is the only breakage, park it — Task 8 owns that file; if anything
else calls `inputGate`, update it now to pass a comfort accessor.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/supply-chain.ts lib/engine/__tests__/
git commit -m "feat(economy): supply-chain cascade on the shared scarcity ramp + delivered tracking"
```

(If Step 5 left `industry.ts` red, note it in the commit body as resolved by the read-path task —
do not leave `main`-bound history red; the PR is squashed into the shared branch, so intra-PR
redness is acceptable only between commits, and the branch must be green by Task 8.)

---

### Task 4: Economy processor — satisfaction measured once, persisted

**Files:**
- Modify: `lib/tick/world/economy-world.ts` (`MarketUpdate`)
- Modify: `lib/world/types.ts` (`WorldMarket.satisfaction?`)
- Modify: `lib/tick/adapters/memory/economy.ts` (`applyMarketUpdates`)
- Modify: `lib/world/gen.ts:194-201` (seed `satisfaction: 1`)
- Modify: `lib/tick/processors/economy.ts:150-191`
- Test: `lib/tick/processors/__tests__/economy.test.ts`

**Interfaces:**
- Consumes: `SimulatedMarketEntry.delivered` (Task 3).
- Produces: `WorldMarket.satisfaction?: number` (missing ⇒ 1; clamped [0,1]; finite-guarded) —
  read by Tasks 5/6 and PR3/PR5. `MarketUpdate.satisfaction: number`.

- [ ] **Step 1: Write the failing processor tests**

In `lib/tick/processors/__tests__/economy.test.ts` (its `simParams` fixture at line 39 gains
`comfortCover: 0.75` if Task 1 didn't already): add

```ts
describe("satisfaction — measured flow, persisted", () => {
  it("persists satisfaction 1 for a consumer fully served above the comfort knee", async () => {
    // consumer market with stock deep above comfort → after the pulse the
    // adapter's market row carries satisfaction === 1
  });
  it("persists the rationed delivered fraction below the knee", async () => {
    // stock at 0.25 × comfort → satisfaction ≈ sqrt(0.25) = 0.5 (delivered ÷ demanded)
  });
  it("is flow-measured, not a post-tick stock read (boundary bias)", async () => {
    // stock just above comfort but small enough that a full month's draw ends below
    // the knee → satisfaction still 1 (full delivery happened)
  });
  it("persists 1 for pure producers", async () => {});
  it("feeds the same value into dissatisfactionBySystem", async () => {
    // rationed consumer → dissatisfaction = share × (1 − satisfaction)² with the
    // persisted satisfaction, not a recomputed one
  });
});
```

Build these on the file's existing world/adapter fixtures (it already constructs
`InMemoryEconomyWorld` with market rows and runs `runEconomyProcessor` on a pulse tick). Assert
via the adapter's public `markets` field.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tick/processors/__tests__/economy.test.ts`
Expected: FAIL — no `satisfaction` on the market rows.

- [ ] **Step 3: Implement the carrier**

`lib/tick/world/economy-world.ts` — `MarketUpdate` (line 45):

```ts
/** Result of one market simulation step — written back via applyMarketUpdates. */
export interface MarketUpdate {
  id: string;
  stock: number;
  /** Active pricing-anchor multiplier from event modifiers (1 = none). */
  anchorMult: number;
  /** Consumption satisfaction actually applied this pulse (delivered ÷ demanded; 1 for non-consumers). */
  satisfaction: number;
}
```

`lib/world/types.ts` — `WorldMarket` gains, after `storageCapacity`:

```ts
  /**
   * Consumption satisfaction the last economy pulse actually applied for this
   * good (civilian delivered ÷ demanded, ∈ [0,1]; 1 = fully served). The
   * measured-once flow the needs display, the planner fed-proxy, and the regime
   * classification all read — never recomputed from stock. Optional:
   * missing (pre-change save) reads as 1.
   */
  satisfaction?: number;
```

`lib/tick/adapters/memory/economy.ts` — `applyMarketUpdates` (line 118):

```ts
    this.markets = this.markets.map((m) => {
      const u = byKey.get(`${m.systemId}|${m.goodId}`);
      if (!u) return m;
      return {
        ...m,
        stock: isFinite(u.stock) ? u.stock : 0,
        anchorMult: isFinite(u.anchorMult) ? u.anchorMult : 1,
        satisfaction: isFinite(u.satisfaction) ? Math.max(0, Math.min(1, u.satisfaction)) : 1,
      };
    });
```

`lib/world/gen.ts` market seed (line 194) gains `satisfaction: 1,` (a fresh world opens fully
served — matches the comfort-floored seed stock).

- [ ] **Step 4: Implement the measurement**

In `lib/tick/processors/economy.ts`, replace lines 140-191 (from the `marketUpdates` build through
the `economySignals` assembly):

```ts
  // Satisfaction is the FLOW actually applied this pulse (delivered ÷ demanded),
  // never a post-tick stock recompute — a month that starts above the comfort
  // knee delivers in full even when it ends just below it. Non-consumers read 1.
  const satisfactionByIndex = markets.map((_, i) => {
    const consumptionRate = tickEntries[i].consumptionRate;
    if (consumptionRate == null || consumptionRate <= 0) return 1;
    const demanded = consumptionRate * (tickEntries[i].consumptionMult ?? 1);
    return demanded > 0 ? Math.max(0, Math.min(1, simulated[i].delivered / demanded)) : 1;
  });

  // anchorMult comes straight off the resolved tick — the builder already
  // aggregated the system's modifiers, so there's no second aggregation pass.
  const marketUpdates: MarketUpdate[] = markets.map((m, i) => ({
    id: m.id,
    stock: simulated[i].stock,
    anchorMult: resolved[i].anchorMult,
    satisfaction: satisfactionByIndex[i],
  }));

  await world.applyMarketUpdates(marketUpdates);

  // Fold the same per-good satisfaction into per-system convex demand-weighted
  // dissatisfaction D (consume side) and read per-produced-good output uptake
  // (produce side) from post-tick stock.
  const goodsBySystem = new Map<string, GoodSatisfaction[]>();
  const uptakeBySystem = new Map<string, Map<string, number>>();
  const realizedProductionBySystem = new Map<string, Map<string, number>>();
  markets.forEach((m, i) => {
    const consumptionRate = tickEntries[i].consumptionRate;
    if (consumptionRate != null && consumptionRate > 0) {
      const demanded = consumptionRate * (tickEntries[i].consumptionMult ?? 1);
      const arr = goodsBySystem.get(m.systemId) ?? [];
      arr.push({ satisfaction: satisfactionByIndex[i], demanded });
      goodsBySystem.set(m.systemId, arr);
    }
    // (outputUptake + realizedProduction blocks unchanged — keep the existing
    // storage-band comment; the selling-signal rework is a separate change.)
    ...
  });
```

Keep the `outputUptake` and `realized` blocks byte-identical (PR2 owns them). Drop the now-unused
`selfLimitingFactor` import (line 8). The old lines 142-148 (updates built before measurement) are
subsumed — updates are now built after `satisfactionByIndex`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run lib/tick/processors/__tests__/economy.test.ts`
Expected: PASS. Also run `npx vitest run lib/world/__tests__/` — the whole-world tick tests and
both invariance bridges must be green (satisfaction is band-relative; S-invariance holds).

- [ ] **Step 6: Commit**

```bash
git add lib/tick/world/economy-world.ts lib/world/types.ts lib/tick/adapters/memory/economy.ts lib/world/gen.ts lib/tick/processors/economy.ts lib/tick/processors/__tests__/economy.test.ts
git commit -m "feat(economy): satisfaction measured once as delivered flow, persisted per (system, good)"
```

---

### Task 5: Pop-needs display reads the stored flow

**Files:**
- Modify: `lib/engine/pop-needs.ts`
- Test: `lib/engine/__tests__/pop-needs.test.ts` (locate the existing file; create if absent)

**Interfaces:**
- Consumes: `WorldMarket.satisfaction?` (Task 4) — arrives structurally via the rows
  `lib/services/pop-needs.ts:15` already passes (`marketsBySystem()` returns `WorldMarket[]`; no
  service change needed).
- Produces: `PopNeedsMarketRow` shrinks to `{ goodId: string; satisfaction?: number }`;
  `computePopNeeds` signature unchanged, `PopNeed` shape unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
describe("computePopNeeds — stored satisfaction", () => {
  it("reads the persisted flow, not a stock recompute", () => {
    // row { goodId: "food", satisfaction: 0.6 } → need.satisfaction === 0.6,
    // delivered = want × 0.6, pressure = share × 0.4²
  });
  it("treats a missing satisfaction field as fully served (pre-change save)", () => {
    // row without satisfaction → 1
  });
  it("treats a wanted good with no market row as satisfaction 0", () => {});
});
```

- [ ] **Step 2: Run to verify failure** — the first test fails (current code recomputes from
stock and the fixture row has no band fields).

- [ ] **Step 3: Implement**

Rewrite `lib/engine/pop-needs.ts`:

- Module doc: the read-side projection now *reads* the economy pulse's persisted per-good
  satisfaction (delivered ÷ demanded) instead of recomputing a stock position — the display and
  the sim cannot diverge, and the post-tick boundary bias is gone. Note: the stored measure is
  taken against total civilian demand including the government boost; rationing is pro-rata, so
  the delivered *fraction* is identical for every civilian drawer.
- Delete the `marketBandForRow` / `selfLimitingFactor` / `GOODS`-for-band imports (keep `GOODS`
  only for `consumedGoodIds`' filter).
- `PopNeedsMarketRow`:

```ts
/** The market-row fields the needs read consumes. */
export interface PopNeedsMarketRow {
  goodId: string;
  /** Persisted consumption satisfaction from the last economy pulse (missing ⇒ 1). */
  satisfaction?: number;
}
```

- In `computePopNeeds`, the satisfaction derivation becomes:

```ts
      const row = rowByGood.get(goodId);
      const satisfaction = row ? Math.max(0, Math.min(1, row.satisfaction ?? 1)) : 0;
```

  (`PopNeed.satisfaction` doc: `/** [0,1] — the delivered fraction the last economy pulse applied; 1 = fully met. */`)

- [ ] **Step 4: Run tests** — `npx vitest run` on the pop-needs test file + `npx tsc --noEmit`
(callers pass `WorldMarket[]`, structurally fine). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/pop-needs.ts lib/engine/__tests__/
git commit -m "feat(economy): needs display reads the persisted satisfaction flow"
```

---

### Task 6: Planner fed-proxy reads the stored flow

**Files:**
- Modify: `lib/tick/world/directed-logistics-world.ts` (`MarketRowForLogistics.satisfaction?`)
- Modify: `lib/world/tick.ts:265-281` (`marketRowsBySystem` threads it)
- Modify: `lib/tick/processors/good-market-state.ts` (pass-through)
- Modify: `lib/engine/directed-logistics.ts` (`GoodMarketState.satisfaction?`)
- Modify: `lib/engine/directed-build.ts:36-49, 98-112` (`BuildGoodState.satisfaction?`,
  `supplyDissatisfaction`)
- Test: `lib/tick/processors/__tests__/good-market-state.test.ts`,
  `lib/engine/__tests__/directed-build.test.ts` (or the file holding `supplyDissatisfaction`
  tests — grep for it)

**Interfaces:**
- Consumes: `WorldMarket.satisfaction?` (Task 4).
- Produces: `satisfaction?: number` on `MarketRowForLogistics`, `GoodMarketState`,
  `BuildGoodState` (all missing ⇒ 1); `supplyDissatisfaction` re-based onto it. PR3's squeeze
  counters read the same row field.

- [ ] **Step 1: Write the failing tests**

```ts
// good-market-state.test.ts
it("threads the persisted satisfaction through to GoodMarketState", () => {
  // row with satisfaction 0.7 → state.satisfaction === 0.7; missing → undefined
});

// directed-build tests
describe("supplyDissatisfaction — delivered flow", () => {
  it("reads a fully-delivering exporter parked at comfort as satisfied (D = 0)", () => {
    // goods: [{ stock: 0.75 × target, targetStock, demand, satisfaction: 1 }] → 0
    // (the old stock/target proxy read this as 25% unsatisfied)
  });
  it("uses the persisted flow when present and 1 when missing", () => {});
  it("still folds convexly by demand share", () => {
    // two goods, one satisfaction 0.5 → D = share × 0.25
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`lib/tick/world/directed-logistics-world.ts` — `MarketRowForLogistics` gains:

```ts
  /** Persisted consumption satisfaction from the last economy pulse (missing ⇒ 1). */
  satisfaction?: number;
```

`lib/world/tick.ts:268` — the row literal gains `satisfaction: m.satisfaction,`.

`lib/tick/processors/good-market-state.ts:33` — the pushed state gains
`satisfaction: m.satisfaction,`.

`lib/engine/directed-logistics.ts` — `GoodMarketState` gains the same optional field (doc: the
fed-proxy's input; the matcher itself does not read it).

`lib/engine/directed-build.ts` — `BuildGoodState` gains the field, and `supplyDissatisfaction`
becomes:

```ts
/**
 * Delivered-flow dissatisfaction D in [0,1] for one system — the "fed" half of
 * the settle gate. Reuses the population engine's demand-weighted convex fold
 * over the economy pulse's persisted per-good satisfaction (delivered ÷
 * demanded — the same measure the needs display reads), so a
 * deliberately-at-comfort exporter with full delivery reads as satisfied.
 * Missing satisfaction (engine-test fixtures, pre-change saves) ⇒ 1.
 */
export function supplyDissatisfaction(goods: BuildGoodState[]): number {
  return dissatisfaction(
    goods.map((g) => ({
      satisfaction: clamp(g.satisfaction ?? 1, 0, 1),
      demanded: Math.max(0, g.demand),
    })),
  );
}
```

`stock`/`targetStock` stay on `BuildGoodState` (the deficit finder and severity weights still use
them) — only the fed-proxy formula moves off them.

- [ ] **Step 4: Run tests** — the two test files + `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
(fixtures constructing `MarketRowForLogistics` without `satisfaction` stay valid — optional).
Expected: PASS. Watch for existing directed-build tests that relied on LOW STOCK alone making a
system un-fed: they now need `satisfaction` set explicitly to model a starving system — update
those fixtures to carry the flow they mean.

- [ ] **Step 5: Commit**

```bash
git add lib/tick/world/directed-logistics-world.ts lib/world/tick.ts lib/tick/processors/good-market-state.ts lib/engine/directed-logistics.ts lib/engine/directed-build.ts lib/engine/__tests__/ lib/tick/processors/__tests__/
git commit -m "feat(economy): planner fed-proxy reads the persisted satisfaction flow"
```

---

### Task 7: Floor-retirement sweep — shocks, logistics clamp, seed stocks

**Files:**
- Modify: `lib/tick/adapters/memory/events.ts:201-204`
- Modify: `lib/tick/processors/directed-logistics.ts:90-101, 133-137`
- Modify: `lib/constants/market-economy.ts:86-126` (`getInitialStock`)
- Test: the events-adapter test file (grep `applyShocks` under `lib/tick`), plus the world-gen /
  market-economy test that covers `getInitialStock` (grep `getInitialStock` under `lib`)

**Interfaces:**
- Consumes: `ECONOMY_CONSTANTS.COMFORT_COVER` (Task 1).
- Produces: no new interfaces — behaviour only. Every remaining `minStock`-as-floor site in the
  codebase is gone after this task (verified in Step 5).

- [ ] **Step 1: Write the failing tests**

```ts
// events adapter
it("lets a supply-destruction shock push stock below the price-saturation point", async () => {
  // market at 0.6×T, percentage shock −0.9 → stock ≈ 0.06×T (not floored at 0.5×T), ≥ 0
});
it("still clamps shocked stock to [0, maxStock]", async () => { /* huge negative → 0; huge positive → maxStock */ });

// getInitialStock
it("seeds a pure consumer at the comfort knee, not the price-saturation point", () => {
  // consumer-only system: initial stock === COMFORT_COVER × band.targetStock
  // (SEED_COVER_MIN 0.5 < COMFORT_COVER 0.75 → the comfort floor binds)
});
it("still seeds a pure producer at deep cover", () => { /* coverMult 1.5 unchanged */ });
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`lib/tick/adapters/memory/events.ts:201-204`:

```ts
    for (const market of touched) {
      const band = marketBandForRow(market, GOODS[market.goodId]);
      market.stock = Math.max(0, Math.min(band.maxStock, market.stock));
    }
```

(Comment on the loop: shocks clamp to the physical `[0, maxStock]` range — a supply-destruction
event may push a market below the price-saturation point; that is the crisis zone working, not a
floor breach.)

`lib/tick/processors/directed-logistics.ts` — drop the `min` field from the `MarketEntry` local
type (line 90) and its assignment (line 98); the transfer apply (line 133) becomes:

```ts
    const moved = Math.min(
      qty,
      Math.max(0, fromCur),
      Math.max(0, to.max - toCur),
    );
```

(The matcher's `surplusDrawable` never plans a draw below the donor's anchor
(`directed-logistics.ts:50-56`) — this clamp is only the physical belt-and-braces against
same-pulse concurrent writes, so its floor is 0, not the retired reserve.)

`lib/constants/market-economy.ts` — `getInitialStock` return (line 125):

```ts
  return Math.max(
    ECONOMY_CONSTANTS.COMFORT_COVER * band.targetStock,
    Math.min(band.maxStock, band.targetStock * coverMult),
  );
```

with `import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";` (constants → constants, no
cycle). Rewrite the doc block (lines 86-97): seeds clamp to `[COMFORT_COVER × targetStock,
maxStock]` so every market — pure consumers included — opens Comfortable; drop the
"minStock"/floor vocabulary. Also update the `SEED_COVER_MIN` doc (line 44-48): a pure consumer's
0.5 blend is floored up to the comfort knee at seed.

- [ ] **Step 4: Run tests** — the two test files. Expected: PASS.

- [ ] **Step 5: Sweep for stragglers**

Run: `Grep minStock` across `lib/` and `app/`/`components/`. Expected remaining references ONLY:
`marketBand`/`marketBandForRow` (defines it — the price-saturation point),
`midPriceAt` (price math), `MarketTickEntry.minStock` + `outputUptake`'s band read (PR2 retires),
the harness pin metric (Task 9 re-bases), and test fixtures. Any other floor/clamp use is a missed
site — move it to 0 now and add it to this task's commit.

- [ ] **Step 6: Commit**

```bash
git add lib/tick/adapters/memory/events.ts lib/tick/processors/directed-logistics.ts lib/constants/market-economy.ts lib/tick/ lib/constants/
git commit -m "feat(economy): retire the minStock goods wall — shocks, transfers, and seeds"
```

---

### Task 8: Industry read-path on the same geometry

**Files:**
- Modify: `lib/engine/industry.ts:668-800` (`buildIndustryReadout` signature + gate/throttle reads)
- Modify: `lib/services/universe.ts:183-222` (caller)
- Test: the industry readout test file (grep `buildIndustryReadout` under `lib/engine/__tests__`)

**Interfaces:**
- Consumes: `inputDrawRatio`, `inputGate` (Task 3); `MarketBand` type
  (`lib/engine/market-pricing.ts:50`); `ECONOMY_CONSTANTS.COMFORT_COVER`.
- Produces: `buildIndustryReadout(buildings, population, marketStock, bandOf, yields)` — the
  `minStockOf`/`maxStockOf` closure pair is replaced by one
  `bandOf: (goodId: string) => MarketBand | undefined` accessor. PR2 reuses `bandOf` for the
  read-side selling factor.

- [ ] **Step 1: Write/adjust the failing tests**

Update the readout tests' call sites to the new signature (a `bandOf` returning a
`{ targetStock, minStock, maxStock }` literal per good), and add:

```ts
it("gates a producer's displayed output on the scarcity ramp, not a reserve floor", () => {
  // input stock below the old minStock but > 0 → output > 0 (draws toward empty)
});
it("marks throttledBy only when the ramp actually binds", () => {
  // input at/above comfort with desired ≤ stock → not throttled;
  // input below comfort → throttled
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

In `lib/engine/industry.ts`:

1. `import type { MarketBand } from "@/lib/engine/market-pricing";` (type-only — market-pricing
   imports `constants/market-economy`, which imports this module; a value import would cycle, a
   type import erases) and `import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";`
   (leaf module, no cycle). Import `inputDrawRatio` alongside `inputGate` from supply-chain.
2. Signature:

```ts
export function buildIndustryReadout(
  buildings: Record<string, number>,
  population: number,
  marketStock: Record<string, number>,
  bandOf: (goodId: string) => MarketBand | undefined,
  yields: ResourceVector,
): SystemIndustryReadout {
```

3. The accessor block (lines 684-691) becomes:

```ts
  const stockOf = (g: string): number => marketStock[g] ?? 0;
  const comfortOf = (g: string): number => {
    const band = bandOf(g);
    return band !== undefined ? ECONOMY_CONSTANTS.COMFORT_COVER * band.targetStock : 0;
  };
  // Seller-side uptake for a produced good ∈ [0,1]; a good with no market band sells freely (1).
  // Shared by buildingUsed and the producer idleReason.
  const uptakeOf = (g: string): number => {
    const band = bandOf(g);
    return band !== undefined ? outputUptake(stockOf(g), band.minStock, band.maxStock) : 1;
  };
```

4. The output gate (line 745) passes `comfortOf`:
   `const gate = GOOD_RECIPES[outputGood] ? inputGate(outputGood, production, stockOf, comfortOf) : 1;`
5. The supply-chain throttledBy loop (lines 779-784) becomes:

```ts
    for (const [input, perOutput] of Object.entries(recipe)) {
      const desired = effectiveProduction * perOutput;
      if (desired <= 0) continue;
      if (inputDrawRatio(stockOf(input), comfortOf(input), desired) < 1) throttledBy.push(input);
    }
```

   (and the gate above it, line 776, passes `comfortOf`).
6. Update the function's doc block (lines ~655-667): callers pass one `bandOf` accessor; draws
   ration on the shared scarcity ramp below each input's comfort stock — no reserve floor.

In `lib/services/universe.ts` (lines 183-222):

```ts
  const marketStock: Record<string, number> = {};
  const bandByGood: Record<string, MarketBand> = {};
  for (const row of marketsBySystem().get(systemId) ?? []) {
    bandByGood[row.goodId] = marketBandForRow(row, GOODS[row.goodId]);
    marketStock[row.goodId] = row.stock;
  }
  ...
  const readout = buildIndustryReadout(
    buildings,
    system.population,
    marketStock,
    (goodKey) => bandByGood[goodKey],
    yields,
  );
```

(with `import type { MarketBand } from "@/lib/engine/market-pricing";` — `marketBandForRow` is
already imported.)

- [ ] **Step 4: Find every other caller**

Run: `Grep buildIndustryReadout` across `lib/`, `app/`, `components/`. Update each call site
(tests included) to the `bandOf` signature. Then `npx tsc --noEmit` — expected clean across the
whole repo (this task closes Task 3's parked breakage).

- [ ] **Step 5: Run tests** — industry + universe test files, then the full `npx vitest run`.
Expected: PASS everywhere except possibly the harness fixtures Task 9 owns.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/industry.ts lib/services/universe.ts lib/engine/__tests__/
git commit -m "feat(economy): industry readout reads the shared scarcity ramp via one band accessor"
```

---

### Task 9: Harness — true-floor pins + fixture sweep

**Files:**
- Modify: `lib/tick-harness/market-analysis.ts:21-37, 127-166`
- Test: `lib/tick-harness/__tests__/market-analysis.test.ts`

**Interfaces:**
- Consumes: nothing new — `WorldMarket` rows off the final world.
- Produces: `stockPins` re-based — a floor pin is stock ≈ 0 (the Shortage regime's resting
  point); ceiling pin unchanged.

- [ ] **Step 1: Write the failing tests**

Rework the pin fixtures in `market-analysis.test.ts`: rows previously placed at `band.minStock`
to assert a floor pin now assert **no** pin there; rows at stock ≈ 0 assert the pin:

```ts
it("counts a market at (or within 2% of max of) zero stock as floor-pinned", () => {});
it("does NOT count the price-saturation point as pinned — deep draws are normal", () => {
  // stock = band.minStock → floorFrac 0
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```ts
/**
 * True when a market's stock sits at the true floor — stock ≈ 0, the Shortage
 * regime's resting point. The price-saturation point (minStock) is a pricing
 * construct, not a clamp; nothing pins there, and deep draws below it are the
 * crisis zone working as designed.
 */
function nearBandFloor(m: WorldMarket, band: { minStock: number; maxStock: number }): boolean {
  return m.stock <= BAND_PROXIMITY_FRAC * band.maxStock;
}
```

Update `computeStockPins`' doc block (lines 129-136): "a pin is a literally empty market, the
unambiguous supply pathology" — drop "the literal clamp" language. `nearBandCeiling` unchanged.

- [ ] **Step 4: Full-suite sweep**

Run: `npx vitest run`
Expected: green. Fix any straggler across the suite whose fixture/assertion still encodes the old
geometry (search hints: `selfLimitingFactor` outside `lib/engine/tick.ts`+`outputUptake`,
`minStock` in test expectations, exact-magnitude equilibrium assertions). Keep every repaired
magnitude assertion **range-y**. The two invariance bridges must pass **unmodified** — if either
fails, the change under test broke band-relativity; fix the code, never the bridge.

- [ ] **Step 5: Commit**

```bash
git add lib/tick-harness/
git commit -m "feat(harness): stock-pin metric reads true floor pins (stock ≈ 0)"
```

---

### Task 10: Sim validation, build gate, PR

**Files:** none new — verification + PR.

- [ ] **Step 1: Baseline vs post-change simulate**

```bash
git stash list   # ensure clean tree
npm run simulate -- --config experiments/examples/equilibrium-calibration.yaml
```

Read the report against PR1's scoped expectations:
- **Must hold:** no NaN/Infinity anywhere; no runaway stock; satisfaction-driven signals improve —
  unrest/striking counts at or below the pre-change run; median price/base in a sane band
  (~0.9–1.15 — the anchor knee rests self-suppliers just above `T`); floor-pin fractions near 0
  outside genuine crises; colonies still populate.
- **Expected and NOT chased (PR2–PR4 scope):** producer decay churn (old uptake signal at the new
  resting point), housing rebuild churn, deficit% shifts from the planner's unchanged
  classification. Note observed values in the PR body under "interim state".

For a second opinion at a different maturity, also run the default quick pass
(`npm run simulate`) and ignore logistics metrics below the warm-up caveat.

- [ ] **Step 2: Build gate + full tests**

```bash
npx vitest run
npx next build --webpack
```

Expected: both green.

- [ ] **Step 3: Push and open the PR (before review, per house process)**

```bash
git push -u origin feat/band-recon-pr1-curves
gh pr create --base feat/band-reconciliation --title "feat(economy): PR1 — knee'd curves, floor retirement, persisted satisfaction" --body "<summary + interim-state notes + sim readouts>"
```

PR body must include: the spec/§ pointers, the interim-state paragraph (decay churn expected until
PR2), and the simulate before/after readout. Then run `/uber-review` (local mode diffs against
`feat/band-reconciliation`); fix cheap in-scope Minor findings in-task.

---

## Self-Review (run after writing, before execution)

- Spec §1 consume-knee, §1 production-knee, §1 satisfaction-persistence (incl. both secondary
  sites), §4 every floor site (tick clamps, shock clamp, input drawable, recipe floor, logistics
  transfer floor, seed clamp), §4 shared scarcity ramp, §8 stock-pin re-base — each maps to a task
  above. §1 selling-signal, §1 regimes/hysteresis, §2, §3, §5, §6, §7 UI, §8 remaining metrics —
  explicitly NOT this PR (umbrella assigns them).
- Type-consistency: `consumptionFactor(stock, comfortStock)`, `productionCeiling(stock,
  targetStock, holdCover)`, `inputDrawRatio(stock, comfortStock, desired)`, `inputGate(goodId,
  effectiveProduction, stockOf, comfortOf)`, `bandOf(goodId) => MarketBand | undefined`,
  `satisfaction?: number` — spelled identically in every task that names them.
