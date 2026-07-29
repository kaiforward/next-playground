# Necessity-Weighted Unrest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unrest grade *what* a population is short of, not merely *how much* — an authored
per-good necessity weight on the dissatisfaction fold, named per-regime unrest ceilings, and a
survival-good floor — after deleting the flat government consumption boost the weights are
calibrated against.

**Architecture:** Two PRs on the shared `feat/band-reconciliation` branch, in a forced order. PR A
deletes `GOVERNMENT_TYPES[…].consumptionBoosts` and unthreads `governmentType` from the civilian
demand chain; PR B adds `GOOD_NECESSITY`, re-expresses the unrest gains as `gain = ceiling × decay`
with a ceiling blended across the regime cut, adds the water/food survival floor, and makes the
planner's `fed()` gate civilian-only. **PR A must land first** — the spec's measured demand shares
are computed *after* the boost is removed, so building the fold first calibrates it against a basket
that is about to move.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, the existing pure-engine / processor-body split
(`lib/engine`, `lib/tick`, `lib/tick-harness`). No new dependencies.

**Spec (source of truth):** `docs/planned/necessity-weighted-unrest.md`. Reviewed and amended
2026-07-28 (`080acc4d`); **do not re-review it**. Umbrella: `docs/build-plans/band-reconciliation-umbrella.md`.

## Global Constraints

- **No `as` assertions** (only `as const` / inside `lib/types/guards.ts`). **No `unknown`.** No
  postfix `!` outside `find(...)!` in tests.
- Engine functions stay pure — no `fs` / `process.env` / `Date.now` / `Math.random` in
  `lib/engine`, `lib/tick/processors`, `lib/world` (except `save-files.ts`).
- `World` stays JSON-serializable: no `Map`/`Set`/`Date`, and **no `Infinity`/`NaN`** may reach
  world state. This slice adds **no new persisted state** — no `WorldMarket`/`WorldSystem` field,
  no save-version bump. (The spec is explicit: no stored regime, no hysteresis state.)
- Comments describe the code, never the plan/PR/phase that produced it.
- `GOOD_NECESSITY` is **dimensionless** — it weights a ratio, so it is authored as a plain
  `Record<string, number>` and **must not** go through `scaleRecord`/`scaleValue`.
- Containment guarantees are **computed from the shared constants in tests, never hardcoded as
  sums** (the rule PR5 established).
- Every ceiling/cut/weight in this slice is a **first cut; the simulator owns the finals.** Say so in
  the docstring, as the surrounding constants do.
- Cover is measured in **cycles**, not days — one economy cycle consumes one
  `demandRate`. Every "days-of-supply" docstring is legacy and wrong.
- The four downstream unrest consumers (purse, directed-logistics exporter drawability, planner
  squeeze backstop, infrastructure decay channels) are **measured before and after, never
  pre-tuned.** Their constants were calibrated against a striking galaxy.

---

## Branch strategy

Both PRs branch off the shared feature branch `feat/band-reconciliation` and merge back into it
(squash or fast-forward, never a merge commit). `main` sees nothing until the final shared→main PR
after PR6.

| PR | Branch | Base |
| --- | --- | --- |
| A — government boost deletion | `feat/necessity-unrest-gov-deletion` | `feat/band-reconciliation` |
| B — the necessity fold | `feat/necessity-unrest-fold` | `feat/band-reconciliation` (**after A merges**) |

**Never open B's PR while A's PR is open** — squash-merging A would permanently auto-close a PR based
on A's branch. Wait for A to land in shared, then branch B off the updated shared branch.

Per PR: push, open the PR, then `/uber-review` (findings land as PR comments). Do not gate PR
creation on a clean review.

---

## File structure

### PR A — government consumption boost deletion

| File | Change |
| --- | --- |
| `lib/constants/government.ts` | Drop `consumptionBoosts` from `GovernmentDefinition` + all 8 entries |
| `lib/engine/physical-economy.ts` | `consumptionRate` / `consumptionBreakdown` lose the government term **and** the `governmentType` parameter; `ConsumptionBreakdown` loses `government` |
| `lib/constants/market-economy.ts` | `civilianDemandRateForGood`, `totalDemandRateForGood`, `getInitialStock` lose the parameter |
| `lib/engine/industry.ts` | `capacityGoodRates` loses the parameter |
| `lib/engine/pop-needs.ts` | `computePopNeeds` loses the parameter |
| `lib/engine/homeworld-prefab.ts` | `computeHomeworldBuildings`, `sizeCapitalBuildings`, `homeworldGardenBody` lose the parameter; two docstrings rewritten |
| `lib/engine/universe-gen.ts` | Homeworld stamp/garden call sites; `homeworldGovernments` map deleted if it has no other reader |
| `lib/world/markets.ts` | `SystemMarketSeed.governmentType` deleted |
| `lib/world/tick.ts` | `buildLogisticsRows` / `buildBuildRows` / market-creation call sites stop threading it |
| `lib/tick/world/directed-build-world.ts`, `.../directed-logistics-world.ts` | Row types drop `governmentType` |
| `lib/tick/processors/good-market-state.ts` | `MarketStateSource` drops it; `capacityGoodRates` call updated |
| `lib/tick/processors/directed-build.ts` | `planFoundingStock`'s `consumptionRate` call |
| `lib/tick/adapters/memory/economy.ts`, `.../population.ts` | `consumptionRate` / `totalDemandRateForGood` calls; the dead `governmentBySystemId` map |
| `lib/tick-harness/build-analysis.ts` | `FoundedColonySystem` Pick + `consumptionRate` call |
| `lib/services/pop-needs.ts`, `system-population.ts`, `universe.ts`, `trade-flow.ts`, `dev-tools.ts` | Stop deriving/threading the government type for demand |
| `lib/services/world-index.ts` | Delete `governmentTypeForSystem` (and `governmentByFactionId` if it loses its last reader) |
| `lib/types/api.ts` | `PopNeedData.breakdown` docstring |
| `components/system/population-panel.tsx` | Drop the `government` entry from `TIER_META` |
| `docs/SPEC.md`, `docs/active/gameplay/faction-system.md`, `universe.md`, `navigation.md`, `economy.md` | Government is economically inert now — fix the interaction map + the boost table |
| `lib/world/__tests__/economy-scale-dynamic-invariance.test.ts` | Docstring: the government-scaling coverage it named is gone (accepted loss, stated) |

### PR B — the necessity fold

| File | Change |
| --- | --- |
| `lib/constants/physical-economy.ts` | **New** `GOOD_NECESSITY` + `SURVIVAL_GOODS` peer tables |
| `lib/constants/economy.ts` | **New** `D_SHORTAGE_CUT`, `D_SHORTAGE_BLEND`; `SHORTAGE_SATISFACTION` docstring re-pointed |
| `lib/constants/population.ts` | `UNREST_PARAMS` reparameterised to ceilings; `POPULATION_PARAMS` docstring rewritten |
| `lib/constants/directed-build.ts` | `D_SETTLE` re-cut + docstring |
| `lib/engine/population.ts` | `GoodSatisfaction.goodId`; weighted `dissatisfaction`; `SupplyState` + `foldSupplyState`; `unrestCeiling`; `accumulateUnrest` |
| `lib/engine/directed-build.ts` | `supplyDissatisfaction` folds civilian demand + goodId |
| `lib/engine/directed-logistics.ts` | `GoodMarketState.civilianDemand` (required) |
| `lib/tick/processors/good-market-state.ts` | Populate `civilianDemand` |
| `lib/tick/types.ts` | `supplyRegimeBySystem` → `supplyStateBySystem: Map<string, SupplyState>` |
| `lib/tick/processors/economy.ts` | Pass `goodId`; emit the supply state |
| `lib/tick/processors/population.ts` | Read the supply state; stop scaling ceilings by catch-up |
| `lib/engine/pop-needs.ts` | `pressure` takes the necessity weight |
| `lib/tick-harness/build-analysis.ts` | Colony opening reading passes `goodId` |
| `lib/tick-harness/population-analysis.ts` | **New** `summarizeSupplyRegimes` + `SupplyRegimeSummary` |
| `scripts/simulate.ts` | Regime-share block in the report |
| `lib/constants/__tests__/band-constants.test.ts` | The containment + necessity-arithmetic guarantees |
| `lib/constants/__tests__/physical-economy.test.ts` | `GOOD_NECESSITY` totality/shape |

---

# PR A — Government consumption boost deletion

The boost adds a **flat, population-independent** term inside `consumptionRate`
(`GOVERNMENT_TYPES[gov].consumptionBoosts[goodId]`, scaled). At `ECONOMY_SCALE` that is 100 units per
system whatever the population, so it is ~2% of a pop-1000 basket and **~92% of a pop-2 colony
seed's** — which is why a federation colony's founding manifest asks for ~3006 medicine against ~36
food. It is deleted outright rather than re-based per-capita; governments keep their event weights
and danger baseline and become economically inert until the government layer is revisited.

Demand moves for **eight goods only** — medicine, luxuries, weapons, fuel, machinery, food,
electronics, textiles — at the governments that boosted them. For those goods the price anchor
`targetStock`, the ration threshold, the producer operating ceiling (and hence the decay glut
signal), `classifyMarketState`/`surplusDrawable`, the planner's `capacityGap`, world-gen seed stock,
the homeworld prefab and colony founding manifests all move with it. **That is the expected
correction, not a regression**: standing stock sized against a boosted anchor reads as glut,
producers throttle, and the idle channel prunes capacity that phantom demand justified. There are no
save files to migrate — the world is regenerated.

### Task A1: Delete the boost and unthread `governmentType` from civilian demand

This is one atomic change: removing a parameter from `consumptionRate` breaks every caller at once,
so the tree does not compile in between. Work outward from the chokepoint.

**Files:**
- Modify: `lib/constants/government.ts:3-12` (interface), `:15-72` (all 8 entries)
- Modify: `lib/engine/physical-economy.ts:10-68`
- Modify: `lib/constants/market-economy.ts:60-62`, `:75-87`, `:101-135`
- Modify: `lib/engine/industry.ts:494-506`
- Modify: `lib/engine/pop-needs.ts:14-76`
- Modify: `lib/engine/homeworld-prefab.ts:1-15`, `:50-118`, `:127-135`, `:148-149`
- Modify: `lib/engine/universe-gen.ts:648-666`, `:693`
- Modify: `lib/world/markets.ts:15-51`
- Modify: `lib/world/tick.ts:516-523`
- Modify: `lib/tick/processors/good-market-state.ts:8-25`
- Modify: `lib/tick/processors/directed-build.ts:103-107`
- Modify: `lib/tick/adapters/memory/economy.ts:79`
- Modify: `lib/tick/adapters/memory/population.ts:47-74`
- Modify: `lib/tick-harness/build-analysis.ts:83-84`, `:146`
- Modify: `lib/services/pop-needs.ts`, `system-population.ts:24-25`, `universe.ts:225-234`, `trade-flow.ts:77-78`, `dev-tools.ts:184-201`
- Test: `lib/engine/__tests__/physical-economy.test.ts:24-30`, `lib/engine/__tests__/industry.test.ts:168-179`,
  `lib/constants/__tests__/market-economy.test.ts:71-80`, `lib/world/__tests__/gen.test.ts:168-194`,
  `lib/engine/__tests__/homeworld-prefab.test.ts:45-75`, `lib/constants/__tests__/government.test.ts:22-38`

**Interfaces:**
- Produces (consumed by every later task and by PR B):
  - `consumptionRate(goodId: string, basis: CivilianDemandBasis): number`
  - `consumptionBreakdown(goodId: string, basis: CivilianDemandBasis): ConsumptionBreakdown`
  - `interface ConsumptionBreakdown { base: number; technicians: number; engineers: number }`
  - `civilianDemandRateForGood(goodId: string, basis: CivilianDemandBasis): number`
  - `totalDemandRateForGood(goodId, basis, buildings, yields, labourState?): number`
  - `getInitialStock(buildings, yields, population, goodId): number`
  - `capacityGoodRates(buildings, population, yields): SubstrateGoodRate[]`
  - `computePopNeeds(basis: CivilianDemandBasis, markets: PopNeedsMarketRow[]): PopNeed[]`
  - `computeHomeworldBuildings(pop: number): Record<string, number>`
  - `homeworldGardenBody(): GeneratedBody`

