# Rate-Based Placement + Planner Seam (Sub-projects B + C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make faction industry placement size built capacity to the **demand rate** (`production < demand`) instead of a 40-day stock target, killing seed over-extraction — then factor the planner into a clean decision → gate → pacing seam and remove the double-metering / linear-scan / inline-pool debts.

**Architecture:** The over-extraction bug is a units mismatch in the live planner (`lib/engine/directed-build.ts`): a build is sized `servedOutput / perUnit` where `servedOutput` is a **stock** (`targetStock − stock`, ≈ 40× demand) but `perUnit` is a **rate**, so it builds ≈40× the units needed to meet the flow, driving every extractor to its deposit cap. B replaces the deficit metric with the **rate deficit** (`demand − production`); the existing `servedOutput / perUnit` arithmetic then yields the correct unit count. Logistics keeps its stock-based classification (it moves the running-balance stock); only *placement* switches to rate. C then factors the fused `planFactionBuilds` into named **decide** (rank rate-deficit opportunities) and **gate** (staff/space/whole-level fit + academy/complex co-builds) units so a future player proposer plugs into the same pipeline, removes the vestigial planner `budget` (pool is the sole pacer), binary-searches the whole-level gate, and extracts the faction throughput pool to a pure helper.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Pure engine module (`lib/engine/`), zero I/O. Live wiring in `lib/tick/processors/directed-build.ts`; calibration via `npm run simulate`.

## Global Constraints

- **No `as` casts** (except `as const` / `lib/types/guards.ts`); no `unknown`; no postfix `!` outside tests (`find(...)!` is the test idiom).
- **Engine purity** — `lib/engine/directed-build.ts` and `lib/engine/construction.ts` stay pure: no `fs` / `process.env` / DB / `Date.now` / `Math.random`.
- **World stays JSON-serializable** — no `NaN`/`Infinity` may reach world state (guard funding math; `fundQueue` already coerces non-finite pool/cap to 0).
- **Determinism** — no wall-clock or RNG in engine bodies.
- **Logistics is unchanged** — `classifyMarketState` / `surplusDrawable` in `lib/engine/directed-logistics.ts` and the directed-logistics processor keep their stock-based semantics. This plan touches placement only.
- **Branch:** phase branch `feat/economy-bc-rate-placement` off `feat/economy-rework-base`; PR into that shared branch (not `main`). Health-check with `npm run simulate` after Phase B before starting Phase C.
- **Gates (run before PR):** `npx vitest run`, `npx tsc --noEmit`, `npx next build --webpack`, `npm run simulate`.
- **Key symbols** (import from their existing homes; never hardcode scaled numbers — reference the constant):
  - `TARGET_COVER = 40` — `lib/constants/market-economy.ts` (kept for pricing/satisfaction/logistics; **no longer drives builds**).
  - `OUTPUT_PER_UNIT` (per-good per-unit output *rate*), `ANCHOR_MIN_THROUGHPUT`, `ANCHOR_RATED_COVERAGE`, `ANCHOR_CAP` — `lib/constants/industry.ts`.
  - `DIRECTED_BUILD` (`GENERATION_PER_POP` removed in C1) — `lib/constants/directed-build.ts`.
  - `CONSTRUCTION.THROUGHPUT_PER_POP` — `lib/constants/construction.ts` (the sole pacer).
  - `surplusDrawable`, `RouteCost` — `lib/engine/directed-logistics.ts`.

---

## Design decisions locked in (read before starting)

