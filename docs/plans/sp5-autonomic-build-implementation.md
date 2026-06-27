# SP5 Autonomic Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reactive "co-build housing to staff industry" planner with a proactive autonomic build: housing leads (built ahead of population wherever a system is fed and calm, capped by habitable land), population fills it (untouched logistic), and industry follows the resident workforce (gated by spare labour).

**Architecture:** Rework the pure engine `planFactionBuilds` in `lib/engine/directed-build.ts` into two passes — a proactive **housing pass** (fed-and-calm gate, paced toward the habitable cap) and the existing demand-pull **industry pass** with a new **spare-labour gate** — and delete the co-build block. Thread the system's stored `unrest` into the build world so the engine can compute the "fed and calm" gate (supply-dissatisfaction is derived in the engine from market state it already reads; `unrest` is a new column read). The live (Prisma) and simulator (in-memory) adapters share the pure body unchanged. SP3.5 decay is **not touched**.

**Tech Stack:** TypeScript 5 (strict), Vitest 4 (unit + integration projects), Prisma 7 / PostgreSQL (live adapter only), pure-function engine (zero DB import in the unit test graph).

## Global Constraints

- **No `as` casts** (except `as const` / `lib/types/guards.ts`). No `unknown`. No postfix `!` (except `find(...)!` in tests).
- **Engine is pure** — `lib/engine/directed-build.ts` must not import `@/lib/prisma` (directly or transitively). It may import other pure engine modules (`@/lib/engine/population`, `@/lib/utils/math`) and constants.
- **Discriminated unions for result types**; typed union keys for maps, never `Record<string, unknown>`.
- **Continuous Float building counts** — no integer rounding anywhere in the build path (a 0.3-pop outpost staffs 0.3 of a facility).
- **SP3.5 decay rates/thresholds are frozen** — this sub-project never edits `lib/engine/infrastructure-decay.ts` or `lib/constants/*decay*`.
- **Per-system pacing cap: NOT implemented in v1** (deliberate). The physical ceilings (habitable land caps housing; spare labour caps industry — both ∝ population) already pace each system to ≈ its own pooled-budget contribution, so an explicit cap is dominated by the labour gate and would be dead code. Recorded as a deferred calibration knob; revisit only if the Phase-3 harness shows single-system concentration or housing-pass ordering bias. See `docs/plans/sp5-autonomic-build-design.md` ("Budget and pacing").
- Test commands run from the project root (already cwd). Never prefix with `cd`.

---

## File map

| File | Change |
| --- | --- |
| `lib/constants/directed-build.ts` | Add `D_SETTLE`, `UNREST_SETTLE`, `SETTLE_MARGIN` knobs |
| `lib/tick/world/directed-build-world.ts` | Add `unrest: number` to `SystemBuildRow` |
| `lib/tick/adapters/prisma/directed-build.ts` | Read `unrest` column → `SystemBuildRow.unrest` |
| `lib/tick/processors/directed-build.ts` | `toBuildState` passes `row.unrest` into `BuildSystemState` |
| `lib/engine/simulator/economy.ts` | Build-row map passes `s.unrest` |
| `lib/engine/directed-build.ts` | Add `unrest` to `BuildSystemState`; add helpers; rewrite `planFactionBuilds` (housing pass + spare-labour gate; delete co-build) |
| `lib/engine/__tests__/directed-build.test.ts` | Thread `unrest` into fixtures; helper tests; housing + labour-gate + idle/barren tests; update co-build expectations |
| `lib/tick/processors/__tests__/directed-build.test.ts` | Thread `unrest`; adjust the "no writes" fixture for proactive housing |
| `lib/tick/adapters/memory/__tests__/directed-build.test.ts` | Thread `unrest` into the `row` helper |
| `lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts` | Assert `unrest` is read into `SystemBuildRow` |
| `lib/constants/substrate-gen.ts` | Add `SEED_FILL_MULT` (=1) calibration lever (Task 5) |
| `lib/engine/body-gen.ts` | Apply `SEED_FILL_MULT` to the development fill (Task 5) |

---

## Task 1: Thread `unrest` + knobs + the fed-and-calm helper

Adds the `unrest` signal end-to-end and a pure, tested helper that computes the "fed and calm" gate. **No change to `planFactionBuilds` behaviour yet** — the co-build block stays; all existing tests keep passing once fixtures carry the new field.

**Files:**
- Modify: `lib/constants/directed-build.ts`
- Modify: `lib/tick/world/directed-build-world.ts:11-26`
- Modify: `lib/tick/adapters/prisma/directed-build.ts` (the `select` + the `return` mapping)
- Modify: `lib/tick/processors/directed-build.ts:22-33` (`toBuildState`)
- Modify: `lib/engine/simulator/economy.ts:444-464` (row map)
- Modify: `lib/engine/directed-build.ts` (add `unrest` field + helpers)
- Test: `lib/engine/__tests__/directed-build.test.ts` (fixtures + new helper tests)
- Test: `lib/tick/processors/__tests__/directed-build.test.ts` (fixtures)
- Test: `lib/tick/adapters/memory/__tests__/directed-build.test.ts` (fixture)
- Test: `lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts` (assertion)