- [ ] **Step 1: Delete the three assertions that require a positive government term**

They assert behaviour that is being removed, so they are deleted rather than re-based. In
`lib/engine/__tests__/physical-economy.test.ts` delete the whole `it("adds the scaled militarist
government demand to strategic goods", …)` block (lines 24-30). In
`lib/engine/__tests__/industry.test.ts` delete `it("uses the supplied government for capacity
consumption", …)` (lines 168-179). In `lib/constants/__tests__/market-economy.test.ts` delete
`describe("government-adjusted demand", …)` (from line 71 through its closing `});`).

- [ ] **Step 2: Remove `consumptionBoosts` from the government table**

```ts
// lib/constants/government.ts
export interface GovernmentDefinition {
  name: string;
  description: string;
  /** Additive danger baseline for transit in this government type's regions. */
  dangerBaseline: number;
  /** Event type weight adjustments. Positive = more likely, negative = less likely. */
  eventWeights: Record<string, number>;
}
```

Delete the `consumptionBoosts: { … }` line from all eight entries. Also drop
`"consumptionBoosts"` from the `requiredKeys` array in
`lib/constants/__tests__/government.test.ts:23-27`.

- [ ] **Step 3: Drop the government term from the demand chokepoint**

```ts
// lib/engine/physical-economy.ts — imports: GOVERNMENT_TYPES, scaleValue and GovernmentType all go
/** The three additive terms of consumptionRate, separated for display. */
export interface ConsumptionBreakdown {
  base: number;
  technicians: number;
  engineers: number;
}

/** consumptionRate split into its per-capita baseline and per-grade basket terms. */
export function consumptionBreakdown(goodId: string, basis: CivilianDemandBasis): ConsumptionBreakdown {
  return {
    base: (GOOD_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.population),
    technicians: (SKILL1_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.technicians),
    engineers: (SKILL2_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.engineers),
  };
}

/**
 * Civilian consumption rate: per-capita baseline + additive per-grade baskets. Population-
 * proportional throughout — there is no flat per-system term, so the basket's SHAPE is the
 * same at a 2-pop seed and a 5000-pop capital.
 * Sums the same terms as consumptionBreakdown but stays allocation-free — it runs per
 * (good, system) on the tick hot path; the breakdown object is for the display read path only.
 */
export function consumptionRate(goodId: string, basis: CivilianDemandBasis): number {
  return (
    (GOOD_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.population) +
    (SKILL1_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.technicians) +
    (SKILL2_CONSUMPTION[goodId] ?? 0) * Math.max(0, basis.engineers)
  );
}
```

- [ ] **Step 4: Run the type-checker to enumerate every remaining call site**

Run: `npx tsc --noEmit`
Expected: FAIL, with one error per call site listed in the Files block above. Use the error list as
the worklist for step 5 — do not hunt by hand.

- [ ] **Step 5: Drop the parameter through every caller**

Mechanical: delete the trailing `governmentType` argument at each call site, and delete the
parameter (and any now-unused `GovernmentType` import) from each signature. Specific non-mechanical
bits:

- `lib/tick/adapters/memory/population.ts:47-74` — delete the whole `governmentBySystemId` map
  (lines 52 and 56) along with the argument at line 71.
- `lib/services/system-population.ts`, `universe.ts`, `trade-flow.ts`, `dev-tools.ts` — delete the
  `governmentTypeForSystem(...)` / `governmentByFactionId()` derivations that existed only to feed
  these calls. Then `grep` for both symbols; if neither has a reader left, delete
  `governmentTypeForSystem` and `governmentByFactionId` from `lib/services/world-index.ts`.
- `lib/engine/universe-gen.ts:648-666` — `homeworldGardenBody()` and
  `computeHomeworldBuildings(HOME_SYSTEM_POP)` take no government. Check whether the
  `homeworldGovernments` map (line 693) has any other reader; if not, delete it.

- [ ] **Step 6: Rewrite the two docstrings that now state something untrue**

`lib/engine/homeworld-prefab.ts` — the module docstring (lines 1-15) and `computeHomeworldBuildings`
(lines 50-63) both say the prefab is sized to "the faction government's consumption boost". It is
now identical for all eight governments:

```ts
/**
 * Home-system prefab — the self-sufficient industrial base a faction capital starts with.
 *
 * A faction homeworld is not seeded by the fractional substrate allocator (whose scale-down + whole-level
 * floor wiped small manufacturing counts, leaving the galaxy extraction-only). Instead it is stamped with
 * this deterministic prefab: whole-integer building counts sized so local production meets its residents'
 * full civilian consumption — the per-capita baseline plus the technician/engineer skilled baskets — plus
 * the recipe draw of its own factories: a real tier-0 → tier-2 economy, computed from the economy
 * constants (no per-system rounding, no guessing). Civilian demand is population-proportional, so one
 * prefab serves every government.
 *
 * Counts are ECONOMY_SCALE-invariant: OUTPUT_PER_UNIT and GOOD_CONSUMPTION carry the same scale factor,
 * so the production ≥ consumption balance holds at any scale. The prefab is stamped onto a guaranteed
 * garden body sized to fit it (see world-gen), so nothing is ever floored or scaled down.
 */
```

`HOME_SYSTEM_PREFAB` (lines 127-135) loses its "frontier reference stamp / a capital's actual stamp is
sized to its faction's government" framing — it is now simply *the* stamp:

```ts
/** The stamp every faction capital receives: the baseline building counts + resident population. */
export const HOME_SYSTEM_PREFAB: { buildings: Record<string, number>; population: number } = {
  buildings: computeHomeworldBuildings(HOME_SYSTEM_POP),
  population: HOME_SYSTEM_POP,
};
```

- [ ] **Step 7: Re-base the two government-flavoured tests that still have a job**

`lib/engine/__tests__/homeworld-prefab.test.ts:45-75` — the per-government loop is now vacuous
(`computeHomeworldBuildings` is identical for all eight). Collapse it to a single self-sufficiency
assertion and rewrite the comment:

```ts
it("is self-sufficient — production meets the full tick-model consumption for every good it manufactures", () => {
  // Consumption must match the live per-tick model (consumptionRate): the per-capita baseline plus the
  // technician/engineer skilled baskets. A fully-staffed capital works exactly its licensed skilled
  // demand, so its basis is the labour allocation over its own base.
  const buildings = computeHomeworldBuildings(HOME_SYSTEM_POP);
  const alloc = computeLabourAllocation(labourParts(buildings), HOME_SYSTEM_POP);
  const basis = { population: HOME_SYSTEM_POP, technicians: alloc.technicians, engineers: alloc.engineers };
  // …retain the existing per-good production ≥ consumption + recipeDraw assertion body, with the
  // `${governmentType}/${g}` message labels reduced to `${g}`.
});
```

`lib/world/__tests__/gen.test.ts:168-194` — the test's real content is now the frontier fallback for
an unowned system, so re-point it:

```ts
describe("generateWorld: market seeding", () => {
  it("seeds owned markets from the shared civilian basket and unowned tick rows as frontier", () => {
    const world = generateWorld({
      systemCount: 60,
      seed: 8,
      playerFaction: { name: "Marshalate", governmentType: "militarist", doctrine: "hegemonic" },
    });
    const player = world.factions.find((faction) => faction.name === "Marshalate")!;
    const home = world.systems.find((system) => system.id === player.homeworldId)!;
    const buildings: Record<string, number> = {};
    for (const building of world.buildings) {
      if (building.systemId === home.id) buildings[building.buildingType] = building.count;
    }
    const yields = resourceVectorFromColumns({
      yieldGas: home.yieldGas, yieldMinerals: home.yieldMinerals, yieldOre: home.yieldOre,
      yieldBiomass: home.yieldBiomass, yieldArable: home.yieldArable, yieldWater: home.yieldWater,
      yieldRadioactive: home.yieldRadioactive,
    }, "yield");
    const basis = computeSystemLabourSnapshot(buildings, home.population).basis;
    const weapons = world.markets.find((market) => market.systemId === home.id && market.goodId === "weapons")!;
    expect(weapons.demandRate).toBeCloseTo(civilianDemandRateForGood("weapons", basis), 10);
    expect(weapons.stock).toBe(getInitialStock(buildings, yields, home.population, "weapons"));

    const unowned = world.systems.find((system) => system.factionId === null)!;
    expect(toTickSystems(world).find((system) => system.id === unowned.id)?.governmentType).toBe("frontier");
  });
});
```

- [ ] **Step 8: Run the type-checker until clean**

Run: `npx tsc --noEmit`
Expected: PASS (no output).

- [ ] **Step 9: Run the full unit suite and fix the fallout**

Run: `npx vitest run`
Expected: FAIL initially. Known-affected fixtures carrying a now-dead `governmentType` property are
listed in Task A2 — object literals with an extra property fail `tsc` only where the type is exact,
so most will surface here as behavioural drift instead. Two invariance bridges will move because
S=1 output changes: `lib/engine/__tests__/economy-scale-invariance.test.ts` and
`lib/world/__tests__/economy-scale-dynamic-invariance.test.ts`. **Their ratio assertions must still
hold** — only magnitudes move. If a *ratio* assertion breaks, stop: that is a real defect, not a
fixture update.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(economy): delete the flat government consumption boost

The boost was a population-independent term inside consumptionRate — ~2% of a
pop-1000 basket and ~92% of a pop-2 colony seed's, so it distorted small systems
hardest and made a federation colony's founding manifest 99% medicine by quantity.
Governments keep their event weights and danger baseline and become economically
inert until the government layer is revisited.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: Prune the dead `governmentType` fields from the row and world types

`governmentType` is now carried by row types nobody reads it from. It stays on `TickSystem`
(`lib/tick/rows.ts:32`) — the harness region overview and the relations path still read it — but
comes off the planner/logistics rows and the market seed.

**Files:**
- Modify: `lib/tick/world/directed-build-world.ts:19`, `lib/tick/world/directed-logistics-world.ts:39`
- Modify: `lib/tick/processors/good-market-state.ts:16-22`
- Modify: `lib/world/markets.ts:15-27`
- Modify: `lib/world/tick.ts:294-302` (`buildLogisticsRows`), `:309-323` (`buildBuildRows`), `:516-523`
- Modify: `lib/tick-harness/build-analysis.ts:83-84`
- Test: `lib/tick/processors/__tests__/directed-build.test.ts`, `.../directed-logistics.test.ts`,
  `.../good-market-state.test.ts`, `lib/tick/adapters/memory/__tests__/directed-build.test.ts`,
  `.../economy.test.ts`, `.../infrastructure.test.ts`, `lib/tick-harness/__tests__/build-analysis.test.ts`,
  `lib/world/__tests__/tick-treasury.test.ts`, `lib/world/__tests__/apply-developments.test.ts`

**Interfaces:**
- Consumes: the Task A1 signatures.
- Produces: `MarketStateSource` and `SystemMarketSeed` without `governmentType`; `FoundedColonySystem`
  = `Pick<TickSystem, "id" | "control" | "population" | "buildings">`.

- [ ] **Step 1: Delete the field from the five type declarations**

Remove the `governmentType: GovernmentType;` line (and the now-unused `GovernmentType` import where
it was the only use) from:
- `lib/tick/world/directed-build-world.ts` (`SystemBuildRow`)
- `lib/tick/world/directed-logistics-world.ts` (`SystemLogisticsRow`)
- `lib/tick/processors/good-market-state.ts` (`MarketStateSource`)
- `lib/world/markets.ts` (`SystemMarketSeed`)
- `lib/tick-harness/build-analysis.ts` (`FoundedColonySystem` — drop `"governmentType"` from the `Pick`)

- [ ] **Step 2: Stop populating it at the three construction sites**

Delete `governmentType: s.governmentType,` from `buildLogisticsRows` (`lib/world/tick.ts:298`) and
`buildBuildRows` (`:314`), and `governmentType: sys.governmentType,` from the `createSystemMarkets`
call at `:521`.

- [ ] **Step 3: Run the type-checker to find the fixtures**

Run: `npx tsc --noEmit`
Expected: FAIL — "Object literal may only specify known properties" at each test fixture that still
sets `governmentType` on one of these rows. Delete the property at each.