1. **Deficit condition & magnitude are rate-based.** A `(system, good)` is a build target when `production < demand` (rate); the magnitude to close is `demand − production`. The stock-based `classifyMarketState` gate is **dropped from placement** — a system with a full stock buffer but `production < demand` is still structurally short (it is draining the buffer) and must build. This is the whole point of §2/§3 of `docs/planned/economy-demand-driven-model.md`.
2. **Two different "surplus" questions, split by what they gate.**
   - **Structural-deficit exclusion** (should A build good X at all?): a reachable **rate exporter** — a system with `production > demand` — excludes A. A sustainable producer, not a transient stock pile. This aligns with `13e4314` ("systems build to serve their own demand"): a neighbour merely *holding* stock (but draining it, `production < demand`) is not a reason to forgo building A's own capacity; logistics will still ship that transient stock while A's capacity comes up. (Refined during execution — the initial plan kept this stock-based, but a stock-holder with `production < demand` is itself a rate deficit and cannot double as a donor, and deferring capacity to a draining pile is unsound.)
   - **Tier-1+ input-availability gate** (can a factory's recipe input be *delivered* here?): stays stock-based (`surplusDrawable` — drawable stock OR a structural producer), because inputs arrive as physical stock via logistics. The input-gate tests (structural-producer-below-margin, in-band-non-producer) encode this and keep passing. This uses `planFactionBuilds`'s own `surplusSystemsByGood`, which is separate from `findStructuralDeficits`'s exclusion map.
3. **`self-supply gate` already correct.** `findStructuralDeficits` and the logistics matcher already skip a good where `production ≥ demand`. The rate deficit `demand − production > 0` is the same predicate, so the self-supply gate is preserved for free.
4. **C is a light, behaviour-preserving seam**, not a rewrite (design §5: "we only ensure the seams exist … not a planner rewrite"). The greedy allocator's behaviour is held fixed by the existing test suite; C renames its two internal responsibilities into `decide` / `gate` units and folds in the three deferred findings (A1 double-meter, P1 linear scan, A2 inline pool).

---

## File Structure

- **`lib/engine/directed-build.ts`** — the pure planner. B changes `findStructuralDeficits` (rate deficit) and the `StructuralDeficit` field name; the downstream sizing arithmetic is unchanged. C factors the fused `planFactionBuilds` into `decideFactionBuilds` (rank opportunities) + `gateProposal` (fit to whole levels + co-builds), removes the `budget` param and `systemBuildGeneration`, and binary-searches the whole-level loop.
- **`lib/engine/construction.ts`** — the pure funding half. C2 adds `factionThroughputPool(...)`.
- **`lib/tick/processors/directed-build.ts`** — the live adapter. C2 replaces the inline pool sum with `factionThroughputPool`. No other processor change (it already reads `production`/`demand` via `toGoodMarketStates`).
- **`lib/constants/directed-build.ts`** — C1 removes `GENERATION_PER_POP` (dead after the budget is gone).
- **`lib/engine/__tests__/directed-build.test.ts`** — B migrates every deficit fixture to rate terms + adds the over-extraction regression; C1 removes the `systemBuildGeneration` describe block; C adds decide/gate unit tests.
- **`lib/engine/__tests__/construction.test.ts`** — C2 adds `factionThroughputPool` tests (create the file if absent).
- **`docs/active/gameplay/economy-autonomic-agency.md`** — C5 updates the placement description to rate-based + the decision/gate/pace seam.

---

# Phase B — Rate-based placement (the core fix)

### Task B1: Placement sizes to the demand rate, not the stock target

**Files:**
- Modify: `lib/engine/directed-build.ts` — `StructuralDeficit` interface (~157-163) and `findStructuralDeficits` (~174-201); remove the now-unused `classifyMarketState` import (~13).
- Test: `lib/engine/__tests__/directed-build.test.ts` — rewrite the `findStructuralDeficits` describe block, migrate deficit fixtures throughout, add the over-extraction regression.

**Interfaces:**
- Consumes: `surplusDrawable(stock, targetStock, demand, production)` and `RouteCost` from `lib/engine/directed-logistics` (unchanged); `TARGET_COVER` from `lib/constants/market-economy`; `OUTPUT_PER_UNIT`, `makeResourceVector`, `hopRouteCost`, `DIRECTED_BUILD` (already imported in the test).
- Produces: `findStructuralDeficits(systems, routeCost): StructuralDeficit[]` where `StructuralDeficit = { systemId; goodId; rateDeficit; demand }` and `rateDeficit = demand − production > 0`. `planFactionBuilds(systems, routeCost): PlannedBuild[]` (signature unchanged) now sizes builds to the rate.

- [ ] **Step 1: Write the failing over-extraction regression test**

Add to the `describe("planFactionBuilds")` block in `lib/engine/__tests__/directed-build.test.ts`. Add `TARGET_COVER` to the imports from `@/lib/constants/market-economy` at the top of the file (new import line).

```typescript
it("sizes a tier-0 build to the demand RATE, not the 40-day stock target (over-extraction regression)", () => {
  // A developed system with an ample deposit and an ore-scale food deposit: demand rate 20/tick,
  // no local production, ample labour. It reaches itself (self-cost) so it self-supplies.
  // Stock model built servedOutput/perUnit where servedOutput = targetStock − stock = 40×20 = 800
  // → ~228 food units (deposit-capped over-extraction). Rate model builds demand/perUnit ≈ 20/3.5 ≈ 5.
  const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
  const sys: BuildSystemState = {
    systemId: "A", factionId: "F", control: "developed", population: 100000, unrest: 0,
    buildings: {}, slotCap: makeResourceVector({ arable: 1000 }), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "food", stock: 0, targetStock: TARGET_COVER * 20, demand: 20, production: 0 }],
  };
  const foodUnits = countFor(planFactionBuilds([sys], rc), "A", "food");
  // Capacity meets the flow, within one whole level.
  expect(foodUnits * OUTPUT_PER_UNIT.food).toBeGreaterThanOrEqual(20 - OUTPUT_PER_UNIT.food);
  expect(foodUnits * OUTPUT_PER_UNIT.food).toBeLessThanOrEqual(20 + OUTPUT_PER_UNIT.food);
  // Far below the deposit-cap over-extraction the stock target would have driven.
  expect(foodUnits).toBeLessThan((TARGET_COVER * 20) / OUTPUT_PER_UNIT.food / 4);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "over-extraction regression"`
Expected: FAIL — `foodUnits` is ~228 (deposit-capped), far above the rate band and above the `< 57` bound.

- [ ] **Step 3: Rate-ify the deficit interface + `findStructuralDeficits`**

In `lib/engine/directed-build.ts`, change the import (drop `classifyMarketState`, keep the rest):

```typescript
import { surplusDrawable, type RouteCost } from "@/lib/engine/directed-logistics";
```

Replace the `StructuralDeficit` interface (~157-163):

```typescript
/** A rate deficit (production < demand) with no reachable surplus of its good — the build target. */
export interface StructuralDeficit {
  systemId: string;
  goodId: string;
  /** The per-tick flow to close = demand − production (> 0). Placement sizes capacity to this rate. */
  rateDeficit: number;
  demand: number;
}
```

Replace `findStructuralDeficits` (~174-201). Only the deficit branch changes — the reachable-surplus side (via `surplusDrawable`) is untouched:

```typescript
/**
 * Find rate deficits (production < demand) that logistics cannot serve because no reachable surplus
 * of the good exists. A good's build target is its RATE deficit (demand − production), not a
 * days-of-supply stock shortfall: capacity is built to meet the flow (docs/planned/economy-demand-driven-model.md
 * §2), so a full stock buffer does not cancel a structural shortfall. A self-supplier (production ≥
 * demand) has no rate deficit and is skipped. The reachable-surplus exclusion is stock-based
 * (surplusDrawable) because logistics moves the running-balance stock — one definition shared with
 * the matcher, so the planner never builds capacity for a good a reachable donor can already ship.
 */
export function findStructuralDeficits(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): StructuralDeficit[] {
  const deficits: Array<{ systemId: string; goodId: string; rateDeficit: number; demand: number }> = [];
  const surplusSystemsByGood = new Map<string, string[]>();

  for (const s of systems) {
    for (const g of s.goods) {
      const production = g.production ?? 0;
      const rateDeficit = g.demand - production;
      if (rateDeficit > 0) {
        deficits.push({ systemId: s.systemId, goodId: g.goodId, rateDeficit, demand: g.demand });
      } else if (surplusDrawable(g.stock, g.targetStock, g.demand, production) > 0) {
        const list = surplusSystemsByGood.get(g.goodId) ?? [];
        list.push(s.systemId);
        surplusSystemsByGood.set(g.goodId, list);
      }
    }
  }

  const structural: StructuralDeficit[] = [];
  for (const d of deficits) {
    const sources = surplusSystemsByGood.get(d.goodId) ?? [];
    const reachableSurplus = sources.some((su) => routeCost(su, d.systemId) !== null);
    if (!reachableSurplus) structural.push(d);
  }
  return structural;
}
```

- [ ] **Step 4: Thread `rateDeficit` through `planFactionBuilds`**

In `planFactionBuilds`, the only reference to the renamed field is where `remainingByGood` is seeded from `structural` (~425-430). Change `d.shortfall` to `d.rateDeficit`:

```typescript
  const remainingByGood = new Map<string, Map<string, number>>();
  for (const d of structural) {
    const m = remainingByGood.get(d.goodId) ?? new Map<string, number>();
    m.set(d.systemId, (m.get(d.systemId) ?? 0) + d.rateDeficit);
    remainingByGood.set(d.goodId, m);
  }
```

No other line changes: `remainingByGood` now holds rate deficits, `opp.perUnit`/`perUnit` are output rates, so `servedOutput / opp.perUnit` and `prodLevels = Math.floor(Math.min(capUnits, servedOutput / opp.perUnit, budget))` now compute the unit count that meets the flow. The nearest-first decrement (`producedOutput`, `deficitMap.set(...)`) also works in rate units.

- [ ] **Step 5: Run the regression to confirm it passes**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "over-extraction regression"`
Expected: PASS — `foodUnits` ≈ 5.

- [ ] **Step 6: Rewrite the `findStructuralDeficits` describe block for rate semantics**

Replace the entire `describe("findStructuralDeficits", …)` block (~45-92). The `buildSys` helper stays. Key changes: the returned field is `rateDeficit` (= `demand − production`), and deficit membership is now `production < demand` regardless of stock. Set `production` explicitly on every good.

```typescript
describe("findStructuralDeficits", () => {
  it("flags a good with production below demand as a structural rate deficit", () => {
    // demand 4, production 0 → rateDeficit 4. Stock/targetStock are irrelevant to placement now.
    const deficit = buildSys("A", { goodId: "electronics", stock: 1, targetStock: 10, demand: 4, production: 0 });
    const out = findStructuralDeficits([deficit], reachable);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ systemId: "A", goodId: "electronics", rateDeficit: 4, demand: 4 });
  });

  it("flags a rate deficit even when the stock buffer is full (stock decoupled from placement)", () => {
    // Full stock (>= targetStock) but production 1 < demand 4 → still a structural rate deficit:
    // the buffer is draining. This is the core B behaviour — TARGET_COVER no longer gates builds.
    const drainingButStocked = buildSys("A", { goodId: "food", stock: 500, targetStock: 100, demand: 4, production: 1 });
    const out = findStructuralDeficits([drainingButStocked], reachable);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ goodId: "food", rateDeficit: 3 });
  });

  it("excludes a deficit when a reachable stock surplus of that good exists", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4, production: 0 });
    const surplus = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 0 });
    expect(findStructuralDeficits([deficit, surplus], reachable)).toHaveLength(0);
  });

  it("keeps a deficit structural when the only surplus is unreachable", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4, production: 0 });
    const surplus = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 0 });
    expect(findStructuralDeficits([deficit, surplus], unreachable)).toHaveLength(1);
  });

  it("does not flag a self-supplier (production ≥ demand) as a deficit despite low standing stock", () => {
    const selfSupplier = buildSys("A", { goodId: "ore", stock: 1, targetStock: 20, demand: 5, production: 10 });
    expect(findStructuralDeficits([selfSupplier], reachable)).toHaveLength(0);
  });

  it("still flags a net importer (production < demand) as structural", () => {
    const importer = buildSys("A", { goodId: "ore", stock: 1, targetStock: 20, demand: 5, production: 2 });
    expect(findStructuralDeficits([importer], reachable)).toHaveLength(1);
    expect(findStructuralDeficits([importer], reachable)[0]).toMatchObject({ rateDeficit: 3 });
  });

  it("excludes a deficit when a reachable structural producer (below the 1.4× margin) can supply it", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4, production: 0 });
    const producer = buildSys("B", { goodId: "food", stock: 110, targetStock: 100, demand: 5, production: 30 });
    expect(findStructuralDeficits([deficit, producer], reachable)).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Migrate the remaining deficit fixtures to rate terms**