**Interfaces:**
- Produces: `BuildSystemState.unrest: number` (required); `SystemBuildRow.unrest: number` (required).
- Produces: `supplyDissatisfaction(goods: BuildGoodState[]): number` — stock-coverage dissatisfaction D in [0,1].
- Produces: `fedAndCalm(sys: BuildSystemState): boolean` — `D ≤ D_SETTLE && unrest ≤ UNREST_SETTLE`.
- Produces: `DIRECTED_BUILD.D_SETTLE`, `.UNREST_SETTLE`, `.SETTLE_MARGIN`.
- Consumes: `dissatisfaction` from `@/lib/engine/population`; `clamp` from `@/lib/utils/math`.

- [ ] **Step 1: Add the calibration knobs**

In `lib/constants/directed-build.ts`, inside the `DIRECTED_BUILD` object (after `GENERATION_PER_POP`), add:

```ts
  /** "Fed" gate: grow housing only where supply-dissatisfaction D ≤ this (0…1). */
  D_SETTLE: 0.15,
  /** "Calm" gate: grow housing only where stored unrest ≤ this (0…1). */
  UNREST_SETTLE: 0.2,
  /** Housing is paced to keep popCap at most this fraction ahead of current population. */
  SETTLE_MARGIN: 0.25,
```

- [ ] **Step 2: Add `unrest` to the world row type**

In `lib/tick/world/directed-build-world.ts`, in `SystemBuildRow` (after `population: number;`):

```ts
  /** Stored unrest integral 0…1 — the "calm" half of the settle gate. */
  unrest: number;
```

- [ ] **Step 3: Read `unrest` in the Prisma adapter**

In `lib/tick/adapters/prisma/directed-build.ts`, add `unrest: true,` to the `starSystem.findMany` `select` block (next to `population: true,`), and add `unrest: s.unrest,` to the returned `SystemBuildRow` object (next to `population: s.population,`).

- [ ] **Step 4: Thread `unrest` through the processor + simulator**

In `lib/tick/processors/directed-build.ts`, `toBuildState` — add `unrest: row.unrest,` (after `population: row.population,`).

In `lib/engine/simulator/economy.ts`, the `rows` map in `processSimDirectedBuild` — add `unrest: s.unrest,` (after `population: s.population,`).

- [ ] **Step 5: Add `unrest` to the engine state + the helpers (write the implementation)**

In `lib/engine/directed-build.ts`:

Add imports near the top:

```ts
import { clamp } from "@/lib/utils/math";
import { dissatisfaction } from "@/lib/engine/population";
```

In `BuildSystemState`, add after `population: number;`:

```ts
  /** Stored unrest integral 0…1 — the "calm" half of the settle gate. */
  unrest: number;
```

Add these exported helpers (place them after `systemBuildGeneration`):

```ts
/**
 * Stock-coverage dissatisfaction D in [0,1] for one system — the "fed" half of the
 * settle gate. Reuses the population engine's demand-weighted convex fold, with a
 * stock-based satisfaction proxy (stock ÷ targetStock, clamped): the build planner
 * sees standing market state, not the economy's per-tick delivered/demanded flow, so
 * a good sitting at or above its days-of-supply anchor reads as satisfied.
 */
export function supplyDissatisfaction(goods: BuildGoodState[]): number {
  return dissatisfaction(
    goods.map((g) => ({
      satisfaction: g.targetStock > 0 ? clamp(g.stock / g.targetStock, 0, 1) : 1,
      demanded: Math.max(0, g.demand),
    })),
  );
}

/** Settle gate: a system grows housing only when well-supplied (D ≤ D_SETTLE) and calm (unrest ≤ UNREST_SETTLE). */
export function fedAndCalm(sys: BuildSystemState): boolean {
  return (
    supplyDissatisfaction(sys.goods) <= DIRECTED_BUILD.D_SETTLE &&
    sys.unrest <= DIRECTED_BUILD.UNREST_SETTLE
  );
}
```

- [ ] **Step 6: Thread `unrest` into every fixture (make the code compile)**

`unrest` is now required, so add it to all `BuildSystemState` / `SystemBuildRow` literals.

In `lib/engine/__tests__/directed-build.test.ts`:
- `buildSys` helper return object: add `unrest: 0,` after `population: 100,`.
- `tier0Sys` return object: add `unrest: 0,` after `population: 100,`.
- Every inline `BuildSystemState` literal in the `planFactionBuilds` and `planFactionBuilds performance` describes: add `unrest: 0,` after each `population: …,`.

In `lib/tick/processors/__tests__/directed-build.test.ts`:
- `scenario`'s two row literals: add `unrest: 0,` after each `population: …,`.
- The two inline rows in the "never builds past capacity" test: add `unrest: 0,`.
- The `balanced` row in "returns no writes…": add `unrest: 0,`.

In `lib/tick/adapters/memory/__tests__/directed-build.test.ts`:
- `row` helper: add `unrest: 0,` after `population: 100,`.

- [ ] **Step 7: Write the failing helper tests**

