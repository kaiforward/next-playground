# Economy Equilibrium Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe both economy self-limiting factors (production throttle, consumption/satisfaction) to be measured against the days-of-supply **anchor** instead of the **storage ceiling**, so equilibrium stock rests near the anchor (prices lift off the floor, unrest is no longer floored) — then add a price-dispersion metric to the simulator, calibrate `HOLD_COVER`, and pick `ECONOMY_SCALE`.

**Architecture:** The economy tick is a pure engine (`lib/engine/tick.ts` flat + `lib/engine/supply-chain.ts` coupled) driven by per-market `MarketTickEntry` band geometry built in `lib/engine/market-tick-builder.ts`. The change adds the band's `targetStock` (anchor) to the entry and a `holdCover` policy knob to `EconomySimParams`; the produce throttle saturates at `holdCover × targetStock` (the operating ceiling) and the consume/satisfaction factor saturates at `targetStock`. The infrastructure-decay "is this selling?" signal (`outputUptake`) deliberately stays on the full `[minStock, maxStock]` storage band. Live and simulator run the same processor bodies, so one engine change covers both.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, pure engine functions (no DB), the in-memory simulator harness (`npm run simulate`), and the read-only DB audit (`npm run audit:economy`).

## Global Constraints

- **Engine purity** — `lib/engine/tick.ts` and `lib/engine/supply-chain.ts` import **no DB and no constants**. `HOLD_COVER` reaches them only through `EconomySimParams.holdCover` (mirroring how `noiseFraction` already flows). Never `import { HOLD_COVER }` into either engine file.
- **`outputUptake` stays storage-relative** — the produce-direction call in `lib/tick/processors/economy.ts` (currently line ~149) MUST keep `maxStock` as its ceiling. Only the production *throttle* (inside `simulateSystemEconomyTick` / `simulateEconomyTick`) adopts the operating ceiling. This split is the whole point of the decay reconciliation — do not unify them.
- **No `as` type assertions** (except `as const` and `lib/types/guards.ts`); **no `unknown`**; **no postfix `!`** (except the `find(...)!` idiom in tests).
- **`ECONOMY_SCALE` is server-only** — default stays `1` (staged). Do not expose it to the client; do not flip the default in this phase unless Task 6 explicitly decides to.
- **Discriminated unions** for result types; **typed union keys** for maps, never `Record<string, ...>` with loose string keys.
- **Coarse health bar only** for calibration (Task 5/6) — no precision tuning; magnitude assertions stay as ranges, not exact values (perishable pre-SP5).
- **Tests:** `npx vitest run` (unit project has no `DATABASE_URL`; the engine is pure so this is moot, but never statically import `@/lib/prisma` into a unit-tested graph). Commit after each task.
- **Behavioural change** — at `S=1` the post-change economy is **no longer byte-identical** to the pre-change one. Golden-value fixtures that run the tick and assert resulting stock/price WILL move; updating them is expected, not a regression.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `lib/constants/economy.ts` | Live economy-tick knobs (`NOISE_FRACTION`). | **Add** `HOLD_COVER`. |
| `lib/engine/tick.ts` | Pure flat tick: `EconomySimParams`, `MarketTickEntry`, `buildMarketTickEntry`, `selfLimitingFactor`, `outputUptake`, `simulateEconomyTick`. | **Add** `holdCover` param + `targetStock` field; flip produce + consume factors. |
| `lib/engine/supply-chain.ts` | Pure coupled tick (the **live + sim** path): `simulateSystemEconomyTick`. | Flip produce + consume factors. |
| `lib/engine/market-tick-builder.ts` | Builds `MarketTickEntry` from band geometry. | Pass `band.targetStock` through. |
| `lib/tick/processors/economy.ts` | Live/sim processor body: builds entries, runs the coupled tick, derives satisfaction + `outputUptake` signals, wires live `simParams`. | Flip satisfaction call to `targetStock`; add `holdCover` to live `simParams`; comment-guard `outputUptake`. |
| `lib/engine/simulator/constants.ts` | `SimConstants.economy` snapshot + override types. | **Add** `holdCover`. |
| `lib/engine/simulator/economy.ts` | `buildSimParams` for the in-memory tick. | **Add** `holdCover`. |
| `lib/engine/simulator/experiment.ts` | Zod override schema for experiment YAML. | **Add** `holdCover` override. |
| `lib/engine/simulator/types.ts` | `MarketHealthSummary` shape. | **Add** `priceLevels` + `coverLevels`. |
| `lib/engine/simulator/market-analysis.ts` | Derived market-health metrics. | **Add** `computePriceLevels` + `computeCoverLevels`. |
| `scripts/simulate.ts` | Human-readable sim report. | Print the new distributions. |
| `scripts/economy-audit.ts` | Read-only live-DB calibration audit. | Flip the audit's satisfaction formula + copy to anchor-relative. |
| `experiments/equilibrium-calibration.yaml` | Long-run calibration config (transient). | **Create** for Task 5. |
| Tests (`*.test.ts`) | Fixtures + behavioural assertions. | Add `targetStock`/`holdCover`; new behaviour tests; refresh goldens. |

---

## Task 1: Simulator price-level + cover distribution metric (the eyes)

Gives us an in-memory, DB-free read of "are prices off the floor / is there dispersion" before touching the equilibrium. Ports the audit's PRICE LEVELS + per-good cover signals into `MarketHealthSummary`.

**Files:**
- Modify: `lib/engine/simulator/types.ts` (`MarketHealthSummary`, ~line 269)
- Modify: `lib/engine/simulator/market-analysis.ts` (`computeMarketHealth`, ~line 43)
- Modify: `scripts/simulate.ts` (market-health print block, ~line 168)
- Test: `lib/engine/simulator/__tests__/market-analysis.test.ts`

**Interfaces:**
- Consumes: `SimWorld.markets` (`SimMarketEntry`), `curveForGood`/`midPriceAt`/`marketBand` from `lib/engine/market-pricing`, `DIRECTED_LOGISTICS.SURPLUS_MARGIN` (1.4) / `DEFICIT_FRACTION` (0.8).
- Produces: `MarketHealthSummary.priceLevels: PriceLevelSummary` and `MarketHealthSummary.coverLevels: CoverLevelEntry[]`, consumed by `scripts/simulate.ts` and the Task 5 calibration loop.