Run the full engine test file and fix the fallout. Apply this mechanical rule everywhere a fixture represents a market:

> **Rate-fixture rule.** A build target needs `production < demand`; its built magnitude is `(demand − production) / OUTPUT_PER_UNIT[good]` units. A self-supplying / balanced / "at-potential" system needs `production ≥ demand`. Set `production` explicitly on every `goods[]` entry the planner reads. `stock` / `targetStock` no longer affect placement (they still matter only for the housing `fedAndCalm` gate, which reads `targetStock`).

Concrete fixtures that assert magnitude or membership and MUST change (search the file for each):

- `describe("planFactionBuilds — idle at potential & barren worlds")` → `"builds nothing at a system already at its potential"` (~543): the ore good `{ stock: 50, targetStock: 50, demand: 20 }` must add `production: 20` (the system runs `ore: 4` and self-supplies) so it is not a rate deficit. Without it the rate model sees demand 20, production 0 → a deficit and builds.
- `heavyDeficitScenario()` (~689): change the metals good to `{ goodId: "metals", stock: 1, targetStock: 1000, demand: 500, production: 0 }`. Rate deficit 500 → 500/`OUTPUT_PER_UNIT.metals` units → throughput clears `ANCHOR_MIN_THROUGHPUT`, so the complex co-build test still holds. (Confirm `500 / OUTPUT_PER_UNIT.metals × OUTPUT_PER_UNIT.metals = 500 ≥ ANCHOR_MIN_THROUGHPUT`.)
- `tinyHeavyDeficitScenario()` (~708): set the metals good to `{ goodId: "metals", targetStock: 7, demand: OUTPUT_PER_UNIT.metals, production: 0 }` so exactly one whole level is funded and its family throughput (`OUTPUT_PER_UNIT.metals`) stays below `ANCHOR_MIN_THROUGHPUT` (assert-driven: pick `demand = OUTPUT_PER_UNIT.metals`, which yields 1 level).
- `crossFamilyDeficitScenario()` (~720): both deficits must independently clear `ANCHOR_MIN_THROUGHPUT`, so set each good to `{ …, demand: ANCHOR_MIN_THROUGHPUT * 3, production: 0 }` (drop the small `targetStock: 30, demand: 5`). This keeps the test's own assertion `units × OUTPUT_PER_UNIT ≥ ANCHOR_MIN_THROUGHPUT` true.
- `anchoredVsGreenfieldScenario()` (~744): the intent is "both sites capacity-limited at score time so C's buffed per-unit ranks it first." Re-express the deficit as a large **rate**: replace the good with `{ goodId: "metals", stock: 0, targetStock: 1, demand: capUnits * OUTPUT_PER_UNIT.metals * 1.15, production: 0 }`. The rate deficit now exceeds both sites' capacity output (`capUnits × perUnit`), so both are capacity-limited and the snowball ranking holds. Keep `capUnits`/`space` as-is.
- `planFactionBuilds — spare-labour gate` `deficitAndBuilder` (~510): the ore good `{ stock: 1, targetStock: 50, demand: 50 }` needs `production: 0` added; rate deficit 50 still exceeds the labour cap, so both labour-gate tests keep their bounds.
- Any `buildSys(...)` / inline deficit good used by a `planFactionBuilds` test that omits `production`: add `production: 0` (a pure consumer). The `>0` assertions are unaffected because a positive `demand` with `production 0` is a positive rate deficit.