In `lib/engine/__tests__/directed-build.test.ts`, update the import line to include the new exports and add a shared fixture helper + two describes. Add `supplyDissatisfaction, fedAndCalm` to the existing import from `@/lib/engine/directed-build`.

Add near the top of the file (after the imports):

```ts
function sysWith(partial: Partial<BuildSystemState>): BuildSystemState {
  return {
    systemId: "X", factionId: "f1", population: 100, unrest: 0, buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0, goods: [],
    ...partial,
  };
}
```

Add these describes:

```ts
describe("supplyDissatisfaction", () => {
  it("is ~0 when every demanded good sits at or above target", () => {
    const d = supplyDissatisfaction([
      { goodId: "food", stock: 20, targetStock: 20, demand: 10 },
      { goodId: "water", stock: 30, targetStock: 20, demand: 8 },
    ]);
    expect(d).toBeCloseTo(0);
  });

  it("is high when a heavily-demanded good is far below target", () => {
    const d = supplyDissatisfaction([
      { goodId: "food", stock: 1, targetStock: 20, demand: 100 },
      { goodId: "luxuries", stock: 10, targetStock: 10, demand: 1 },
    ]);
    expect(d).toBeGreaterThan(0.5);
  });

  it("returns 0 when nothing is demanded", () => {
    expect(supplyDissatisfaction([])).toBe(0);
    expect(supplyDissatisfaction([{ goodId: "ore", stock: 0, targetStock: 0, demand: 0 }])).toBe(0);
  });
});

describe("fedAndCalm", () => {
  const fedGoods = [{ goodId: "food", stock: 20, targetStock: 20, demand: 10 }];

  it("is true for a well-supplied, calm system", () => {
    expect(fedAndCalm(sysWith({ goods: fedGoods, unrest: 0 }))).toBe(true);
  });

  it("is false when stored unrest exceeds the calm threshold", () => {
    expect(fedAndCalm(sysWith({ goods: fedGoods, unrest: DIRECTED_BUILD.UNREST_SETTLE + 0.1 }))).toBe(false);
  });

  it("is false when the system is starved (high supply dissatisfaction)", () => {
    const starved = [{ goodId: "food", stock: 1, targetStock: 20, demand: 100 }];
    expect(fedAndCalm(sysWith({ goods: starved, unrest: 0 }))).toBe(false);
  });
});
```

- [ ] **Step 8: Run the unit tests — expect PASS**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/tick/adapters/memory/__tests__/directed-build.test.ts`

Expected: all PASS (new helper tests pass; existing tests unchanged behaviour). If "no tests run" appears, a prisma import leaked into the unit graph — verify with `npx vitest run --project unit lib/engine/__tests__/directed-build.test.ts` in a shell with `DATABASE_URL` unset.

- [ ] **Step 9: Add the integration assertion for the `unrest` read**

In `lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts`, in the "reads persisted capacity columns" test: add `unrest: 0.42` to the `starSystem.update` `data`, and add `expect(row.unrest).toBe(0.42);` after the `slotCap.arable` assertion.

- [ ] **Step 10: Run the integration test — expect PASS**

Run: `npx vitest run --project integration lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts`

Expected: PASS (requires the Postgres integration DB; if unavailable locally, note it and let CI run it).

- [ ] **Step 11: Commit**

```bash
git add lib/constants/directed-build.ts lib/tick/world/directed-build-world.ts lib/tick/adapters/prisma/directed-build.ts lib/tick/processors/directed-build.ts lib/engine/simulator/economy.ts lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/tick/adapters/memory/__tests__/directed-build.test.ts lib/tick/adapters/prisma/__tests__/integration/directed-build.integration.test.ts
git commit -m "feat(build): thread unrest + fed-and-calm settle gate into the build planner"
```

---

## Task 2: Proactive housing pass + delete the co-build block

Rewrites `planFactionBuilds` to build housing proactively (housing leads population) and deletes the reactive co-build. The industry pass stays demand-pulled and (for this task) ungated by labour — the spare-labour gate lands in Task 3.

**Files:**
- Modify: `lib/engine/directed-build.ts` (`planFactionBuilds` + two new housing helpers)
- Test: `lib/engine/__tests__/directed-build.test.ts`
- Test: `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- Produces: `habitableHousingHeadroom(sys: BuildSystemState): number` — additional housing units buildable before hitting habitable/general bounds.
- Produces: `plannedHousingUnits(sys: BuildSystemState): number` — housing units to build this cycle (0 unless fed-and-calm and below habitable cap).
- Consumes (existing): `generalSpaceUsed` (private), `effectiveSpaceCost`, `housingPopCap`, `HOUSING_TYPE`, `POP_CENTRE_DENSITY`, `BUILDING_TYPES`, `systemBuildGeneration`, `findStructuralDeficits`, `classifyMarketState`, `buildableUnits`, `inputsAvailable`, `OUTPUT_PER_UNIT`, `GOOD_TIER_BY_KEY`.

- [ ] **Step 1: Write the failing housing-helper tests**

In `lib/engine/__tests__/directed-build.test.ts`, add `habitableHousingHeadroom, plannedHousingUnits` to the import from `@/lib/engine/directed-build`, then add:

