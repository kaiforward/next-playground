# Economy UI Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface S1's already-computed skilled-labour data on the Industry panel — a system Labour card, health glyphs, academy-specific idle reasons, per-grade staffing, output/cyc, building descriptions, and a Compact/Detailed toggle — with no changes to the economy model.

**Architecture:** Display-only pass. The engine (`buildIndustryReadout`) stops discarding the labour pools and exposes them plus two derived per-building fields (`staffedFraction`, `output`); the `IdleReason` union splits `skill → skill1 | skill2`. All per-grade tooltip/micro-bar math is derived **client-side** from the static `BUILDING_TYPES[type].labour` × built count × the new `labour` block — no per-grade server payload. Because the repo has **no jsdom / React Testing Library**, all new *logic* lives in pure, Vitest-tested functions (engine + one pure display helper); the component stays thin and is verified by `tsc` + `build` + a manual visual smoke.

**Tech Stack:** Next.js 16 (App Router), TypeScript 5 strict, Tailwind v4 (`@theme` in `globals.css`), Radix tooltip wrapper (`components/ui/tooltip.tsx`), `SegmentedControl` (`components/form/segmented-control.tsx`), Vitest 4.

## Global Constraints

- **No `as` casts** except `as const` / runtime type guards in `lib/types/guards.ts`. Fix types at the source.
- **No `unknown`** anywhere except a `JSON.parse`/`localStorage` boundary narrowed immediately with `typeof`/`in` (or a type-guard param). Never store `unknown`.
- **No postfix `!`** in non-test code — strip `null | undefined` with a real check. `find(...)!` is the accepted idiom *in tests only*.
- **Engine is pure** — `lib/engine/industry.ts` has zero DB import. Keep it that way.
- **Unit test project has no `DATABASE_URL`** — never statically import `@/lib/prisma` into a unit-tested module graph. `lib/engine/industry.ts` and its test already comply; keep new imports DB-free.
- **Theme (Foundry):** no rounded corners on cards/badges/bars; `font-display` (Chakra Petch) for headings, `font-mono` (Geist Mono) for numerics; copper accents. Reuse existing `components/ui` + `components/form` primitives — no raw `<input>`/`<select>`.
- **Three colour languages, never overloaded** (colourblind-safe, each also carried by shape/glyph/label):
  - land/space = copper (`accent` / `accent-muted`),
  - labour grade = **unskilled blue** (`status-blue`) · **technician/skill1 cyan** (`status-cyan`) · **engineer/skill2 purple** (`status-purple`) — never grey (grey reads "absent"),
  - health = green/amber/red (`status-green|amber|red`) driven by the trend **glyph** `▲ ▬ ▼`.
- All these color tokens (`--color-status-{blue,cyan,purple,green,amber,red}` and `-light` variants) already exist in `app/globals.css`. No new tokens required.
- **Scope guard:** no labour-model / tick / decay / seed / build-planner change. No price/stock/net-flow on this panel. No deep pinnable tooltip infra.

---

## File Structure

**Modified**
- `lib/engine/industry.ts` — add `LabourPool` / `SystemLabour` types + `labour` block to `SystemIndustryReadout`; split `IdleReason`; add per-building `staffedFraction` + `output`; add pure `perGradeStaffing` helper + `GradeStaffing` type.
- `lib/engine/__tests__/industry.test.ts` — new describe blocks; one existing assertion updated (`skill` → `skill1`).
- `components/system/industry-panel.tsx` — rewritten into focused sub-components (`HealthGlyph`, `LabourCard`, `ProductionRow`, `BuildingTooltip`) + Compact/Detailed density.

**Created**
- `lib/constants/building-descriptions.ts` — `BUILDING_DESCRIPTIONS` (housing + 2 academies) + `TIER_LABELS` + `describeBuilding()` resolver (falls back to `GOODS[id].description`).
- `lib/constants/__tests__/building-descriptions.test.ts` — copy-coverage + resolver unit tests.
- `lib/hooks/use-industry-density.ts` — localStorage-backed `"compact" | "detailed"` density, SSR-safe.

**Untouched (flows through automatically)**
- `lib/services/universe.ts` — spreads `...buildIndustryReadout(...)`; the new fields ride along. No edit.
- `lib/types/api.ts` — `SystemIndustryData = { … } & SystemIndustryReadout`; picks up `labour` + extended `buildings[]` automatically. No edit.

---

## Semantics reference (so the four per-row signals never blur)

| Signal | Source | Meaning |
|--------|--------|---------|
| **Glyph** `▲▬▼` | `buildingHealth(used, built, unrest, θ)` | overall health — *all* throttles. The one at-a-glance state. |
| **Bar + `%`** | `staffedFraction` (= `effectiveFulfilment(tier)` for producers; occupancy for housing) | pure staffing. Bar hue = health; length = staffedFraction. |
| **`used/built`** | `round(staffedFraction × count) / count` (panel-derived) | staffing-consistent operating count + scale. |
| **`output/cyc`** | `output` = `buildingProduction × inputGate` | real production rate the base runs at this cycle. |
| **cause / needs** | `idleReason` + `supplyChain.throttledBy` | non-labour throttles (which academy, which input short, not selling). |

Note the engine field `used` (= `count × min(effectiveFulfilment, uptake)`, **staffed AND selling**) is kept **unchanged** — it drives the health glyph/tally/`industryHealth`. The panel's *displayed* `used/built` is a separate staffing-only figure derived from `staffedFraction`. `output` deliberately excludes `uptake`: the economy tick applies production = `buildingProduction × inputGate` and clamps at the band (uptake is decay's "is it selling" signal, not a production multiplier — see `lib/tick/processors/economy.ts:147-158`). The selling constraint surfaces via the glyph + the "output not selling" cause, not the number.

---

# Phase 1 — Engine + constants (pure, fully Vitest-tested)

Ships all data plumbing and copy with zero UI change. Verifiable by `tsc` + `vitest` alone.

### Task 1: Expose the system labour block on the readout

**Files:**
- Modify: `lib/engine/industry.ts` (add types near `LabourParts`; change `buildIndustryReadout`)
- Test: `lib/engine/__tests__/industry.test.ts`

**Interfaces:**
- Consumes: existing `labourParts()`, `labourStateFromParts()`.
- Produces: `LabourPool { have; need; fulfil }`, `SystemLabour { workforce; skill1; skill2 }`, and `SystemIndustryReadout.labour: SystemLabour`.

- [ ] **Step 1: Write the failing test** — append to `lib/engine/__tests__/industry.test.ts`:

```ts
describe("buildIndustryReadout — labour block", () => {
  const MIN = 5;
  it("reports workforce/skill1/skill2 supply, demand and fulfil", () => {
    // 3 electronics (tier-2: unskilled 30, skill1 20, skill2 10) + 1 school + 1 institute.
    const buildings = { electronics: 3, vocational_school: 1, research_institute: 1 };
    const pop = 100;
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());

    const demand = labourDemand(buildings);
    expect(readout.labour.workforce.have).toBeCloseTo(pop, 6);
    expect(readout.labour.workforce.need).toBeCloseTo(demand, 6);
    expect(readout.labour.workforce.fulfil).toBeCloseTo(labourFulfillment(pop, demand), 6);

    expect(readout.labour.skill1.have).toBeCloseTo(skill1Cap(buildings), 6);
    expect(readout.labour.skill1.need).toBeCloseTo(skill1Demand(buildings), 6);
    expect(readout.labour.skill1.fulfil).toBeCloseTo(computeLabourState(buildings, pop).skill1Fulfil, 6);

    expect(readout.labour.skill2.have).toBeCloseTo(skill2Cap(buildings), 6);
    expect(readout.labour.skill2.need).toBeCloseTo(skill2Demand(buildings), 6);
    expect(readout.labour.skill2.fulfil).toBeCloseTo(computeLabourState(buildings, pop).skill2Fulfil, 6);
  });

  it("a demand-with-zero-cap skill pool reads fulfil 0 (no academy)", () => {
    const buildings = { metals: 2 }; // tier-1 needs skill1; no school built
    const readout = buildIndustryReadout(buildings, 1000, {}, () => MIN, unitResourceVector());
    expect(readout.labour.skill1.need).toBeGreaterThan(0);
    expect(readout.labour.skill1.have).toBe(0);
    expect(readout.labour.skill1.fulfil).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run lib/engine/__tests__/industry.test.ts -t "labour block"` → FAIL (`readout.labour` is undefined).