Do NOT change: the `supplyDissatisfaction`, `fedAndCalm`, `habitableHousingHeadroom`, `plannedHousingUnits`, `buildableUnits/buildableOutput`, `hopRouteCost`, and `planFactionQueue` blocks — they read stock/`targetStock` for the housing gate or don't touch the deficit metric. (The `hopRouteCost` "builds a system's OWN local deficit" test already sets `production: 0` and `demand: 50` → still a rate deficit 50; leave it.)

- [ ] **Step 8: Run the full engine test file to green**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: PASS (all describes). If a magnitude assertion still fails, apply the Rate-fixture rule — the failing fixture almost certainly omits `production` or still encodes a stock-shortfall magnitude.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (The `StructuralDeficit.shortfall → rateDeficit` rename is fully contained in `directed-build.ts` + its test.)

- [ ] **Step 10: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "feat(directed-build): size placement to the demand rate, not the stock target

Placement now closes a rate deficit (production < demand) instead of a 40-day
days-of-supply shortfall, fixing seed over-extraction. Logistics keeps its
stock-based classification. See docs/planned/economy-demand-driven-model.md §2.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B2: Economy-health checkpoint (re-measure after B)

**Files:** none (validation gate). If the simulator surfaces a defect, fix it in `lib/engine/directed-build.ts` under TDD and re-run.

- [ ] **Step 1: Run the affected-file tests + full suite**

Run: `npx vitest run`
Expected: PASS. Adapter/processor tests (`lib/tick/processors/__tests__/directed-build.test.ts`, economy tests) are unaffected — the processor already feeds `production`/`demand` via `toGoodMarketStates`, so no adapter change is needed.

- [ ] **Step 2: Run the calibration harness**

Run: `npm run simulate`
Expected (coarse health only — no precision tuning, per the calibration note): no `NaN`/`Infinity`; no runaway or pinning; population does not collapse; homeworlds produce manufactured (tier-1+) goods. Compare the extraction/production mix against the pre-B baseline — extraction should **fall** toward demand-tracking levels rather than sitting pinned at deposit caps.

- [ ] **Step 3: Record the result**

If green: note the headline metrics (extraction share, per-tier production, pop trajectory) in the PR description. If a metric is unhealthy, open a `superpowers:systematic-debugging` pass — but expect green: B only changes the sizing metric, and the physical gates (labour, space, deposits) that pace each system are unchanged.

- [ ] **Step 4 (optional, recommended): drive it in the app**

Use the `/verify` or `/run` skill to New-game at the default 600-system scale, run the tick a few in-game months, and confirm freshly-`developed` systems now grow housing + industry (the stranded-pop symptom from the prior session should be gone: housing gets built, so `popCap` rises and the seed pop is no longer stranded on `popCap = 0`).

---

# Phase C — Decision / gate / pacing seam (+ deferred findings)

> Start Phase C only after B2 is green. Each task below is behaviour-preserving except C1 (which intentionally lets the planner propose to physical ceilings). The Phase-B test suite is the regression guard.

### Task C1: Remove the vestigial planner budget — pool is the sole pacer (finding A1)

**Files:**
- Modify: `lib/engine/directed-build.ts` — delete `systemBuildGeneration` (~72-75); remove the `budget` accumulation and every `budget`-guard / `budget -=` in `planFactionBuilds`.
- Modify: `lib/constants/directed-build.ts` — delete `GENERATION_PER_POP` (~11-12).
- Test: `lib/engine/__tests__/directed-build.test.ts` — delete the `describe("systemBuildGeneration")` block and the `systemBuildGeneration` import.

**Interfaces:**
- Consumes: nothing new.
- Produces: `planFactionBuilds(systems, routeCost)` proposes builds bounded only by physical ceilings (capacity, space, labour, whole-level). The processor's `fundQueue` throughput pool remains the only speed meter. `systemBuildGeneration` and `DIRECTED_BUILD.GENERATION_PER_POP` no longer exist.

- [ ] **Step 1: Write the failing "no artificial budget cap" test**

Add to `describe("planFactionBuilds")`. This asserts the planner proposes the full labour-affordable capacity in one pass (previously the pop×0.05 budget could truncate it):

```typescript
it("proposes capacity up to the physical ceilings in one pass (no population-budget throttle)", () => {
  // A lone developed builder with a large local rate deficit, ample deposits, and ample labour.
  // The only bounds are deposits and labour — NOT a per-pass build budget. Build should reach the
  // labour ceiling (spareLabour / labourTotal(ore)), not a small pop×GENERATION_PER_POP cap.
  const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
  const sys: BuildSystemState = {
    systemId: "A", factionId: "F", control: "developed", population: 100, unrest: 0,
    buildings: {}, slotCap: makeResourceVector({ ore: 1000 }), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "ore", stock: 0, targetStock: 1, demand: 100000, production: 0 }],
  };
  const oreUnits = countFor(planFactionBuilds([sys], rc), "A", "ore");
  // Labour-bound: pop 100 ÷ per-unit ore labour. The old budget (100 × 0.05 = 5) would have capped far lower.
  expect(oreUnits).toBeGreaterThan(5);
  expect(oreUnits).toBeLessThanOrEqual(100 / oreLabour + 1e-9);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "no population-budget throttle"`