```ts
describe("habitableHousingHeadroom", () => {
  it("returns the min of remaining habitable and remaining general, in housing units", () => {
    expect(habitableHousingHeadroom(sysWith({ generalSpace: 100, habitableSpace: 40 }))).toBeCloseTo(40);
  });

  it("subtracts existing housing from both habitable and general", () => {
    const sys = sysWith({ generalSpace: 100, habitableSpace: 40, buildings: { housing: 10 } });
    expect(habitableHousingHeadroom(sys)).toBeCloseTo(30); // habitable 40 - 10 = 30 binds
  });

  it("is bounded by remaining general space when factories crowd it", () => {
    const sys = sysWith({ generalSpace: 20, habitableSpace: 50, buildings: { metals: 15 } });
    expect(habitableHousingHeadroom(sys)).toBeCloseTo(5); // general 20 - 15 = 5 binds
  });
});

describe("plannedHousingUnits", () => {
  it("paces housing a settle-margin ahead of population", () => {
    // pop 100, no housing, ample habitable → target popCap = 100 × 1.25 = 125 → 6.25 housing.
    const units = plannedHousingUnits(sysWith({
      population: 100, buildings: {}, generalSpace: 100, habitableSpace: 100,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }));
    expect(units).toBeCloseTo(125 / 20 - 0); // 6.25
  });

  it("returns 0 when the system is not fed and calm", () => {
    expect(plannedHousingUnits(sysWith({
      population: 100, generalSpace: 100, habitableSpace: 100, unrest: 0.9,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }))).toBe(0);
  });

  it("returns 0 at the habitable cap (no headroom)", () => {
    expect(plannedHousingUnits(sysWith({
      population: 100, buildings: { housing: 50 }, generalSpace: 100, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }))).toBe(0);
  });

  it("never targets more housing than the habitable land allows", () => {
    // Huge pop, tiny habitable: housing is bounded by habitable (5 units), not population.
    const units = plannedHousingUnits(sysWith({
      population: 100000, buildings: {}, generalSpace: 1000, habitableSpace: 5,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }));
    expect(units).toBeCloseTo(5);
  });
});
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "habitableHousingHeadroom|plannedHousingUnits"`
Expected: FAIL — `habitableHousingHeadroom is not a function` (not yet exported).

- [ ] **Step 3: Implement the housing helpers**

In `lib/engine/directed-build.ts`, add (after `fedAndCalm`):

```ts
/**
 * Additional housing units a site can build before hitting its physical bounds: the
 * habitable subset of space (minus the housing already standing) and the remaining
 * general space (housing competes with factories for it), in housing units. Never
 * negative. Mirrors the seeder's habitable bound.
 */
export function habitableHousingHeadroom(sys: BuildSystemState): number {
  const cost = effectiveSpaceCost(HOUSING_TYPE);
  if (cost <= 0) return 0;
  const housing = sys.buildings[HOUSING_TYPE] ?? 0;
  const remainingGeneral = sys.generalSpace - generalSpaceUsed(sys.buildings);
  const remainingHabitable = sys.habitableSpace - housing * cost;
  return Math.max(0, Math.min(remainingHabitable, remainingGeneral) / cost);
}

/**
 * Proactive housing units to build at a site this cycle: paced to keep popCap a
 * SETTLE_MARGIN ahead of population, never past the habitable headroom. Returns 0
 * when the site is not fed-and-calm or already at its habitable cap. Housing leads —
 * it creates the popCap headroom the (untouched) population logistic then fills.
 */
export function plannedHousingUnits(sys: BuildSystemState): number {
  if (!fedAndCalm(sys)) return 0;
  const headroom = habitableHousingHeadroom(sys);
  if (headroom <= 0) return 0;
  const popProvided = BUILDING_TYPES[HOUSING_TYPE]?.popProvided ?? POP_CENTRE_DENSITY;
  if (popProvided <= 0) return 0;
  const housing = sys.buildings[HOUSING_TYPE] ?? 0;
  const currentPopCap = housingPopCap(sys.buildings);
  const habitableCapPop = (housing + headroom) * popProvided;
  const pop = Math.max(0, sys.population);
  const targetPopCap = Math.min(habitableCapPop, pop * (1 + DIRECTED_BUILD.SETTLE_MARGIN));
  const wantUnits = Math.max(0, (targetPopCap - currentPopCap) / popProvided);
  return Math.min(wantUnits, headroom);
}
```