- [ ] **Step 1: Write the failing tests**

Add to `lib/engine/simulator/__tests__/market-analysis.test.ts` (the `market()` fixture there uses `demandRate: 1, priceFloor: 0.2, priceCeiling: 5.0, basePrice: 100` ⇒ `targetStock = TARGET_COVER × 1 = 40`, and `midPriceAt` ratio `= 40 / stock`):

```ts
describe("computeMarketHealth — price levels", () => {
  it("reports the galaxy-wide price/base distribution and cheap/near/expensive split", () => {
    // ratios: stock 80 → 0.5 (cheap), stock 40 → 1.0 (near), stock 20 → 2.0 (expensive).
    const { priceLevels } = computeMarketHealth(
      world([
        market("sys-1", "water", 80),
        market("sys-2", "water", 40),
        market("sys-3", "water", 20),
      ]),
    );
    expect(priceLevels.median).toBeCloseTo(1.0, 5);
    expect(priceLevels.cheapFrac).toBeCloseTo(1 / 3, 5);
    expect(priceLevels.nearFrac).toBeCloseTo(1 / 3, 5);
    expect(priceLevels.expensiveFrac).toBeCloseTo(1 / 3, 5);
  });
});

describe("computeMarketHealth — cover levels", () => {
  it("reports per-good median cover and surplus/deficit fractions vs the anchor", () => {
    // covers (stock/target=40): 80→2.0 surplus(≥1.4), 40→1.0 balanced, 20→0.5 deficit(<0.8).
    const { coverLevels } = computeMarketHealth(
      world([
        market("sys-1", "water", 80),
        market("sys-2", "water", 40),
        market("sys-3", "water", 20),
      ]),
    );
    const water = coverLevels.find((c) => c.goodId === "water");
    expect(water?.medianCover).toBeCloseTo(1.0, 5);
    expect(water?.surplusFrac).toBeCloseTo(1 / 3, 5);
    expect(water?.deficitFrac).toBeCloseTo(1 / 3, 5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/engine/simulator/__tests__/market-analysis.test.ts`
Expected: FAIL — `priceLevels`/`coverLevels` undefined on the result.

- [ ] **Step 3: Extend the result type**

In `lib/engine/simulator/types.ts`, add above `MarketHealthSummary`:

```ts
export interface PriceLevelSummary {
  /** Median price / basePrice across all markets (galaxy-wide). */
  median: number;
  /** 10th percentile price / basePrice. */
  p10: number;
  /** 90th percentile price / basePrice. */
  p90: number;
  /** Fraction of markets below 0.9× base (cheap — overstocked). */
  cheapFrac: number;
  /** Fraction within 0.9–1.1× base (near the anchor). */
  nearFrac: number;
  /** Fraction above 1.1× base (expensive — scarce). */
  expensiveFrac: number;
}

export interface CoverLevelEntry {
  goodId: string;
  /** Median stock / targetStock (days-of-supply cover) across systems. */
  medianCover: number;
  /** Fraction of markets at/above the surplus margin. */
  surplusFrac: number;
  /** Fraction below the deficit fraction. */
  deficitFrac: number;
}
```

Then add two fields to `MarketHealthSummary`:

```ts
export interface MarketHealthSummary {
  /** Per-good average price standard deviation across systems (high = trade opportunity). */
  priceDispersion: { goodId: string; avgStdDev: number }[];
  /** Per-good average distance of stock from its targetStock at simulation end. */
  stockDrift: { goodId: string; avgStockDrift: number }[];
  /** Per-good fraction of markets clamped at the stock floor / ceiling (supply pathology surface). */
  stockPins: { goodId: string; floorFrac: number; ceilingFrac: number }[];
  /** Galaxy-wide price/base distribution — the floor-pinning signal. */
  priceLevels: PriceLevelSummary;
  /** Per-good stock cover distribution (stock/anchor) — surplus/deficit balance. */
  coverLevels: CoverLevelEntry[];
}
```

- [ ] **Step 4: Implement the metric functions**

In `lib/engine/simulator/market-analysis.ts`, update the import line and `computeMarketHealth`, and add the two functions + helpers:

```ts
import { spotPrice, curveForGood, marketBand, midPriceAt } from "@/lib/engine/market-pricing";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type {
  SimWorld, MarketSnapshot, MarketHealthSummary, SimMarketEntry,
  PriceLevelSummary, CoverLevelEntry,
} from "./types";
```

```ts
export function computeMarketHealth(world: SimWorld): MarketHealthSummary {
  return {
    priceDispersion: computePriceDispersion(world),
    stockDrift: computeStockDrift(world),
    stockPins: computeStockPins(world),
    priceLevels: computePriceLevels(world),
    coverLevels: computeCoverLevels(world),
  };
}
```

```ts
// ── Distribution helpers ────────────────────────────────────────
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// ── Price levels (price / basePrice, galaxy-wide) ───────────────
/**
 * Distribution of price/basePrice across every market — the direct floor-pinning
 * read. Mirrors the DB audit's PRICE LEVELS section: a galaxy stuck cheap (median
 * « 1, high cheapFrac) is the overproduction signature this phase fixes.
 */
function computePriceLevels(world: SimWorld): PriceLevelSummary {
  const ratios: number[] = [];
  for (const m of world.markets) {
    const price = midPriceAt(
      curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult),
      m.stock,
    );
    ratios.push(price / m.basePrice);
  }
  const n = ratios.length || 1;
  const cheap = ratios.filter((r) => r < 0.9).length;
  const expensive = ratios.filter((r) => r > 1.1).length;
  return {
    median: median(ratios),
    p10: quantile(ratios, 0.1),
    p90: quantile(ratios, 0.9),
    cheapFrac: cheap / n,
    nearFrac: (ratios.length - cheap - expensive) / n,
    expensiveFrac: expensive / n,
  };
}

// ── Cover levels (stock / targetStock, per good) ────────────────
/**
 * Per-good distribution of cover = stock / anchor. Surplus/deficit use the same
 * thresholds as directed logistics so the sim read lines up with the live audit.
 */
function computeCoverLevels(world: SimWorld): CoverLevelEntry[] {
  const coversByGood = new Map<string, number[]>();
  for (const m of world.markets) {
    const target = curveForGood(
      m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult,
    ).targetStock;
    if (target <= 0) continue;
    const list = coversByGood.get(m.goodId) ?? [];
    list.push(m.stock / target);
    coversByGood.set(m.goodId, list);
  }
  const result: CoverLevelEntry[] = [];
  for (const [goodId, covers] of coversByGood) {
    const surplus = covers.filter((c) => c >= DIRECTED_LOGISTICS.SURPLUS_MARGIN).length;
    const deficit = covers.filter((c) => c < DIRECTED_LOGISTICS.DEFICIT_FRACTION).length;
    result.push({
      goodId,
      medianCover: median(covers),
      surplusFrac: surplus / covers.length,
      deficitFrac: deficit / covers.length,
    });
  }
  return result.sort((a, b) => b.medianCover - a.medianCover);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/engine/simulator/__tests__/market-analysis.test.ts`