- [ ] **Step 3: Implement** — in `lib/engine/industry.ts`, add the types immediately after the `LabourParts` interface (after line 122):

```ts
/** One supply-vs-demand labour pool for the Industry panel's Labour card. */
export interface LabourPool {
  /** Supply: population for workforce, licensed cap for skill pools. */
  have: number;
  /** Demand: Σ head count for workforce, Σ skill-grade demand for skill pools. */
  need: number;
  /** min(1, have / need) — 1 when nothing is demanded. */
  fulfil: number;
}

/** The three system-wide labour pools, supply vs demand. */
export interface SystemLabour {
  workforce: LabourPool;
  skill1: LabourPool;
  skill2: LabourPool;
}
```

Add `labour` to the `SystemIndustryReadout` interface (inside the interface, after `labourFulfillment`):

```ts
  /** The three system-wide labour pools (workforce/technician/engineer), supply vs demand. */
  labour: SystemLabour;
```

In `buildIndustryReadout`, replace the first line of the body:

```ts
  const state = computeLabourState(buildings, population);
```

with:

```ts
  const parts = labourParts(buildings);
  const state = labourStateFromParts(parts, population);
  const pop = Math.max(0, population);
  const labour: SystemLabour = {
    workforce: { have: pop, need: parts.demand, fulfil: state.labourFulfil },
    skill1: { have: parts.skill1Cap, need: parts.skill1Demand, fulfil: state.skill1Fulfil },
    skill2: { have: parts.skill2Cap, need: parts.skill2Demand, fulfil: state.skill2Fulfil },
  };
```

Add `labour` to the returned object (the final `return { labourFulfillment: state.labourFulfil, buildings: …, supplyChain: … }`):

```ts
  return {
    labourFulfillment: state.labourFulfil,
    labour,
    buildings: buildingEntries,
    supplyChain: supplyChainEntries,
  };
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run lib/engine/__tests__/industry.test.ts -t "labour block"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/industry.ts lib/engine/__tests__/industry.test.ts
git commit -m "feat(economy): expose system labour pools on the industry readout"
```

---

### Task 2: Split the skill idle reason into skill1 / skill2

**Files:**
- Modify: `lib/engine/industry.ts` (the `IdleReason` union; the idle-reason branch in `buildIndustryReadout`)
- Test: `lib/engine/__tests__/industry.test.ts` (add cases; update one existing assertion)

**Interfaces:**
- Produces: `IdleReason = "occupancy" | "labour" | "skill1" | "skill2" | "selling"`.

- [ ] **Step 1: Write the failing test** — append:

```ts
describe("buildIndustryReadout — skill idle reason split", () => {
  const MIN = 5;
  const MAXBAND = () => 100;

  it("'skill1' when a tier-1 good is fully staffed but no school licenses it", () => {
    const buildings = { metals: 4 }; // tier-1 needs skill1; no vocational_school
    const pop = labourDemand(buildings); // headcount fully staffed
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === "metals")!.idleReason).toBe("skill1");
  });

  it("'skill2' when a tier-2 good has skill1 licensed but no institute", () => {
    // enough schools to cover skill1 demand, zero institutes → skill2 is the binding pool.
    const buildings = { electronics: 1, vocational_school: 5 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { electronics: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === "electronics")!.idleReason).toBe("skill2");
  });

  it("'skill1' on a tier-2 good with neither academy (lower grade wins the tie)", () => {
    const buildings = { electronics: 4 }; // skill1Fulfil === skill2Fulfil === 0
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { electronics: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === "electronics")!.idleReason).toBe("skill1");
  });
});
```

- [ ] **Step 2: Update the one existing assertion** — in the existing test `"'skill' when a tier-2 building is fully staffed but no academy licenses its skilled work"`, change:

```ts
    expect(electronics.idleReason).toBe("skill");
```

to:

```ts
    expect(electronics.idleReason).toBe("skill1"); // neither academy → lower grade wins the tie
```

- [ ] **Step 3: Run it, verify it fails** — `npx vitest run lib/engine/__tests__/industry.test.ts -t "skill idle reason"` → FAIL (`"skill"` still emitted).

- [ ] **Step 4: Implement** — in `lib/engine/industry.ts`:

Change the union (line ~278):

```ts
export type IdleReason = "occupancy" | "labour" | "skill1" | "skill2" | "selling";
```

Update its doc comment to name both academies. In `buildIndustryReadout`'s per-building idle branch, replace:

```ts
    let idleReason: IdleReason | undefined;
    if (used < count) {
      if (uptake < fulfil) idleReason = "selling";
      else if (fulfil < state.labourFulfil) idleReason = "skill";
      else idleReason = "labour";
    }
```

with:

```ts
    let idleReason: IdleReason | undefined;
    if (used < count) {
      if (uptake < fulfil) idleReason = "selling";
      else if (fulfil < state.labourFulfil) {
        // A skill ceiling binds. Name the pool that is actually the min the tier draws on;
        // on a tier-2 tie (neither academy) the lower grade (skill1) wins — it is the prerequisite.
        idleReason = tier >= 2 && state.skill2Fulfil < state.skill1Fulfil ? "skill2" : "skill1";
      } else idleReason = "labour";
    }
```