- [ ] **Step 4: Run them — expect PASS**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "habitableHousingHeadroom|plannedHousingUnits"`
Expected: PASS.

- [ ] **Step 5: Rewrite `planFactionBuilds` (housing pass + delete co-build)**

Replace the entire body of `planFactionBuilds` (currently `lib/engine/directed-build.ts:187-324`) with this. It adds Pass 1 (housing), keeps Pass 2 (industry) verbatim **minus** the co-build block, and returns `builds` (which may contain housing) instead of `[]` on the early exits. The spare-labour gate is added in Task 3.

```ts
export function planFactionBuilds(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): PlannedBuild[] {
  let budget = 0;
  for (const s of systems) budget += systemBuildGeneration(s.population);
  if (budget <= 0) return [];

  // Mutable per-system working copy so capacity/labour reflect builds made this pass.
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) working.set(s.systemId, { ...s, buildings: { ...s.buildings } });

  const builds: PlannedBuild[] = [];

  // ── Pass 1: proactive housing (housing leads population). ──
  // Build housing toward the habitable cap wherever a system is fed and calm, paced a
  // margin ahead of its current population. Housing draws general space, so it runs
  // before industry — habitable land is housing's by right; factories take what's left.
  for (const site of working.values()) {
    if (budget <= 0) break;
    const want = plannedHousingUnits(site);
    if (want <= 0) continue;
    const units = Math.min(want, budget);
    if (units <= 0) continue;
    site.buildings[HOUSING_TYPE] = (site.buildings[HOUSING_TYPE] ?? 0) + units;
    builds.push({ systemId: site.systemId, buildingType: HOUSING_TYPE, count: units });
    budget -= units;
  }

  // ── Pass 2: labour-gated industry (industry follows the resident workforce). ──
  if (budget <= 0) return builds;

  const structural = findStructuralDeficits(systems, routeCost);
  if (structural.length === 0) return builds;

  // Goods for which this faction has a reachable surplus anywhere (tier-1+ input gate).
  const reachableSurplusGoods = new Set<string>();
  for (const s of systems) {
    for (const g of s.goods) {
      const c = classifyMarketState(g.stock, g.targetStock);
      if (c.kind === "surplus" && c.drawable > 0) reachableSurplusGoods.add(g.goodId);
    }
  }

  // Remaining structural shortfall per (good → systemId → shortfall).
  const remainingByGood = new Map<string, Map<string, number>>();
  for (const d of structural) {
    const m = remainingByGood.get(d.goodId) ?? new Map<string, number>();
    m.set(d.systemId, (m.get(d.systemId) ?? 0) + d.shortfall);
    remainingByGood.set(d.goodId, m);
  }

  // Precompute every candidate (site, good) opportunity once — the reachable deficit
  // list depends only on static route costs, so building it here (not per-build) keeps
  // the planner near-linear in the faction's system count.
  const opportunities: BuildOpportunity[] = [];
  for (const [goodId, deficitMap] of remainingByGood) {
    const perUnit = OUTPUT_PER_UNIT[goodId] ?? 0;
    if (perUnit <= 0) continue;
    const isTier0 = GOOD_TIER_BY_KEY[goodId] === 0;
    const deficitSystemIds = [...deficitMap.keys()];

    for (const site of working.values()) {
      const capUnits = buildableUnits(site, goodId);
      if (capUnits <= 0) continue;
      if (!isTier0 && !inputsAvailable(goodId, site, reachableSurplusGoods)) continue;

      const reachable = deficitSystemIds
        .map((sysId) => ({ sysId, cost: routeCost(site.systemId, sysId) }))
        .filter((r): r is { sysId: string; cost: number } => r.cost !== null && r.cost > 0)
        .sort((a, b) => a.cost - b.cost);
      if (reachable.length === 0) continue;

      // Score: allocate this site's output capacity to its reachable deficits,
      // nearest-first, summing served ÷ route cost (capacity + proximity). Ordering only.
      let capOutput = capUnits * perUnit;
      let score = 0;
      for (const r of reachable) {
        if (capOutput <= 0) break;
        const short = deficitMap.get(r.sysId) ?? 0;
        if (short <= 0) continue;
        const take = Math.min(capOutput, short);
        score += take / r.cost;
        capOutput -= take;
      }
      if (score <= 0) continue;

      opportunities.push({ systemId: site.systemId, goodId, perUnit, reachable, score });
    }
  }

  opportunities.sort((a, b) => b.score - a.score);

  for (const opp of opportunities) {
    if (budget <= 0) break;
    const site = working.get(opp.systemId);
    if (!site) continue;

    const capUnits = buildableUnits(site, opp.goodId);
    if (capUnits <= 0) continue;

    const deficitMap = remainingByGood.get(opp.goodId);
    if (!deficitMap) continue;

    // Output we can usefully place = Σ over reachable remaining shortfalls, capped by capacity.
    let capOutput = capUnits * opp.perUnit;
    let servedOutput = 0;
    for (const r of opp.reachable) {
      if (capOutput <= 0) break;
      const short = deficitMap.get(r.sysId) ?? 0;
      if (short <= 0) continue;
      const take = Math.min(capOutput, short);
      servedOutput += take;
      capOutput -= take;
    }
    if (servedOutput <= 0) continue;

    const wantUnits = Math.min(capUnits, servedOutput / opp.perUnit, budget);
    if (wantUnits <= 0) continue;

    // Apply the production build to the working copy + emit it.
    site.buildings[opp.goodId] = (site.buildings[opp.goodId] ?? 0) + wantUnits;
    builds.push({ systemId: site.systemId, buildingType: opp.goodId, count: wantUnits });
    budget -= wantUnits;

    // Decrement the served structural demand (nearest-first) so later opportunities don't re-target it.
    let producedOutput = wantUnits * opp.perUnit;
    for (const r of opp.reachable) {
      if (producedOutput <= 0) break;
      const short = deficitMap.get(r.sysId) ?? 0;
      if (short <= 0) continue;
      const take = Math.min(producedOutput, short);
      deficitMap.set(r.sysId, short - take);
      producedOutput -= take;
    }
  }

  return builds;
}
```

- [ ] **Step 6: Update the engine tests for proactive housing**

In `lib/engine/__tests__/directed-build.test.ts`:

(a) In "builds tier-0 production at a site that can serve a reachable structural deficit", change the trailing comment `// Co-built housing accompanies the production so it can be staffed.` to `// Proactive housing accompanies the build (B is fed and calm with habitable land).`