Expected: PASS (all describe blocks, including the existing dispersion/drift/pins).

- [ ] **Step 6: Surface the metric in the sim report**

In `scripts/simulate.ts`, inside the `if (marketHealth)` block, after the per-good loop closes (the line with the row table, ~line 201), add the price-levels block and a `Cover` column. Replace the table header/widths and add a cover map + the print:

```ts
    const dHeaders = ["Good", "Price StdDev", "Stock Drift", "Cover", "Floor %", "Ceil %"];
    const dWidths = [12, 13, 13, 7, 8, 8];
```

```ts
    const coverMap = new Map(marketHealth.coverLevels.map((c) => [c.goodId, c]));
```

In the per-good `row` array, insert the cover cell between Stock Drift and Floor %:

```ts
      const cover = coverMap.get(goodId);
      const row = [
        pad(goodId, dWidths[0]),
        rpad(disp ? disp.avgStdDev.toFixed(1) : "-", dWidths[1]),
        rpad(drift ? (drift.avgStockDrift >= 0 ? "+" : "") + drift.avgStockDrift.toFixed(1) : "-", dWidths[2]),
        rpad(cover ? cover.medianCover.toFixed(2) + "x" : "-", dWidths[3]),
        rpad(pin ? (pin.floorFrac * 100).toFixed(0) + "%" : "-", dWidths[4]),
        rpad(pin ? (pin.ceilingFrac * 100).toFixed(0) + "%" : "-", dWidths[5]),
      ];
```

After the per-good loop, add the headline price-level summary:

```ts
    const pl = marketHealth.priceLevels;
    lines.push("");
    lines.push(
      `Price levels (price/base, all markets): median ${pl.median.toFixed(2)}x  ` +
        `p10 ${pl.p10.toFixed(2)}x  p90 ${pl.p90.toFixed(2)}x`,
    );
    lines.push(
      `  cheap <0.9x: ${(pl.cheapFrac * 100).toFixed(0)}%   ` +
        `near 0.9-1.1x: ${(pl.nearFrac * 100).toFixed(0)}%   ` +
        `expensive >1.1x: ${(pl.expensiveFrac * 100).toFixed(0)}%`,
    );
```

- [ ] **Step 7: Smoke the report and run the full simulator test project**

Run: `npm run simulate` then `npx vitest run lib/engine/simulator`
Expected: the report prints a `Cover` column and a `Price levels` block; all simulator tests PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/engine/simulator/types.ts lib/engine/simulator/market-analysis.ts \
  lib/engine/simulator/__tests__/market-analysis.test.ts scripts/simulate.ts
git commit -m "feat(sim): price-level + cover distribution in market health"
```

---

## Task 2: Anchor-relative production throttle (operating ceiling)

Producers stop filling the warehouse: the production self-limiting factor saturates at `holdCover × targetStock` (the operating ceiling) instead of `maxStock`. Threads the band's `targetStock` onto the tick entry and a `holdCover` knob through `EconomySimParams`.

**Files:**
- Modify: `lib/constants/economy.ts`
- Modify: `lib/engine/tick.ts` (`EconomySimParams`, `MarketTickEntry`, `TickEntryInput`, `buildMarketTickEntry`, `simulateEconomyTick`)
- Modify: `lib/engine/supply-chain.ts` (`simulateSystemEconomyTick`)
- Modify: `lib/engine/market-tick-builder.ts` (`resolveMarketTickEntry`)
- Modify: `lib/tick/processors/economy.ts` (live `simParams`)
- Modify: `lib/engine/simulator/constants.ts`, `lib/engine/simulator/economy.ts`, `lib/engine/simulator/experiment.ts`
- Test: `lib/engine/__tests__/tick.test.ts`, `lib/engine/__tests__/supply-chain.test.ts`, `lib/tick/processors/__tests__/economy.test.ts`, `lib/tick/processors/__tests__/integration/economy.integration.test.ts`

**Interfaces:**
- Consumes: `MarketBand.targetStock` (already returned by `marketBand`), `ECONOMY_CONSTANTS.HOLD_COVER`.
- Produces: `EconomySimParams.holdCover: number`; `MarketTickEntry.targetStock: number`; `TickEntryInput.targetStock: number`. Task 3 consumes `targetStock`; Task 4 relies on the throttle being a *separate* call from `outputUptake`.

- [ ] **Step 1: Write the failing engine test**

In `lib/engine/__tests__/tick.test.ts`, first update the shared fixtures so the new fields exist, then add the operating-ceiling test:

```ts
const PARAMS: EconomySimParams = {
  noiseFraction: 0, // deterministic: no noise unless a test opts in
  holdCover: 1.3,
};