Expected: FAIL — `oreUnits` is capped at ~5 by the `budget = pop × GENERATION_PER_POP` throttle.

- [ ] **Step 3: Strip the budget from `planFactionBuilds`**

In `lib/engine/directed-build.ts`:
- Delete the `systemBuildGeneration` export (~72-75).
- In `planFactionBuilds`, delete the budget accumulation + early return:
  ```typescript
  // DELETE these lines near the top of planFactionBuilds:
  //   let budget = 0;
  //   for (const s of systems) budget += systemBuildGeneration(s.population);
  //   if (budget <= 0) return [];
  ```
  Replace with nothing (the `working` map build follows directly). Keep an early return only if there are no economically-active systems (the `working` map handles that — if empty, both passes no-op and it returns `builds`).
- In Pass 1 (housing), remove `if (budget <= 0) break;` and change the level cap from `Math.floor(Math.min(want, budget))` to `Math.floor(want)`; delete `budget -= levels;`.
- Remove the `if (budget <= 0) return builds;` guard before Pass 2.
- In Pass 2's `for (const opp of opportunities)` loop, remove `if (budget <= 0) break;`; in the whole-level fit, drop `budget` from `prodLevels = Math.floor(Math.min(capUnits, servedOutput / opp.perUnit, budget))` → `Math.floor(Math.min(capUnits, servedOutput / opp.perUnit))`; in the fit-check drop the `unitsTotal <= budget` clause (keep `spaceTotal <= remainingGeneral && labourNeeded <= spareLabour`); and delete every `budget -= …` (complex, academies, production).

- [ ] **Step 4: Remove the constant**

In `lib/constants/directed-build.ts`, delete the `GENERATION_PER_POP: 0.05,` line and its doc comment.

- [ ] **Step 5: Remove the dead test + import**

In `lib/engine/__tests__/directed-build.test.ts`, delete the `describe("systemBuildGeneration", …)` block (~21-30) and remove `systemBuildGeneration` from the top import.

- [ ] **Step 6: Run the full engine file + typecheck**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts && npx tsc --noEmit`
Expected: PASS. The performance test (500-system faction) still bounds < 2 s — the planner does more per pass now but is still near-linear (guarded further by P1 in C3). If it regresses, C3 fixes it; note it and continue.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/directed-build.ts lib/constants/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "refactor(directed-build): remove the vestigial planner budget (pool is the sole pacer)

The planner double-metered speed against the processor throughput pool. It now
proposes toward the physical ceilings; fundQueue paces how fast levels land.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: Extract `factionThroughputPool` to the funding engine (finding A2)

**Files:**
- Modify: `lib/engine/construction.ts` — add `factionThroughputPool(...)`.
- Modify: `lib/tick/processors/directed-build.ts` — replace the inline pool sum (~150-152) with the helper.
- Test: `lib/engine/__tests__/construction.test.ts` — add a describe block (create the file if it does not exist, following the engine-test conventions).

**Interfaces:**
- Consumes: `isEconomicallyActive` from `lib/engine/control`.
- Produces: `factionThroughputPool(systems: Array<{ control: SystemControl; population: number }>, throughputPerPop: number): number` — `Σ over economically-active systems of max(0, population) × throughputPerPop`.

- [ ] **Step 1: Write the failing helper test**

Create/append `lib/engine/__tests__/construction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { factionThroughputPool } from "@/lib/engine/construction";