(b) In "serves two distinct structural deficits across multiple greedy iterations", change `// Co-built housing also appears (from the first build's staffing co-build).` to `// Proactive housing also appears (C is fed and calm with habitable headroom).`

(c) Replace the test `it("returns no builds when the faction has no structural deficits", …)` with:

```ts
  it("builds proactive housing (no production) at a fed system with no structural deficits", () => {
    const fed: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 10, targetStock: 10, demand: 5 }],
    };
    const builds = planFactionBuilds([fed], () => 1);
    expect(countFor(builds, "A", "housing")).toBeGreaterThan(0);
    expect(builds.every((b) => b.buildingType === "housing")).toBe(true);
  });
```

(d) Add a new describe (proves the housing gates + co-build removal):

```ts
describe("planFactionBuilds — proactive housing", () => {
  it("does not build housing at a starved system", () => {
    const starved: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 100 }],
    };
    expect(countFor(planFactionBuilds([starved], () => 1), "A", "housing")).toBe(0);
  });

  it("does not build housing at an unsettled (high-unrest) system", () => {
    const unsettled: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0.9, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    };
    expect(countFor(planFactionBuilds([unsettled], () => 1), "A", "housing")).toBe(0);
  });

  it("never builds housing past the habitable cap", () => {
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100000, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 1000, habitableSpace: 5,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    };
    const housing = countFor(planFactionBuilds([sys], () => 1), "A", "housing");
    expect(housing).toBeGreaterThan(0);
    expect(housing).toBeLessThanOrEqual(5); // habitableSpace 5 ÷ spaceCost 1
  });

  it("does not co-build housing on the industry path (housing comes only from the housing pass)", () => {
    // Builder has NO habitable land: the housing pass cannot fire, so any housing here
    // would be the deleted co-build. Expect production, zero housing.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 0,
      goods: [],
    };
    const builds = planFactionBuilds([deficit, builder], () => 1);
    expect(countFor(builds, "B", "food")).toBeGreaterThan(0);
    expect(countFor(builds, "B", "housing")).toBe(0);
  });
});
```

- [ ] **Step 7: Update the processor "no writes" fixture**

In `lib/tick/processors/__tests__/directed-build.test.ts`, in "returns no writes when there are no structural deficits": change the `balanced` row's `generalSpace: 50, habitableSpace: 50` to `generalSpace: 0, habitableSpace: 0` (no habitable land → the proactive housing pass is a no-op → still zero writes). Update its trailing comment from `// demandRate 0 → targetStock 0 → balanced` to `// demandRate 0 → balanced; no habitable land → no proactive housing → no writes`.

- [ ] **Step 8: Run the engine + processor tests — expect PASS**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-build.test.ts`
Expected: PASS (all describes including the new proactive-housing block).

- [ ] **Step 9: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-build.test.ts
git commit -m "feat(build): proactive housing pass leads population; delete reactive co-build"
```

---

## Task 3: Spare-labour gate on the industry pass

Industry may only add the production its **already-resident** population can staff. Housing built this cycle adds no labour now (population fills it over later ticks), so industry genuinely follows the people who already live there.

**Files:**
- Modify: `lib/engine/directed-build.ts` (the industry allocation loop in `planFactionBuilds`)
- Test: `lib/engine/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes (existing): `labourDemand` from `@/lib/engine/industry`; `BUILDING_TYPES` from `@/lib/constants/industry` (for `labourPerUnit`).

- [ ] **Step 1: Write the failing spare-labour tests**

In `lib/engine/__tests__/directed-build.test.ts`, add:

```ts
describe("planFactionBuilds — spare-labour gate", () => {
  // A: ore-starved consumer (pop 0). B: builder with ore slots + general space but NO
  // habitable land (so the housing pass never interferes — this isolates industry).
  function deficitAndBuilder(builderPop: number, builderBuildings: Record<string, number>): BuildSystemState[] {
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    return [
      {
        systemId: "A", factionId: "f1", population: 0, unrest: 0, buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "ore", stock: 1, targetStock: 50, demand: 50 }],
      },
      {
        systemId: "B", factionId: "f1", population: builderPop, unrest: 0, buildings: builderBuildings,
        slotCap, generalSpace: 50, habitableSpace: 0, goods: [],
      },
    ];
  }

  it("builds no industry when the builder has no spare labour", () => {
    // pop 100 fully absorbed by 4 ore extractors (4 × 25 = 100 labour) → spareLabour 0.
    const builds = planFactionBuilds(deficitAndBuilder(100, { ore: 4 }), () => 1);
    expect(countFor(builds, "B", "ore")).toBe(0);
  });

  it("caps industry at the spare labour the resident population supports", () => {
    // pop 200, 4 ore extractors demand 100 → spareLabour 100 → ≤ 100/25 = 4 new units.
    const builds = planFactionBuilds(deficitAndBuilder(200, { ore: 4 }), () => 1);
    const built = countFor(builds, "B", "ore");
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThanOrEqual(4 + 1e-9);
  });
});
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "spare-labour"`
Expected: FAIL — "builds no industry when the builder has no spare labour" fails (ungated industry still builds ore).

- [ ] **Step 3: Add the spare-labour cap to the industry allocation**

In `lib/engine/directed-build.ts`, inside the `for (const opp of opportunities)` loop, replace this block:

```ts
    const wantUnits = Math.min(capUnits, servedOutput / opp.perUnit, budget);
    if (wantUnits <= 0) continue;
