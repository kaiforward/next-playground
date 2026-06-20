# SP3 Part 3 — Supply-Chain Input-Gating Cascade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 26 independent markets into a coupled supply chain — tier-1+ production consumes real input goods from local stock, so shortages cascade downstream and days-of-supply pricing reflects total (civilian + industrial) demand.

**Architecture:** A new pure engine (`lib/engine/supply-chain.ts`) simulates one system's markets in **recipe-topological order**, maintaining a live per-system stock map: each producing good draws its recipe inputs from the live local stock (only the portion *above the stock floor*), throttles its output by the binding input's availability (`inputGate`), drains inputs proportional to actual output, then applies civilian consumption + noise + clamp — reusing `selfLimitingFactor` from `tick.ts`. The economy processor groups its region's already-resolved `MarketTickEntry`s by `systemId` and calls this engine, **replacing** the flat `simulateEconomyTick` call. No `EconomyWorld` interface change is needed for the tick because production *capacity* is already folded into each entry's `productionRate`; the gate needs only the entries + the constant `GOOD_RECIPES`. Separately, the population processor's per-tick `demandRate` rewrite gains a production-input term (needs building counts → extend `PopulationWorld`). The simulator inherits gating for free (shared processor body).

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Prisma 7 (PostgreSQL), Next.js 16 App Router, TanStack Query v5.

## Global Constraints

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown`** anywhere (Record<string, unknown> banned). Use typed good-keyed records.
- **Engine functions are pure** — no DB imports, no Prisma. `lib/engine/supply-chain.ts` and `lib/engine/industry.ts` may import constants (`GOOD_RECIPES`, `BUILDING_TYPES`) but never `@/lib/prisma`.
- **Never static-import `@/lib/prisma`** into a unit-tested module graph — the `unit` Vitest project has no `DATABASE_URL` and `lib/prisma.ts` throws at module load. Adapters are fine (they take a `tx`); engine modules must stay prisma-free.
- **Stock invariant:** every market stock stays in `[ECONOMY_CONSTANTS.MIN_LEVEL, ECONOMY_CONSTANTS.MAX_LEVEL]` (currently `[5, 200]`) after every tick — input draws must not breach the floor.
- **Bulk DB writes only** inside the tick transaction — `unnest()` UPDATE / `createMany`, never per-row writes in a loop (10K-scale timeout).
- **`find(...)!` postfix `!` in tests is the project idiom** — acceptable.
- **Calibration is coarse** — SP5 reshapes the equilibrium. Recipe quantities, `outputPerUnit`, and the triangle knobs are sim-discovered; do not over-tune. Residual staple stock-drift is a known SP5 item — do not chase it.
- **This whole Part is ONE PR** into the shared `feat/economy-sp3` branch. Phase boundaries below are check-in **PAUSES**, not PRs. Do NOT open phase PRs.

---

## File Structure

**New files:**
- `lib/engine/supply-chain.ts` — the coupled per-system cascade engine (`inputGate`, `simulateSystemEconomyTick`, `simulateCoupledEconomyTick`). Pure.
- `lib/engine/__tests__/supply-chain.test.ts` — engine unit tests.
- `lib/constants/__tests__/production-order.test.ts` — topo-order test (if not folded into recipes.test.ts).
- `components/system/industry-panel.tsx` — the Industrial Base / Supply-Chain readout card.
- `lib/hooks/use-system-industry.ts` — TanStack Query hook for the industry read path.
- `app/api/game/systems/[id]/industry/route.ts` — thin read route.

**Modified files:**
- `lib/constants/recipes.ts` — add `PRODUCTION_GOOD_ORDER` (topo-sort) + `GOOD_RECIPE_CONSUMERS` (reverse index).
- `lib/engine/industry.ts` — add `inputDemandForGood`.
- `lib/tick/processors/economy.ts` — group resolved entries by system; call `simulateCoupledEconomyTick`.
- `lib/tick/world/population-world.ts` — extend `PopulationWorld` with `getIndustry`.
- `lib/tick/adapters/prisma/population.ts` + `lib/tick/adapters/memory/population.ts` — load buildings; fold input demand into `rewriteDemandRates`.
- `lib/engine/simulator/economy.ts` / sim assertions — extend equilibrium checks.
- `lib/constants/industry.ts` / `recipes.ts` — coarse calibration of `OUTPUT_OVERRIDES` / recipe quantities after the sim run.
- `lib/services/universe.ts` (or the system read service) — expose industry readout data.
- `docs/active/gameplay/economy.md`, `docs/SPEC.md`, `docs/planned/economy-simulation-supply-chain.md` — doc finalization.

---

## Key formulas (locked)

For a producing good *g* at a system, within the coupled per-system tick (processed in recipe-topological order, maintaining a live `stock` map):

```
effectiveProduction_g = (entry.productionRate ?? 0) × (entry.productionMult ?? 1)
                        # capacity × strike-suppress × event-mult  (already in the entry)

# desired (uncapped-by-input) draw of each input i of g's recipe:
desiredDraw_i = effectiveProduction_g × recipe_g[i]

# only stock ABOVE the floor is drawable — this is what keeps the floor invariant:
drawable_i    = max(0, liveStock_i − minLevel)
ratio_i       = desiredDraw_i > 0 ? clamp(drawable_i / desiredDraw_i, 0, 1) : 1
inputGate_g   = min over inputs i of ratio_i        # tier-0 / no-recipe → 1

# actual output also self-limits near the ceiling (existing sqrt curve):
ceiling_g     = selfLimitingFactor(liveStock_g, minLevel, maxLevel, "produce")
actualOutput_g = effectiveProduction_g × inputGate_g × ceiling_g

liveStock_g  += actualOutput_g
for each input i:  liveStock_i −= recipe_g[i] × actualOutput_g     # ≤ drawable_i ⇒ floor holds