- [ ] **Step 5: Run it, verify it passes** — `npx vitest run lib/engine/__tests__/industry.test.ts` (whole file, catches the updated existing test too) → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/industry.ts lib/engine/__tests__/industry.test.ts
git commit -m "feat(economy): name the specific academy in the idle reason (skill1/skill2)"
```

---

### Task 3: Add per-building `staffedFraction` + `output`

**Files:**
- Modify: `lib/engine/industry.ts` (`buildings[]` entry type; the per-building loop)
- Test: `lib/engine/__tests__/industry.test.ts`

**Interfaces:**
- Produces: each `SystemIndustryReadout.buildings[i]` gains `staffedFraction: number` and `output?: number`.

- [ ] **Step 1: Write the failing test** — append:

```ts
describe("buildIndustryReadout — staffedFraction + output", () => {
  const MIN = 5;
  const MAXBAND = () => 100;

  it("producer staffedFraction = effectiveFulfilment(tier), independent of selling", () => {
    // fully staffed + licensed, but stock pinned at the ceiling (not selling).
    const buildings = { metals: 4, vocational_school: 1 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { metals: 100 }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.staffedFraction).toBeCloseTo(1, 6); // pure staffing full even though used (selling) is ~0
    expect(metals.used).toBeLessThan(4 * 0.2);         // used still folds uptake (unchanged)
  });

  it("housing staffedFraction = occupancy (used / count)", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 10 }, 6 * POP_CENTRE_DENSITY, {}, () => MIN, unitResourceVector(), MAXBAND);
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing.staffedFraction).toBeCloseTo(0.6, 6);
  });

  it("output = buildingProduction × inputGate (input-throttled reads low even when fully staffed)", () => {
    const buildings = { metals: 3, vocational_school: 1 };
    const pop = labourDemand(buildings);
    // ore at floor → inputGate < 1; metals fully staffed.
    const readout = buildIndustryReadout(buildings, pop, { ore: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    const gate = readout.supplyChain.find((e) => e.goodId === "metals")!.inputGate;
    const gross = buildingProduction(buildings, "metals", computeLabourState(buildings, pop), unitResourceVector());
    expect(gate).toBeLessThan(1);
    expect(metals.output!).toBeCloseTo(gross * gate, 6);
  });

  it("output is 0 for a tier-1 good with no academy (skill-gated to zero)", () => {
    const buildings = { metals: 4 }; // no school → skill1Fulfil 0 → production 0
    const readout = buildIndustryReadout(buildings, labourDemand(buildings), { metals: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === "metals")!.output).toBe(0);
  });

  it("housing and academies carry no output", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 3, vocational_school: 1 }, 100, {}, () => MIN, unitResourceVector(), MAXBAND);
    expect(readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!.output).toBeUndefined();
    expect(readout.buildings.find((b) => b.buildingType === "vocational_school")!.output).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run lib/engine/__tests__/industry.test.ts -t "staffedFraction"` → FAIL.

- [ ] **Step 3: Implement** — in `lib/engine/industry.ts`:

Extend the `buildings` entry type in `SystemIndustryReadout`:

```ts
  buildings: Array<{
    buildingType: string;
    outputGood?: string;
    tier: number;
    count: number;
    used: number;
    /** Pure-staffing ratio the panel bar shows: effectiveFulfilment(tier) for producers, occupancy for housing. */
    staffedFraction: number;
    /** Real production rate this cycle (buildingProduction × inputGate). Producers/extractors only. */
    output?: number;
    idleReason?: IdleReason;
  }>;
```

In the housing branch of the loop, replace the `push`:

```ts
      buildingEntries.push({ buildingType, tier: -1, count, used, idleReason: used < count ? "occupancy" : undefined });
```

with:

```ts
      const staffedFraction = count > 0 ? used / count : 0;
      buildingEntries.push({ buildingType, tier: -1, count, used, staffedFraction, idleReason: used < count ? "occupancy" : undefined });
```

In the producer branch, after `const used = count * Math.min(fulfil, uptake);` and before the `idleReason` block, add the `output` computation; then include the two new fields in the `push`. Replace:

```ts
    const fulfil = effectiveFulfilment(state, tier);
    const used = count * Math.min(fulfil, uptake);
    let idleReason: IdleReason | undefined;
```

with:

```ts
    const fulfil = effectiveFulfilment(state, tier);
    const used = count * Math.min(fulfil, uptake);
    // output = the real production rate this cycle: buildingProduction × inputGate (uptake is a
    // selling/decay signal, not a production multiplier — see lib/tick/processors/economy.ts).
    let output: number | undefined;
    if (outputGood !== undefined) {
      const production = buildingProduction(buildings, outputGood, state, yields);
      const gate = GOOD_RECIPES[outputGood] ? inputGate(outputGood, production, stockOf, minStockOf) : 1;
      output = production * gate;
    }
    let idleReason: IdleReason | undefined;
```

and replace the producer `push`:

```ts
    buildingEntries.push({ buildingType, outputGood, tier, count, used, idleReason });
```

with:

```ts
    buildingEntries.push({ buildingType, outputGood, tier, count, used, staffedFraction: fulfil, output, idleReason });
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run lib/engine/__tests__/industry.test.ts` (whole file) → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/industry.ts lib/engine/__tests__/industry.test.ts
git commit -m "feat(economy): expose per-building staffedFraction + real output on the readout"
```

---

### Task 4: Pure `perGradeStaffing` helper (drives Detailed micro-bars + tooltip)

**Files:**
- Modify: `lib/engine/industry.ts` (add helper + type)
- Test: `lib/engine/__tests__/industry.test.ts`

**Interfaces:**
- Consumes: `LabourVector` (from `@/lib/constants/industry`), `LabourState`.
- Produces:
  - `GradeStaffing { grade: "unskilled" | "skill1" | "skill2"; needed; filled; fulfil; wall }`.
  - `perGradeStaffing(labour: LabourVector, built: number, tier: GoodTier, state: LabourState): GradeStaffing[]` — one entry per grade the tier draws on (tier-0 → 1 row; tier-1 → 2; tier-2 → 3), `wall` set on the binding (min-fulfil) grade.

- [ ] **Step 1: Write the failing test** — append (and add `perGradeStaffing` + type `GradeStaffing` to the import block at the top of the test file):

```ts
describe("perGradeStaffing", () => {
  const V = BUILDING_TYPES.electronics!.labour!; // tier-2: unskilled 30, skill1 20, skill2 10

  it("emits only the grades the tier draws on", () => {
    const s: LabourState = { labourFulfil: 1, skill1Fulfil: 1, skill2Fulfil: 1 };
    expect(perGradeStaffing(BUILDING_TYPES.ore!.labour!, 2, 0, s).map((g) => g.grade)).toEqual(["unskilled"]);
    expect(perGradeStaffing(BUILDING_TYPES.metals!.labour!, 2, 1, s).map((g) => g.grade)).toEqual(["unskilled", "skill1"]);
    expect(perGradeStaffing(V, 2, 2, s).map((g) => g.grade)).toEqual(["unskilled", "skill1", "skill2"]);
  });

  it("needed = built × vector share; filled = needed × grade fulfil", () => {
    const s: LabourState = { labourFulfil: 0.5, skill1Fulfil: 0.25, skill2Fulfil: 1 };
    const rows = perGradeStaffing(V, 3, 2, s);
    const u = rows.find((r) => r.grade === "unskilled")!;
    const t = rows.find((r) => r.grade === "skill1")!;
    expect(u.needed).toBeCloseTo(3 * 30, 6);
    expect(u.filled).toBeCloseTo(3 * 30 * 0.5, 6);
    expect(t.needed).toBeCloseTo(3 * 20, 6);
    expect(t.filled).toBeCloseTo(3 * 20 * 0.25, 6);
  });

  it("flags the binding (min-fulfil) grade as the wall", () => {
    const s: LabourState = { labourFulfil: 0.9, skill1Fulfil: 0.25, skill2Fulfil: 0.6 };
    const rows = perGradeStaffing(V, 1, 2, s);
    expect(rows.find((r) => r.wall)!.grade).toBe("skill1");
    expect(rows.filter((r) => r.wall)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run lib/engine/__tests__/industry.test.ts -t "perGradeStaffing"` → FAIL (not exported).

- [ ] **Step 3: Implement** — in `lib/engine/industry.ts`, first extend the constants import (line 21-34) to include `type LabourVector`:

```ts
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  POP_CENTRE_DENSITY,
  effectiveSpaceCost,
  EXTRACTOR_STORAGE_PER_UNIT,
  PRODUCTION_STORAGE_PER_UNIT,
  POP_CENTRE_STORAGE,
  POP_CENTRE_STORAGE_DEFAULT,
  IDLE_COASTING_FRACTION,
  IDLE_COLLAPSING_FRACTION,
  labourTotal,
  INPUT_DEMAND_MULTIPLIER,
  type LabourVector,
} from "@/lib/constants/industry";
```

Then add the helper (place it after `effectiveFulfilment`, ~line 170):

```ts
/** One grade's staffing for a building: how many workers it needs, how many are filled, and whether it is the wall. */
export interface GradeStaffing {
  grade: "unskilled" | "skill1" | "skill2";
  /** built × the grade's share of the labour vector. */
  needed: number;
  /** needed × the grade's system-wide fulfilment. */
  filled: number;
  /** The grade's system-wide fulfilment ratio in [0,1]. */
  fulfil: number;
  /** True on the binding grade (the min fulfil among the grades the tier draws on). */
  wall: boolean;
}

/**
 * Per-grade staffing for one building type, derived from its static labour vector, its built
 * count and the system labour state. Emits only the grades the good's tier draws on
 * (tier-0 → unskilled; tier-1 → +skill1; tier-2 → +skill2). Pure — the same values feed the
 * Detailed micro-bars and the tooltip. `wall` marks the grade whose fulfil is the effective min.
 */
export function perGradeStaffing(
  labour: LabourVector,
  built: number,
  tier: GoodTier,
  state: LabourState,
): GradeStaffing[] {
  const rows: GradeStaffing[] = [
    { grade: "unskilled", needed: built * labour.unskilled, fulfil: state.labourFulfil, filled: 0, wall: false },
  ];
  if (tier >= 1) rows.push({ grade: "skill1", needed: built * labour.skill1, fulfil: state.skill1Fulfil, filled: 0, wall: false });
  if (tier >= 2) rows.push({ grade: "skill2", needed: built * labour.skill2, fulfil: state.skill2Fulfil, filled: 0, wall: false });
  for (const r of rows) r.filled = r.needed * r.fulfil;
  let wall = rows[0];
  for (const r of rows) if (r.fulfil < wall.fulfil) wall = r;
  wall.wall = true;
  return rows;
}
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run lib/engine/__tests__/industry.test.ts -t "perGradeStaffing"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/industry.ts lib/engine/__tests__/industry.test.ts
git commit -m "feat(economy): add pure per-grade staffing helper for the industry panel"
```

---

### Task 5: Building descriptions + tier labels

**Files:**
- Create: `lib/constants/building-descriptions.ts`
- Create: `lib/constants/__tests__/building-descriptions.test.ts`

**Interfaces:**
- Produces:
  - `BUILDING_DESCRIPTIONS: Record<string, string>` — bespoke copy for `housing`, `vocational_school`, `research_institute`.
  - `TIER_LABELS: Record<GoodTier, string>` — `0 → "Extraction"`, `1 → "Basic manufacturing"`, `2 → "Advanced manufacturing"`.
  - `describeBuilding(type: string): string` — `BUILDING_DESCRIPTIONS[type]` else `GOODS[type]?.description` else `""`.

Rationale (DRY): the 26 production buildings each map 1:1 to a good, and `GOODS[id].description` already carries "what it is" copy — so `describeBuilding` falls back to it instead of duplicating 26 strings. Only the three non-good buildings (the least self-explanatory, per the design) get bespoke role copy.

- [ ] **Step 1: Write the failing test** — `lib/constants/__tests__/building-descriptions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BUILDING_DESCRIPTIONS, TIER_LABELS, describeBuilding } from "@/lib/constants/building-descriptions";
import { HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE } from "@/lib/constants/industry";
import { GOODS } from "@/lib/constants/goods";

describe("building descriptions", () => {
  it("carries bespoke copy for the three non-good buildings", () => {
    for (const t of [HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE]) {
      expect(BUILDING_DESCRIPTIONS[t], t).toBeDefined();
      expect(BUILDING_DESCRIPTIONS[t].length, t).toBeGreaterThan(20);
    }
  });

  it("names what each academy licenses", () => {
    expect(BUILDING_DESCRIPTIONS[VOCATIONAL_SCHOOL_TYPE].toLowerCase()).toContain("technician");
    expect(BUILDING_DESCRIPTIONS[RESEARCH_INSTITUTE_TYPE].toLowerCase()).toContain("engineer");
  });

  it("TIER_LABELS covers all three tiers", () => {
    expect(TIER_LABELS[0]).toBeTruthy();
    expect(TIER_LABELS[1]).toBeTruthy();
    expect(TIER_LABELS[2]).toBeTruthy();
  });

  it("describeBuilding falls back to the good description for production buildings", () => {
    expect(describeBuilding(VOCATIONAL_SCHOOL_TYPE)).toBe(BUILDING_DESCRIPTIONS[VOCATIONAL_SCHOOL_TYPE]);
    expect(describeBuilding("ore")).toBe(GOODS.ore.description);
    expect(describeBuilding("nonexistent-good")).toBe("");
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run lib/constants/__tests__/building-descriptions.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `lib/constants/building-descriptions.ts`:

```ts
/**
 * "What it does" copy for the Industry panel tooltips + tier role labels. Pure data.
 *
 * Production buildings map 1:1 to a good, so their copy is the good's own description
 * (GOODS[id].description) — `describeBuilding` falls back to it rather than duplicating
 * 26 strings here. Only the three non-good buildings (housing + the two academies, the
 * least self-explanatory) carry bespoke role copy.
 */
import type { GoodTier } from "@/lib/types/game";
import { GOODS } from "@/lib/constants/goods";
import { HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE } from "@/lib/constants/industry";

/** Role label per good tier — the building's manufacturing class. */
export const TIER_LABELS: Record<GoodTier, string> = {
  0: "Extraction",
  1: "Basic manufacturing",
  2: "Advanced manufacturing",
};

/** Bespoke copy for the buildings that are not a produced good. */
export const BUILDING_DESCRIPTIONS: Record<string, string> = {
  [HOUSING_TYPE]:
    "Population centres — homes, services, and civic infrastructure. Raise the population ceiling; every resident is a potential worker. Decay toward their occupants: housing left empty is shed, housing overfilled displaces its overflow as migration.",
  [VOCATIONAL_SCHOOL_TYPE]:
    "Vocational school — trains residents for technician-grade (skill-1) work. Licenses a system-wide ceiling on how much basic manufacturing can be staffed; without one, no processed goods can be made here. Draws unskilled labour to run, and decays toward the technician demand it actually serves.",
  [RESEARCH_INSTITUTE_TYPE]:
    "Research institute — certifies residents for engineer-grade (skill-2) work. Licenses a system-wide ceiling on advanced manufacturing; without one, no advanced goods can be made here. Draws unskilled labour to run, and decays toward the engineer demand it actually serves.",
};

/** "What it does" for a building type: bespoke copy, else the produced good's description, else "". */
export function describeBuilding(type: string): string {
  return BUILDING_DESCRIPTIONS[type] ?? GOODS[type]?.description ?? "";
}
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run lib/constants/__tests__/building-descriptions.test.ts` → PASS.

- [ ] **Step 5: Typecheck the phase** — `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/constants/building-descriptions.ts lib/constants/__tests__/building-descriptions.test.ts
git commit -m "feat(economy): add building descriptions + tier labels for the industry panel"
```

---

# Phase 2 — Component: Labour card, health glyph, richer production rows (Compact)

No new economy behaviour. Verified by `tsc` + `next build` + manual visual smoke. Logic already lives in the tested Phase-1 helpers; the component composes them.

> The current `components/system/industry-panel.tsx` (read it first) already has `LandBar`, `PoolHeader`, `RoleLabel`, `LegendTooltip`, `BuildingRow` and the grouped-by-land-pool layout. Phase 2 **replaces the status dot with a glyph, adds the Labour card, and rebuilds `BuildingRow` → `ProductionRow`** with the aligned label column + trailing cluster + tooltip. The land bars, pool grouping and `LegendTooltip` are kept.

### Task 6: `HealthGlyph` component; replace the status dot and badge prefix

**Files:**
- Modify: `components/system/industry-panel.tsx`

**Interfaces:**
- Produces: `HealthGlyph({ health, className? })` rendering `▲ | ▬ | ▼` in the health colour with an accessible label.

- [ ] **Step 1: Add the glyph map + component** near the top of the file, after the `HEALTH` map:

```tsx
/** Trend glyph per health — shape-first (colourblind-safe), colour reinforces. */
const HEALTH_GLYPH: Record<IndustryHealth, string> = {
  thriving: "▲",
  coasting: "▬",
  declining: "▼",
};

/** The one at-a-glance state signal: a trend glyph coloured by health. */
function HealthGlyph({ health, className = "" }: { health: IndustryHealth; className?: string }) {
  return (
    <span
      aria-label={HEALTH[health].sys}
      title={HEALTH[health].sys}
      className={`font-mono leading-none ${HEALTH[health].text} ${className}`}
    >
      {HEALTH_GLYPH[health]}
    </span>
  );
}
```

- [ ] **Step 2: Prefix the system badge with the glyph** — in `IndustryPanel`, change the badge line:

```tsx
          <Badge color={HEALTH[sysHealth].badge}>{HEALTH[sysHealth].sys}</Badge>
```

to:

```tsx
          <Badge color={HEALTH[sysHealth].badge}>
            <HealthGlyph health={sysHealth} className="mr-1 text-xs" />
            {HEALTH[sysHealth].sys}
          </Badge>
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` → no errors. (The dot is removed in Task 8 when `BuildingRow` becomes `ProductionRow`; leaving it until then keeps this task self-contained.)

- [ ] **Step 4: Commit**

```bash
git add components/system/industry-panel.tsx
git commit -m "feat(economy): add health trend glyph to the industry panel badge"
```

---

### Task 7: `LabourCard` — the three system-wide pools

**Files:**
- Modify: `components/system/industry-panel.tsx`

**Interfaces:**
- Consumes: `data.labour` (`SystemLabour`).
- Produces: `LabourCard({ labour })` — three supply-vs-demand rows under the health strip.

- [ ] **Step 1: Add the grade-colour map + pool-health helper + component.** After the `HEALTH_GLYPH` map add:

```tsx
/** Labour-grade hues — distinct from health and from land (copper). Redundant U/T/E label at call sites. */
const GRADE = {
  unskilled: { bar: "bg-status-blue", text: "text-status-blue-light", tag: "U" },
  skill1: { bar: "bg-status-cyan", text: "text-status-cyan-light", tag: "T" },
  skill2: { bar: "bg-status-purple", text: "text-status-purple-light", tag: "E" },
} as const;

/** Coarse 3-band health for a pool fulfil ratio — drives the % numeral colour on the Labour card. */
function poolHealth(fulfil: number): IndustryHealth {
  if (fulfil >= 0.999) return "thriving";
  if (fulfil >= 0.5) return "coasting";
  return "declining";
}
```

Then, above `IndustryPanel`, add the card. Import `describeBuilding` is not needed here; the "no academy" cause is inline copy.

```tsx
type Grade = keyof typeof GRADE;

/** One Labour-card row: grade bar (grade hue) + supply/demand numbers + health-coloured %. */
function LabourRow({
  title,
  grade,
  have,
  need,
  fulfil,
  supplyNoun,
  demandNoun,
  emptyCause,
}: {
  title: string;
  grade: Grade;
  have: number;
  need: number;
  fulfil: number;
  supplyNoun: string;
  demandNoun: string;
  emptyCause?: string;
}) {
  const health = poolHealth(fulfil);
  const noCap = need > 0 && have <= 0;
  return (
    <div className="py-1">
      <div className="flex items-center gap-2.5">
        <span className={`flex w-[92px] shrink-0 items-center gap-1.5 text-sm text-text-primary`}>
          <span aria-hidden className={`inline-flex h-3.5 w-3.5 items-center justify-center border border-border font-mono text-[9px] ${GRADE[grade].text}`}>
            {GRADE[grade].tag}
          </span>
          {title}
        </span>
        <div className="relative h-3.5 flex-1 overflow-hidden border border-border bg-surface-active">
          <div className={`absolute inset-y-0 left-0 ${GRADE[grade].bar}`} style={{ width: `${Math.min(100, Math.max(0, fulfil * 100))}%` }} />
        </div>
        <span className={`w-9 text-right font-mono text-xs ${HEALTH[health].text}`}>{Math.round(fulfil * 100)}%</span>
        <span className="w-[104px] text-right font-mono text-[11px] text-text-secondary">
          <span className="text-text-primary">{formatMagnitude(have)}</span> {supplyNoun} / {formatMagnitude(need)} {demandNoun}
        </span>
      </div>
      {noCap && emptyCause && (
        <p className="mt-0.5 ml-[102px] text-[11px] text-status-red-light">{emptyCause}</p>
      )}
    </div>
  );
}

/** System-wide labour: workforce headcount + the two academy-licensed skill ceilings. */
function LabourCard({ labour }: { labour: SystemLabour }) {
  return (
    <Card variant="bordered" padding="md">
      <p className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wider text-text-primary">Labour</p>
      <LabourRow title="Workforce" grade="unskilled" have={labour.workforce.have} need={labour.workforce.need} fulfil={labour.workforce.fulfil} supplyNoun="pop" demandNoun="jobs" />
      <LabourRow title="Technicians" grade="skill1" have={labour.skill1.have} need={labour.skill1.need} fulfil={labour.skill1.fulfil} supplyNoun="lic" demandNoun="req" emptyCause="No vocational school — technician-grade work can't run." />
      <LabourRow title="Engineers" grade="skill2" have={labour.skill2.have} need={labour.skill2.need} fulfil={labour.skill2.fulfil} supplyNoun="lic" demandNoun="req" emptyCause="No research institute — engineer-grade work can't run." />
    </Card>
  );
}
```

- [ ] **Step 2: Add the `SystemLabour` import** — extend the type import from the engine:

```tsx
import type { IndustryHealth, IdleReason, SystemIndustryReadout, SystemLabour } from "@/lib/engine/industry";
```

- [ ] **Step 3: Render it** — in `IndustryPanel`, destructure `labour` and mount the card directly under the health strip `Card`:

```tsx
  const { space, deposits, labour, labourFulfillment, buildings, supplyChain, unrest } = data;
```

and after the closing `</Card>` of the health strip, add:

```tsx
      <LabourCard labour={labour} />
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add components/system/industry-panel.tsx
git commit -m "feat(economy): add system Labour card (workforce + technician + engineer pools)"
```

---

### Task 8: `ProductionRow` — glyph, aligned label column, staffing bar, trailing cluster, column header

**Files:**
- Modify: `components/system/industry-panel.tsx`

**Interfaces:**
- Consumes: `BuildingEntry` (now carrying `staffedFraction` + `output`), `perGradeStaffing`, `describeBuilding`, `TIER_LABELS`.
- Produces: `ProductionRow` (replaces `BuildingRow`) rendering `<glyph> <label [×yield]> [bar] <staff%> <used/built> <output/cyc>` + cause/needs lines; a `RowHeader` labelling the trailing columns.

This task delivers the **Compact** density only (single health-coloured staffing bar). The Detailed micro-bars + toggle come in Phase 3; the tooltip comes in Task 9. Keep `ProductionRow` accepting a `density` prop now (default `"compact"`) so Phase 3 is a pure addition.

- [ ] **Step 1: Update the idle-cause map** for the split reasons (replace `IDLE_CAUSE`):

```tsx
const IDLE_CAUSE: Record<IdleReason, string> = {
  occupancy: "low occupancy",
  labour: "labour short",
  skill1: "needs vocational school",
  skill2: "needs research institute",
  selling: "output not selling",
};
```

- [ ] **Step 2: Add the imports** the row needs:

```tsx
import { perGradeStaffing, buildingHealth, industryHealth } from "@/lib/engine/industry";
import { describeBuilding, TIER_LABELS } from "@/lib/constants/building-descriptions";
import type { GoodTier } from "@/lib/types/game";
```

(Merge the `perGradeStaffing`/`buildingHealth`/`industryHealth` names into the existing engine import line rather than duplicating it; `buildingHealth` + `industryHealth` are already imported — only add `perGradeStaffing`.)

- [ ] **Step 3: Add a shared column-width contract + the header.** Above `ProductionRow` add:

```tsx
/** Trailing numeric cluster widths — shared by the header and every row so they align as a table. */
const COL = { staff: "w-9", used: "w-[52px]", out: "w-[60px]" };

/** Column header labelling the trailing numbers so the block reads like a table. */
function RowHeader({ showOutput }: { showOutput: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-3 pb-1 font-mono text-[9px] uppercase tracking-wider text-text-tertiary/70">
      <span className="w-3 shrink-0" aria-hidden />
      <span className="min-w-[104px] flex-1">{" "}</span>
      <span className={`${COL.staff} text-right`}>staff</span>
      <span className={`${COL.used} text-right`}>used/built</span>
      {showOutput && <span className={`${COL.out} text-right`}>out/cyc</span>}
    </div>
  );
}
```

- [ ] **Step 4: Replace `BuildingRow` with `ProductionRow`.** Delete the whole `BuildingRow` function and add:

```tsx
type Density = "compact" | "detailed";

/** One building line: glyph · name (+yield) · staffing bar · staff% · used/built · output/cyc, with cause/needs lines. */
function ProductionRow({
  b,
  unrest,
  labour,
  yieldMult,
  yieldBand,
  supply,
  density = "compact",
  showOutput = false,
}: {
  b: BuildingEntry;
  unrest: number;
  labour: SystemLabour;
  yieldMult?: number;
  yieldBand?: QualityBandId;
  supply?: SystemIndustryReadout["supplyChain"][number];
  density?: Density;
  showOutput?: boolean;
}) {
  const health = buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: THRESHOLD });
  const meta = HEALTH[health];
  const staffPct = Math.max(0, Math.min(100, b.staffedFraction * 100));
  const usedDisplay = Math.round(b.staffedFraction * b.count);
  const isAcademy = ACADEMY_TYPES.includes(b.buildingType);

  // Cause line — only for rows that aren't stable. Priority: over-capacity, unrest, then the idle constraint.
  let cause: string | undefined;
  if (health !== "thriving") {
    if (b.used > b.count) cause = "over capacity";
    else if (unrest >= THRESHOLD) cause = "high unrest";
    else if (b.idleReason) cause = IDLE_CAUSE[b.idleReason];
  }

  const inputs = supply ? Object.keys(GOOD_RECIPES[supply.goodId] ?? {}) : [];

  // Detailed density: per-grade micro-bars in place of the single health bar (Phase 3).
  const grades =
    density === "detailed" && !isAcademy && b.tier >= 0
      ? perGradeStaffing(BUILDING_TYPES[b.buildingType]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 }, b.count, b.tier as GoodTier, {
          labourFulfil: labour.workforce.fulfil,
          skill1Fulfil: labour.skill1.fulfil,
          skill2Fulfil: labour.skill2.fulfil,
        })
      : null;

  return (
    <div className="border-b border-border/40 px-3 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <HealthGlyph health={health} className="w-3 shrink-0 text-center text-[10px]" />
        <span className="flex min-w-[104px] flex-1 items-center gap-1.5 text-sm text-text-primary">
          {label(b.buildingType)}
          {yieldMult !== undefined && (
            <span className={`font-mono text-[10px] ${yieldBand ? QUALITY_BAND_TEXT[yieldBand] : "text-text-tertiary"}`}>
              ×{yieldMult.toFixed(2)}
            </span>
          )}
        </span>

        {grades ? (
          <div className="flex flex-1 flex-col gap-0.5">
            {grades.map((g) => (
              <div key={g.grade} className="flex items-center gap-1.5">
                <span aria-hidden className={`w-3 font-mono text-[9px] ${GRADE[g.grade].text}`}>{GRADE[g.grade].tag}</span>
                <div className="relative h-2 flex-1 overflow-hidden border border-border bg-surface-active">
                  <div className={`absolute inset-y-0 left-0 ${GRADE[g.grade].bar}`} style={{ width: `${Math.max(0, Math.min(100, g.fulfil * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            role="progressbar"
            aria-valuenow={Math.round(staffPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${label(b.buildingType)}: ${Math.round(staffPct)}% staffed`}
            className="relative h-3.5 flex-1 overflow-hidden border border-border bg-surface-active"
            style={{ backgroundImage: IDLE_HATCH }}
          >
            <div className={`absolute inset-y-0 left-0 ${meta.fill}`} style={{ width: `${staffPct}%` }} />
          </div>
        )}

        <span className={`${COL.staff} text-right font-mono text-xs ${meta.text}`}>{Math.round(staffPct)}%</span>
        <span className={`${COL.used} text-right font-mono text-[11px] text-text-secondary`}>
          <span className="text-text-primary">{usedDisplay}</span>/{formatMagnitude(b.count)}
        </span>
        {showOutput && (
          <span className={`${COL.out} text-right font-mono text-[11px] text-text-secondary`}>
            {b.output !== undefined ? formatMagnitude(b.output) : "—"}
          </span>
        )}
      </div>

      {cause && (
        <p className="mt-1 ml-[26px] text-[11px] text-text-tertiary">
          <span className="font-mono uppercase tracking-wide text-text-tertiary/80">cause</span> {cause}
        </p>
      )}
      {supply && inputs.length > 0 && (
        <p className="mt-1 ml-[26px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className="font-mono uppercase tracking-wide text-text-tertiary/80">needs</span>
          {inputs.map((input) => {
            const short = supply.throttledBy.includes(input);
            return (
              <span key={input} className={`font-mono ${short ? "text-status-red-light" : "text-status-green-light"}`}>
                {short ? "⚠" : "✓"} {label(input)}{short ? ` ${Math.round(supply.inputGate * 100)}%` : ""}
              </span>
            );
          })}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update every `BuildingRow` call site** in `IndustryPanel` to `ProductionRow`, passing `labour`, and add `RowHeader` + `showOutput` to the pools that produce a good. Extractors and Production show output; Housing and Academies do not.

Extractors block:

```tsx
          <RowHeader showOutput />
          <div className="mt-2.5 -mx-1">
            {extractors.map((b) => {
              const dep = yieldFor(b);
              return <ProductionRow key={b.buildingType} b={b} unrest={unrest} labour={labour} yieldMult={dep?.yieldMult} yieldBand={dep?.band} showOutput />;
            })}
          </div>
```

Housing block:

```tsx
            <div className="-mx-1">
              {housing.map((b) => <ProductionRow key={b.buildingType} b={b} unrest={unrest} labour={labour} />)}
            </div>
```

Academies block:

```tsx
            <div className="-mx-1">
              {academies.map((b) => <ProductionRow key={b.buildingType} b={b} unrest={unrest} labour={labour} />)}
            </div>
```

Production block:

```tsx
            <RowHeader showOutput />
            <div className="-mx-1">
              {factories.map((b) => (
                <ProductionRow key={b.buildingType} b={b} unrest={unrest} labour={labour} showOutput supply={b.outputGood ? supplyByGood.get(b.outputGood) : undefined} />
              ))}
            </div>
```

- [ ] **Step 6: Remove the now-unused `usedNoun` helper** (the old bar tooltip is gone) and any now-unused imports flagged by `tsc`.

- [ ] **Step 7: Verify** — `npx tsc --noEmit` → no errors, then `npm run build` → succeeds.

- [ ] **Step 8: Commit**

```bash
git add components/system/industry-panel.tsx
git commit -m "feat(economy): rebuild industry rows with glyph, staffing bar, used/built + output/cyc"
```

---

### Task 9: `BuildingTooltip` — description + per-grade filled/needed + footer

**Files:**
- Modify: `components/system/industry-panel.tsx`

**Interfaces:**
- Consumes: `perGradeStaffing`, `describeBuilding`, `TIER_LABELS`, `labour`.
- Produces: `BuildingTooltip` wrapping a `ProductionRow`'s label in a Radix tooltip trigger; content = header + description + per-grade rows (producers) + footer.

- [ ] **Step 1: Add the tooltip content component.** Above `ProductionRow` add:

```tsx
/** Rich per-building tooltip: header · description · per-grade filled/needed · footer. Producers get the grade split; housing/academies a lighter body. */
function BuildingTooltipBody({ b, labour }: { b: BuildingEntry; labour: SystemLabour }) {
  const isAcademy = ACADEMY_TYPES.includes(b.buildingType);
  const isProducer = b.outputGood !== undefined && !isAcademy && b.tier >= 0;
  const grades = isProducer
    ? perGradeStaffing(BUILDING_TYPES[b.buildingType]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 }, b.count, b.tier as GoodTier, {
        labourFulfil: labour.workforce.fulfil,
        skill1Fulfil: labour.skill1.fulfil,
        skill2Fulfil: labour.skill2.fulfil,
      })
    : [];
  const wall = grades.find((g) => g.wall);
  const tierLabel = b.tier >= 0 ? TIER_LABELS[b.tier as GoodTier] : undefined;

  return (
    <div className="space-y-1.5">
      <p className="font-display text-[12px] font-semibold text-text-primary">{label(b.buildingType)}</p>
      {(tierLabel || b.count > 0) && (
        <p className="font-mono text-[10px] text-text-tertiary">
          {tierLabel && !isAcademy ? `tier ${b.tier} · ${tierLabel} · ` : ""}×{formatMagnitude(b.count)} built
        </p>
      )}
      <p className="text-[11px] leading-snug text-text-secondary">{describeBuilding(b.buildingType)}</p>

      {isProducer && grades.length > 0 && (
        <div className="space-y-0.5 border-t border-border/60 pt-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">staffing — filled / needed</p>
          {grades.map((g) => (
            <div key={g.grade} className="flex items-center gap-1.5">
              <span aria-hidden className={`w-3 font-mono text-[9px] ${GRADE[g.grade].text}`}>{GRADE[g.grade].tag}</span>
              <div className="relative h-1.5 flex-1 overflow-hidden border border-border bg-surface-active">
                <div className={`absolute inset-y-0 left-0 ${GRADE[g.grade].bar}`} style={{ width: `${Math.max(0, Math.min(100, g.fulfil * 100))}%` }} />
              </div>
              <span className={`w-[70px] text-right font-mono text-[10px] ${g.wall ? "text-status-red-light" : "text-text-secondary"}`}>
                {formatMagnitude(g.filled)}/{formatMagnitude(g.needed)}{g.wall ? " ◄" : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {isProducer && (
        <p className="border-t border-border/60 pt-1.5 text-[11px] leading-snug text-text-tertiary">
          Output <span className="font-mono text-text-secondary">{b.output !== undefined ? formatMagnitude(b.output) : "0"}</span>/cyc — staffing{" "}
          <span className="font-mono text-text-secondary">{Math.round(b.staffedFraction * 100)}%</span>
          {wall && wall.fulfil < 1 ? (
            <>
              , {GRADE[wall.grade].tag === "U" ? "unskilled workers" : GRADE[wall.grade].tag === "T" ? "technicians" : "engineers"} are the wall.
              {wall.grade === "skill1" ? " Build a vocational school to license technician-grade work." : ""}
              {wall.grade === "skill2" ? " Build a research institute to license engineer-grade work." : ""}
            </>
          ) : "."}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wrap the row label in a tooltip trigger.** In `ProductionRow`, replace the label `<span>` with a Radix tooltip so hovering the name reveals the breakdown (Radix `asChild` keeps the span a direct flex child). Change:

```tsx
        <span className="flex min-w-[104px] flex-1 items-center gap-1.5 text-sm text-text-primary">
          {label(b.buildingType)}
          {yieldMult !== undefined && (
            <span className={`font-mono text-[10px] ${yieldBand ? QUALITY_BAND_TEXT[yieldBand] : "text-text-tertiary"}`}>
              ×{yieldMult.toFixed(2)}
            </span>
          )}
        </span>
```

to:

```tsx
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="flex min-w-[104px] flex-1 items-center gap-1.5 text-left text-sm text-text-primary underline-offset-2 hover:underline">
              {label(b.buildingType)}
              {yieldMult !== undefined && (
                <span className={`font-mono text-[10px] ${yieldBand ? QUALITY_BAND_TEXT[yieldBand] : "text-text-tertiary"}`}>
                  ×{yieldMult.toFixed(2)}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent className="w-64">
            <BuildingTooltipBody b={b} labour={labour} />
          </TooltipContent>
        </Tooltip>
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` → no errors, then `npm run build` → succeeds.

- [ ] **Step 4: Manual visual smoke** — start `npm run dev`, open a developed system's Industry tab, and confirm: system badge shows a glyph; Labour card shows three pools (find a no-academy frontier system → red 0% technician/engineer rows with a cause line); rows show glyph + staffing bar + staff% + used/built + out/cyc; hovering a production row opens the tooltip with per-grade filled/needed, the wall grade flagged `◄`, and the academy fix in the footer. *(Report back before the review pass — per the smoke-before-review preference.)*

- [ ] **Step 5: Commit**

```bash
git add components/system/industry-panel.tsx
git commit -m "feat(economy): add per-building tooltip with per-grade staffing + description"
```

---

# Phase 3 — Compact / Detailed density toggle

### Task 10: `useIndustryDensity` hook + the segmented toggle

**Files:**
- Create: `lib/hooks/use-industry-density.ts`
- Modify: `components/system/industry-panel.tsx`

**Interfaces:**
- Produces: `useIndustryDensity(): { density: "compact" | "detailed"; setDensity: (d) => void }` — localStorage-backed (`"industry-density"`), SSR-safe (defaults `"compact"`, hydrates after mount).

- [ ] **Step 1: Implement the hook** — `lib/hooks/use-industry-density.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

export type IndustryDensity = "compact" | "detailed";

const KEY = "industry-density";

function isDensity(v: string | null): v is IndustryDensity {
  return v === "compact" || v === "detailed";
}

/**
 * Persisted Compact/Detailed density for the Industry panel. SSR-safe: renders
 * "compact" on the server + first client paint (so hydration matches), then reads
 * localStorage after mount. Value is validated at the storage boundary.
 */
export function useIndustryDensity(): { density: IndustryDensity; setDensity: (d: IndustryDensity) => void } {
  const [density, setDensityState] = useState<IndustryDensity>("compact");

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    if (isDensity(stored)) setDensityState(stored);
  }, []);

  const setDensity = useCallback((d: IndustryDensity) => {
    setDensityState(d);
    window.localStorage.setItem(KEY, d);
  }, []);

  return { density, setDensity };
}
```

- [ ] **Step 2: Wire the toggle into the panel.** Add imports:

```tsx
import { SegmentedControl } from "@/components/form/segmented-control";
import { useIndustryDensity, type IndustryDensity } from "@/lib/hooks/use-industry-density";
```

In `IndustryPanel`, call the hook near the top:

```tsx
  const { density, setDensity } = useIndustryDensity();
```

Add the control to the health-strip `Card`, in the right-hand `flex` cluster before `<LegendTooltip />`:

```tsx
            <SegmentedControl<IndustryDensity>
              ariaLabel="Row density"
              name="industryDensity"
              value={density}
              onChange={setDensity}
              options={[
                { value: "compact", label: "Compact" },
                { value: "detailed", label: "Detailed" },
              ]}
            />
```

- [ ] **Step 3: Thread `density` into every `ProductionRow`.** Pass `density={density}` on all four call sites (extractors, housing, academies, factories). (`ProductionRow` already renders per-grade micro-bars when `density === "detailed"` — Task 8 Step 4.)

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → no errors; `npm run build` → succeeds.

- [ ] **Step 5: Manual visual smoke** — toggle Compact↔Detailed: Compact shows one health bar per row; Detailed replaces it with 1–3 grade micro-bars (blue/cyan/purple with U/T/E tags), tier-0 → 1 line, tier-1 → 2, tier-2 → 3; the trailing cluster stays aligned; the choice survives a page reload.

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/use-industry-density.ts components/system/industry-panel.tsx
git commit -m "feat(economy): add Compact/Detailed density toggle to the industry panel"
```

---

# Phase 4 — Docs + final verification

### Task 11: Fold the behaviour into the active specs; delete the build-plan docs; full green

**Files:**
- Modify: `docs/active/gameplay/economy-specialisation.md` (add an "Industry panel legibility" paragraph — the Labour card, health glyph, academy-named idle reasons, per-grade tooltip, Compact/Detailed toggle).
- Modify: `docs/SPEC.md` (extend the Economy section's Industry-panel sentence, line ~32, to mention the Labour card + skill-legibility surfacing).
- Delete: `docs/build-plans/economy-ui-legibility.md` and `docs/build-plans/economy-ui-legibility-plan.md` (this plan) — the code is now the source of truth.
- Modify: `docs/BACKLOG.md` — remove the "Economy UI legibility — quick wins" item.

- [ ] **Step 1: Update `docs/active/gameplay/economy-specialisation.md`** — after the S1 description, add:

```markdown
### Industry panel legibility (S1 surfacing)

The Industry panel surfaces S1's skilled-labour model without changing any mechanic:
a **Labour card** shows the three system-wide pools (Workforce / Technicians / Engineers)
as supply-vs-demand rows — surviving the no-academy case, where a licensed-cap-zero pool
reads red 0% with the exact academy it needs. Each building carries a health **trend glyph**
(`▲ ▬ ▼`, colourblind-safe), a pure-staffing bar with `staff% · used/built · output/cyc`,
and a hover tooltip with per-grade filled/needed staffing (the binding grade flagged), a
"what it does" description, and the academy fix. A **Compact/Detailed** toggle swaps the single
health bar for per-grade micro-bars (unskilled blue / technician cyan / engineer purple). An
idle factory names the specific academy it needs (vocational school vs research institute).
```

- [ ] **Step 2: Update `docs/SPEC.md`** — extend the Industry-panel sentence in the Economy section to read (append after "health-coloured (stable / idle / collapsing)"):

```markdown
 …and surfaces the skill-tiered labour model — a system Labour card (workforce + the two academy-licensed skill ceilings), per-building health glyphs, academy-named idle reasons, and per-grade staffing tooltips.
```

- [ ] **Step 3: Remove the BACKLOG item** — delete the "Economy UI legibility — quick wins" line from `docs/BACKLOG.md`.

- [ ] **Step 4: Delete the transient build-plan docs**

```bash
git rm docs/build-plans/economy-ui-legibility.md docs/build-plans/economy-ui-legibility-plan.md
```

- [ ] **Step 5: Full verification — all must be green**

```bash
npx tsc --noEmit
npx vitest run
npm run build
npm run simulate
```

Expected: `tsc` clean; full Vitest suite passes (economy behaviour unchanged — display-only); `next build` succeeds (watch for the Tailwind `docs/` scan gotcha — `docs/` is excluded via `@source not`, and both plan docs are deleted anyway); `npm run simulate` equilibrium unchanged vs pre-branch (no tick behaviour touched).

- [ ] **Step 6: Commit**

```bash
git add docs/active/gameplay/economy-specialisation.md docs/SPEC.md docs/BACKLOG.md
git commit -m "docs(economy): fold industry-panel legibility into active specs; drop build-plan"
```

---

## Self-review (against the design doc)

- **Scope §1 — three colour languages:** land=copper (kept), grade=blue/cyan/purple with U/T/E tags (`GRADE` map, Tasks 7/8/9), health=green/amber/red via glyph (`HEALTH_GLYPH`, Task 6). ✓
- **§2 — health glyph:** `HealthGlyph` replaces the dot + prefixes the badge (Tasks 6, 8). ✓
- **§3 — Labour card:** three always-visible pools, no-academy zero case with cause line (Task 7). ✓
- **§4 — production rows:** aligned label column + trailing `staff% · used/built · out/cyc` + `RowHeader`; staffedFraction bar; extractor ×yield kept; cause/needs kept; Compact default + Detailed micro-bars (Tasks 8, 10). ✓
- **§5 — tooltip:** header + description + per-grade filled/needed (wall flagged) + footer with academy fix; academies/housing lighter (Task 9). ✓
- **§6 — descriptions + tier labels:** `BUILDING_DESCRIPTIONS` + `TIER_LABELS` + `describeBuilding` fallback (Task 5). ✓
- **Data plumbing 1-3:** labour block (Task 1), idle-reason split (Task 2), per-building `staffedFraction`/`output` (Task 3), client-side per-grade (Task 4). ✓
- **Plumbing 4-5:** service + api.ts flow through automatically (no edit) — confirmed by reading `lib/services/universe.ts:395` (`...buildIndustryReadout`) and `lib/types/api.ts:247` (`& SystemIndustryReadout`). ✓
- **Testing:** engine + helper + constants fully Vitest-tested; component logic pushed into those pure helpers; render verified via `tsc`/`build`/manual smoke (repo has no jsdom/RTL — deliberate, per CLAUDE.md). This is the one deliberate deviation from the design's "component render" bullet; flagged here.
- **Deviations from the design doc, with rationale:**
  1. `output/cyc` excludes selling `uptake` (design §4 parenthetical said "× selling/uptake"). The economy tick applies production = `buildingProduction × inputGate` and treats uptake as a separate decay/selling signal (`lib/tick/processors/economy.ts:147-158`); folding uptake would understate real throughput. Selling is surfaced via the glyph + "output not selling" cause instead. ✓
  2. `BUILDING_DESCRIPTIONS` covers only the 3 non-good buildings; production buildings reuse `GOODS[id].description` via `describeBuilding` (DRY — avoids duplicating 26 strings). ✓
  3. No new `built` field on `buildings[]` — `count` already is the built total; the panel derives `used/built` from `staffedFraction × count`. ✓
```