```

with:

```ts
    // Spare-labour gate: a site may add only the production its already-resident
    // population can staff (population − labour already demanded). Housing built this
    // cycle adds no labour now — population fills it over later ticks — so industry
    // follows the people who already live there, never population that doesn't yet exist.
    const labourPerUnit = BUILDING_TYPES[opp.goodId]?.labourPerUnit ?? 0;
    const spareLabour = Math.max(0, site.population - labourDemand(site.buildings));
    const labourCapUnits = labourPerUnit > 0 ? spareLabour / labourPerUnit : Infinity;

    const wantUnits = Math.min(capUnits, servedOutput / opp.perUnit, budget, labourCapUnits);
    if (wantUnits <= 0) continue;
```

- [ ] **Step 4: Run them — expect PASS**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "spare-labour"`
Expected: PASS.

- [ ] **Step 5: Run the full directed-build suite — expect PASS**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts lib/tick/processors/__tests__/directed-build.test.ts lib/engine/simulator/__tests__/directed-build-sim.test.ts`
Expected: PASS (including the performance test — the gate is O(1) per opportunity).

- [ ] **Step 6: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "feat(build): spare-labour gate caps industry at the resident workforce"
```

---

## Task 4: Behavioural guards — idle at potential & barren worlds

Two invariants that prove the build is well-behaved: a system at its potential builds nothing, and a barren low-habitable world never works its deposit slots (no labour to staff them).

**Files:**
- Test: `lib/engine/__tests__/directed-build.test.ts`

- [ ] **Step 1: Write the failing guard tests**

In `lib/engine/__tests__/directed-build.test.ts`, add:

```ts
describe("planFactionBuilds — idle at potential & barren worlds", () => {
  it("builds nothing at a system already at its potential", () => {
    // Housing fills the habitable cap (5 units → popCap 100); population 100 == popCap and
    // == labourDemand (4 ore × 25), so spareLabour 0; ore market balanced → no deficit.
    const slotCap = emptyResourceVector();
    slotCap.ore = 4;
    const atPotential: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0,
      buildings: { housing: 5, ore: 4 },
      slotCap, generalSpace: 9, habitableSpace: 5,
      goods: [{ goodId: "ore", stock: 50, targetStock: 50, demand: 20 }],
    };
    expect(planFactionBuilds([atPotential], () => 1)).toHaveLength(0);
  });

  it("does not work deposit slots on a barren, low-habitable world", () => {
    // 56 ore slots but ~no habitable land → can't house labour → spareLabour 0 → no extraction.
    const slotCap = emptyResourceVector();
    slotCap.ore = 56;
    const barren: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 3, unrest: 0,
      buildings: { ore: 0.12 }, // 0.12 × 25 = 3 labour == population → spareLabour 0
      slotCap, generalSpace: 60, habitableSpace: 0.001,
      goods: [],
    };
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 1, targetStock: 50, demand: 50 }],
    };
    expect(countFor(planFactionBuilds([barren, deficit], () => 1), "B", "ore")).toBe(0);
  });
});
```

- [ ] **Step 2: Run them — expect PASS**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "idle at potential"`
Expected: PASS (these are guards over already-implemented behaviour; if either fails, the housing/labour math in Tasks 2–3 has a bug — fix the engine, not the test).

- [ ] **Step 3: Commit**

```bash
git add lib/engine/__tests__/directed-build.test.ts
git commit -m "test(build): guard idle-at-potential and barren-world build behaviour"
```

---

## Task 5: Seed-below-potential validation harness + coarse calibration

The build loop is idle at potential, so a full seed shows nothing. Add a calibration lever that seeds systems below potential, run the simulator, and tune the knobs to the **coarse** health bar. This is observational calibration, not a pass/fail unit test.

**Files:**
- Modify: `lib/constants/substrate-gen.ts` (add `SEED_FILL_MULT`)
- Modify: `lib/engine/body-gen.ts:150-164` (apply it to the development fill)

**Interfaces:**
- Produces: `SUBSTRATE_GEN.SEED_FILL_MULT` — multiplier on the seeded development fill (1 = production default; <1 = seed below potential for the harness).

- [ ] **Step 1: Add the calibration lever**

In `lib/constants/substrate-gen.ts`, add to the `SUBSTRATE_GEN` object:

```ts
  /**
   * Validation lever: multiplies the seeded development fill so systems start BELOW
   * their substrate potential, letting the autonomic build be observed climbing toward
   * it (the loop is idle at potential). 1 = production (seed at potential). Lower for
   * the seed-below-potential harness (e.g. 0.5). See docs/plans/sp5-autonomic-build-design.md.
   */
  SEED_FILL_MULT: 1,