# then civilian consumption (unchanged), noise, clamp — exactly as the flat tick:
effectiveConsumption_g = (entry.consumptionRate ?? 0) × (entry.consumptionMult ?? 1)
liveStock_g -= effectiveConsumption_g × selfLimitingFactor(liveStock_g, minLevel, maxLevel, "consume")
liveStock_g  = clamp(liveStock_g + noise, minLevel, maxLevel)
```

**Why drawable-above-floor:** `draw_i = recipe_g[i] × actualOutput_g = desiredDraw_i × inputGate_g × ceiling_g ≤ desiredDraw_i × ratio_i ≤ drawable_i`, so `liveStock_i − draw_i ≥ minLevel` with no re-clamp. The gate honestly reflects *usable* input (stock above the floor), and there is no below-floor overshoot for the next tick to recover — this is the deliberate resolution of the spec §16 "input-gate / self-limiting interaction" risk.

**Why topological order, not literal T0→T1→T2:** the recipe DAG has intra-`GoodTier` edges (e.g. `metals`→`alloys`→`hull_plating` are all `GoodTier 1`; `gas`→`chemicals`→`munitions`). Ordering by the coarse market tier would give those edges a one-tick lag. Ordering by a true topological sort of `GOOD_RECIPES` (every good after all its recipe inputs) guarantees same-tick propagation for *all* edges and subsumes the spec's "T0→T1→T2" shorthand. The DAG is already validated acyclic by `recipes.test.ts`.

**demandRate production-input term (§8):** for good *g*,
```
demandRate_g = perCapitaNeed_g × population
             + Σ_{t : g ∈ recipe_t}  buildingProduction(buildings, t, fulfillment) × recipe_t[g]
```
The input term uses the *capacity* (`buildingProduction`, i.e. count × outputPerUnit × labourFulfillment) — stable, no strike/event/gate twitch — per spec §8 ("depends on the industrial base + labour, not on this tick's stock").

---

## Phase A — Production order + pure input-demand helper

*No wiring; everything stays inert. Existing suite must stay green.*

### Task A1: Recipe-topological production order

**Files:**
- Modify: `lib/constants/recipes.ts`
- Test: `lib/constants/__tests__/recipes.test.ts` (extend existing)

**Interfaces:**
- Produces: `export const PRODUCTION_GOOD_ORDER: string[]` — all 26 good ids such that every good appears after all its recipe inputs (tier-0 goods first). `export const GOOD_RECIPE_CONSUMERS: Readonly<Record<string, Array<{ goodId: string; perOutput: number }>>>` — reverse index: for each input good, the list of goods that consume it and how much per unit of their output.

- [ ] **Step 1: Write the failing test**

```typescript
// in recipes.test.ts
import { GOOD_RECIPES, PRODUCTION_GOOD_ORDER, GOOD_RECIPE_CONSUMERS } from "@/lib/constants/recipes";
import { GOOD_NAMES } from "@/lib/constants/goods";

describe("PRODUCTION_GOOD_ORDER", () => {
  it("includes every good exactly once", () => {
    expect([...PRODUCTION_GOOD_ORDER].sort()).toEqual([...GOOD_NAMES].sort());
  });

  it("places every good after all of its recipe inputs", () => {
    const pos = new Map(PRODUCTION_GOOD_ORDER.map((g, i) => [g, i]));
    for (const [good, recipe] of Object.entries(GOOD_RECIPES)) {
      for (const input of Object.keys(recipe)) {
        expect(pos.get(input)!).toBeLessThan(pos.get(good)!);
      }
    }
  });

  it("orders the metals→alloys→hull_plating intra-tier chain correctly", () => {
    const pos = new Map(PRODUCTION_GOOD_ORDER.map((g, i) => [g, i]));
    expect(pos.get("metals")!).toBeLessThan(pos.get("alloys")!);
    expect(pos.get("alloys")!).toBeLessThan(pos.get("hull_plating")!);
  });
});