describe("factionThroughputPool", () => {
  it("sums pop × rate over economically-active (developed) systems only", () => {
    const systems = [
      { control: "developed" as const, population: 100 },
      { control: "controlled" as const, population: 50 },   // inert
      { control: "unclaimed" as const, population: 0 },      // inert
      { control: "developed" as const, population: 200 },
    ];
    expect(factionThroughputPool(systems, 0.05)).toBeCloseTo((100 + 200) * 0.05);
  });

  it("floors negative population at zero", () => {
    expect(factionThroughputPool([{ control: "developed" as const, population: -10 }], 0.05)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts`
Expected: FAIL — `factionThroughputPool` not exported.

- [ ] **Step 3: Implement the helper**

In `lib/engine/construction.ts`, add the import and the function:

```typescript
import { isEconomicallyActive } from "@/lib/engine/control";
import type { SystemControl } from "@/lib/world/types";

/**
 * A faction's per-pulse construction throughput pool: Σ over its economically-active (developed)
 * systems of population × throughputPerPop. Controlled/unclaimed systems are inert (population 0)
 * and contribute nothing. This is the single pacing meter — the planner proposes toward physical
 * ceilings; this pool decides how fast fundQueue drains the queue. A money/treasury gate stacks on
 * top of this at the same seam later (docs/planned/economy-demand-driven-model.md §5).
 */
export function factionThroughputPool(
  systems: Array<{ control: SystemControl; population: number }>,
  throughputPerPop: number,
): number {
  let pool = 0;
  for (const s of systems) {
    if (isEconomicallyActive(s.control)) pool += Math.max(0, s.population) * throughputPerPop;
  }
  return pool;
}
```

- [ ] **Step 4: Use it in the processor**

In `lib/tick/processors/directed-build.ts`, add `factionThroughputPool` to the `@/lib/engine/construction` import and replace the inline sum (~150-152):

```typescript
    const pool = factionThroughputPool(group, params.construction.throughputPerPop);
```

Remove the now-unused `isEconomicallyActive` import from the processor if nothing else uses it (check — the funding pool was its only use in this file; if so, drop it).

- [ ] **Step 5: Run the affected tests + typecheck**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts lib/tick/processors/__tests__/directed-build.test.ts && npx tsc --noEmit`
Expected: PASS — processor behaviour is identical (same pool value).

- [ ] **Step 6: Commit**

```bash
git add lib/engine/construction.ts lib/tick/processors/directed-build.ts lib/engine/__tests__/construction.test.ts
git commit -m "refactor(construction): extract factionThroughputPool pacing helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: Binary-search the whole-level gate (finding P1)

**Files:**
- Modify: `lib/engine/directed-build.ts` — the `for (; prodLevels >= 1; prodLevels--)` fit loop inside `planFactionBuilds` (~530-549).
- Test: `lib/engine/__tests__/directed-build.test.ts` — add a convergence test; the existing academy/complex/labour tests are the behaviour guard.

**Interfaces:**
- Consumes: `academyLift`, `complexLift`, `effectiveSpaceCost`, `unskilledPerUnit`, `labourTotal` (all in-module already).
- Produces: identical `prodLevels` / `schools` / `institutes` / `complexLevels` selection, computed in O(log capUnits) fit-checks instead of O(capUnits).

- [ ] **Step 1: Write the failing performance/correctness test**

Add to `describe("planFactionBuilds performance")` (or a new `describe`):

```typescript
it("converges the whole-level fit without scanning every candidate level", () => {
  // A huge deposit + huge rate deficit but labour that admits only a handful of levels: the fit
  // must land the labour-max whole level, and do so fast (binary search, not a per-level scan from
  // the top). Correctness: built labour never exceeds population.
  const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
  const sys: BuildSystemState = {
    systemId: "A", factionId: "F", control: "developed", population: 40 * oreLabour, unrest: 0,
    buildings: {}, slotCap: makeResourceVector({ ore: 100000 }), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "ore", stock: 0, targetStock: 1, demand: 1_000_000, production: 0 }],
  };
  const t0 = performance.now();
  const oreUnits = countFor(planFactionBuilds([sys], rc), "A", "ore");
  expect(performance.now() - t0).toBeLessThan(50);
  expect(oreUnits).toBeGreaterThan(0);
  expect(oreUnits).toBeLessThanOrEqual(40 + 1e-9); // labour ceiling: 40×oreLabour ÷ oreLabour
});
```

- [ ] **Step 2: Run it — it passes for correctness but establishes the fast-path baseline**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "converges the whole-level fit"`
Expected: PASS on correctness (the linear loop is correct); the `< 50ms` bound is generous. This test locks behaviour so the binary-search rewrite can't drift. (If the linear scan is already slow here it may FAIL the time bound — that is the P1 motivation.)

- [ ] **Step 3: Replace the linear fit loop with binary search**

The fit-check is monotonic in `prodLevels` (more production → more space, more labour, more/equal academy + complex levels), so the largest feasible `prodLevels` is found by binary search over `[1, maxLevels]` where `maxLevels = Math.floor(Math.min(capUnits, servedOutput / opp.perUnit))`. Factor the per-candidate lift+fit into a local closure and binary-search it:

```typescript
    const maxLevels = Math.floor(Math.min(capUnits, servedOutput / opp.perUnit));
    if (maxLevels < 1) continue;

    // Whole-level fit for a candidate production level count: round the gates (academies/complex)
    // that LICENSE it UP (a fractional school licenses nobody), and report whether the bundle fits
    // the site's remaining general space and spare labour. Monotonic in `levels`, so binary-searchable.
    const fitFor = (levels: number) => {
      const a = academyLift(site, opp.goodId, levels);
      const c = complexLift(site, opp.goodId, levels);
      const schools = a.schools > 0 ? Math.ceil(a.schools) : 0;
      const institutes = a.institutes > 0 ? Math.ceil(a.institutes) : 0;
      const complexType = c.complexType;
      const complexLevels = c.count > 0 ? Math.ceil(c.count) : 0;
      const spaceTotal =
        levels * prodSpacePerUnit +
        schools * effectiveSpaceCost(VOCATIONAL_SCHOOL_TYPE) +
        institutes * effectiveSpaceCost(RESEARCH_INSTITUTE_TYPE) +
        (complexType ? complexLevels * effectiveSpaceCost(complexType) : 0);
      const labourNeeded =
        levels * prodLabourPerUnit +
        schools * unskilledPerUnit(VOCATIONAL_SCHOOL_TYPE) +
        institutes * unskilledPerUnit(RESEARCH_INSTITUTE_TYPE) +
        (complexType ? complexLevels * unskilledPerUnit(complexType) : 0);
      const fits = spaceTotal <= remainingGeneral && labourNeeded <= spareLabour;
      return { fits, schools, institutes, complexType, complexLevels };
    };

    // Largest feasible whole-level count. Binary search [1, maxLevels]; fit is monotone-decreasing.
    let lo = 1;
    let hi = maxLevels;
    let prodLevels = 0;
    let schools = 0;
    let institutes = 0;
    let complexLevels = 0;
    let complexType: string | undefined;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const f = fitFor(mid);
      if (f.fits) {
        prodLevels = mid;
        schools = f.schools;
        institutes = f.institutes;
        complexType = f.complexType;
        complexLevels = f.complexLevels;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (prodLevels < 1) continue;
```

Delete the old `let prodLevels = Math.floor(…); … for (; prodLevels >= 1; prodLevels--) { … }` block this replaces. The `prodSpacePerUnit`, `prodLabourPerUnit`, `remainingGeneral`, `spareLabour` locals defined just above are reused unchanged. The apply-order block below (complex → academies → production, with the `perUnit`/decrement) is unchanged.

- [ ] **Step 4: Run the behaviour guard + convergence test**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: PASS — especially the `academy co-build`, `complex co-build`, and `spare-labour gate` blocks (they assert the exact same feasible levels the linear loop produced) plus the new convergence test.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "perf(directed-build): binary-search the whole-level fit (was O(levels) per opportunity)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C4: Factor `planFactionBuilds` into decision / gate units (the seam)

**Files:**
- Modify: `lib/engine/directed-build.ts` — introduce `BuildProposal` (rename/relabel the existing `BuildOpportunity`), a `decideIndustryProposals(...)` unit (the opportunity precompute + sort), and a `gateProposal(...)` unit (the whole-level fit + co-build bundle). `planFactionBuilds` becomes a thin orchestrator: housing proposer → industry decide → gate loop.
- Test: `lib/engine/__tests__/directed-build.test.ts` — add focused unit tests for `decideIndustryProposals` (ranked, rate-based, pure) and `gateProposal` (fits to labour/space, emits co-builds gate-first). The whole existing suite remains the behaviour guard.

**Interfaces:**
- Consumes: everything already in-module.
- Produces (all exported so the seam is testable and a future player proposer can target it):
  - `interface BuildProposal { systemId: string; goodId: string; perUnit: number; reachable: Array<{ sysId: string; cost: number }>; score: number; }`
  - `decideIndustryProposals(working: Map<string, BuildSystemState>, structural: StructuralDeficit[], surplusSystemsByGood: Map<string, string[]>, routeCost: RouteCost): { proposals: BuildProposal[]; remainingByGood: Map<string, Map<string, number>> }` — pure ranking of rate-deficit opportunities (descending score). The "decision."
  - `interface GatedBuild { builds: PlannedBuild[]; }` (or return the mutation directly) — `gateProposal(site: BuildSystemState, proposal: BuildProposal, deficitMap: Map<string, number>): PlannedBuild[]` — validates one proposal against the site's spare labour / general space / whole-level rules, emits the gate-first co-build bundle (complex → academies → production), mutates `site.buildings` and `deficitMap`, and returns the emitted builds (empty if nothing fits). The "gate."

- [ ] **Step 1: Write the failing seam unit tests**

Add a new describe block:

```typescript
describe("decision/gate seam", () => {
  it("decideIndustryProposals ranks rate-deficit opportunities by served ÷ cost (pure)", () => {
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 5000, unrest: 0, control: "developed", buildings: {},
      slotCap, generalSpace: 100, habitableSpace: 0, goods: [],
    };
    const working = new Map<string, BuildSystemState>([["B", { ...builder, buildings: { ...builder.buildings } }]]);
    const structural: StructuralDeficit[] = [
      { systemId: "A", goodId: "food", rateDeficit: 50, demand: 50 },
    ];
    const { proposals, remainingByGood } = decideIndustryProposals(
      working, structural, new Map(), () => 1,
    );
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].goodId).toBe("food");
    expect(remainingByGood.get("food")?.get("A")).toBe(50);
    // Purity: calling again yields the same ranking and does not mutate `working`.
    expect(decideIndustryProposals(working, structural, new Map(), () => 1).proposals[0].goodId).toBe("food");
  });

  it("gateProposal fits a proposal to spare labour and emits gate-first co-builds", () => {
    const systems = makeElectronicsDeficitWithCapableSite();
    // Full-pipeline behaviour (decide → gate) is already covered by the academy co-build tests;
    // here assert the gate never over-commits labour and orders academies before production.
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute);
    const site = systems.find((s) => s.systemId === "B")!;
    const finalBuildings = applyBuilds(site.buildings, builds, "B");
    expect(labourDemand(finalBuildings)).toBeLessThanOrEqual(site.population + 1e-9);
    const prodIdx = builds.findIndex((b) => b.systemId === "B" && b.buildingType === "electronics");
    const schoolIdx = builds.findIndex((b) => b.systemId === "B" && b.buildingType === VOCATIONAL_SCHOOL_TYPE);
    expect(schoolIdx).toBeGreaterThanOrEqual(0);
    expect(schoolIdx).toBeLessThan(prodIdx);
  });
});
```

Add `decideIndustryProposals` and `StructuralDeficit` to the top import from `@/lib/engine/directed-build`.

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "decision/gate seam"`
Expected: FAIL — `decideIndustryProposals` not exported.

- [ ] **Step 3: Extract the decision unit**

In `lib/engine/directed-build.ts`, rename `interface BuildOpportunity` to `export interface BuildProposal` (same fields). Extract the opportunity precompute + sort (currently ~435-475) and the `remainingByGood` seed (~424-430) into:

```typescript
/**
 * DECISION unit: rank the rate-deficit build opportunities for a faction's working systems.
 * Pure — reads the working copy and route costs, mutates nothing. Each proposal is a (site, good)
 * whose reachable structural rate-deficits it can serve, scored served ÷ route cost (capacity +
 * proximity), buffed per-unit for a site already carrying the good's family complex (the snowball).
 * A future player proposer emits BuildProposal[] into the same gate→pace pipeline.
 */
export function decideIndustryProposals(
  working: Map<string, BuildSystemState>,
  structural: StructuralDeficit[],
  surplusSystemsByGood: Map<string, string[]>,
  routeCost: RouteCost,
): { proposals: BuildProposal[]; remainingByGood: Map<string, Map<string, number>> } {
  const remainingByGood = new Map<string, Map<string, number>>();
  for (const d of structural) {
    const m = remainingByGood.get(d.goodId) ?? new Map<string, number>();
    m.set(d.systemId, (m.get(d.systemId) ?? 0) + d.rateDeficit);
    remainingByGood.set(d.goodId, m);
  }

  const proposals: BuildProposal[] = [];
  for (const [goodId, deficitMap] of remainingByGood) {
    // ... unchanged body of the current opportunity loop (baseUnit guard, per-site capUnits,
    //     inputsAvailable gate, reachable sort, score) pushing to `proposals` ...
  }
  proposals.sort((a, b) => b.score - a.score);
  return { proposals, remainingByGood };
}
```

Move the existing loop body verbatim (only the enclosing names change: push to `proposals`). Keep `surplusSystemsByGood` construction in `planFactionBuilds` (it is shared with nothing else here) and pass it in.

- [ ] **Step 4: Extract the gate unit**

Extract the per-opportunity sizing + apply block (currently ~477-585) into:

```typescript
/**
 * GATE unit: validate one proposal against the site's physical feasibility and emit the whole-level
 * build bundle. Sizes production to the reachable remaining rate-deficit, binary-searches the largest
 * whole-level count that fits spare labour + general space (rounding the academy/complex gates that
 * license it UP), then applies complex → academies → production to the site's working copy (gate
 * before production, so the funding queue funds the gate first) and decrements the served deficit.
 * Returns the emitted builds (empty when nothing fits). Mutates `site.buildings` and `deficitMap`.
 */
function gateProposal(
  site: BuildSystemState,
  proposal: BuildProposal,
  deficitMap: Map<string, number>,
): PlannedBuild[] {
  // ... the servedOutput sum, perUnit, spareLabour/remainingGeneral/prodSpacePerUnit/prodLabourPerUnit,
  //     the C3 binary-search fit, and the apply-order + decrement blocks, verbatim ...
}
```

- [ ] **Step 5: Rewrite `planFactionBuilds` as the orchestrator**

```typescript
export function planFactionBuilds(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): PlannedBuild[] {
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    working.set(s.systemId, { ...s, buildings: { ...s.buildings } });
  }

  const builds: PlannedBuild[] = [];

  // Pass 1: proactive housing proposer (housing leads population).
  for (const site of working.values()) {
    const want = plannedHousingUnits(site);
    const levels = Math.floor(want);
    if (levels < 1) continue;
    site.buildings[HOUSING_TYPE] = (site.buildings[HOUSING_TYPE] ?? 0) + levels;
    builds.push({ systemId: site.systemId, buildingType: HOUSING_TYPE, count: levels });
  }

  // Pass 2: labour-gated industry — decide (rank rate-deficit opportunities) then gate each.
  const structural = findStructuralDeficits(systems, routeCost);
  if (structural.length === 0) return builds;

  const surplusSystemsByGood = new Map<string, string[]>();
  for (const s of systems) {
    for (const g of s.goods) {
      if (surplusDrawable(g.stock, g.targetStock, g.demand, g.production ?? 0) > 0) {
        const list = surplusSystemsByGood.get(g.goodId) ?? [];
        list.push(s.systemId);
        surplusSystemsByGood.set(g.goodId, list);
      }
    }
  }

  const { proposals, remainingByGood } = decideIndustryProposals(working, structural, surplusSystemsByGood, routeCost);
  for (const proposal of proposals) {
    const site = working.get(proposal.systemId);
    if (!site) continue;
    const deficitMap = remainingByGood.get(proposal.goodId);
    if (!deficitMap) continue;
    builds.push(...gateProposal(site, proposal, deficitMap));
  }

  return builds;
}
```

Keep the module docstring accurate (two-pass: housing proposer → decide/gate industry).

- [ ] **Step 6: Run the whole engine file + typecheck**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts && npx tsc --noEmit`
Expected: PASS — the full suite is the behaviour guard; the seam refactor must not change any emitted build. If a test drifts, the extraction changed behaviour (most likely a moved local or a lost mutation) — reconcile against the pre-C4 body.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "refactor(directed-build): split planner into decision/gate units (player-ready seam)

planFactionBuilds now orchestrates a housing proposer, a pure decideIndustryProposals
ranking, and a gateProposal validator — the decide→gate→pace pipeline a future player
proposer plugs into. Behaviour-preserving. See economy-demand-driven-model.md §5.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C5: Docs + full gates

**Files:**
- Modify: `docs/active/gameplay/economy-autonomic-agency.md` — placement description.
- (Check) `docs/active/gameplay/economy.md` — if it states placement fills a days-of-supply target, correct it to rate-based.

- [ ] **Step 1: Update the active spec (present tense, no phase/plan references)**

In `docs/active/gameplay/economy-autonomic-agency.md`, update the **autonomic build** description so it reads: industry placement sizes built capacity to the **demand rate** (a per-tick flow: `production < demand`), physically gated by deposit slots, general space, and labour; the days-of-supply anchor (`TARGET_COVER`) drives pricing, satisfaction, and logistics classification but **not** builds. State the planner as a decision → gate → pacing pipeline: a decision unit ranks rate-deficit opportunities, a gate validates staffing/space/whole-level feasibility (co-building academies/complexes as needed), and the faction throughput pool paces how fast the committed queue lands. Keep it present-tense and free of "Phase"/"PR"/change-history framing (per the active-docs convention).

- [ ] **Step 2: Grep for stale placement descriptions**

Run: `git grep -n "40-day\|days-of-supply.*build\|targetStock.*build\|GENERATION_PER_POP" -- docs/active`
Expected: no hit implies builds are described as filling a stock target. Fix any that do.

- [ ] **Step 3: Run all gates**

Run:
```bash
npx vitest run
npx tsc --noEmit
npx next build --webpack
npm run simulate
```
Expected: vitest green; tsc clean; webpack build succeeds; simulate reports coarse-healthy economy (no `NaN`/runaway/pinning; population stable; homeworlds manufacture) — matching or improving on the B2 baseline.

- [ ] **Step 4: Commit + open the PR**

```bash
git add docs/active/gameplay/economy-autonomic-agency.md docs/active/gameplay/economy.md
git commit -m "docs(active): describe rate-based placement + the decision/gate/pace planner seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Open a PR from `feat/economy-bc-rate-placement` into `feat/economy-rework-base` summarising: B (rate placement, over-extraction fixed) with the B2 health metrics, and C (double-meter removed, pool extracted, gate binary-searched, decision/gate seam). Note D (homeworld prefab) remains a separate follow-up.

---

## Self-Review (checklist run against `docs/planned/economy-demand-driven-model.md`)

1. **Spec coverage.**
   - §1 demand as `Σ sources` → already implemented (`toGoodMarketStates` sums civilian + industrial into `demand`); B relies on it, no change needed. ✅
   - §2 rate-based placement → Task B1. ✅
   - §3 stock as passive buffer, `TARGET_COVER` decoupled from builds → B1 drops the stock gate from placement; logistics/pricing keep it. ✅
   - §5 decision/gate/pacing seam; don't gold-plate funding → C1 (pool is sole pacer), C2 (pool helper), C3 (gate perf), C4 (decide/gate units). ✅
   - §4 delete trader machinery, §6 homeworld prefab → **out of scope** (§4 shipped in sub-project A; §6 is sub-project D, explicitly deferred). ✅
   - Testing strategy (demand-rate sizing regression, seed coherence, buffer emerges, determinism, gates) → B1 regression + B2/C5 simulate + gates. Buffer-emergence and shock-resilience are validated in the simulate checkpoint rather than as engine unit tests (they are cross-processor, tick-integrated behaviours). ✅
2. **Placeholder scan.** No TBD/TODO; every code step shows the code or an exact verbatim-move instruction; fixture migration gives a precise mechanical rule plus the named magnitude-sensitive fixtures. ✅
3. **Type consistency.** `StructuralDeficit.rateDeficit` used identically in B1 and C4; `BuildProposal` fields match the former `BuildOpportunity`; `factionThroughputPool` signature matches its processor call and test. `decideIndustryProposals` return shape (`{ proposals, remainingByGood }`) matches its consumer in `planFactionBuilds` and its unit test. ✅