```

- [ ] **Step 2: Apply it in body-gen**

In `lib/engine/body-gen.ts`, find the development-fill line (currently `const fill = habitableSpace > 0 ? rawFill : 0;`, ~line 164) and change it to:

```ts
  const fill = habitableSpace > 0 ? rawFill * SUBSTRATE_GEN.SEED_FILL_MULT : 0;
```

(`SUBSTRATE_GEN` is already imported in `body-gen.ts`.) With the default `SEED_FILL_MULT = 1` this is a no-op — population, housing, and industry all scale down coherently when it is lowered, so food still matches the reduced population and nothing starts starving.

- [ ] **Step 3: Verify the no-op default — expect PASS**

Run: `npx vitest run lib/engine/__tests__/body-gen.test.ts lib/engine/__tests__/universe-gen.test.ts`
Expected: PASS (default 1 changes nothing).

- [ ] **Step 4: Run the harness (manual observation)**

Temporarily set `SEED_FILL_MULT: 0.5` in `lib/constants/substrate-gen.ts`, then run the simulator:

Run: `npm run simulate`

Confirm the **coarse** behaviour (not exact numbers):
- Fed systems climb — housing toward the habitable cap, population into the housing, industry behind the people — and asymptote at potential.
- Barren / low-habitable worlds stay small (deposit slots stay unworked).
- Nothing builds past habitable land or past staffable labour.
- No NaN / Infinity, no runaway, no galaxy-wide collapse; reasonable dispersion across systems.

- [ ] **Step 5: Tune the knobs to the coarse bar**

Adjust in `lib/constants/directed-build.ts` if the harness shows a problem: `SETTLE_MARGIN` (growth headroom — small enough that population fills it before disuse decay erodes it), `D_SETTLE` / `UNREST_SETTLE` (the fed-and-calm thresholds), and `GENERATION_PER_POP` (galaxy-wide build speed). Calibrate to the coarse health bar only — precise tuning is perishable and waits for SP4/SP5-full. Watch for **housing-pass ordering bias** (earlier systems in array order grabbing budget before later ones); if it shows, that is the signal to reintroduce the per-system pacing cap.

- [ ] **Step 6: Restore the production default**

Set `SEED_FILL_MULT` back to `1` in `lib/constants/substrate-gen.ts`. (Whether the live game ships seeds below potential is a separate product call — keep the production default at 1 until that is decided.)

- [ ] **Step 7: Run the full suite + lint/build — expect PASS**

Run: `npx vitest run`
Run: `npm run build`
Expected: PASS / clean build.

- [ ] **Step 8: Commit**

```bash
git add lib/constants/substrate-gen.ts lib/engine/body-gen.ts lib/constants/directed-build.ts
git commit -m "feat(build): seed-below-potential validation lever + coarse calibration"
```

---

## Self-review notes (spec coverage)

| Spec requirement (`sp5-autonomic-build-design.md`) | Covered by |
| --- | --- |
| Proactive housing toward habitable cap, fed-and-calm gated | Task 1 (gate) + Task 2 (housing pass) |
| Housing paced a `settleMargin` ahead of population | Task 2 `plannedHousingUnits` |
| Population growth untouched | Untouched by design (no population-engine edits) |
| Labour-gated fractional industry (`spareLabour / labourPerUnit`) | Task 3 |
| Co-build housing removed | Task 2 (deletes the block; co-build-removal test) |
| Pooled budget funds both; gates self-sequence | Tasks 2–3 (housing pass + industry pass share `budget`) |
| Per-system pacing cap | **Deliberately deferred** — physical ceilings pace it (Global Constraints; Task 5 watches for ordering bias) |
| `dissatisfaction()` + stored unrest, no new state | Task 1 (engine derives D from markets; `unrest` is an existing column) |
| Decay untouched (SP3.5 as-is) | No edits to decay files (Global Constraints) |
| Barren world builds nothing | Task 4 |
| Idle at potential | Task 4 |
| Seed-below-potential harness | Task 5 |
| Live (Prisma) + sim (memory) share the pure body | Tasks 1–3 (engine body unchanged across adapters) |

**Deliberate deviation from the spec:** the per-system pacing cap listed in the spec's "In scope" is not implemented in v1 — the physical ceilings already pace each system to ≈ its own pooled-budget contribution, so an explicit cap is dominated by the labour gate and would be untested dead code. Recorded as a deferred calibration knob (see `project-build-budget-pacing` memory). The honest driver today is the physical ceiling; deliberate single-system concentration is a future faction-agency concern, not an artifact of "spend the whole pot."