describe("GOOD_RECIPE_CONSUMERS", () => {
  it("lists metals as consumed by alloys at its recipe quantity", () => {
    const consumers = GOOD_RECIPE_CONSUMERS["metals"] ?? [];
    const alloys = consumers.find((c) => c.goodId === "alloys");
    expect(alloys?.perOutput).toBe(GOOD_RECIPES["alloys"]["metals"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/constants/__tests__/recipes.test.ts`
Expected: FAIL — `PRODUCTION_GOOD_ORDER` / `GOOD_RECIPE_CONSUMERS` undefined.

- [ ] **Step 3: Implement (append to `lib/constants/recipes.ts`)**

```typescript
import { GOOD_NAMES } from "@/lib/constants/goods";

/**
 * Goods in recipe-topological order: every good appears after all of its
 * recipe inputs, so a freshly-produced input feeds its consumer the same tick.
 * Subsumes the coarse T0→T1→T2 ordering and handles intra-tier edges
 * (metals→alloys→hull_plating). Kahn's algorithm over GOOD_RECIPES (validated
 * acyclic by this file's tests). Stable on GOOD_NAMES order for determinism.
 */
export const PRODUCTION_GOOD_ORDER: string[] = (() => {
  const indeg = new Map<string, number>(GOOD_NAMES.map((g) => [g, 0]));
  for (const good of GOOD_NAMES) {
    indeg.set(good, Object.keys(GOOD_RECIPES[good] ?? {}).length);
  }
  const order: string[] = [];
  const ready = GOOD_NAMES.filter((g) => (indeg.get(g) ?? 0) === 0);
  while (ready.length > 0) {
    const g = ready.shift()!;
    order.push(g);
    for (const consumer of GOOD_NAMES) {
      if (GOOD_RECIPES[consumer]?.[g] === undefined) continue;
      const d = (indeg.get(consumer) ?? 0) - 1;
      indeg.set(consumer, d);
      if (d === 0) ready.push(consumer);
    }
  }
  return order;
})();

/** Reverse recipe index: input good → goods that consume it (and units per their output). */
export const GOOD_RECIPE_CONSUMERS: Readonly<
  Record<string, Array<{ goodId: string; perOutput: number }>>
> = (() => {
  const out: Record<string, Array<{ goodId: string; perOutput: number }>> = {};
  for (const [good, recipe] of Object.entries(GOOD_RECIPES)) {
    for (const [input, perOutput] of Object.entries(recipe)) {
      (out[input] ??= []).push({ goodId: good, perOutput });
    }
  }
  return out;
})();
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/constants/__tests__/recipes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/recipes.ts lib/constants/__tests__/recipes.test.ts
git commit -m "feat(economy): recipe-topological production order + consumer index"
```

### Task A2: `inputDemandForGood` (production-input demand per good)

**Files:**
- Modify: `lib/engine/industry.ts`
- Test: `lib/engine/__tests__/industry.test.ts` (extend existing)

**Interfaces:**
- Consumes: `buildingProduction` (existing, `lib/engine/industry.ts`), `labourDemand`, `labourFulfillment`, `GOOD_RECIPE_CONSUMERS` (Task A1).
- Produces: `export function inputDemandForGood(buildings: Record<string, number>, goodId: string, fulfillment: number): number` — Σ over consumers `t` of `goodId`: `buildingProduction(buildings, t, fulfillment) × perOutput`.

- [ ] **Step 1: Write the failing test**

```typescript
import { inputDemandForGood, labourDemand, labourFulfillment } from "@/lib/engine/industry";
import { OUTPUT_PER_UNIT } from "@/lib/constants/industry";
import { GOOD_RECIPES } from "@/lib/constants/recipes";

it("computes ore demand from a smelter (metals) building", () => {
  // metals recipe = { ore: 1 }. One metals building, fully staffed.
  const buildings = { metals: 4 };
  const pop = labourDemand(buildings); // exactly staffs them ⇒ fulfillment 1
  const f = labourFulfillment(pop, labourDemand(buildings));
  const metalsCapacity = 4 * OUTPUT_PER_UNIT["metals"] * f;
  const expectedOreDemand = metalsCapacity * GOOD_RECIPES["metals"]["ore"];
  expect(inputDemandForGood(buildings, "ore", f)).toBeCloseTo(expectedOreDemand, 6);
});

it("returns 0 for a good nothing consumes as an input", () => {
  expect(inputDemandForGood({ metals: 4 }, "luxuries", 1)).toBe(0);
});

it("sums across multiple consumers of the same input", () => {
  // minerals feeds chemicals, alloys, components.
  const buildings = { chemicals: 2, alloys: 2, components: 2 };
  const f = 1;
  const direct =
    inputDemandForGood({ chemicals: 2 }, "minerals", f) +
    inputDemandForGood({ alloys: 2 }, "minerals", f) +
    inputDemandForGood({ components: 2 }, "minerals", f);
  expect(inputDemandForGood(buildings, "minerals", f)).toBeCloseTo(direct, 6);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts`
Expected: FAIL — `inputDemandForGood` not exported.

- [ ] **Step 3: Implement (append to `lib/engine/industry.ts`)**

```typescript
import { GOOD_RECIPE_CONSUMERS } from "@/lib/constants/recipes";

/**
 * Production-input demand on `goodId` from the local industrial base: the total
 * desired (uncapped) draw of `goodId` across every building type that consumes
 * it. Capacity-based (no strike/event/gate twitch) — the stable pricing-reference
 * term folded into demandRate (spec §8). `fulfillment` is the system-wide labour
 * ratio (`labourFulfillment(population, labourDemand(buildings))`).
 */
export function inputDemandForGood(
  buildings: Record<string, number>,
  goodId: string,
  fulfillment: number,
): number {
  let demand = 0;
  for (const consumer of GOOD_RECIPE_CONSUMERS[goodId] ?? []) {
    demand += buildingProduction(buildings, consumer.goodId, fulfillment) * consumer.perOutput;
  }
  return demand;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/industry.ts lib/engine/__tests__/industry.test.ts
git commit -m "feat(economy): inputDemandForGood — production-input demand per good"
```

**PAUSE — Phase A check-in.** Run full suite (`npx vitest run`) + `npx tsc --noEmit`. Everything still inert; nothing should change behaviorally.

---

## Phase B — The coupled cascade engine (pure)

*Pure `lib/engine/supply-chain.ts`. Not wired into the processor yet — Phase C wires it.*

### Task B1: `inputGate` + `simulateSystemEconomyTick`

**Files:**
- Create: `lib/engine/supply-chain.ts`
- Test: `lib/engine/__tests__/supply-chain.test.ts`

**Interfaces:**
- Consumes: `MarketTickEntry`, `EconomySimParams`, `selfLimitingFactor` (from `@/lib/engine/tick`); `GOOD_RECIPES`, `PRODUCTION_GOOD_ORDER` (from `@/lib/constants/recipes`).
- Produces:
  - `export function inputGate(goodId: string, effectiveProduction: number, stockOf: (g: string) => number, minLevel: number): number` — the `[0,1]` throttle; `1` for tier-0 / no-recipe / zero production.
  - `export interface SystemMarketEntry extends MarketTickEntry { systemId: string }` — an entry tagged with its system.
  - `export function simulateSystemEconomyTick(entries: MarketTickEntry[], params: EconomySimParams, rng: () => number): MarketTickEntry[]` — simulates ONE system's markets (any order in; processed in `PRODUCTION_GOOD_ORDER`), returns a new array **in the same order as the input** (so callers can zip back to their market rows).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { inputGate, simulateSystemEconomyTick } from "@/lib/engine/supply-chain";
import type { MarketTickEntry, EconomySimParams } from "@/lib/engine/tick";

const PARAMS: EconomySimParams = { noiseAmplitude: 0, minLevel: 5, maxLevel: 200 };
const noRng = () => 0.5; // noise = 0 when amplitude 0

describe("inputGate", () => {
  it("is 1 for a tier-0 good (no recipe)", () => {
    expect(inputGate("ore", 10, () => 100, 5)).toBe(1);
  });

  it("is 1 when the input is abundant", () => {
    // metals recipe { ore: 1 }; effectiveProduction 10 wants 10 ore; 200 ore available.
    expect(inputGate("metals", 10, () => 200, 5)).toBe(1);
  });

  it("throttles proportionally when the input is scarce (above-floor drawable)", () => {
    // want 10 ore; stock 8 ⇒ drawable 3 ⇒ gate 0.3
    expect(inputGate("metals", 10, () => 8, 5)).toBeCloseTo(0.3, 6);
  });

  it("binds on the scarcest of multiple inputs", () => {
    // chemicals { gas: 0.5, minerals: 0.5 }; eff 10 ⇒ wants 5 gas, 5 minerals.
    const stock = (g: string) => (g === "gas" ? 200 : 6); // minerals drawable 1 ⇒ ratio 0.2
    expect(inputGate("chemicals", 10, stock, 5)).toBeCloseTo(0.2, 6);
  });
});

describe("simulateSystemEconomyTick", () => {
  function entry(goodId: string, stock: number, prod?: number, cons?: number): MarketTickEntry {
    return { goodId, stock, productionRate: prod, consumptionRate: cons };
  }

  it("never breaches the floor when draining a scarce input", () => {
    // ore near floor, a metals producer wanting more than is drawable.
    const out = simulateSystemEconomyTick(
      [entry("ore", 6, undefined, undefined), entry("metals", 50, 20, undefined)],
      PARAMS,
      noRng,
    );
    const ore = out.find((e) => e.goodId === "ore")!;
    expect(ore.stock).toBeGreaterThanOrEqual(5);
  });

  it("propagates a fresh tier-0 output to its tier-1 consumer the same tick", () => {
    // ore starts AT floor (5, nothing drawable yet) but produces this tick;
    // metals should still get some ore because ore is processed first (topo order).
    const out = simulateSystemEconomyTick(
      [entry("metals", 50, 10, undefined), entry("ore", 5, 30, undefined)],
      PARAMS,
      noRng,
    );
    const metals = out.find((e) => e.goodId === "metals")!;
    // ore produced 30 (self-limited) before metals draws ⇒ metals output > 0.
    expect(metals.stock).toBeGreaterThan(50);
  });

  it("leaves a no-recipe, no-producer good driven only by consumption", () => {
    const out = simulateSystemEconomyTick([entry("water", 100, undefined, 8)], PARAMS, noRng);
    expect(out[0].stock).toBeLessThan(100);
  });

  it("returns entries in the input order regardless of processing order", () => {
    const out = simulateSystemEconomyTick(
      [entry("metals", 50, 5), entry("ore", 100, 5)],
      PARAMS,
      noRng,
    );
    expect(out.map((e) => e.goodId)).toEqual(["metals", "ore"]);
  });

  it("cascade: cutting ore supply throttles metals output", () => {
    const rich = simulateSystemEconomyTick([entry("ore", 150, 0), entry("metals", 50, 20)], PARAMS, noRng);
    const starved = simulateSystemEconomyTick([entry("ore", 6, 0), entry("metals", 50, 20)], PARAMS, noRng);
    const richMetals = rich.find((e) => e.goodId === "metals")!.stock;
    const starvedMetals = starved.find((e) => e.goodId === "metals")!.stock;
    expect(starvedMetals).toBeLessThan(richMetals);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/supply-chain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/engine/supply-chain.ts`**

```typescript
/**
 * Coupled per-system economy tick — the supply-chain cascade engine. Pure
 * (no DB). Tier-1+ production draws its recipe inputs from the system's live
 * local stock; output throttles by the binding input's availability; inputs
 * drain proportional to actual output. Goods are processed in recipe-topological
 * order so a freshly-produced input feeds its consumer the same tick.
 *
 * Only stock ABOVE the floor is drawable, so input draws never breach the
 * [minLevel, maxLevel] band — no re-clamp needed. Civilian consumption, noise,
 * and clamp are identical to the flat tick (lib/engine/tick.ts), whose
 * selfLimitingFactor this engine reuses.
 */
import { clamp } from "@/lib/utils/math";
import {
  selfLimitingFactor,
  type EconomySimParams,
  type MarketTickEntry,
} from "@/lib/engine/tick";
import { GOOD_RECIPES, PRODUCTION_GOOD_ORDER } from "@/lib/constants/recipes";

/**
 * Input-availability throttle in [0, 1] for one producing good. `1` for tier-0
 * / no-recipe goods and for zero production. Computed against drawable stock
 * (stock − minLevel), so the eventual draw cannot breach the floor.
 */
export function inputGate(
  goodId: string,
  effectiveProduction: number,
  stockOf: (g: string) => number,
  minLevel: number,
): number {
  const recipe = GOOD_RECIPES[goodId];
  if (!recipe || effectiveProduction <= 0) return 1;
  let gate = 1;
  for (const [input, perOutput] of Object.entries(recipe)) {
    const desired = effectiveProduction * perOutput;
    if (desired <= 0) continue;
    const drawable = Math.max(0, stockOf(input) - minLevel);
    const ratio = Math.min(1, drawable / desired);
    if (ratio < gate) gate = ratio;
  }
  return Math.max(0, gate);
}

/**
 * Simulate one system's markets with input-gating. Input order is preserved on
 * return; processing happens in PRODUCTION_GOOD_ORDER. Entries for goods not in
 * the order list (defensive) are processed last in input order.
 */
export function simulateSystemEconomyTick(
  entries: MarketTickEntry[],
  params: EconomySimParams,
  rng: () => number = Math.random,
): MarketTickEntry[] {
  const { noiseAmplitude, minLevel, maxLevel } = params;

  // Live mutable stock per good for this system.
  const stock = new Map<string, number>();
  const byGood = new Map<string, MarketTickEntry>();
  for (const e of entries) {
    stock.set(e.goodId, e.stock);
    byGood.set(e.goodId, e);
  }
  const stockOf = (g: string): number => stock.get(g) ?? minLevel;

  const orderIndex = new Map(PRODUCTION_GOOD_ORDER.map((g, i) => [g, i]));
  const processOrder = [...entries].sort(
    (a, b) =>
      (orderIndex.get(a.goodId) ?? Number.MAX_SAFE_INTEGER) -
      (orderIndex.get(b.goodId) ?? Number.MAX_SAFE_INTEGER),
  );

  for (const entry of processOrder) {
    let s = stockOf(entry.goodId);

    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0) {
      const gate = inputGate(entry.goodId, effectiveProduction, stockOf, minLevel);
      const ceiling = selfLimitingFactor(s, minLevel, maxLevel, "produce");
      const actualOutput = effectiveProduction * gate * ceiling;
      s += actualOutput;
      // Drain inputs proportional to actual output. draw ≤ drawable ⇒ floor holds.
      const recipe = GOOD_RECIPES[entry.goodId];
      if (recipe) {
        for (const [input, perOutput] of Object.entries(recipe)) {
          const draw = perOutput * actualOutput;
          stock.set(input, Math.max(minLevel, stockOf(input) - draw));
        }
      }
    }

    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      s -= effectiveConsumption * selfLimitingFactor(s, minLevel, maxLevel, "consume");
    }

    const noise = (rng() * 2 - 1) * noiseAmplitude * (entry.volatility ?? 1);
    s = clamp(s + noise, minLevel, maxLevel);
    stock.set(entry.goodId, s);
  }

  return entries.map((e) => ({ ...e, stock: stockOf(e.goodId) }));
}
```

> **Note on the drain `Math.max(minLevel, …)`:** with drawable-above-floor gating the draw is already ≤ drawable, so the `max` is a belt-and-suspenders guard for floating-point and for the same-input-multiple-consumers case (each consumer recomputes against the now-lower live stock). It never silently swallows a real over-draw because the gate already bounds it.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/engine/__tests__/supply-chain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/supply-chain.ts lib/engine/__tests__/supply-chain.test.ts
git commit -m "feat(economy): coupled per-system cascade engine with input-gating"
```

### Task B2: `simulateCoupledEconomyTick` — group flat entries by system

**Files:**
- Modify: `lib/engine/supply-chain.ts`
- Test: `lib/engine/__tests__/supply-chain.test.ts` (extend)

**Interfaces:**
- Produces: `export function simulateCoupledEconomyTick(entries: MarketTickEntry[], systemIds: string[], params: EconomySimParams, rng?: () => number): MarketTickEntry[]` — `systemIds[i]` is the system of `entries[i]`; groups by system, runs `simulateSystemEconomyTick` per group, returns results in the original flat index order.

- [ ] **Step 1: Write the failing test**

```typescript
import { simulateCoupledEconomyTick } from "@/lib/engine/supply-chain";

it("isolates systems — system A's ore does not feed system B's metals", () => {
  // A: ore-rich + metals. B: ore-starved + metals. Same flat array.
  const entries: MarketTickEntry[] = [
    { goodId: "ore", stock: 150, productionRate: 0 },   // A
    { goodId: "metals", stock: 50, productionRate: 20 }, // A
    { goodId: "ore", stock: 6, productionRate: 0 },      // B
    { goodId: "metals", stock: 50, productionRate: 20 }, // B
  ];
  const systemIds = ["A", "A", "B", "B"];
  const out = simulateCoupledEconomyTick(entries, systemIds, PARAMS, () => 0.5);
  expect(out.map((e) => e.goodId)).toEqual(["ore", "metals", "ore", "metals"]);
  const aMetals = out[1].stock;
  const bMetals = out[3].stock;
  expect(bMetals).toBeLessThan(aMetals); // B starved ⇒ less metals
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/supply-chain.test.ts`
Expected: FAIL — `simulateCoupledEconomyTick` not exported.

- [ ] **Step 3: Implement (append to `lib/engine/supply-chain.ts`)**

```typescript
/**
 * Group a region's flat entries by system, run the coupled per-system tick on
 * each, and return results in the original flat order. `systemIds[i]` owns
 * `entries[i]`. Cross-system coupling is impossible — each system has its own
 * live stock map.
 */
export function simulateCoupledEconomyTick(
  entries: MarketTickEntry[],
  systemIds: string[],
  params: EconomySimParams,
  rng: () => number = Math.random,
): MarketTickEntry[] {
  const groups = new Map<string, number[]>();
  systemIds.forEach((sysId, i) => {
    (groups.get(sysId) ?? groups.set(sysId, []).get(sysId)!).push(i);
  });

  const result = new Array<MarketTickEntry>(entries.length);
  for (const indices of groups.values()) {
    const simulated = simulateSystemEconomyTick(
      indices.map((i) => entries[i]),
      params,
      rng,
    );
    indices.forEach((i, j) => {
      result[i] = simulated[j];
    });
  }
  return result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/engine/__tests__/supply-chain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/supply-chain.ts lib/engine/__tests__/supply-chain.test.ts
git commit -m "feat(economy): group flat economy entries by system for coupled tick"
```

**PAUSE — Phase B check-in.** Full suite + `tsc`. The engine exists and is tested but unused; live behavior unchanged.

---

## Phase C — Wire the economy processor

### Task C1: Replace the flat tick with the coupled tick

**Files:**
- Modify: `lib/tick/processors/economy.ts:105-114`
- Test: `lib/tick/processors/__tests__/economy.test.ts` (extend) — uses the in-memory adapter.

**Interfaces:**
- Consumes: `simulateCoupledEconomyTick` (Task B2). The `markets`/`resolved`/`tickEntries` arrays in `runEconomyProcessor` are already parallel; `markets[i].systemId` gives the system.

- [ ] **Step 1: Write the failing test** (processor-level cascade through the in-memory adapter)

```typescript
// economy.test.ts — build a one-system world with an ore extractor + a smelter,
// run runEconomyProcessor against InMemoryEconomyWorld, assert metals stock
// responds to ore availability. Cut ore (set ore buildings to 0 OR start ore at
// the floor) and assert metals stock rises less than in the ore-rich case.
it("throttles metals production when local ore is scarce", async () => {
  // Arrange two in-memory systems differing only in ore stock; both have a
  // smelter (metals building). After one tick the ore-rich system's metals
  // stock exceeds the ore-starved system's.
  // (Use the existing economy.test.ts harness/builders for the in-memory world.)
});
```

> Concrete arrangement: reuse whatever `makeSimWorld`/builder the existing `economy.test.ts` uses. Seed two systems in the SAME region (so they process the same tick), each with `buildings: { ore: N, metals: M, housing: H }` and population ≈ labourDemand. Set system A ore market `stock` high, system B ore market `stock = 5`. Assert `metalsStock(A) > metalsStock(B)` after `runEconomyProcessor`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tick/processors/__tests__/economy.test.ts`
Expected: FAIL — current flat tick ignores ore stock, so metals(A) == metals(B).

- [ ] **Step 3: Implement — edit `runEconomyProcessor`**

Replace lines ~105-106:

```typescript
  const tickEntries: MarketTickEntry[] = resolved.map((r) => r.entry);
  const simulated = simulateEconomyTick(tickEntries, simParams, rng);
```

with:

```typescript
  const tickEntries: MarketTickEntry[] = resolved.map((r) => r.entry);
  const entrySystemIds = markets.map((m) => m.systemId);
  const simulated = simulateCoupledEconomyTick(tickEntries, entrySystemIds, simParams, rng);
```

Add the import:

```typescript
import { simulateCoupledEconomyTick } from "@/lib/engine/supply-chain";
```

Remove the now-unused `simulateEconomyTick` import if nothing else in the file uses it (keep `selfLimitingFactor` — still used for dissatisfaction at line ~125).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tick/processors/__tests__/economy.test.ts`
Expected: PASS. Then run the broader tick suite: `npx vitest run lib/tick`.

- [ ] **Step 5: Commit**

```bash
git add lib/tick/processors/economy.ts lib/tick/processors/__tests__/economy.test.ts
git commit -m "feat(economy): economy tick consumes recipe inputs via the cascade engine"
```

**PAUSE — Phase C check-in.** Full suite + `tsc`. Input-gating is now LIVE in both the game and the simulator (shared body). Run `npm run simulate` once just to confirm it doesn't crash and stocks stay bounded — do NOT calibrate yet (that's Phase E). Note: seeded-noise sim results will shift because processing order changed; that's expected.

---

## Phase D — `demandRate` production-input term

### Task D1: Fold input demand into the population processor's rewrite

**Files:**
- Modify: `lib/tick/world/population-world.ts` (extend `PopulationWorld`)
- Modify: `lib/tick/adapters/prisma/population.ts` + `lib/tick/adapters/memory/population.ts`
- Modify: `lib/tick/processors/population.ts` (pass building data through)
- Test: `lib/tick/processors/__tests__/population.test.ts` (extend, in-memory)

**Interfaces:**
- The `demandRate` rewrite must now add `inputDemandForGood(buildings, goodId, fulfillment)` (Task A2) to the existing `demandRateForGood(goodId, population)`.
- `fulfillment = labourFulfillment(population, labourDemand(buildings))` per system.
- Both adapters need per-system `buildings`. The memory adapter already has `SimSystem.buildings`; the prisma adapter must load `SystemBuilding` rows for the systems being rewritten (mirror the economy prisma adapter's `findMany` on `systemBuilding`).

- [ ] **Step 1: Write the failing test**

```typescript
// population.test.ts — in-memory: a system with a metals building should have
// a strictly higher `ore` demandRate than civilian-only, because the smelter's
// ore draw is folded in.
it("includes production-input demand in the rewritten demandRate", async () => {
  // Build an in-memory world: one system, population P, buildings { metals: K, housing },
  // an `ore` market. Run runPopulationProcessor; read the ore market's demandRate.
  // Expect it to equal demandRateForGood("ore", P) + inputDemandForGood(buildings, "ore", f).
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tick/processors/__tests__/population.test.ts`
Expected: FAIL — ore demandRate equals civilian-only (input term missing).

- [ ] **Step 3: Implement**

`market-economy.ts` — overload the demand denominator with an optional input term, keeping `demandRateForGood` pure/population-only and adding a composed helper:

```typescript
import { inputDemandForGood } from "@/lib/engine/industry";

/**
 * Total days-of-supply demand denominator: civilian (population) + industrial
 * (production-input draw). The industrial term is capacity-based and stable
 * (spec §8). `fulfillment` is the system-wide labour ratio.
 */
export function totalDemandRateForGood(
  goodId: string,
  population: number,
  buildings: Record<string, number>,
  fulfillment: number,
): number {
  const civilian = (GOOD_CONSUMPTION[goodId] ?? 0) * Math.max(0, population);
  const industrial = inputDemandForGood(buildings, goodId, fulfillment);
  return Math.max(civilian + industrial, MIN_DEMAND);
}
```

> Keep `demandRateForGood` unchanged for `demandFootprint` (the UI footprint stays civilian — or extend it too if the footprint card should show industrial demand; decide in Phase F). `getInitialStock` is unchanged (seed time has no live buildings/fulfillment context in that helper; the seeded reference stays civilian — acceptable, coarse).

`population-world.ts` — extend the interface:

```typescript
/** Per-system building counts for the demandRate input term. */
export interface SystemBuildingsView {
  systemId: string;
  population: number;
  buildings: Record<string, number>;
}

export interface PopulationWorld {
  // … existing …
  /** Building counts + population for the systems whose demandRate is rewritten. */
  getIndustry(systemIds: string[]): Promise<SystemBuildingsView[]>;
}
```

`prisma/population.ts` — implement `getIndustry` (load `SystemBuilding` + population) and use `totalDemandRateForGood` in `rewriteDemandRates`:

```typescript
async getIndustry(systemIds: string[]): Promise<SystemBuildingsView[]> {
  if (systemIds.length === 0) return [];
  const [sys, buildingRows] = await Promise.all([
    this.tx.starSystem.findMany({ where: { id: { in: systemIds } }, select: { id: true, population: true } }),
    this.tx.systemBuilding.findMany({ where: { systemId: { in: systemIds } }, select: { systemId: true, buildingType: true, count: true } }),
  ]);
  const buildingsBySystem = new Map<string, Record<string, number>>();
  for (const b of buildingRows) {
    const m = buildingsBySystem.get(b.systemId) ?? {};
    m[b.buildingType] = b.count;
    buildingsBySystem.set(b.systemId, m);
  }
  return sys.map((s) => ({ systemId: s.id, population: s.population, buildings: buildingsBySystem.get(s.id) ?? {} }));
}
```

Then in `rewriteDemandRates`, compute `fulfillment` per system from `labourFulfillment(population, labourDemand(buildings))` and call `totalDemandRateForGood(goodKey, population, buildings, fulfillment)` instead of `demandRateForGood`. The processor (`population.ts`) calls `world.getIndustry(systemIds)` and threads the building map into `rewriteDemandRates` — extend the `rewriteDemandRates` signature to accept the industry views (or have the adapter load them itself; prefer the adapter loading to keep the processor body data-source-agnostic, consistent with how it already loads markets inside `rewriteDemandRates`).

> **Simplest wiring:** have `rewriteDemandRates` (both adapters) internally fetch industry alongside markets — the prisma adapter already does its own `findMany` there, and the memory adapter already has `SimSystem.buildings`. Then no `PopulationWorld` interface change is needed. **Prefer this** unless a test needs `getIndustry` separately. (If you take this route, drop the `getIndustry` interface addition above and just extend the two `rewriteDemandRates` bodies.)

`memory/population.ts` — in `rewriteDemandRates`, look up `sys.buildings` + `sys.population` for each market's system, compute `fulfillment`, call `totalDemandRateForGood`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tick/processors/__tests__/population.test.ts && npx vitest run lib/tick`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/market-economy.ts lib/tick/world/population-world.ts lib/tick/adapters/prisma/population.ts lib/tick/adapters/memory/population.ts lib/tick/processors/population.ts lib/tick/processors/__tests__/population.test.ts
git commit -m "feat(economy): demandRate includes production-input demand"
```

**PAUSE — Phase D check-in.** Full suite + `tsc`. Pricing now reflects industrial demand: an input-heavy good (ore at a refinery world) reads dearer, pulling supply in via trade flow.

---

## Phase E — Simulator calibration (coarse)

### Task E1: Extend simulator equilibrium checks for the cascade

**Files:**
- Modify: `lib/engine/simulator/` (the assertions/report module — find where `npm run simulate` checks targets, e.g. `lib/engine/simulator/report.ts` / `analysis.ts`).
- Modify: `lib/constants/industry.ts` (`OUTPUT_OVERRIDES`) and/or `lib/constants/recipes.ts` (recipe quantities) — coarse calibration only.

- [ ] **Step 1: Add cascade + whole-web assertions to the sim run.** Check: (a) seeded systems start non-starved (no tier-1 good pinned at floor at tick 0 in a system that has its inputs locally or via a lane); (b) cutting a tier-0 lane/supply throttles the downstream good and restoring recovers (an injected-shortage scenario); (c) existing targets still hold — stocks in `[5,200]`, greedy ≫ random, cross-system price dispersion, stable-but-growing population — now over 26 goods with input demand in the reference.

- [ ] **Step 2: Run the simulator**

Run: `npm run simulate`
Expected: completes; report shows bounded stocks, greedy ≫ random, no good universally pinned to floor/ceiling.

- [ ] **Step 3: Coarse-tune.** If a tier-1+ good is chronically starved galaxy-wide (its inputs can't keep up), nudge the input good's `OUTPUT_OVERRIDES`/`outputPerUnit` up or the recipe quantity down — **coarsely**. If a good floods, the reverse. Keep within the SP2 norm: tune `OUTPUT_PER_UNIT` overrides and recipe quantities; leave the triangle knobs (`BASE_SPACE`, `labourPerUnit`, `popProvided`) unless the sim shows a structural labour/space imbalance. Re-run `npm run simulate` after each change. **Stop when targets hold coarsely — do not chase residual staple stock-drift (known SP5 item).**

- [ ] **Step 4: Commit**

```bash
git add lib/engine/simulator lib/constants/industry.ts lib/constants/recipes.ts
git commit -m "feat(economy): simulator validates the supply-chain cascade; coarse calibration"
```

**PAUSE — Phase E check-in.** Share the `npm run simulate` summary (equilibrium table, cascade scenario result) before moving to UI. This is the SP1–SP3 stop-and-reflect checkpoint — the complete physical economy is now observable.

---

## Phase F — UI readouts (Industrial Base / Supply Chain)

*Readouts only — no build UI in SP3. Tick-invalidated read path, separate from the static substrate read. Reuse `StatList`, `ProgressBar`, `Badge`, and the SP2 Population-tab pattern (`components/system/population-panel.tsx`).*

### Task F1: Industry read service + route + hook

**Files:**
- Modify: the system read service (`lib/services/universe.ts` or wherever the system detail service lives) — add an `getSystemIndustry(systemId)` returning building counts by type, `buildSpace` used/total, labour fulfillment, and per-good input-gate status (which goods are throttled).
- Create: `app/api/game/systems/[id]/industry/route.ts` — thin `requirePlayer()` → service → `NextResponse.json` wrapper. `Cache-Control: private, no-cache` (auth-gated, tick-dynamic).
- Create: `lib/hooks/use-system-industry.ts` — `useSuspenseQuery`, query key in `lib/query/keys.ts`, tick-invalidated (not static).

**Interfaces (service return shape):**

```typescript
export interface SystemIndustryReadout {
  buildSpace: { used: number; total: number };
  labourFulfillment: number; // 0..1
  buildings: Array<{ buildingType: string; outputGood?: string; tier: number; count: number }>;
  supplyChain: Array<{ goodId: string; inputGate: number; throttledBy: string[] }>; // gate < 1 ⇒ starved
}
```

- [ ] **Step 1–5 (TDD):** service test (compute readout from a fixture system's buildings + market stocks via `inputGate`), route smoke (auth + shape), then the hook. Compute `inputGate` per produced good using the live market stocks the service already reads. Commit per unit.

```bash
git commit -m "feat(economy): system industry read path (service + route + hook)"
```

### Task F2: Industrial Base panel component

**Files:**
- Create: `components/system/industry-panel.tsx` — three sub-cards mirroring `population-panel.tsx`:
  1. **Industrial base** — build-space utilisation (`ProgressBar used/total`), labour fulfillment (`ProgressBar`), building counts grouped by tier (`StatList`).
  2. **Supply chain** — per-good input-gate; goods with `gate < 1` flagged (`Badge` "starved") with `throttledBy` inputs listed.
- Modify: the system detail page to mount the panel (a new tab or section alongside the Population tab).

- [ ] **Step 1–5:** Component test (renders counts, flags a throttled good), wire into the page, verify with `npm run dev` manually. Use `font-mono` for numerics, copper accent card, no rounded corners (Foundry theme — HTML UI). Commit.

```bash
git commit -m "feat(economy): industrial base & supply-chain readout panel"
```

**PAUSE — Phase F check-in.** Full suite + `tsc` + `npm run build`. Manually verify the panel on a seeded system in `npm run dev`.

---

## Phase G — Docs finalization & SP3 close-out

*Part 3 completing = SP3 feature complete. Finalize docs and remove the pending marker. Plan-doc deletions happen here (whole SP3 ships).*

- [ ] **Step 1: Update `docs/active/gameplay/economy.md`** — production is now capacity + **input-gated** (remove the `[PENDING: supply-chain]` line at `economy.md:80`); `demandRate` includes production-input demand; document the 26-good chain, recipe-topological intra-system tick, and the drawable-above-floor draw rule. Also fix the stale "12 goods" escapes flagged in memory: `trading.md:25`, `universe.md:39`, `MIGRATION-NOTES.md:199`.

- [ ] **Step 2: Move the supply-chain spec to active.** Fold `docs/planned/economy-simulation-supply-chain.md`'s now-shipped content into `docs/active/gameplay/economy.md` (or a dedicated active doc), per the design-doc lifecycle. Update `docs/SPEC.md` Economy section to state production is input-gated and the chain cascades.

- [ ] **Step 3: Remove the pending marker** and confirm none remain for supply-chain: `grep -rn "PENDING: supply-chain" docs/ lib/` → empty.

- [ ] **Step 4: Delete the shipped plan docs** (whole SP3 done): `docs/plans/sp3-part1-26-good-roster.md`, `docs/plans/sp3-part2-industrial-base.md`, `docs/plans/sp3-part3-supply-chain-cascade.md`.

- [ ] **Step 5: Final verification.** `npx vitest run` (full suite green), `npx tsc --noEmit` (clean), `npm run build` (succeeds), `npm run simulate` (healthy). Then commit.

```bash
git add docs lib
git commit -m "docs(economy): SP3 supply-chain shipped — finalize spec, remove pending marker"
```

- [ ] **Step 6: Open ONE PR** `feat/economy-sp3` Part 3 into the shared branch is already there — this Part's commits ARE the shared branch. Per the multi-part workflow, when all three parts are merged into `feat/economy-sp3`, open the single shared→main PR (squash or ff per the clean-history rule). Confirm with the user before merging shared→main.

---

## Self-Review notes (author)

- **Spec coverage:** §7 input-gating → Phase B/C; §8 demandRate input term → Phase D; §11 per-system tier-ordered restructure → Phase B/C (topo-order refinement noted); §12 UI → Phase F; §13 calibration → Phase E; §14 reseed — **no schema change in Part 3** (SystemBuilding/buildSpace shipped in Part 2), so no reseed needed unless Phase E changes seed *values* (constants only, no migration). §16 input-gate/self-limiting interaction → resolved via drawable-above-floor (documented in Key Formulas).
- **No new processor, no processor-order change** (spec §11) — confirmed: changes are inside the economy + population processor bodies only.
- **Type consistency:** `inputGate(goodId, effectiveProduction, stockOf, minLevel)`, `simulateSystemEconomyTick(entries, params, rng)`, `simulateCoupledEconomyTick(entries, systemIds, params, rng)`, `inputDemandForGood(buildings, goodId, fulfillment)`, `totalDemandRateForGood(goodId, population, buildings, fulfillment)` — names used consistently across tasks.
- **Open calibration (Phase E, coarse only):** recipe quantities, `OUTPUT_PER_UNIT` overrides, whether `demandFootprint` shows industrial demand (Phase F decision).