- [ ] **Step 4: Verify clean**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(tick): prune the dead governmentType from planner and market-seed rows

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task A3: Drop the Government segment from the UI and fold the docs

**Files:**
- Modify: `components/system/population-panel.tsx:16-23`
- Modify: `lib/types/api.ts:163`
- Modify: `docs/SPEC.md` (interaction map)
- Modify: `docs/active/gameplay/faction-system.md`, `universe.md`, `navigation.md`, `economy.md`
- Modify: `lib/world/__tests__/economy-scale-dynamic-invariance.test.ts` (docstring only)

**Interfaces:**
- Consumes: `ConsumptionBreakdown` without `government` (Task A1).

- [ ] **Step 1: Remove the Government swatch from the needs tooltip**

```tsx
// components/system/population-panel.tsx
// Tier swatch colours match the dataviz-validated categorical set (base copper /
// technician deep-cyan / engineer purple) used elsewhere for consumer tiers.
const TIER_META = [
  { key: "base", label: "Base population", color: "#d06a42" },
  { key: "technicians", label: "Technicians", color: "#0891b2" },
  { key: "engineers", label: "Engineers", color: "#a855f7" },
] as const;
```

And in `lib/types/api.ts:163`:
```ts
  /** want's composition — base + technicians + engineers. */
```

- [ ] **Step 2: Fix the SPEC.md interaction map**

`docs/SPEC.md:174` currently reads `- **Government → Economy**: Consumption boosts`. Delete that
line, and delete the corresponding `GOV` edge from the mermaid interaction diagram if it exists only
for consumption. Government still reaches Navigation (danger baseline) — leave `:175` alone.

- [ ] **Step 3: Fix the active gameplay docs**

Present tense, current reality, no change-history (project doc convention). Grep first so nothing is
missed:

Run: `grep -rniE "consumption boost|consumptionBoost" docs/active docs/SPEC.md`

Then, at minimum:
- `docs/active/gameplay/faction-system.md` — §"Government Types": government type is an
  event-weight and danger axis; it carries **no** economic modifier today. Delete the
  Consumption-boost column from the §133-135 modifier table (keep Danger). Fix the line that says
  "The economy processor reads `governmentType` per-market" — it does not. Fix "Economic identity —
  drives market behavior" in the §43 field table. Add a one-line pointer that a replacement economic
  axis is a planned government-layer revisit.
- `docs/active/gameplay/universe.md:177` — drop "consumption boosts" from the Government → Economy
  bullet (danger baseline remains).
- `docs/active/gameplay/navigation.md:64` — same.
- `docs/active/gameplay/economy.md` — whatever the grep finds.

- [ ] **Step 4: State the invariance-coverage loss rather than letting it go silent**

`lib/world/__tests__/economy-scale-dynamic-invariance.test.ts:22-26` names the government
consumption scaling as one of the two things the bridge exists to exercise. Rewrite that paragraph:

```
 * The invariant breaks the instant any goods-magnitude term is quantised
 * (`Math.round`/`floor` on a goods amount) or left as an unscaled absolute — those
 * are a rounding error at S=100 but a large fraction at S=1, so they diverge only
 * at low scale and compound through every cycle start. This broad end-to-end guard
 * reliably exercises the seed-stock de-rounding (from tick 0) and every per-capita
 * demand term through the economy cycle. There is no longer a flat scaled
 * demand term in the civilian path to exercise — the civilian basket is
 * population-proportional throughout — so that specific coverage is gone rather than
 * merely untested. The logistics-transfer term is guarded directly by a focused unit
 * test (`lib/tick/processors/__tests__/directed-logistics.test.ts`) instead, because
 * directed transfers don't reliably fire within this short window for an arbitrary seed.
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(economy): government is economically inert; drop the needs Government segment

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task A4: Verify, measure the correction, and open the PR

The deletion's fallout is a **validation target**, not something to soften. The one thing that must
NOT happen is a permanent teardown: capacity in the eight boosted goods should step down once and
then stabilise.

**Files:** none (measurement + PR).

- [ ] **Step 1: Take the baseline reading BEFORE the branch's changes**

```bash
git stash list   # ensure clean
git switch feat/band-reconciliation
npm run simulate -- --ticks 3000 --seed 42 > /tmp/baseline.txt || true
git switch feat/necessity-unrest-gov-deletion
```
(Use the scratchpad directory rather than `/tmp` — see the session scratchpad path. If a 3000-tick
baseline already exists from PR5's ship at `fe26bbbb`, reuse it and say so.)

- [ ] **Step 2: Run the full gate**

Run: `npx vitest run && npx tsc --noEmit && npx next build --webpack`
Expected: all three PASS. (`next build --webpack` is the build gate, not the Turbopack build.)

- [ ] **Step 3: Take the after reading**

Run: `npm run simulate -- --ticks 3000 --seed 42`
Record, and compare against the baseline: built base total and per-good levels for the eight boosted
goods (medicine, luxuries, weapons, fuel, machinery, food, electronics, textiles), median price
vs base, collapsed/stranded counts, mean unrest, striking share, founding-stock opening
satisfaction.

**Expected:** built capacity in the eight goods steps down and holds; median price does not move
much for the other eighteen; founding-stock opening satisfaction improves markedly (the manifest
stops being ~99% medicine). **Unrest and striking share should barely move** — the fold is PR B.
If the eight goods ratchet toward zero over the run rather than settling, that is the one real
failure mode; investigate before shipping.

- [ ] **Step 4: Push, open the PR, then review**

```bash
git push -u origin feat/necessity-unrest-gov-deletion
gh pr create --base feat/band-reconciliation --title "feat(economy): delete the government consumption boost" --body "..."
```
Then run `/uber-review` (local, diffing against the shared branch) so findings land as PR comments.
Fix cheap, self-contained, already-touching Minor findings in-task.

- [ ] **Step 5: Merge into the shared branch**

Squash or fast-forward into `feat/band-reconciliation`. **Do not** start PR B's branch until this
has landed in shared.

---

# PR B — The necessity fold

Three changes that ship together because the containment guarantee is a claim about the set:
`GOOD_NECESSITY` (whose shortfall counts), the regime ceilings (how far unrest can settle), and the
survival-good floor (famine is famine at any D).

**The arithmetic below is measured, not estimated — do not re-derive it.** At the authored weights
the weighted denominator is ≈45.66 (in units of raw-basket %) and the scenarios fold to: water empty
0.373, food empty 0.320, water+food 0.692, all tier-1+2 empty 0.140, luxuries empty 0.0013, water at
50% 0.093, water at 20% 0.239. Today's *unweighted* fold scores the ambient deficit at **2.2× a
total water failure**; weighted, a water failure scores **2.6× the ambient deficit**. Any cut in
(0.141, 0.319] separates them.

### Task B1: The `GOOD_NECESSITY` and `SURVIVAL_GOODS` tables

**Files:**
- Modify: `lib/constants/physical-economy.ts` (append after `GOOD_CONSUMPTION`, before the skill baskets)
- Test: `lib/constants/__tests__/physical-economy.test.ts`

**Interfaces:**
- Consumes: `consumptionRate(goodId, basis)` (PR A).
- Produces: `GOOD_NECESSITY: Record<string, number>`, `SURVIVAL_GOODS: readonly string[]`.

- [ ] **Step 1: Write the failing coverage test**

```ts
// lib/constants/__tests__/physical-economy.test.ts — add to the imports:
//   GOOD_NECESSITY, SURVIVAL_GOODS from "../physical-economy"
describe("GOOD_NECESSITY", () => {
  it("weights every good, and only real goods", () => {
    // Total over GOODS by construction: a good added without a weight would silently drop out of
    // the unrest fold (weight 0), so the build fails here instead.
    const known = new Set(GOOD_NAMES);
    for (const goodId of GOOD_NAMES) {
      const n = GOOD_NECESSITY[goodId];
      expect(n, `necessity: ${goodId}`).toBeGreaterThan(0);
      expect(n, `necessity: ${goodId}`).toBeLessThanOrEqual(1);
    }
    for (const goodId of Object.keys(GOOD_NECESSITY)) expect(known.has(goodId), goodId).toBe(true);
  });

  it("is authored, not read off consumption volume — medicine outweighs gas", () => {
    // The defect this table exists to fix: GOOD_CONSUMPTION is a TIER gradient, so medicine (0.001)
    // sits below gas (0.004) purely because medicine is tier-1. Necessity must invert that.
    expect(GOOD_CONSUMPTION.medicine).toBeLessThan(GOOD_CONSUMPTION.gas);
    expect(GOOD_NECESSITY.medicine).toBeGreaterThan(GOOD_NECESSITY.gas);
  });

  it("puts the survival goods strictly at the top", () => {
    for (const goodId of SURVIVAL_GOODS) {
      expect(GOOD_NAMES, goodId).toContain(goodId);
      expect(GOOD_NECESSITY[goodId], goodId).toBe(1);
    }
    for (const goodId of GOOD_NAMES) {
      if (SURVIVAL_GOODS.includes(goodId)) continue;
      expect(GOOD_NECESSITY[goodId], goodId).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/constants/__tests__/physical-economy.test.ts`
Expected: FAIL — `GOOD_NECESSITY` is not exported from `../physical-economy`.

- [ ] **Step 3: Author the tables**

```ts
// lib/constants/physical-economy.ts — directly after GOOD_CONSUMPTION
/**
 * Per-good necessity — how much NOT having a good counts as suffering, in (0,1]. A peer table to
 * GOOD_CONSUMPTION and deliberately NOT derived from it: consumption volume is a tier gradient
 * (medicine 0.001 sits below gas 0.004 purely because medicine is tier-1), the price floor/ceiling
 * pair is a pure tier lookup, and `volatility` is unread — so every existing signal that looks like
 * necessity gets it backwards. People still want the luxuries; this table just stops the model
 * calling not having them suffering.
 *
 * Dimensionless: it weights a ratio, so it never rides ECONOMY_SCALE (no scaleRecord). Only the
 * relative shape matters; magnitudes are a first draft and the simulator owns the finals. Moving any
 * weight moves the scenario arithmetic the shortage cut was drawn against — re-derive it (see
 * lib/constants/__tests__/band-constants.test.ts), don't nudge the cut.
 */
export const GOOD_NECESSITY: Record<string, number> = {
  // Survival — losing either of these must be able to collapse a system.
  water: 1.0,
  food: 1.0,
  // Health.
  medicine: 0.8,
  // Daily life.
  gas: 0.4,
  textiles: 0.4,
  // Broad utility.
  consumer_goods: 0.35,
  fuel: 0.3,
  // Industrial staples.
  biomass: 0.15,
  chemicals: 0.15,
  electronics: 0.15,
  // Industrial inputs.
  ore: 0.1,
  minerals: 0.1,
  metals: 0.1,
  polymers: 0.1,
  // Discretionary / military.
  radioactives: 0.05,
  alloys: 0.05,
  components: 0.05,
  machinery: 0.05,
  luxuries: 0.05,
  // Pure war matériel — a population deprived of these is not deprived.
  munitions: 0.02,
  hull_plating: 0.02,
  weapons: 0.02,
  weapons_systems: 0.01,
  targeting_arrays: 0.01,
  reactor_cores: 0.01,
  ship_frames: 0.01,
};

/**
 * The goods whose deprivation is famine rather than scarcity. Below SHORTAGE_SATISFACTION on either
 * one, a system reads Shortage whatever the rest of the basket looks like: dissatisfaction squares
 * the gap, so water at half rations folds to only ~0.09 and no workable cut on the fold alone
 * catches a population that is genuinely on half rations.
 */
export const SURVIVAL_GOODS: readonly string[] = ["water", "food"];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/constants/__tests__/physical-economy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/physical-economy.ts lib/constants/__tests__/physical-economy.test.ts
git commit -m "feat(economy): add the authored GOOD_NECESSITY weight table

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task B2: Necessity-weighted `dissatisfaction`, and the D-based regime with the survival floor

**Files:**
- Modify: `lib/constants/economy.ts` (add `D_SHORTAGE_CUT`, `D_SHORTAGE_BLEND`; re-point the `SHORTAGE_SATISFACTION` docstring)
- Modify: `lib/engine/population.ts:1-78`
- Modify: `lib/tick/types.ts:52-56`
- Modify: `lib/tick/processors/economy.ts:20-26`, `:195-235`
- Modify: `lib/engine/directed-build.ts:116-131`
- Modify: `lib/tick-harness/build-analysis.ts:141-151`
- Test: `lib/engine/__tests__/population.test.ts:15-57`

**Interfaces:**
- Consumes: `GOOD_NECESSITY`, `SURVIVAL_GOODS` (B1).
- Produces:
  - `interface GoodSatisfaction { goodId: string; satisfaction: number; demanded: number }`
  - `dissatisfaction(goods: GoodSatisfaction[]): number`
  - `interface SupplyState { regime: SupplyRegime; survivalShortfall: boolean }`
  - `foldSupplyState(goods: GoodSatisfaction[], d: number): SupplyState`
  - `EconomySignals.supplyStateBySystem: Map<string, SupplyState>` (replaces `supplyRegimeBySystem`)

**Design ruling this task locks (the one place the spec left two readings):** the survival floor
selects the Shortage *label* **and** the Shortage *ceiling* (Task B3), while the D-driven path ramps
continuously across the cut. Selecting only the label would make the floor simulation-inert —
Rationing and Shortage share a relaxation rate, so the label alone changes nothing, and the spec's
"gives `SHORTAGE_SATISFACTION` a live sim consumer" would be empty. The spec's "continuous
everywhere" objection is stated entirely about the D cut ("would double a system's settled unrest for
an arbitrarily small change in delivered goods… landing the step across strike onset"); the survival
step is at a per-good satisfaction line, is small where it binds (D is small there), and lands
nowhere near a threshold. `SupplyState` carries the bit so the ceiling can see it without inferring
it from the label.

- [ ] **Step 1: Write the failing engine tests**

Replace the existing `describe("dissatisfaction …")` and `describe("supplyRegime …")` blocks in
`lib/engine/__tests__/population.test.ts` (lines 15-57) with:

```ts
import { D_SHORTAGE_CUT } from "@/lib/constants/economy";

describe("dissatisfaction (convex, necessity-weighted)", () => {
  it("is 0 when fully satisfied and 0 when nothing is demanded", () => {
    expect(dissatisfaction([
      { goodId: "food", satisfaction: 1, demanded: 10 },
      { goodId: "luxuries", satisfaction: 1, demanded: 2 },
    ])).toBeCloseTo(0, 6);
    expect(dissatisfaction([])).toBe(0);
    expect(dissatisfaction([{ goodId: "food", satisfaction: 0, demanded: 0 }])).toBe(0);
  });

  it("ranks by necessity, not by how much is bought", () => {
    // Equal demand, opposite necessity: the medicine shortfall must dominate the luxuries one even
    // though the basket wants exactly as much of each. Demand-share alone cannot express this.
    const medicineCut = dissatisfaction([
      { goodId: "medicine", satisfaction: 0, demanded: 10 },
      { goodId: "luxuries", satisfaction: 1, demanded: 10 },
    ]);
    const luxCut = dissatisfaction([
      { goodId: "medicine", satisfaction: 1, demanded: 10 },
      { goodId: "luxuries", satisfaction: 0, demanded: 10 },
    ]);
    expect(medicineCut).toBeGreaterThan(luxCut * 5);
  });

  it("still weights by how much is wanted, at equal necessity", () => {
    const deep = dissatisfaction([
      { goodId: "water", satisfaction: 0, demanded: 90 },
      { goodId: "food", satisfaction: 1, demanded: 10 },
    ]);
    const shallow = dissatisfaction([
      { goodId: "water", satisfaction: 1, demanded: 90 },
      { goodId: "food", satisfaction: 0, demanded: 10 },
    ]);
    expect(deep).toBeGreaterThan(shallow);
  });

  it("convexity: one deep shortage dominates broad shallow tightness", () => {
    const deep = dissatisfaction([
      { goodId: "water", satisfaction: 0, demanded: 10 },
      { goodId: "water", satisfaction: 1, demanded: 90 },
    ]);
    const shallow = dissatisfaction([{ goodId: "water", satisfaction: 0.9, demanded: 100 }]);
    expect(deep).toBeGreaterThan(shallow);
  });

  it("ignores a good with no authored necessity rather than guessing one", () => {
    // Totality is enforced by a constants test; at runtime an unknown id must not invent a weight.
    expect(dissatisfaction([
      { goodId: "not_a_good", satisfaction: 0, demanded: 100 },
      { goodId: "water", satisfaction: 1, demanded: 10 },
    ])).toBe(0);
  });
});

describe("foldSupplyState (D cut + survival floor)", () => {
  const full = (goodId: string, demanded: number) => ({ goodId, satisfaction: 1, demanded });

  it("is supplied only at D exactly 0", () => {
    const goods = [full("water", 10), full("luxuries", 2)];
    expect(foldSupplyState(goods, dissatisfaction(goods)).regime).toBe("supplied");
    expect(foldSupplyState([], 0).regime).toBe("supplied");
  });

  it("is rationing for any positive D below the cut", () => {
    const goods = [{ goodId: "luxuries", satisfaction: 0, demanded: 2 }, full("water", 100)];
    const state = foldSupplyState(goods, dissatisfaction(goods));
    expect(state.regime).toBe("rationing");
    expect(state.survivalShortfall).toBe(false);
  });

  it("is shortage at or above the cut", () => {
    expect(foldSupplyState([full("ore", 10)], D_SHORTAGE_CUT).regime).toBe("shortage");
    expect(foldSupplyState([full("ore", 10)], D_SHORTAGE_CUT - 1e-9).regime).toBe("rationing");
  });

  it("selects shortage from the survival floor even when D is far below the cut", () => {
    // Water at half rations folds to ~0.09 — nowhere near any workable cut, yet the population is
    // genuinely on half rations. This is the case the floor exists for.
    const goods = [
      { goodId: "water", satisfaction: SHORTAGE_SATISFACTION - 1e-9, demanded: 100 },
      full("ore", 400),
    ];
    const d = dissatisfaction(goods);
    expect(d).toBeLessThan(D_SHORTAGE_CUT);
    const state = foldSupplyState(goods, d);
    expect(state.regime).toBe("shortage");
    expect(state.survivalShortfall).toBe(true);
  });

  it("treats exactly the shortage satisfaction line as not a survival shortfall (strict <)", () => {
    const goods = [{ goodId: "food", satisfaction: SHORTAGE_SATISFACTION, demanded: 100 }];
    expect(foldSupplyState(goods, dissatisfaction(goods)).survivalShortfall).toBe(false);
  });

  it("ignores a zero-demand survival good", () => {
    const goods = [{ goodId: "water", satisfaction: 0, demanded: 0 }, full("ore", 5)];
    expect(foldSupplyState(goods, dissatisfaction(goods)).survivalShortfall).toBe(false);
  });

  it("does not let a non-survival good trip the floor at any depth", () => {
    const goods = [{ goodId: "luxuries", satisfaction: 0, demanded: 5 }, full("water", 5)];
    expect(foldSupplyState(goods, dissatisfaction(goods)).survivalShortfall).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/population.test.ts`
Expected: FAIL — `foldSupplyState` is not exported; `GoodSatisfaction` has no `goodId`.

- [ ] **Step 3: Add the two D constants**

```ts
// lib/constants/economy.ts — after SHORTAGE_SATISFACTION
/**
 * System dissatisfaction D at or above which the supply regime reads Shortage rather than Rationing.
 * Cut against the measured 26-good basket under GOOD_NECESSITY: the ambient barren-galaxy deficit
 * (every tier-1 and tier-2 good empty) folds to ≈0.14 while a total water failure folds to ≈0.37, so
 * any cut in (0.141, 0.319] grades famine as Shortage and ambient scarcity as Rationing. Both
 * endpoints are scenario values, not constants — moving any necessity weight moves them, so re-derive
 * rather than nudge (lib/constants/__tests__/band-constants.test.ts asserts the separation holds).
 * First cut; the simulator owns the final.
 */
export const D_SHORTAGE_CUT = 0.25;

/**
 * Width of the D band above the cut across which the unrest ceiling ramps from the Rationing value to
 * the Shortage one. The ramp starts AT the cut and never below it, so the Rationing containment
 * guarantee (sustained Rationing cannot reach collapse at any tax) holds across the whole Rationing
 * range; a hard branch here would instead double a system's settled unrest for an arbitrarily small
 * change in delivered goods, and land that step across strike onset. Narrow enough that a total food
 * failure still reaches the full Shortage ceiling — asserted from the constants, not assumed.
 */
export const D_SHORTAGE_BLEND = 0.05;
```

Also re-point the `SHORTAGE_SATISFACTION` docstring, which names the deleted worst-good fold:

```ts
/**
 * Civilian satisfaction (delivered/demanded) below which a demanded good counts as a Shortage rather
 * than mere Rationing. Its live consumer is the survival-good floor (`foldSupplyState`): water or food
 * below this level selects Shortage for the whole system whatever the fold says. A strict `<`
 * boundary: exactly this level is still Rationing.
 */
export const SHORTAGE_SATISFACTION = 0.5;
```

- [ ] **Step 4: Rewrite the fold and the regime in the population engine**

```ts
// lib/engine/population.ts — imports
import { clamp } from "@/lib/utils/math";
import { SHORTAGE_SATISFACTION, D_SHORTAGE_CUT } from "@/lib/constants/economy";
import { GOOD_NECESSITY, SURVIVAL_GOODS } from "@/lib/constants/physical-economy";

/** One consumed good's signal for a system this tick. */
export interface GoodSatisfaction {
  /** Which good this reading is for — resolves its GOOD_NECESSITY weight and survival status. */
  goodId: string;
  /** delivered / demanded in [0,1]; 1 = well-fed, 0 = floor-pinned. */
  satisfaction: number;
  /** demanded_g = civilian demand (per-capita baseline + skilled baskets). */
  demanded: number;
}

/** demanded × necessity — the fold's weight. An unweighted good contributes nothing, either way. */
function goodWeight(g: GoodSatisfaction): number {
  return Math.max(0, g.demanded) * Math.max(0, GOOD_NECESSITY[g.goodId] ?? 0);
}

/**
 * Convex, necessity-weighted dissatisfaction D in [0,1] for one system:
 *   weight_g = demanded_g × necessity_g,  share_g = weight_g / Σ weight
 *   D        = Σ share_g × (1 − satisfaction_g)²
 * Importance is the AUTHORED necessity weight times how much is actually wanted — demand volume alone
 * is a tier gradient and ranks medicine below gas. Convexity makes a deep shortage dominate many
 * shallow ones. Necessity is resolved from goodId here rather than passed in, so no call site can
 * diverge on the table. Returns 0 when Σ weight ≤ 0.
 */
export function dissatisfaction(goods: GoodSatisfaction[]): number {
  let totalWeight = 0;
  for (const g of goods) totalWeight += goodWeight(g);
  if (totalWeight <= 0) return 0;
  let d = 0;
  for (const g of goods) {
    const share = goodWeight(g) / totalWeight;
    const gap = 1 - clamp(g.satisfaction, 0, 1);
    d += share * gap * gap;
  }
  return d;
}

/** Supply-rate class for a system this tick. */
export type SupplyRegime = "supplied" | "rationing" | "shortage";

/**
 * The system's supply reading. `survivalShortfall` is carried alongside the label because the two
 * drive different things: the label picks the relaxation rate, the shortfall promotes the unrest
 * ceiling to the Shortage bound (see unrestCeiling). It cannot be inferred back from the label —
 * a D-driven Shortage and a survival-driven one carry the same label and must not carry the same
 * ceiling shape.
 */
export interface SupplyState {
  regime: SupplyRegime;
  /** A demanded survival good (water/food) is below SHORTAGE_SATISFACTION. */
  survivalShortfall: boolean;
}

/** Is a demanded survival good below the shortage line? */
function hasSurvivalShortfall(goods: GoodSatisfaction[]): boolean {
  for (const g of goods) {
    if (g.demanded <= 0 || !SURVIVAL_GOODS.includes(g.goodId)) continue;
    if (clamp(g.satisfaction, 0, 1) < SHORTAGE_SATISFACTION) return true;
  }
  return false;
}

/**
 * The SYSTEM-level supply label, from the dissatisfaction the same goods folded to plus the
 * survival-good floor:
 *  - shortage  — D ≥ D_SHORTAGE_CUT, or a demanded survival good below SHORTAGE_SATISFACTION.
 *  - supplied  — D exactly 0. Reachable exactly, not approximately: delivery is full while stock
 *                covers the ration knee, so every gap above it is exactly 0.
 *  - rationing — anything in between.
 * `d` is the caller's own `dissatisfaction(goods)` over the SAME array, passed rather than recomputed
 * so the two folds cannot diverge. This label is about the whole system; the per-good chips read
 * stock cover and are a different labelling entirely.
 */
export function foldSupplyState(goods: GoodSatisfaction[], d: number): SupplyState {
  const survivalShortfall = hasSurvivalShortfall(goods);
  if (survivalShortfall) return { regime: "shortage", survivalShortfall };
  if (d >= D_SHORTAGE_CUT) return { regime: "shortage", survivalShortfall };
  return { regime: d > 0 ? "rationing" : "supplied", survivalShortfall };
}
```

Delete the old `supplyRegime` function entirely.

- [ ] **Step 5: Run to verify the engine tests pass**

Run: `npx vitest run lib/engine/__tests__/population.test.ts`
Expected: PASS for the two rewritten describes. Other blocks in the file (accumulateUnrest) still
fail — Task B3 owns them.

- [ ] **Step 6: Thread `goodId` through the three constructors and rename the signal**

`lib/tick/types.ts`:
```ts
  /** Per-system supplied/rationing/shortage reading of this cycle's consumption satisfaction, with
   *  the survival-good shortfall bit the unrest ceiling reads. */
  supplyStateBySystem: Map<string, SupplyState>;
```
(and swap the `SupplyRegime` import for `SupplyState`.)

`lib/tick/processors/economy.ts` — import `foldSupplyState` and `type SupplyState` in place of
`supplyRegime`/`SupplyRegime`; at line ~201 push the id, and at ~221-235 emit both folds:
```ts
      arr.push({ goodId: m.goodId, satisfaction: satisfactionByIndex[i], demanded });
...
  // Two folds of the same per-good satisfactions: D is the magnitude of the shortfall, the supply
  // state is its class. A system with no consuming markets reads supplied.
  const dissatisfactionBySystem = new Map<string, number>();
  const supplyStateBySystem = new Map<string, SupplyState>();
  for (const sysId of systemIds) {
    const goods = goodsBySystem.get(sysId) ?? [];
    const d = dissatisfaction(goods);
    dissatisfactionBySystem.set(sysId, d);
    supplyStateBySystem.set(sysId, foldSupplyState(goods, d));
  }
  const economySignals: EconomySignals = {
    dissatisfactionBySystem,
    supplyStateBySystem,
    sellingFactorBySystem,
    realizedProductionBySystem,
  };
```

`lib/tick-harness/build-analysis.ts:149` — `list.push({ goodId: m.goodId, satisfaction: m.satisfaction ?? 1, demanded });`

`lib/engine/directed-build.ts` `supplyDissatisfaction` — Task B4 rewrites this function wholesale;
for now just add `goodId: g.goodId,` to the mapped object so the tree compiles.

- [ ] **Step 7: Fix the compile fallout and run the suite**

Run: `npx tsc --noEmit`
Expected: FAIL at `lib/tick/processors/population.ts` (reads `supplyRegimeBySystem`) and at the test
fixtures that build `EconomySignals` (`lib/tick/processors/__tests__/treasury.test.ts:49-50`,
`.../population.test.ts:68-69` and its `ctxWithD` helper). Update each to
`supplyStateBySystem` carrying `{ regime, survivalShortfall: false }`. `population.ts` is finished in
Task B3 — a minimal `?.regime ?? "supplied"` read is fine here.

Run: `npx vitest run`
Expected: the `accumulateUnrest` describes still fail (B3 owns them); everything else PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(population): weight the dissatisfaction fold by authored necessity

The fold picked the unrest rate off the worst single demanded good, so one tier-2
good below half-satisfaction flipped a whole system into the fast rate — the ambient
state in a barren-by-design galaxy. D is now a necessity-weighted convex fold and the
regime is a cut on D plus a water/food survival floor.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task B3: Unrest ceilings — `gain = ceiling × decay`, blended across the cut

**Files:**
- Modify: `lib/engine/population.ts` (`UnrestParams`, `unrestCeiling`, `accumulateUnrest`, module docstring)
- Modify: `lib/constants/population.ts:5-18` (`UNREST_PARAMS`), `:36-54` (`POPULATION_PARAMS` docstring)
- Modify: `lib/tick/processors/population.ts:31-61`
- Test: `lib/engine/__tests__/population.test.ts` (accumulateUnrest block), `lib/constants/__tests__/band-constants.test.ts`

**Interfaces:**
- Consumes: `SupplyState`, `D_SHORTAGE_CUT`, `D_SHORTAGE_BLEND`, `GOOD_NECESSITY` (B1/B2).
- Produces:
  - `interface UnrestParams { ceilingRationing: number; ceilingShortage: number; decay: number; recoveryDecay: number }`
  - `unrestCeiling(d: number, survivalShortfall: boolean, params: UnrestParams): number`
  - `accumulateUnrest(unrest: number, d: number, floor: number, supply: SupplyState, params: UnrestParams): number`

**Why two ceilings and not one (do not re-derive):** sustained Rationing must never reach collapse at
the highest tax → ceiling < `(0.75 − 0.18 − 0.05) / 0.25` = 2.08. A total food failure must collapse at
zero tax → ceiling > `0.75 / 0.320` = 2.34. No single number satisfies both, so the two-regime
structure is load-bearing rather than decorative: famine needs a steeper response than ordinary
scarcity, not merely a larger D.

- [ ] **Step 1: Write the failing containment tests**

Add to `lib/constants/__tests__/band-constants.test.ts`. Every bound is computed from the shared
constants — no hardcoded sums.

```ts
import { GOOD_NAMES } from "@/lib/constants/goods";
import { GOOD_NECESSITY, SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { UNREST_PARAMS } from "@/lib/constants/population";
import { unrestCeiling } from "@/lib/engine/population";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { D_SHORTAGE_CUT, D_SHORTAGE_BLEND } from "@/lib/constants/economy";

/**
 * Each good's weighted share of the ordinary unskilled basket — exactly the quantity the fold
 * divides by, rebuilt from the shipped tables so a weight change moves these numbers instead of
 * silently invalidating them. Unskilled: the basket is population-proportional, so the shares are
 * the same at any population.
 */
function weightedShares(): Map<string, number> {
  const basis = { population: 1000, technicians: 0, engineers: 0 };
  const raw = new Map<string, number>();
  let total = 0;
  for (const goodId of GOOD_NAMES) {
    const w = consumptionRate(goodId, basis) * GOOD_NECESSITY[goodId];
    raw.set(goodId, w);
    total += w;
  }
  const shares = new Map<string, number>();
  for (const [goodId, w] of raw) shares.set(goodId, w / total);
  return shares;
}

/** D when `empty` are at satisfaction 0 and everything else is fully delivered. */
function dFor(empty: readonly string[]): number {
  const shares = weightedShares();
  let d = 0;
  for (const goodId of empty) d += shares.get(goodId) ?? 0;
  return d;
}

/** Equilibrium unrest under sustained D at a given standing floor: floor + ceiling(D) × D. */
function settled(d: number, floor: number, survivalShortfall = false): number {
  return floor + unrestCeiling(d, survivalShortfall, UNREST_PARAMS) * d;
}

const MAX_FLOOR = Math.max(...Object.values(TAX_LEVEL_UNREST_PRESSURE)) + CROWDING.PRESSURE_MAX;
const COLLAPSE = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold;
const TIER1PLUS2 = GOOD_NAMES.filter((g) => (GOOD_TIER_BY_KEY[g] ?? 0) > 0);

describe("necessity fold — the separation the shortage cut was drawn against", () => {
  it("grades a total water or food failure above the ambient barren-galaxy deficit", () => {
    // The whole point of the weight. Unweighted, the ambient deficit scored 2.2x a total water
    // failure, so no cut could separate them; weighted, the ordering inverts.
    const ambient = dFor(TIER1PLUS2);
    expect(dFor(["water"])).toBeGreaterThan(ambient * 2);
    expect(dFor(["food"])).toBeGreaterThan(ambient * 2);
  });

  it("puts the shortage cut strictly between the two", () => {
    expect(D_SHORTAGE_CUT).toBeGreaterThan(dFor(TIER1PLUS2));
    expect(D_SHORTAGE_CUT).toBeLessThanOrEqual(dFor(["food"]));
  });
});

describe("unrest containment — the guarantees the two ceilings carry", () => {
  it("keeps the Shortage ceiling strictly above the Rationing one", () => {
    expect(UNREST_PARAMS.ceilingShortage).toBeGreaterThan(UNREST_PARAMS.ceilingRationing);
  });

  it("never lets sustained Rationing reach collapse, at any tax", () => {
    // Worst sustained Rationing: D just under the cut, the highest tax stance, fully overcrowded.
    expect(settled(D_SHORTAGE_CUT - 1e-9, MAX_FLOOR)).toBeLessThan(COLLAPSE);
  });

  it("lets a total water or food failure collapse, even at zero tax", () => {
    expect(settled(dFor(["water"]), 0)).toBeGreaterThan(COLLAPSE);
    expect(settled(dFor(["food"]), 0)).toBeGreaterThan(COLLAPSE);
  });

  it("lets a total water or food failure drive net decline at every tax level", () => {
    // An uncrowded system declines when unrest > 1 − D (growth and decline share a rate).
    for (const good of ["water", "food"]) {
      const d = dFor([good]);
      for (const pressure of Object.values(TAX_LEVEL_UNREST_PRESSURE)) {
        expect(settled(d, pressure), `${good} @ ${pressure}`).toBeGreaterThan(1 - d);
      }
    }
  });

  it("lets no non-survival good, alone, reach the strike threshold at any tax", () => {
    // The guarantee the deleted per-good contribution cap was meant to carry. It is a claim about
    // the constants, so it is a test rather than a runtime min() that can only cause harm when it fires.
    for (const goodId of GOOD_NAMES) {
      if (SURVIVAL_GOODS.includes(goodId)) continue;
      const d = dFor([goodId]);
      expect(settled(d, MAX_FLOOR), goodId).toBeLessThan(STRIKE_PARAMS.threshold);
    }
  });

  it("still lets a broad shortage strike under overcrowding and very-high tax, below collapse", () => {
    // "Only famine collapses" must not become "nothing but famine ever strikes".
    const worstRationing = settled(D_SHORTAGE_CUT - 1e-9, MAX_FLOOR);
    expect(worstRationing).toBeGreaterThan(STRIKE_PARAMS.threshold);
    expect(worstRationing).toBeLessThan(COLLAPSE);
  });

  it("blends the ceiling across the cut instead of switching it", () => {
    const below = unrestCeiling(D_SHORTAGE_CUT - 1e-6, false, UNREST_PARAMS);
    const above = unrestCeiling(D_SHORTAGE_CUT + 1e-6, false, UNREST_PARAMS);
    expect(Math.abs(above - below)).toBeLessThan(1e-4);
    expect(below).toBe(UNREST_PARAMS.ceilingRationing);
    expect(unrestCeiling(D_SHORTAGE_CUT + D_SHORTAGE_BLEND, false, UNREST_PARAMS))
      .toBeCloseTo(UNREST_PARAMS.ceilingShortage, 10);
  });

  it("holds the Rationing ceiling across the whole Rationing range", () => {
    // The ramp starts AT the cut, never below it — otherwise the containment guarantee above
    // would only hold at the bottom of the band.
    for (const d of [0, 0.05, 0.1, 0.2, D_SHORTAGE_CUT - 1e-9]) {
      expect(unrestCeiling(d, false, UNREST_PARAMS), `D=${d}`).toBe(UNREST_PARAMS.ceilingRationing);
    }
  });

  it("promotes a survival shortfall to the Shortage ceiling at any D", () => {
    expect(unrestCeiling(0.05, true, UNREST_PARAMS)).toBe(UNREST_PARAMS.ceilingShortage);
  });

  it("keeps the housing fed-gate below the shortage cut", () => {
    // A system the simulation calls starving must never be standing up new housing.
    expect(DIRECTED_BUILD.D_SETTLE).toBeLessThan(D_SHORTAGE_CUT);
  });
});
```

Add the missing imports at the top of the file (`STRIKE_PARAMS` and `CROWDING` are already imported;
add `GOOD_TIER_BY_KEY` from `@/lib/constants/goods`).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/constants/__tests__/band-constants.test.ts`
Expected: FAIL — `unrestCeiling` is not exported and `UNREST_PARAMS` has no `ceilingRationing`.

- [ ] **Step 3: Reparameterise the integrator**

```ts
// lib/engine/population.ts — add D_SHORTAGE_BLEND to the constants import
export interface UnrestParams {
  /** Maximum equilibrium unrest ABOVE the standing floor while Rationing — the value settled unrest
   *  reaches at D = 1, and hence the named bound the regime carries. */
  ceilingRationing: number;
  /** …and while Shortage. Strictly above ceilingRationing. */
  ceilingShortage: number;
  /** Relaxation rate toward the standing-pressure floor while Rationing/Shortage. */
  decay: number;
  /** Faster relaxation while Supplied — the recovery rate. */
  recoveryDecay: number;
}

/**
 * The equilibrium unrest ceiling this reading carries, in ceilingRationing…ceilingShortage.
 *
 * Two selectors, deliberately shaped differently. D drives a CONTINUOUS ramp across
 * [D_SHORTAGE_CUT, D_SHORTAGE_CUT + D_SHORTAGE_BLEND]: switching there would double a system's
 * settled unrest for an arbitrarily small change in delivered goods and land that step across strike
 * onset. The ramp starts at the cut, so the ceiling is exactly ceilingRationing across the whole
 * Rationing range and the containment guarantee holds at the top of it. A survival shortfall is a
 * step to ceilingShortage: famine in water or food is graded as famine whatever the fold says, which
 * is the guarantee the floor exists to make explicit rather than hope emerges from a squared average.
 * Total and monotone in both inputs.
 */
export function unrestCeiling(d: number, survivalShortfall: boolean, params: UnrestParams): number {
  if (survivalShortfall) return params.ceilingShortage;
  const ramp = D_SHORTAGE_BLEND > 0
    ? clamp((d - D_SHORTAGE_CUT) / D_SHORTAGE_BLEND, 0, 1)
    : (d >= D_SHORTAGE_CUT ? 1 : 0);
  return params.ceilingRationing + ramp * (params.ceilingShortage - params.ceilingRationing);
}

/**
 * Relaxes unrest toward its standing-pressure floor and integrates dissatisfaction on top:
 *   unrest <- clamp(floor + (1 - k)*(unrest - floor) + ceiling*k*clamp(d,0,1), 0, 1)
 * where k = clamp(supplied ? recoveryDecay : decay, 0, 1) and ceiling = unrestCeiling(d, …).
 *
 * Because the gain is `ceiling × k` rather than an independent number, the fixed point is exactly
 * `floor + ceiling × D` for ANY relaxation rate — so equilibrium, recovery speed and the tick's
 * catch-up factor are fully decoupled, and each ceiling constant states a maximum rather than
 * implying one through a ratio. `floor` is the standing pressure (tax + crowding), clamped to [0,1]
 * by the caller; at D = 0 unrest settles exactly at `floor`. Catastrophe still lives in the integral —
 * one bad cycle is recoverable, chronic shortage climbs toward the ceiling. The caller pre-scales the
 * decays by the catch-up factor (never the ceilings); k is clamped after scaling, so a large catch-up
 * can never flip the relaxation term and overshoot below the floor.
 */
export function accumulateUnrest(
  unrest: number,
  d: number,
  floor: number,
  supply: SupplyState,
  params: UnrestParams,
): number {
  const k = clamp(supply.regime === "supplied" ? params.recoveryDecay : params.decay, 0, 1);
  const ceiling = unrestCeiling(d, supply.survivalShortfall, params);
  const relaxed = floor + (1 - k) * (unrest - floor);
  return clamp(relaxed + ceiling * k * clamp(d, 0, 1), 0, 1);
}
```

Rewrite the module docstring's `measure`/`accumulate` bullets (lines 5-14) to describe the
necessity-weighted fold, the D cut plus survival floor, and `gain = ceiling × decay`.

- [ ] **Step 4: Set the ceiling constants**

```ts
// lib/constants/population.ts
/**
 * Unrest integration. Rates are per *population-processor run* — i.e. per economy-shard update
 * (every `MONTH_LENGTH` ticks, 24), not per game tick. Unrest relaxes toward a standing-pressure
 * floor (tax + crowding) and integrates dissatisfaction on top, settling at exactly
 * `floor + ceiling × D`: each ceiling IS the maximum equilibrium unrest its regime can carry, so the
 * numbers state bounds instead of implying them through a blind gain/decay ratio, and the
 * equilibrium is independent of the relaxation rate (and therefore of the catch-up factor). Supplied
 * recovers twice as fast as either regime accumulates, so a relieved system sheds unrest quickly
 * while a chronically short one climbs.
 *
 * Both ceilings are load-bearing and no single number replaces them: sustained Rationing must stay
 * below the collapse threshold at the highest tax, while a total food failure must cross it at zero
 * tax. Those two bounds do not overlap — famine genuinely needs a steeper response than ordinary
 * scarcity, not merely a larger D. Both are asserted from the shared constants in
 * lib/constants/__tests__/band-constants.test.ts. First cuts; the simulator owns the finals.
 */
export const UNREST_PARAMS: UnrestParams = {
  ceilingRationing: 1.8,
  ceilingShortage: 2.5,
  decay: 0.06,
  recoveryDecay: 0.12,
};
```

And rewrite `POPULATION_PARAMS`' symmetry rationale (lines 36-47), whose premise this pass deletes:

```ts
/**
 * Growth/decline rates (per population-processor run, one per economy-shard update). Growth runs at
 * full rate until the housing cap, then the crowd brake ramps it to zero by `crowdBrakeEnd`; decline
 * scales with unrest. Symmetric growth/decline rates: growth carries a (1 − D) factor and decline
 * carries unrest, so the two are already asymmetric in what they read — an asymmetric *rate* on top
 * of that would drain systems whose only fault is a low-necessity shortfall. With the fold weighted
 * by necessity the ambient barren-galaxy deficit folds to ≈0.14 rather than ≈0.4, so a chronically
 * import-short mining world grows while a genuinely deprived one declines. The overshoot-death sink
 * fires only in the strike regime (`overshootDeathUnrestGate`), so a calm over-capacity system
 * displaces via migration, not death. Calibrated against the simulator.
 */
```

- [ ] **Step 5: Update the population processor**

```ts
// lib/tick/processors/population.ts
  // Rates are reference-denominated; one run applies catchUpFactor(interval) reference cycles of
  // change. Only the relaxation rates rescale the time step — the ceilings are dimensionless bounds
  // on the equilibrium, and the gain is derived from the (scaled, clamped) rate inside
  // accumulateUnrest, so equilibrium is catch-up invariant by construction.
  const catchUp = catchUpFactor(params.interval);
  const scaledUnrest: UnrestParams = {
    ...params.unrest,
    decay: params.unrest.decay * catchUp,
    recoveryDecay: params.unrest.recoveryDecay * catchUp,
  };
...
    const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
    const supply = signals.supplyStateBySystem.get(s.systemId)
      ?? { regime: "supplied", survivalShortfall: false };
...
    const unrest = accumulateUnrest(s.unrest, d, floor, supply, scaledUnrest);
```

- [ ] **Step 6: Run the constants and engine tests**

Run: `npx vitest run lib/constants/__tests__/band-constants.test.ts lib/engine/__tests__/population.test.ts`
Expected: band-constants PASS. `population.test.ts`'s `accumulateUnrest` block still fails on the old
`gainRationing`/`gainShortage`/regime-string signature — update it now:
- replace the params fixtures with `{ ceilingRationing, ceilingShortage, decay, recoveryDecay }`,
- pass `{ regime, survivalShortfall: false }` instead of the bare regime string,
- add an equilibrium test: iterating `accumulateUnrest` 200× at fixed `d`/`floor` converges to
  `floor + unrestCeiling(d, false, params) * d` within 1e-6,
- add a rate-independence test: the same equilibrium is reached from `decay: 0.06` and `decay: 0.5`.

- [ ] **Step 7: Run the whole suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS. Watch two files specifically:
- `lib/tick/processors/__tests__/population.test.ts:198-211` ("unrest integration scales with the
  interval") — the equilibrium is now exactly catch-up invariant, so this should get *easier*, not
  harder. If it fails, the ceilings are being scaled somewhere.
- `lib/world/__tests__/tick.test.ts` around the `RESTIVE_UNREST` fixtures — thresholds move.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(population): name the unrest ceilings and blend them across the regime cut

Accumulation gains become ceiling x decay, so equilibrium is floor + ceiling x D and
each regime states a maximum rather than implying one through a ratio. The ceiling
ramps continuously from the Rationing value across a band starting at the cut; a
water/food survival shortfall promotes it outright.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task B4: The planner's `fed()` gate becomes civilian-only and weighted

`supplyDissatisfaction` currently folds `BuildGoodState.demand`, which is civilian **+ industrial**.
`GOOD_NECESSITY` is authored on the civilian axis, so applying it to a refinery world's ore draw
would collapse that world's D however starved its factories are. `fed()` has exactly one caller and
has only ever gated housing, so the fold becomes civilian-only, meaning exactly one thing: *are the
people here fed?* Industrial-input starvation stops blocking housing — industry is a route out of a
famine, not a reason to refuse shelter.

**Files:**
- Modify: `lib/engine/directed-logistics.ts:77-100` (`GoodMarketState`)
- Modify: `lib/engine/directed-build.ts:35-67` (`BuildGoodState`), `:116-141`
- Modify: `lib/tick/processors/good-market-state.ts:24-46`
- Modify: `lib/constants/directed-build.ts:14-15` (`D_SETTLE`)
- Test: `lib/engine/__tests__/directed-build.test.ts:634-680`

**Interfaces:**
- Consumes: `dissatisfaction` with `goodId` (B2), `D_SHORTAGE_CUT` (B2).
- Produces: `GoodMarketState.civilianDemand: number` (required); `BuildGoodState.civilianDemand?: number`.

- [ ] **Step 1: Update the `supplyDissatisfaction` tests to the civilian axis**

In `lib/engine/__tests__/directed-build.test.ts`, rewrite the two `supplyDissatisfaction` describes
(lines 634-680) so every fixture carries an explicit `civilianDemand`, and add the case the change
exists for:

```ts
describe("supplyDissatisfaction", () => {
  it("is ~0 when every demanded good is fully delivered", () => {
    const d = supplyDissatisfaction([
      { goodId: "food", stock: 20, targetStock: 20, demand: 10, civilianDemand: 10, capacityProduction: 0 },
      { goodId: "water", stock: 30, targetStock: 20, demand: 8, civilianDemand: 8, capacityProduction: 0 },
    ]);
    expect(d).toBeCloseTo(0);
  });

  it("is high when a survival good is undelivered", () => {
    const d = supplyDissatisfaction([
      { goodId: "food", stock: 1, targetStock: 20, demand: 100, civilianDemand: 100, capacityProduction: 0, satisfaction: 0 },
      { goodId: "luxuries", stock: 10, targetStock: 10, demand: 1, civilianDemand: 1, capacityProduction: 0 },
    ]);
    expect(d).toBeGreaterThan(0.5);
  });

  it("ignores industrial input starvation — the gate asks whether the PEOPLE are fed", () => {
    // A refinery world whose ore feed is dry but whose residents eat. Housing must not be blocked:
    // industry is a route out of a famine, not a reason to refuse shelter.
    const d = supplyDissatisfaction([
      { goodId: "ore", stock: 0, targetStock: 100, demand: 500, civilianDemand: 0, capacityProduction: 0, satisfaction: 0 },
      { goodId: "food", stock: 20, targetStock: 20, demand: 10, civilianDemand: 10, capacityProduction: 0, satisfaction: 1 },
    ]);
    expect(d).toBe(0);
  });

  it("returns 0 when no civilian demand is present", () => {
    expect(supplyDissatisfaction([])).toBe(0);
    expect(supplyDissatisfaction([
      { goodId: "ore", stock: 0, targetStock: 0, demand: 0, civilianDemand: 0, capacityProduction: 0 },
    ])).toBe(0);
  });

  it("reads a fully-delivering exporter parked at comfort as satisfied (D = 0)", () => {
    const d = supplyDissatisfaction([
      { goodId: "food", stock: 15, targetStock: 20, demand: 10, civilianDemand: 10, capacityProduction: 0, satisfaction: 1 },
    ]);
    expect(d).toBe(0);
  });
});
```
(Keep the existing "uses the persisted flow when present and 1 when missing" case, adding
`civilianDemand` to its fixtures.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t supplyDissatisfaction`
Expected: FAIL — `civilianDemand` is not a known property; the ore case folds a nonzero D.

- [ ] **Step 3: Add `civilianDemand` to the two market-state types**

```ts
// lib/engine/directed-logistics.ts — GoodMarketState, after `demand`
  /** The civilian half of `demand` alone (per-capita baseline + skilled baskets, no industrial input
   *  draw). The housing fed-gate folds this: necessity is authored on the civilian axis, so weighting
   *  a refinery's ore draw with it would collapse D however starved its factories are. */
  civilianDemand: number;
```

```ts
// lib/engine/directed-build.ts — BuildGoodState, after `demand`
  /** Civilian-only demand rate — the fed-gate's weight (see supplyDissatisfaction). Optional for
   *  engine-test fixtures, which then read as having nobody to feed (D = 0, i.e. fed) exactly as a
   *  missing `satisfaction` reads as fully delivered; the tick path always supplies it via
   *  toGoodMarketStates. */
  civilianDemand?: number;
```

- [ ] **Step 4: Populate it on the tick path**

```ts
// lib/tick/processors/good-market-state.ts — inside the goods.push({ … })
      demand: civ + industrial,
      civilianDemand: civ,
```

- [ ] **Step 5: Rewrite the fold**

```ts
// lib/engine/directed-build.ts
/**
 * Civilian-only, necessity-weighted dissatisfaction D in [0,1] for one system — the input to the
 * housing "fed" gate. Reuses the population engine's fold over the economy cycle's persisted per-good
 * satisfaction (delivered ÷ demanded — the same measure the needs display reads), so a
 * deliberately-at-comfort exporter with full delivery reads as satisfied. Weighted by CIVILIAN demand
 * alone: the gate means exactly one thing, "are the people here fed?", and industrial-input
 * starvation is not a reason to refuse shelter. Missing satisfaction ⇒ 1; missing civilian demand ⇒ 0.
 */
export function supplyDissatisfaction(goods: BuildGoodState[]): number {
  return dissatisfaction(
    goods.map((g) => ({
      goodId: g.goodId,
      satisfaction: clamp(g.satisfaction ?? 1, 0, 1),
      demanded: Math.max(0, g.civilianDemand ?? 0),
    })),
  );
}
```

- [ ] **Step 6: Re-cut `D_SETTLE`**

```ts
// lib/constants/directed-build.ts
  /** "Fed" gate: grow housing only where CIVILIAN, necessity-weighted supply-dissatisfaction D ≤ this
   *  (0…1). Cut above the ambient barren-galaxy deficit (≈0.14 under GOOD_NECESSITY, which every
   *  import-short world carries and which must not block housing) and below D_SHORTAGE_CUT, so a
   *  system the simulation calls starving never stands up new housing. First cut; the simulator owns
   *  the final. */
  D_SETTLE: 0.20,
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts && npx tsc --noEmit`
Expected: PASS. If a `planFactionBuilds` housing test now behaves differently, check whether it set
`demand` expecting the old total-demand fold — it needs `civilianDemand` to keep its intent.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(build): make the housing fed-gate civilian-only and necessity-weighted

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task B5: The needs-ledger display projection takes the same weight

`computePopNeeds`' `pressure` is an explicit mirror of the fold's shape and is the Population panel's
**sort key**, surfaced through the API as "this good's contribution to unrest". Without the weight
the ledger would rank a luxuries shortfall above a medicine one while the simulation ranks the
opposite.

**Files:**
- Modify: `lib/engine/pop-needs.ts:1-13` (docstring), `:26-28`, `:53-76`
- Modify: `lib/types/api.ts:161-162`
- Test: `lib/engine/__tests__/pop-needs.test.ts`

**Interfaces:**
- Consumes: `GOOD_NECESSITY` (B1), `consumptionRate(goodId, basis)` (PR A).

- [ ] **Step 1: Write the failing test**

```ts
// lib/engine/__tests__/pop-needs.test.ts
it("ranks an unmet high-necessity good above an unmet low-necessity one, matching the simulation", () => {
  // The ledger's sort key is the panel's ordering AND the API's "contribution to unrest". If it
  // weighted raw want it would rank luxuries above medicine while the fold ranks the opposite.
  const basis = { population: 1000, technicians: 0, engineers: 200 };
  const needs = computePopNeeds(basis, [
    { goodId: "medicine", satisfaction: 0 },
    { goodId: "luxuries", satisfaction: 0 },
  ]);
  const medicine = needs.find((n) => n.goodId === "medicine")!;
  const luxuries = needs.find((n) => n.goodId === "luxuries")!;
  // The engineer basket wants MORE luxuries than medicine, so raw want inverts the ranking.
  expect(luxuries.want).toBeGreaterThan(medicine.want);
  expect(medicine.pressure).toBeGreaterThan(luxuries.pressure);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/pop-needs.test.ts -t "high-necessity"`
Expected: FAIL — luxuries' pressure exceeds medicine's.

- [ ] **Step 3: Weight the pressure term**

```ts
// lib/engine/pop-needs.ts
import { GOOD_CONSUMPTION, GOOD_NECESSITY, SKILL1_CONSUMPTION, SKILL2_CONSUMPTION } from "@/lib/constants/physical-economy";
...
export function computePopNeeds(basis: CivilianDemandBasis, markets: PopNeedsMarketRow[]): PopNeed[] {
  const rowByGood = new Map(markets.map((m) => [m.goodId, m]));
  const wanted = consumedGoodIds()
    .map((goodId) => ({ goodId, want: consumptionRate(goodId, basis) }))
    .filter((g) => g.want > 0);
  const totalWant = wanted.reduce((s, g) => s + g.want, 0);
  if (totalWant <= 0) return [];
  const totalWeight = wanted.reduce((s, g) => s + g.want * (GOOD_NECESSITY[g.goodId] ?? 0), 0);

  return wanted
    .map(({ goodId, want }) => {
      const row = rowByGood.get(goodId);
      const satisfaction = row ? Math.max(0, Math.min(1, row.satisfaction ?? 1)) : 0;
      const gap = 1 - satisfaction;
      const weight = want * (GOOD_NECESSITY[goodId] ?? 0);
      return {
        goodId,
        want,
        satisfaction,
        delivered: want * satisfaction,
        pressure: totalWeight > 0 ? (weight / totalWeight) * gap * gap : 0,
        breakdown: consumptionBreakdown(goodId, basis),
      };
    })
    .sort((a, b) => b.pressure - a.pressure || b.want - a.want);
}
```

Update the `PopNeed.pressure` docstring (line 27) and the module docstring's mirror claim (lines 8-12):

```ts
  /** necessityWeightedShare × (1 − satisfaction)² — this good's term in the system's dissatisfaction sum. */
```
```
 * Pressure mirrors the necessity-weighted share × gap² shape of the `dissatisfaction()` sum, weighted
 * by unfloored civilian want × GOOD_NECESSITY (the cycle's own shares fold in demand floors and
 * modifiers, so magnitudes can differ slightly). Pure — callers pass market rows and a demand basis.
```

And `lib/types/api.ts:161`:
```ts
  /** necessity-weighted demandShare × (1 − satisfaction)² — this good's contribution to the system's unrest. */
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/engine/__tests__/pop-needs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): weight the needs-ledger pressure by necessity so it matches the fold

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task B6: Harness — the permanent supply-regime instrument

Two harness changes: the colony "opened deprived" reading inherits the weighting automatically once
`goodId` is threaded (done in B2), and a new per-**system** SupplyRegime share becomes a headline in
the simulate report — the permanent instrument for this pass and future economy work.

**Files:**
- Modify: `lib/tick-harness/population-analysis.ts`
- Modify: `lib/tick-harness/types.ts`
- Modify: `scripts/simulate.ts:188-246`
- Test: `lib/tick-harness/__tests__/population-analysis.test.ts`

**Interfaces:**
- Consumes: `dissatisfaction`, `foldSupplyState` (B2), `consumptionRate(goodId, basis)` (PR A).
- Produces: `summarizeSupplyRegimes(systems, markets): SupplyRegimeSummary`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/tick-harness/__tests__/population-analysis.test.ts
import { summarizeSupplyRegimes } from "../population-analysis";

describe("summarizeSupplyRegimes", () => {
  const mkt = (systemId: string, goodId: string, satisfaction: number) => ({ systemId, goodId, satisfaction });

  it("classifies settled systems and reports shares that sum to 1", () => {
    const systems = [popSys("fed", 100, 1000), popSys("thirsty", 100, 1000)];
    const summary = summarizeSupplyRegimes(systems, [
      mkt("fed", "water", 1), mkt("fed", "food", 1),
      mkt("thirsty", "water", 0), mkt("thirsty", "food", 1),
    ]);
    expect(summary.counted).toBe(2);
    expect(summary.supplied).toBe(1);
    expect(summary.shortage).toBe(1);
    expect(summary.suppliedShare + summary.rationingShare + summary.shortageShare).toBeCloseTo(1, 10);
  });

  it("counts only settled systems and never reports NaN for an empty galaxy", () => {
    const summary = summarizeSupplyRegimes([], []);
    expect(summary.counted).toBe(0);
    expect(Number.isFinite(summary.suppliedShare)).toBe(true);
    expect(summary.meanDissatisfaction).toBe(0);
  });
});
```
(`popSys` is the existing helper in that file; it builds a `developed` `TickSystem`. Give the
"thirsty" system a nonzero population so its basis has civilian demand.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/tick-harness/__tests__/population-analysis.test.ts`
Expected: FAIL — `summarizeSupplyRegimes` is not exported.

- [ ] **Step 3: Implement the summary**

```ts
// lib/tick-harness/population-analysis.ts
import { crowdFactor, dissatisfaction, foldSupplyState, type GoodSatisfaction } from "@/lib/engine/population";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { consumptionRate, type CivilianDemandBasis } from "@/lib/engine/physical-economy";
import type { WorldMarket } from "@/lib/world/types";

/**
 * Per-system share of each supply regime at the end of the run — the permanent instrument for the
 * unrest fold. Recomputed from the final world's persisted per-good satisfaction against each
 * system's own civilian demand, which is exactly what the economy cycle folded, so the reading is the
 * simulation's own classification rather than a parallel one. Settled systems only: an unclaimed rock
 * has no market and no opinion.
 */
export interface SupplyRegimeSummary {
  counted: number;
  supplied: number;
  rationing: number;
  shortage: number;
  suppliedShare: number;
  rationingShare: number;
  shortageShare: number;
  /** Mean D over counted systems — the magnitude behind the labels. */
  meanDissatisfaction: number;
}

export function summarizeSupplyRegimes(
  systems: TickSystem[],
  markets: ReadonlyArray<Pick<WorldMarket, "systemId" | "goodId" | "satisfaction">>,
): SupplyRegimeSummary {
  const settled = new Map(systems.filter(isSettled).map((s) => [s.id, s]));
  const goodsBySystem = new Map<string, GoodSatisfaction[]>();
  const basisBySystem = new Map<string, CivilianDemandBasis>();
  for (const m of markets) {
    const sys = settled.get(m.systemId);
    if (!sys) continue;
    let basis = basisBySystem.get(m.systemId);
    if (basis === undefined) {
      basis = computeSystemLabourSnapshot(sys.buildings, sys.population).basis;
      basisBySystem.set(m.systemId, basis);
    }
    const demanded = consumptionRate(m.goodId, basis);
    if (demanded <= 0) continue;
    const list = goodsBySystem.get(m.systemId) ?? [];
    list.push({ goodId: m.goodId, satisfaction: m.satisfaction ?? 1, demanded });
    goodsBySystem.set(m.systemId, list);
  }

  let supplied = 0, rationing = 0, shortage = 0, dSum = 0;
  for (const systemId of settled.keys()) {
    const goods = goodsBySystem.get(systemId) ?? [];
    const d = dissatisfaction(goods);
    dSum += d;
    const regime = foldSupplyState(goods, d).regime;
    if (regime === "supplied") supplied++;
    else if (regime === "rationing") rationing++;
    else shortage++;
  }
  const counted = settled.size;
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

`SupplyRegimeSummary` stays declared in `population-analysis.ts` and does **not** go on
`HarnessResults` — it mirrors `PopulationSummary`, which the report computes from the final world at
print time rather than carrying through the run. (`FoundingStockSummary` lives in `types.ts` only
because it is accumulated *during* the run.)

- [ ] **Step 4: Print it in the simulate report**

In `scripts/simulate.ts`, inside the existing "Population and unrest summary" block (line 188-246),
after the population rows:

```ts
    const regimes = summarizeSupplyRegimes(finalTickSystems, finalWorld.markets);
    lines.push("");
    lines.push("Supply regimes (per settled system, end of simulation):");
    const rWidths = [24, 12, 12];
    lines.push([pad("Regime", rWidths[0]), rpad("Systems", rWidths[1]), rpad("Share", rWidths[2])].join(" | "));
    lines.push(rWidths.map((w) => "-".repeat(w)).join("-+-"));
    const rRows: [string, number, number][] = [
      ["Supplied", regimes.supplied, regimes.suppliedShare],
      ["Rationing", regimes.rationing, regimes.rationingShare],
      ["Shortage", regimes.shortage, regimes.shortageShare],
    ];
    for (const [l, n, s] of rRows) {
      lines.push([pad(l, rWidths[0]), rpad(String(n), rWidths[1]), rpad(`${(s * 100).toFixed(1)}%`, rWidths[2])].join(" | "));
    }
    lines.push(`  mean D ${regimes.meanDissatisfaction.toFixed(3)} over ${regimes.counted} settled systems`);
```
Add `summarizeSupplyRegimes` to the import on line 28.

- [ ] **Step 5: Verify**

Run: `npx vitest run lib/tick-harness && npx tsc --noEmit && npm run simulate -- --ticks 600`
Expected: tests PASS; the report prints the new block with shares summing to 100%.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(harness): report the per-system supply-regime share

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task B7: Docstring truth pass and booking

**Files:**
- Modify: `lib/constants/economy.ts:1-26`, `lib/constants/market-economy.ts:25-60`, `:64-74`, `:89-100`
- Modify: `lib/engine/directed-logistics.ts:80`
- Modify: `docs/build-plans/band-reconciliation-umbrella.md`
- Modify: `docs/BACKLOG.md`

- [ ] **Step 1: Correct "days" to "cycles" everywhere it means an economy cycle**

Run: `grep -rniE "days[- ]of[- ]supply|days of|/cyc|cycles of" lib/ components/ --include=*.ts --include=*.tsx`

An economy cycle consumes one `demandRate`, so `TARGET_COVER` 40 is 40 cycles and
`RATION_COVER` 2 is 2 cycles. Fix each docstring occurrence. Known sites:
- `lib/constants/economy.ts:1` — "Days of total local demand held at the price/base reserve anchor."
- `lib/constants/economy.ts:8-9` — `HOLD_COVER`'s "days-of-supply anchor"
- `lib/constants/economy.ts:19-25` — `RATION_COVER`'s "demand cycles"
- `lib/constants/market-economy.ts:26-27` — "Days of cover (stock ÷ local demand rate)"
- `lib/constants/market-economy.ts:37-40` — `MIN_DEMAND`'s "days-of-supply denominator"
- `lib/constants/market-economy.ts:54-58` — `civilianDemandRateForGood`'s "Days-of-supply demand denominator"
- `lib/constants/market-economy.ts:64-66` — `totalDemandRateForGood`
- `lib/constants/market-economy.ts:89-94` — `getInitialStock`'s "demand-priced" note
- `lib/engine/directed-logistics.ts:80` — `targetStock`'s "Days-of-supply price anchor"

While there, add the warning-gap fact to `RATION_COVER`'s docstring, which is the reason the buffer
stands as authored:

```
   * The gap between the logistics deficit signal (0.8 × the 40-cycle anchor) and this knee is roughly
   * 30 logistics cycles, and logistics resolves every cycle — a system that starves never ran out of
   * warning, it ran out of supply or of budget to move it. Widening this buffer is never the fix for
   * a starving galaxy; the early warning belongs in the UI, not in unrest.
```

Leave user-facing `/cyc` labels in `components/` alone — that is presentation copy PR6 owns.

- [ ] **Step 2: Update the umbrella**

In `docs/build-plans/band-reconciliation-umbrella.md`, in the "Necessity-weighted unrest" section:
mark it **shipped**, point at this plan file, and record the two-PR split. Add to the **PR6** bullet
the two items this slice deliberately hands over:

```
- **Inherited from the necessity slice:** the five-band stability ramp (`lib/utils/stability.ts`,
  stops at 0.2/0.4/0.6/0.8) must be re-cut against the measured post-fold unrest distribution — every
  healthy system now sits in the bottom band and three of five bands are famine-only. The measured
  distribution is in the slice's 3000-tick run. Also inherited: the per-good chip bands (stock-cover
  based, a different labelling from the system regime this slice settles), and any label steadiness
  those chips need, which is a display concern with display tools — no persisted regime state ships.
- **Docs fold additions:** `docs/active/gameplay/economy.md` and `player-seat-purse.md` describe the
  unrest spine; the fold is now necessity-weighted with named ceilings and a survival floor.
```

- [ ] **Step 3: Book the follow-ons the spec defers**

Append to `docs/BACKLOG.md`:

```markdown
- **Per-good price response (`MarketCurve.k`)** — make "water spikes under scarcity, luxuries don't"
  real by giving each good its own price-curve exponent, without touching demand. `DEFAULT_ELASTICITY`
  is currently 1 for every good and `GOODS.priceFloor`/`priceCeiling` is a pure tier lookup with zero
  per-good variation. Booked from `docs/planned/necessity-weighted-unrest.md`.
- **Government layer revisit** — `GOVERNMENT_TYPES` carries only event weights and a danger baseline
  since the flat `consumptionBoosts` term was deleted; decide what, if anything, replaces it as an
  economic axis. Governments are economically inert until then. Booked from
  `docs/planned/necessity-weighted-unrest.md`.
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(economy): cover is measured in cycles; book the deferred follow-ons

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task B8: Validate, measure the four unrest consumers, and open the PR

This pass takes ambient equilibrium unrest from ≈0.82 to ≈0.30 galaxy-wide and clears the strike flag
almost everywhere. **Four shipped mechanics change behaviour at the same cycle, and none of them is
pre-tuned here** — every one of their constants was calibrated against the striking galaxy, so tuning
them now would be tuning against a galaxy that does not exist yet. Measure, report, retune only where
the sim shows a problem.

- [ ] **Step 1: Run the full gate**

Run: `npx vitest run && npx tsc --noEmit && npx next build --webpack`
Expected: all three PASS. Both `ECONOMY_SCALE` invariance bridges must still hold — necessity is a
dimensionless weight and the ceilings are dimensionless bounds, so ratio-invariance holds by
construction; only S=1 fixtures move.

- [ ] **Step 2: Take the 3000-tick reading**

Run: `npm run simulate -- --ticks 3000 --seed 42`
Compare against the PR A "after" reading from Task A4 Step 3.

**Primary targets:**
| Target | Expectation |
| --- | --- |
| Striking share | collapses from ≈54% toward near-zero |
| Collapsed systems / stranded population | approach zero |
| Supply-regime share (new metric) | most settled systems Rationing or Supplied, Shortage rare |
| Mean unrest | ≈0.30 ambient, not ≈0.67 |
| Population growth | strongly positive |
| Median price / base | still ≈1.0 with two-sided dispersion (this slice does not touch pricing for 18 of 26 goods) |
| Founding-stock opening satisfaction | colonies no longer open in the Shortage regime |
| Built capacity, the eight formerly-boosted goods | stabilises over the long run; **must not** ratchet toward zero |

- [ ] **Step 3: Record the before/after for each of the four unrest consumers**

Report these explicitly in the PR body — they are the deliverable, not a footnote:
1. **The purse** — faction solvency and funded fractions. Strike suppression currently cuts realized
   output (the production tax base) to ≈64% galaxy-wide; ending the ambient strike raises it ≈1.5× in
   one cycle while maintenance bills do not move.
2. **Directed logistics** — transfers per cycle and the logistics bill. `surplusDrawable`'s
   deep-exporter path is gated on the strike flag, so today **no** exporter is drawable below its
   anchor; the flag clears everywhere and structural exporters become drawable to their reserve.
3. **The planner's squeeze backstop** — levels committed per build cycle. `strikeExplains` silences
   the feedback gap almost everywhere today and switches on galaxy-wide at the same cycle that
   de-suppressed output raises exporter spare — two effects pushing opposite ways, resultant not
   derivable from the constants.
4. **Infrastructure decay** — levels shed per channel. The unrest-teardown channel goes to exactly
   zero, leaving the 12-cycle idle channel as the only pruner at the moment rising output pushes
   stock toward the operating ceiling and turns strike-throttled producers into glut-idlers.

If one of these is clearly pathological (e.g. the idle channel alone cannot prune the new glut and
built capacity runs away), say so and propose the retune as a *separate* decision — do not fold a
silent constant change into this PR.

- [ ] **Step 4: Push, open the PR, review**

```bash
git push -u origin feat/necessity-unrest-fold
gh pr create --base feat/band-reconciliation --title "feat(population): necessity-weighted unrest, named ceilings, survival floor" --body "..."
```
Then `/uber-review` (local, diffing against the shared branch).

- [ ] **Step 5: Merge into the shared branch**

Squash or fast-forward into `feat/band-reconciliation`. **Do not merge shared→main** — PR6 (regime
presentation + docs fold) is still outstanding.

---

## Validation summary — what this slice must prove

Asserted as tests (constants-derived, never hardcoded sums), in `band-constants.test.ts`:
- No non-survival good, alone, at any tax level, can reach the strike threshold.
- Sustained Rationing cannot reach the collapse threshold at any tax level.
- A total water or food failure both selects Shortage and drives net population decline at every tax
  level, including the lowest — and crosses the collapse threshold at zero tax.
- A broad lower-tier shortage *can* cross into striking when stacked with overcrowding and very-high
  tax, while staying below collapse. Only famine collapses.
- The ceiling is continuous across the shortage cut, and equals the Rationing ceiling across the
  whole Rationing range.
- `GOOD_NECESSITY` is total over `GOODS`; the shortage cut lies strictly between the ambient deficit
  and a total food failure.

Measured in the simulator (Task B8):
- Striking share collapses; collapsed/stranded systems approach zero.
- Colonies no longer open in the Shortage regime; founding a colony no longer strips the founder's
  medicine.
- Built capacity in the eight formerly-boosted goods stabilises rather than ratcheting to zero.
- Before/after readings for the purse, logistics, planner backstop and decay channels.
- The per-system supply-regime share, which becomes the permanent instrument.

## The one ruling the spec left open — settled

The spec says both "the ceiling is blended across the cut… the simulation underneath it is
continuous everywhere" **and** that the survival floor is the mechanism making the survival guarantee
explicit. Those are in tension: if the ceiling were a pure function of D, the survival floor would be
simulation-inert — Rationing and Shortage share a relaxation rate, so the label alone changes nothing
and `SHORTAGE_SATISFACTION` stays an orphaned constant.

**Settled: the survival floor promotes the ceiling to `ceilingShortage`**, while the D-driven path
stays continuous (Tasks B2/B3 build it this way). The live band is narrower than "famine vs shortage"
sounds — it only changes anything for water or food between ~18% and 50% delivered, because below
~18% the fold alone already clears the cut and above 50% the floor does not fire. Inside that band
the response rises ~40%, which is what pulls a system at 20% water over the strike line (0.48 →
0.65) instead of leaving it calm; at exactly 50% it barely moves (0.22 → 0.28). So the step it
introduces is small and sits nowhere near a threshold, unlike the D-cut step the spec's no-cliffs
rule was written against.