function entry(over: Partial<MarketTickEntry>): MarketTickEntry {
  return {
    goodId: "food",
    stock: 100,
    minStock: 5,
    targetStock: 100,
    maxStock: 200,
    ...over,
  };
}
```

```ts
describe("simulateEconomyTick — operating ceiling", () => {
  it("idles production at holdCover × targetStock, well below maxStock", () => {
    // targetStock 100, holdCover 1.3 → operating ceiling 130 (maxStock is 200).
    const atCeiling = simulateEconomyTick([entry({ productionRate: 10, stock: 130 })], PARAMS);
    expect(atCeiling[0].stock).toBeCloseTo(130, 5); // throttled to ~0 at the operating ceiling

    const below = simulateEconomyTick([entry({ productionRate: 10, stock: 100 })], PARAMS);
    expect(below[0].stock).toBeGreaterThan(100); // still produces below the ceiling
    expect(below[0].stock).toBeLessThan(130);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts -t "operating ceiling"`
Expected: FAIL — production still throttles toward `maxStock`, so a producer at 130 keeps producing.

- [ ] **Step 3: Add the `HOLD_COVER` constant**

In `lib/constants/economy.ts`:

```ts
/** Economy simulation constants — used by the economy tick. */
export const ECONOMY_CONSTANTS = {
  /** Noise as a fraction of the per-entry band width (used by the relative-noise tick). */
  NOISE_FRACTION: 0.02,
  /**
   * Operating-ceiling cover: a producer holds up to HOLD_COVER × the days-of-supply
   * anchor (targetStock) before idling spare capacity. The production self-limiting
   * factor runs over [minStock, HOLD_COVER × targetStock] instead of the storage
   * ceiling, so equilibrium stock rests just above the anchor (price near base) rather
   * than at maxStock (price floored). First-draft 1.3 — calibrated via the simulator.
   */
  HOLD_COVER: 1.3,
} as const;
```

- [ ] **Step 4: Thread `holdCover` and `targetStock` through the pure tick**

In `lib/engine/tick.ts`:

Add to `EconomySimParams`:

```ts
export interface EconomySimParams {
  /** Noise as a fraction of the per-entry band width (maxStock - minStock). */
  noiseFraction: number;
  /**
   * Operating-ceiling cover multiple on targetStock. The production self-limiting
   * factor saturates at holdCover × targetStock, not at maxStock. Passed in (not
   * imported) so this module stays constant-free.
   */
  holdCover: number;
}
```

Add `targetStock` to `MarketTickEntry` (between `minStock` and `maxStock`):

```ts
  /** Stock floor for this market entry — scarcity reserve and buy-price floor. */
  minStock: number;
  /**
   * Days-of-supply anchor (price === basePrice). The produce throttle saturates at
   * holdCover × targetStock; the consume/satisfaction factor saturates at targetStock.
   */
  targetStock: number;
  /** Stock ceiling — storage clamp, noise width, and the decay-uptake band. */
  maxStock: number;
```

Add the same `targetStock` field to `TickEntryInput` (between its `minStock` and `maxStock`), then set it in `buildMarketTickEntry`'s returned object:

```ts
  return {
    goodId: input.goodId,
    stock: input.stock,
    minStock: input.minStock,
    targetStock: input.targetStock,
    maxStock: input.maxStock,
    productionRate,
    consumptionRate,
    volatility: input.volatility,
  };
```

In `simulateEconomyTick`, destructure `holdCover` and use the operating ceiling for the produce factor:

```ts
  const { noiseFraction, holdCover } = params;
```

```ts
    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0) {
      const operatingCeiling = entry.targetStock * holdCover;
      stock += effectiveProduction * selfLimitingFactor(stock, minStock, operatingCeiling, "produce");
    }
```

(Leave the consume line and the noise/clamp lines unchanged in this task — consume moves in Task 3. Noise width and the final clamp keep using `maxStock`.)

- [ ] **Step 5: Apply the same throttle change to the coupled (live) tick**

In `lib/engine/supply-chain.ts`, `simulateSystemEconomyTick`:

```ts
  const { noiseFraction, holdCover } = params;
```

```ts
    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0) {
      const gate = inputGate(entry.goodId, effectiveProduction, stockOf, minStockOf);
      const operatingCeiling = entry.targetStock * holdCover;
      const ceiling = selfLimitingFactor(s, minStock, operatingCeiling, "produce");
      const actualOutput = effectiveProduction * gate * ceiling;
      s += actualOutput;
```

(The recipe input-draw, consume, noise, and clamp lines stay as-is in this task.)

- [ ] **Step 6: Pass the anchor through the builder**

In `lib/engine/market-tick-builder.ts`, `resolveMarketTickEntry`, add `targetStock` to the `buildMarketTickEntry` call:

```ts
  const entry = buildMarketTickEntry({
    goodId: input.goodId,
    stock: input.stock,
    minStock: band.minStock,
    targetStock: band.targetStock,
    maxStock: band.maxStock,
    volatility,
    baseProductionRate: input.baseProductionRate,
    baseConsumptionRate: input.baseConsumptionRate,
    govConsumptionBoost: input.govDef?.consumptionBoosts[input.goodId] ?? 0,
    traits: input.traits,
    productionSuppress: input.productionSuppress,
  });
```

- [ ] **Step 7: Wire `holdCover` into live + sim params**

In `lib/tick/processors/economy.ts`, the module-level `simParams`:

```ts
const simParams: EconomySimParams = {
  noiseFraction: ECONOMY_CONSTANTS.NOISE_FRACTION,
  holdCover: ECONOMY_CONSTANTS.HOLD_COVER,
};
```

In `lib/engine/simulator/constants.ts`, add `holdCover` to the `economy` interface block and to `buildDefaults`:

```ts
  economy: {
    noiseFraction: number;
    /** Operating-ceiling cover multiple (produce throttle saturates at holdCover × anchor). */
    holdCover: number;
    /** Ticks for the system shard to refresh every system once. */
    interval: number;
  };
```

```ts
    economy: {
      noiseFraction: ECONOMY_CONSTANTS.NOISE_FRACTION,
      holdCover: ECONOMY_CONSTANTS.HOLD_COVER,
      interval: ECONOMY_UPDATE_INTERVAL,
    },
```

(`SimConstantOverrides.economy` is already `Partial<SimConstants["economy"]>`, so `holdCover` is automatically overridable — no change there.)

In `lib/engine/simulator/economy.ts`, `buildSimParams`:

```ts
function buildSimParams(constants: SimConstants): EconomySimParams {
  return {
    noiseFraction: constants.economy.noiseFraction,
    holdCover: constants.economy.holdCover,
  };
}
```

In `lib/engine/simulator/experiment.ts`, add to the economy override schema (next to `noiseFraction`, ~line 31):

```ts
    holdCover: z.number().min(1).optional(),
```

- [ ] **Step 8: Enumerate and fix the remaining fixtures with the type-checker**

Run: `npx tsc --noEmit`
Expected: errors at every `MarketTickEntry`/`TickEntryInput` literal missing `targetStock` and every `EconomySimParams` literal missing `holdCover`. Fix each:
- `lib/engine/__tests__/supply-chain.test.ts`: `const PARAMS: EconomySimParams = { noiseFraction: 0, holdCover: 1.3 };` and add `targetStock` to every entry literal (use a value between that entry's `minStock` and `maxStock`; for the `[40, 60]` narrow-band entry use e.g. `targetStock: 50`).
- `lib/tick/processors/__tests__/economy.test.ts` (~line 37): add `holdCover: 1.3` to its `simParams`.
- `lib/tick/processors/__tests__/integration/economy.integration.test.ts` (~line 18): add `holdCover: ECONOMY_CONSTANTS.HOLD_COVER` to its `simParams`.

Re-run `npx tsc --noEmit` until clean.

- [ ] **Step 9: Add the live-path operating-ceiling test**

In `lib/engine/__tests__/supply-chain.test.ts`, add a tier-0 (no-recipe) producer test mirroring the flat one (use the file's existing entry-builder/helper shape; a single tier-0 entry has `inputGate === 1`):

```ts
it("idles production at the operating ceiling in the coupled tick", () => {
  // tier-0 good (no recipe) → input gate 1. holdCover 1.3 × targetStock 100 = 130.
  const out = simulateSystemEconomyTick(
    [{ goodId: "ore", stock: 130, minStock: 5, targetStock: 100, maxStock: 200, volatility: 1, productionRate: 10 }],
    PARAMS,
    noRng,
  );
  expect(out[0].stock).toBeCloseTo(130, 5); // throttled to ~0 at the operating ceiling
});
```

(If `ore` has a recipe in `GOOD_RECIPES`, swap it for any tier-0 good id used elsewhere in this test file.)

- [ ] **Step 10: Run the affected test files**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts lib/engine/__tests__/supply-chain.test.ts lib/tick/processors/__tests__/economy.test.ts`
Expected: PASS. (The pre-existing production test "self-limiting near the ceiling" still passes: at stock 199 the factor is already 0 against the 130 ceiling; at 100 it still produces.)

- [ ] **Step 11: Commit**

```bash
git add lib/constants/economy.ts lib/engine/tick.ts lib/engine/supply-chain.ts \
  lib/engine/market-tick-builder.ts lib/tick/processors/economy.ts \
  lib/engine/simulator/constants.ts lib/engine/simulator/economy.ts \
  lib/engine/simulator/experiment.ts lib/engine/__tests__/tick.test.ts \
  lib/engine/__tests__/supply-chain.test.ts lib/tick/processors/__tests__/economy.test.ts \
  lib/tick/processors/__tests__/integration/economy.integration.test.ts
git commit -m "feat(economy): anchor-relative production throttle (operating ceiling)"
```

---

## Task 3: Anchor-relative consumption + satisfaction (saturate at the anchor)

The consume-side self-limiting factor saturates at `targetStock` (the anchor) instead of `maxStock`: consumption runs at full rate once stock meets days-of-supply, and the satisfaction signal reads fully content there — lifting the unrest floor. Both consume call sites (drainage in the tick, the satisfaction signal in the processor) move together so satisfaction stays a faithful delivered/demanded measure.

**Files:**
- Modify: `lib/engine/tick.ts` (`simulateEconomyTick` consume line)
- Modify: `lib/engine/supply-chain.ts` (`simulateSystemEconomyTick` consume line)
- Modify: `lib/tick/processors/economy.ts` (satisfaction signal, ~line 142)
- Test: `lib/engine/__tests__/tick.test.ts`, `lib/tick/processors/__tests__/economy.test.ts`

**Interfaces:**
- Consumes: `MarketTickEntry.targetStock` (from Task 2).
- Produces: no new types — changes the saturation point of the existing consume factor. `outputUptake` (produce-direction, used by decay) is untouched and stays on `maxStock`.

- [ ] **Step 1: Write the failing engine test**

In `lib/engine/__tests__/tick.test.ts`:

```ts
describe("simulateEconomyTick — anchor-relative consumption", () => {
  it("consumes at the full nominal rate once stock is at/above the anchor", () => {
    // targetStock 100: consume factor = 1 at the anchor and above (clamped).
    const atAnchor = simulateEconomyTick([entry({ consumptionRate: 10, stock: 100 })], PARAMS);
    expect(100 - atAnchor[0].stock).toBeCloseTo(10, 5);

    const above = simulateEconomyTick([entry({ consumptionRate: 10, stock: 150 })], PARAMS);
    expect(150 - above[0].stock).toBeCloseTo(10, 5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts -t "anchor-relative consumption"`
Expected: FAIL — consume still saturates at `maxStock` (200), so at stock 100 the factor is `sqrt((100-5)/(200-5)) ≈ 0.70`, draining ~7, not 10.

- [ ] **Step 3: Flip the consume factor in both engine ticks**

In `lib/engine/tick.ts`, `simulateEconomyTick`:

```ts
    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      stock -= effectiveConsumption * selfLimitingFactor(stock, minStock, entry.targetStock, "consume");
    }
```

In `lib/engine/supply-chain.ts`, `simulateSystemEconomyTick`:

```ts
    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      s -= effectiveConsumption * selfLimitingFactor(s, minStock, entry.targetStock, "consume");
    }
```

(Update the module header comments in both files that say consumption self-limits "near the floor" / clamps to `[minStock, maxStock]` only if needed — the floor behaviour is unchanged; only the saturation point moved to the anchor. The noise width and final clamp still use `maxStock`.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts`
Expected: PASS. The pre-existing consumption tests still pass (at stock 6 the factor is `sqrt((6-5)/(100-5)) ≈ 0.10`, draining ~1, clamped at the floor 5).

- [ ] **Step 5: Flip the satisfaction signal in the processor**

In `lib/tick/processors/economy.ts`, the satisfaction computation (~line 142) — change the ceiling from `maxStock` to `targetStock`:

```ts
      const satisfaction = selfLimitingFactor(simulated[i].stock, tickEntries[i].minStock, tickEntries[i].targetStock, "consume");
```

Leave the `outputUptake(...)` call below it (~line 149) **exactly as is** — it must keep `tickEntries[i].maxStock` (guarded in Task 4).

- [ ] **Step 6: Write/extend the processor satisfaction test**

In `lib/tick/processors/__tests__/economy.test.ts`, add a test that a system whose consumed good sits at/above its anchor reports ~zero dissatisfaction (use the file's existing world/harness setup for `runEconomyProcessor`; the returned `economySignals.dissatisfactionBySystem` is the signal). Concrete assertion to add:

```ts
it("reports a well-supplied system (stock at the anchor) as fully content", async () => {
  // Build a one-system world with a single consumed good seeded at its targetStock,
  // run runEconomyProcessor, and read the dissatisfaction signal.
  const result = await runEconomyProcessor(world, ctx, params);
  const d = result.economySignals?.dissatisfactionBySystem.get(systemId) ?? 1;
  expect(d).toBeLessThan(0.05); // at the anchor → content (was ~0.18 pre-change)
});
```

Match `world`/`ctx`/`params`/`systemId` to the harness already used by the other tests in that file; seed the consumed good's stock to its `targetStock` (`TARGET_COVER × demandRate`).

- [ ] **Step 7: Run the affected test files**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts lib/engine/__tests__/supply-chain.test.ts lib/tick/processors/__tests__/economy.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/engine/tick.ts lib/engine/supply-chain.ts lib/tick/processors/economy.ts \
  lib/engine/__tests__/tick.test.ts lib/tick/processors/__tests__/economy.test.ts
git commit -m "feat(economy): anchor-relative consumption + satisfaction (lifts unrest floor)"
```

---

## Task 4: Reconcile infrastructure-decay's uptake signal (guard the split)

The production *throttle* (now anchor-relative) and the decay *uptake* signal answer different questions and must stay separate calls: the throttle is "make more now?" (anchor-relative); `outputUptake` is "is output genuinely stuck against the physical wall?" (storage-relative). The code is already split — this task locks it with a regression test and a clarifying comment so a future refactor can't accidentally move uptake onto the operating ceiling and tear down healthy exporters.

**Files:**
- Modify: `lib/tick/processors/economy.ts` (comment only, at the `outputUptake` call)
- Test: `lib/engine/__tests__/tick.test.ts`

**Interfaces:**
- Consumes: `outputUptake(stock, minStock, maxStock)` from `lib/engine/tick.ts` (unchanged).
- Produces: nothing new — a guard test + comment.

- [ ] **Step 1: Write the guard test**

In `lib/engine/__tests__/tick.test.ts` (the file already imports `outputUptake`):

```ts
describe("outputUptake — stays storage-relative (decay signal)", () => {
  it("reads a producer at the operating ceiling as selling, only a storage-pinned glut as stuck", () => {
    // Operating ceiling (1.3 × target 100 = 130) is well below maxStock 200. A healthy
    // exporter resting near the ceiling must NOT read as a glut, or infra-decay tears it
    // down. uptake is measured on the full [minStock, maxStock] storage band.
    const healthy = outputUptake(130, 5, 200); // at the operating ceiling
    expect(healthy).toBeGreaterThan(0.5); // clearly "selling"

    const glut = outputUptake(199, 5, 200); // pinned at the storage ceiling
    expect(glut).toBeLessThan(0.1); // genuinely stuck → decay is correct here
  });
});
```

- [ ] **Step 2: Run it to verify it passes (the split already holds)**

Run: `npx vitest run lib/engine/__tests__/tick.test.ts -t "stays storage-relative"`
Expected: PASS — `outputUptake(130,5,200)=sqrt(70/195)≈0.60`, `outputUptake(199,5,200)=sqrt(1/195)≈0.07`. (If this FAILS, the throttle change leaked into `outputUptake` — fix that before proceeding.)

- [ ] **Step 3: Add the clarifying comment at the call site**

In `lib/tick/processors/economy.ts`, immediately above the `outputUptake(...)` call (~line 149):

```ts
    // outputUptake stays on the FULL [minStock, maxStock] storage band — NOT the
    // operating ceiling. It is decay's "is output stuck against the physical wall?"
    // signal; a healthy exporter resting at the operating ceiling must read as selling,
    // or infrastructure-decay would tear it down. The throttle and this signal are
    // deliberately separate calls (see docs/planned/economy-equilibrium-rework.md).
    const productionRate = tickEntries[i].productionRate;
    if (productionRate != null && productionRate > 0) {
      const uptake = outputUptake(simulated[i].stock, tickEntries[i].minStock, tickEntries[i].maxStock);
```

- [ ] **Step 4: Run the decay + economy processor tests**

Run: `npx vitest run lib/engine/__tests__/infrastructure-decay.test.ts lib/tick/processors/__tests__/infrastructure-decay.test.ts lib/tick/processors/__tests__/economy.test.ts`
Expected: PASS (decay behaviour is unchanged — `outputUptake` still uses the storage band).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/__tests__/tick.test.ts lib/tick/processors/economy.ts
git commit -m "test(economy): guard infra-decay uptake stays storage-relative"
```

---

## Task 5: Calibrate `HOLD_COVER` against the simulator (coarse health bar)

A measurement/tuning loop, not TDD — iterate `HOLD_COVER` against a long-run sim until the coarse health bar is met. The user runs and judges the long sim (per project preference); you set up the config, propose values, and read the new metric. The satisfaction cover is fixed at the anchor (1.0); only `HOLD_COVER` is tuned here. Do **not** chase precise numbers — perishable pre-SP5.

**Files:**
- Create: `experiments/equilibrium-calibration.yaml`
- Modify (final value only): `lib/constants/economy.ts` (`HOLD_COVER`)

**Interfaces:**
- Consumes: `marketHealth.priceLevels` / `coverLevels` (Task 1), the Population & Unrest report block (`scripts/simulate.ts`).
- Produces: a calibrated `HOLD_COVER` value committed to `lib/constants/economy.ts`.

- [ ] **Step 1: Create a long-run calibration config**

Create `experiments/equilibrium-calibration.yaml` (enough ticks to equilibrate — far past the 500-tick quick run; greedy + random bots for the greedy≫random check). Match the YAML shape the experiment loader expects (see `lib/engine/simulator/experiment.ts` for the schema; `holdCover` is now an allowed `economy` override):

```yaml
label: equilibrium-calibration
tickCount: 3000
seed: 42
bots:
  - strategy: greedy
    count: 8
  - strategy: random
    count: 8
overrides:
  economy:
    holdCover: 1.3
```

- [ ] **Step 2: Run the baseline calibration sim**

Run: `npm run simulate -- --config experiments/equilibrium-calibration.yaml`
Read from the report: the `Price levels` block (median/p10/p90, cheap/near/expensive %), the per-good `Cover` column, and the Population & Unrest block (mean/max unrest, striking count, growth %).

- [ ] **Step 3: Judge against the coarse health bar**

Compare to the pre-change pathology (audit baseline: ~90% cheap, median 0.63×, unrest floored). Targets (coarse, directional — not exact):
- **Prices off the floor:** `priceLevels.median` moved toward ~1.0; `cheapFrac` dropped sharply from ~0.9; a real p10–p90 spread exists (dispersion present).
- **No pinning:** `stockPins` floor/ceiling fractions low; no good fully floor- or ceiling-pinned.
- **Unrest calm:** mean unrest low, few/zero striking systems; growth % sane (no runaway, no mass collapse).
- **Liquidity / greedy≫random:** greedy strategy aggregate clearly out-earns random.
- **No NaN / runaway** anywhere in the report.

- [ ] **Step 4: Tune and re-run until the bar is met**

Adjust `holdCover` in the YAML (design range ~1.2–1.5; higher holds more stock → cheaper/calmer, lower → tighter/pricier) and re-run Step 2. Iterate with the user until the coarse bar holds.
- Edge case: if unrest reads *too* calm or too hot at the right price level, the satisfaction cover (currently fixed at the anchor) is the secondary knob — introduce a `SATISFACTION_COVER` constant **only if needed** (YAGNI), threading it like `holdCover`. Default behaviour (saturate exactly at the anchor) is the design's intent; prefer leaving it.

- [ ] **Step 5: Commit the calibrated value**

Set the final `HOLD_COVER` in `lib/constants/economy.ts`, then:

```bash
git add lib/constants/economy.ts experiments/equilibrium-calibration.yaml
git commit -m "chore(economy): calibrate HOLD_COVER to the coarse health bar"
```

(Per project convention, `experiments/` holds saved sim runs — keep the config; it is the reproducible calibration record.)

---

## Task 6: Pick `ECONOMY_SCALE` (S) on the settled economy — stage it

With the equilibrium settled, measure the baseline export/import magnitude distribution and pick `S` so typical flows land in the **hundreds–thousands** (legibility). Because the knob is ratio-invariant (`economy-scale-invariance.test.ts`), this is a linear solve off the baseline + a validation run — not a search. Lean: **stage** it (record the value; keep the live default at `S=1`).

**Files:**
- Modify (doc): `docs/planned/economy-equilibrium-rework.md` (record the chosen S + decision)
- No production code change if staged (the `ECONOMY_SCALE` knob already exists and defaults to 1).

**Interfaces:**
- Consumes: `results.finalWorld.flowEvents` (each `SimFlowEvent` has `quantity`) from the settled calibration run; the `economy-scale-invariance.test.ts` ratio proof.
- Produces: a documented `S` value (staged).

- [ ] **Step 1: Measure baseline flow magnitudes from the settled sim**

Write a throwaway inspection script in the session scratchpad (NOT committed — per project convention one-off diagnostics never land in `scripts/`), e.g. `<session-scratchpad>/measure-flows.ts`.

It should import the sim runner, run the `equilibrium-calibration.yaml` config, and print the median / p90 of `results.finalWorld.flowEvents.map((f) => f.quantity)` (and, optionally, median per-market production rate). Run it with `npx tsx --tsconfig tsconfig.json <scratch path>`.

(Alternative source: the `npm run audit:economy` "flow size" line on a matured DB — use whichever is available; the sim is the in-the-loop instrument in dev.)

- [ ] **Step 2: Solve for S**

`S = round(targetMagnitude / baselineMedianFlow)`, choosing `targetMagnitude` so the median typical flow lands in the hundreds–thousands (e.g. if the baseline median flow is ~3 units, `S ≈ 100–300`). Pick a clean round value.

- [ ] **Step 3: Validate ratio-invariance at the chosen S**

Run: `npx vitest run lib/engine/__tests__/economy-scale-invariance.test.ts`
Expected: PASS (the proof is S-agnostic; this confirms the equilibrium change didn't break ratio-invariance). Optionally run `npm run simulate -- --config experiments/equilibrium-calibration.yaml` with `ECONOMY_SCALE` set in a local `.env` to the chosen S and confirm `priceLevels.median` is unchanged vs S=1 (prices invariant, magnitudes scaled).

- [ ] **Step 4: Record the decision (staged)**

In `docs/planned/economy-equilibrium-rework.md`, under "### 3. Pick `S`", append the chosen value and the stage decision (default stays 1; flip deferred to SP3 unless the user wants bigger dev-UI numbers now). Keep `ECONOMY_SCALE` server-only and default `1`.

- [ ] **Step 5: Commit**

```bash
git add docs/planned/economy-equilibrium-rework.md
git commit -m "docs(economy): record calibrated ECONOMY_SCALE (staged, default 1)"
```

---

## Task 7: Update the economy audit + DB cross-check

The audit is the calibration instrument that must reflect the shipped mechanic: its "real satisfaction" recompute currently uses the storage-ceiling formula. Flip it to anchor-relative so the audit's satisfaction/unrest read matches the live economy, then run it on a matured DB as the final real-universe cross-check.

**Files:**
- Modify: `scripts/economy-audit.ts` (satisfaction recompute ~line 246; explanatory copy ~lines 270–272)

**Interfaces:**
- Consumes: `selfLimitingFactor` + per-market band (`marketBandForRow`) already imported in the audit.
- Produces: an audit whose satisfaction column matches the live anchor-relative signal.

- [ ] **Step 1: Flip the audit's satisfaction formula to the anchor**

In `scripts/economy-audit.ts`, the per-good satisfaction recompute (~line 245):

```ts
      // real satisfaction = consume-direction self-limiting factor (exactly economy.ts),
      // anchor-relative: saturates at the days-of-supply anchor (target), for civilian goods.
      if (civ > 0 && band.target > band.min) {
        const sat = selfLimitingFactor(m.stock, band.min, band.target, "consume");
        a.satisfactions.push(sat);
        satGoods.push({ satisfaction: sat, demanded: civ });
        ra.sumSat += sat; ra.nSat++;
      }
```

- [ ] **Step 2: Update the explanatory copy**

Replace the now-stale SATISFACTION header/note (~lines 270–272) to describe the anchor-relative behaviour:

```ts
  L.push(`  SATISFACTION (= √((stock−min)/(target−min)), the consume self-limiting factor — reaches 1.0 at the days-of-supply ANCHOR):`);
  L.push(`    mean per-good satisfaction: ${meanSat.toFixed(3)}   →  equilibrium unrest target D (mean): ${meanD.toFixed(3)}   vs actual mean unrest ${meanUnrest.toFixed(3)}`);
  L.push(`    NB: a good at/above its anchor (stock≥target) now reads fully satisfied → unrest is no longer floored by abundance the model refused to credit.`);
```

- [ ] **Step 3: Type-check the audit script**

Run: `npx tsc --noEmit`
Expected: clean (no new errors from the audit edit).

- [ ] **Step 4: Run the audit on a matured DB (final cross-check)**

Run: `npm run audit:economy` (requires a dev DB matured many ticks past the equilibrium change; the user runs/judges this).
Expected (coarse): PRICE LEVELS median materially above the pre-change 0.63× and toward base; cheap% well below the pre-change ~90%; regional price spread present; unrest calm; no good floor/ceiling pinned galaxy-wide. Confirm it lines up with the sim read from Task 5.

- [ ] **Step 5: Commit**

```bash
git add scripts/economy-audit.ts
git commit -m "chore(audit): anchor-relative satisfaction in economy audit"
```

---

## Task 8: Full-suite verification & golden refresh

The behavioural change moves equilibrium stock (and therefore any tick-derived golden values) even at S=1. Sweep the whole suite, refresh the fixtures that legitimately moved, and confirm the build is green before declaring done.

**Files:**
- Modify (as needed): `lib/tick/processors/__tests__/price-snapshots.test.ts`, `lib/tick/processors/__tests__/__tests__` integration tests, any population/economy processor tests with golden stock/price/dissatisfaction values.

**Interfaces:**
- Consumes: the full test suite + build.
- Produces: a green suite + build.

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: identify any FAILs. For each, decide: is it a golden value that legitimately moved because equilibrium stock is now anchor-relative (refresh it), or a real regression (fix the code)? Likely candidates: `price-snapshots.test.ts` (prices derive from post-tick stock), processor integration tests, any population test that runs the economy then asserts dissatisfaction/unrest.

- [ ] **Step 2: Refresh legitimately-moved goldens**

Update only the values that moved due to the documented equilibrium change. Keep magnitude assertions as **ranges**, not exact equalities, where the project already does so (coarse-calibration preference). Do not loosen assertions that were testing a real invariant.

- [ ] **Step 3: Confirm ratio-invariance still holds**

Run: `npx vitest run lib/engine/__tests__/economy-scale-invariance.test.ts`
Expected: PASS — scale stays ratio-invariant on top of the new equilibrium.

- [ ] **Step 4: Production build**

Run: `npx tsc --noEmit && npm run build`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(economy): refresh goldens for anchor-relative equilibrium"
```

- [ ] **Step 6: Ship checklist (when merging, not part of the per-task loop)**

At merge time, per CLAUDE.md docs convention: promote `docs/planned/economy-equilibrium-rework.md` to `docs/active/gameplay/` (de-PR-ified, with the final `HOLD_COVER`/`S` values), delete this build plan (`docs/build-plans/economy-equilibrium-rework-plan.md`), and update `docs/SPEC.md`'s economy section if the headline mechanics changed. Merge shared→main as squash or fast-forward (never a merge commit).

---

## Self-Review

**Spec coverage** (design § "The change" / "Sequencing"):
1. Simulator dispersion metric (§4) → **Task 1**. ✓
2. Anchor-relative production throttle (§1) → **Task 2**. ✓
3. Infra-decay `outputUptake` reconciliation (§"Key interactions") → **Task 4** (guard + comment; code already split). ✓
4. Anchor-relative satisfaction *and* consumption (§2; the worked-example requires consumption at full rate at the anchor) → **Task 3**. ✓
5. Iterate `HOLD_COVER` + satisfaction cover to the coarse health bar (§"Testing", §"Sequencing 4") → **Task 5**. ✓
6. Pick `S`, stage-vs-flip (§3) → **Task 6**. ✓
7. DB-audit cross-check (§"Sequencing 6") + audit reflects the new mechanic → **Task 7**. ✓
8. Test-suite / golden refresh, invariance test stays valid (§"Testing & validation") → **Task 8**. ✓

**Out of scope (correctly absent):** cost-of-capacity / upkeep / treasury (SP5); production-ratio rebalancing (`OUTPUT_PER_UNIT` : `labourDemand` : `GOOD_CONSUMPTION` — a later balance pass alongside SP4); contract-model (SP3); ship re-pricing (SP4). No task touches these.

**Type consistency:** `targetStock: number` is added identically to `MarketTickEntry`, `TickEntryInput`, and set from `band.targetStock` (the field `marketBand` already returns). `holdCover: number` is added to `EconomySimParams`, `SimConstants["economy"]`, `buildSimParams`, the live `simParams`, and the experiment override schema — every `EconomySimParams` constructor is enumerated in Task 2 Step 8 via `tsc`. The produce throttle uses `targetStock * holdCover`; the consume factor and satisfaction signal use `targetStock`; `outputUptake` keeps `maxStock`. Names are consistent across tasks.

**Placeholder scan:** every code step shows real code; fixture sites that can't be exhaustively listed without reading each file are enumerated deterministically by `npx tsc --noEmit` (Task 2 Step 8) and the test runs — not left as "update the tests."

**Invariant assumption (noted, not coded):** `operatingCeiling = holdCover × targetStock < maxStock` holds because `maxStock ≥ targetStock / priceFloor^(1/k) ≥ 2 × targetStock` for every good (`priceFloor ≤ 0.5`), and `holdCover` is ~1.3 (< 2). The `[minStock, maxStock]` clamp remains the physical backstop regardless, so no explicit clamp on `operatingCeiling` is needed (KISS).
