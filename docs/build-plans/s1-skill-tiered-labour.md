# S1 — Skill-Tiered Labour Factor Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tier-1+ manufacturing its own specialisation pressure by making labour a per-good skill-tiered vector gated by built academies, plus per-good space, so the autonomic planner can no longer build a self-supplying full basket everywhere.

**Architecture:** Two PRs into the shared `feat/economy-specialisation` branch. **PR1** (Tasks 1–2) is a contained data refactor: `labourPerUnit: number` becomes a `labour: LabourVector` whose three skill shares *partition* the head count, and `spaceCost` becomes per-good — no skill gates bite yet (the scalar `fulfillment` signature is untouched). **PR2** (Tasks 3–7) introduces the two academy building types, the system-wide skill-ceiling gates (`LabourState`), the planner's academy co-build, the seeder's academy placement, and the decay rule for academies — this is where the gates start biting. A single coarse-health calibration (Task 8) runs after PR2.

**Tech Stack:** TypeScript 5 (strict), pure engine functions (zero DB), Vitest 4. No DB migration — `SystemBuilding.buildingType` is a free string keyed `@@unique([systemId, buildingType])`, so academies are new `buildingType` values.

## Global Constraints

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. No `unknown`. No postfix `!` (except `find(...)!` in tests).
- **Engine purity:** `lib/engine/*` and `lib/constants/*` have zero DB imports. Test with Vitest.
- **Discriminated unions** for result types; typed union keys, never `Record<string, unknown>`.
- **Magnitudes are coarse first-cut.** Every number in this plan is a placeholder for the single post-track calibration pass (Task 8). Only relative shape is committed. Do not hand-tune mid-plan; correctness = "compiles, tests pass, sim is non-NaN and does not collapse" per the coarse-health-calibration principle.
- **Partition invariant:** a good's three labour shares SUM to its total head count. Labour is composition, not extra heads. Population stays a single scalar.
- **Commits:** Conventional Commits, `feat(economy): …` / `refactor(economy): …` / `test(economy): …`. End each commit body with the project trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit on `feat/economy-specialisation` (already the current branch).
- **Run tests with:** `npx vitest run <path>` (the `unit` project sets no `DATABASE_URL`; never statically import `@/lib/prisma` into a unit-tested graph).

## Spec

`docs/planned/economy-specialisation.md` — section "Skill-tiered labour (the merged factor model)". This plan implements S1 only (Tasks per that section + the per-stage decisions: academy decay toward skill demand; per-good space scoped to general-space goods).

---

## File Structure

**PR1 (data refactor — gates do not bite):**
- Modify `lib/constants/industry.ts` — `LabourVector` type; `LABOUR_BY_TIER` + `LABOUR_OVERRIDES`; `labourTotal()`; `SPACE_OVERRIDES`; `BuildingTypeDef.labour` replaces `labourPerUnit`; per-good `spaceCost`.
- Modify `lib/engine/industry.ts` — `labourDemand()` sums `labourTotal`.
- Modify `lib/engine/directed-build.ts:396-398` — spare-labour gate reads `labourTotal`, not `labourPerUnit`.
- Modify tests: `lib/constants/__tests__/industry.test.ts`, `lib/engine/__tests__/industry.test.ts`.

**PR2 (skill gates + academies):**
- Modify `lib/constants/industry.ts` — `vocational_school` + `research_institute` building types; `SKILL1_PER_SCHOOL` / `SKILL2_PER_INSTITUTE`; `ACADEMY_TYPES`; `skill1Licensed`/`skill2Licensed` fields; `INPUT_DEMAND_MULTIPLIER`.
- Modify `lib/engine/industry.ts` — `LabourState` type; `computeLabourState()`; `skill1Demand`/`skill2Demand`/`skill1Cap`/`skill2Cap`; `effectiveFulfilment()`; `buildingProduction()` and `inputDemandForGood()` take `LabourState`; thread through `capacityGoodRates`, `buildIndustryReadout`; `INPUT_DEMAND_MULTIPLIER` in input-demand.
- Modify call sites (signature ripple): `lib/constants/market-economy.ts`, `lib/tick/adapters/prisma/economy.ts`, `lib/tick/adapters/memory/economy.ts`, `lib/tick/processors/good-market-state.ts`, `scripts/economy-audit.ts`, and their tests.
- Modify `lib/engine/directed-build.ts` — spare-**unskilled** gate; academy co-build when a skill ceiling binds.
- Modify `lib/engine/industry-seed.ts` — step 2.5 seed academies; step 3b scales academies with production.
- Modify `lib/engine/infrastructure-decay.ts` — academy `used` = skill-demand coverage; production `used` uses skill-gated fulfilment.
- Update `prisma/schema.prisma:290` comment (no migration) to mention academies.

---

# PR1 — Labour vector + per-good space

### Task 1: Labour becomes a per-good skill-partition vector

**Files:**
- Modify: `lib/constants/industry.ts`
- Modify: `lib/engine/industry.ts` (`labourDemand`, header comment)
- Modify: `lib/engine/directed-build.ts:396-398`
- Test: `lib/engine/__tests__/industry.test.ts`, `lib/constants/__tests__/industry.test.ts`

**Interfaces:**
- Produces: `interface LabourVector { unskilled: number; skill1: number; skill2: number }`; `labourTotal(v: LabourVector): number`; `BuildingTypeDef.labour?: LabourVector` (replaces `labourPerUnit?: number`); `BUILDING_TYPES[good].labour` populated for every production type.
- Consumes (PR2): `labourTotal` and `BuildingTypeDef.labour`.

- [ ] **Step 1: Write the failing test** — append to `lib/engine/__tests__/industry.test.ts`:

```ts
import { BUILDING_TYPES, PRODUCTION_BUILDING_TYPES, labourTotal } from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";

describe("labour vector", () => {
  it("every production type carries a 3-grade labour vector whose shares partition a positive total", () => {
    for (const good of PRODUCTION_BUILDING_TYPES) {
      const v = BUILDING_TYPES[good]?.labour;
      expect(v, good).toBeDefined();
      if (!v) continue;
      expect(v.unskilled, good).toBeGreaterThanOrEqual(0);
      expect(v.skill1, good).toBeGreaterThanOrEqual(0);
      expect(v.skill2, good).toBeGreaterThanOrEqual(0);
      expect(labourTotal(v), good).toBeGreaterThan(0);
      expect(labourTotal(v), good).toBeCloseTo(v.unskilled + v.skill1 + v.skill2, 9);
    }
  });

  it("tier-0 extractors are unskilled-only; tier-2 draws all three grades", () => {
    for (const good of PRODUCTION_BUILDING_TYPES) {
      const v = BUILDING_TYPES[good]!.labour!;
      if (GOOD_TIER_BY_KEY[good] === 0) {
        expect(v.skill1, good).toBe(0);
        expect(v.skill2, good).toBe(0);
      }
      if (GOOD_TIER_BY_KEY[good] === 2) {
        expect(v.skill1, good).toBeGreaterThan(0);
        expect(v.skill2, good).toBeGreaterThan(0);
      }
    }
  });

  it("labourDemand sums labourTotal across production types; housing demands none", () => {
    // ore tier-0 total 10, metals tier-1 total 25 → 5*10 + 2*25 = 100; housing adds 0.
    const demand = labourDemand({ ore: 5, metals: 2, housing: 3 });
    expect(demand).toBeCloseTo(5 * labourTotal(BUILDING_TYPES.ore!.labour!) + 2 * labourTotal(BUILDING_TYPES.metals!.labour!), 6);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts -t "labour vector"`
Expected: FAIL — `labourTotal` is not exported / `def.labour` undefined.

- [ ] **Step 3: Edit `lib/constants/industry.ts`** — add the type + tables + helper, and replace `labourPerUnit` in `BuildingTypeDef` and the builder.

Add near the top (after imports), and import `GOOD_TIER_BY_KEY`:

```ts
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import type { GoodTier } from "@/lib/types/game";

/** Per-good labour requirement, partitioned across skill grades. The three shares SUM to the head count. */
export interface LabourVector {
  /** Tier-0-grade workers — no academy gate. */
  unskilled: number;
  /** Technician-grade work, licensed by vocational schools. */
  skill1: number;
  /** Engineer-grade work, licensed by research institutes. */
  skill2: number;
}

/** Total head count one building of this good demands (the partition's sum). */
export function labourTotal(v: LabourVector): number {
  return v.unskilled + v.skill1 + v.skill2;
}

// ── Labour vectors (coarse first-cut; Task 8 calibrates) ──
// Per-tier default partition; advanced manufacturing is both labour- and skill-heavier.
const LABOUR_BY_TIER: Record<GoodTier, LabourVector> = {
  0: { unskilled: 10, skill1: 0, skill2: 0 },
  1: { unskilled: 18, skill1: 7, skill2: 0 },
  2: { unskilled: 30, skill1: 20, skill2: 10 },
};
// Per-good overrides where the partition reads differently (only a few; rest = tier default).
const LABOUR_OVERRIDES: Record<string, LabourVector> = {
  // Most-integrated tier-2 — engineer- and labour-heavy.
  ship_frames: { unskilled: 35, skill1: 25, skill2: 20 },
  reactor_cores: { unskilled: 30, skill1: 22, skill2: 18 },
  weapons_systems: { unskilled: 30, skill1: 22, skill2: 16 },
  // Labour-heavy, low-skill tier-1.
  consumer_goods: { unskilled: 28, skill1: 8, skill2: 0 },
};

function labourFor(goodId: string): LabourVector {
  return LABOUR_OVERRIDES[goodId] ?? LABOUR_BY_TIER[GOOD_TIER_BY_KEY[goodId] ?? 0];
}
```

In `BuildingTypeDef`, replace the `labourPerUnit?: number` field:

```ts
  /** Skill-partitioned population to fully staff one building. Production types + academies. */
  labour?: LabourVector;
```

Update the doc comment on `DEFAULT_LABOUR_PER_UNIT` block — delete `DEFAULT_LABOUR_PER_UNIT` (no longer used) and keep `POP_CENTRE_DENSITY`. In `buildProductionTypes()`, replace `labourPerUnit: DEFAULT_LABOUR_PER_UNIT` with `labour: labourFor(goodId)`.

> Note: `POP_CENTRE_DENSITY`'s comment references `labourPerUnit` — change "Below labourPerUnit by design" to "Below a building's labour total by design".

- [ ] **Step 4: Edit `lib/engine/industry.ts`** — `labourDemand` sums totals. Replace the body:

```ts
import { BUILDING_TYPES, labourTotal /* …existing… */ } from "@/lib/constants/industry";

/** Σ count × labourTotal across types that demand labour (production + academies). Housing demands none. */
export function labourDemand(buildings: Record<string, number>): number {
  let demand = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const labour = BUILDING_TYPES[type]?.labour;
    if (labour) demand += count * labourTotal(labour);
  }
  return demand;
}
```

Update the file header comment line `labourFulfillment = min(1, population / Σ count_t × labourPerUnit_t)` → `… / Σ count_t × labourTotal_t`.

- [ ] **Step 5: Edit `lib/engine/directed-build.ts:396-398`** — spare-labour gate reads the total:

```ts
    const labourPerUnit = labourTotal(BUILDING_TYPES[opp.goodId]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 });
    const spareLabour = Math.max(0, site.population - labourDemand(site.buildings));
    const labourCapUnits = labourPerUnit > 0 ? spareLabour / labourPerUnit : Infinity;
```

Add `labourTotal` to the existing `@/lib/constants/industry` import.

- [ ] **Step 6: Fix the existing constants test** — `lib/constants/__tests__/industry.test.ts:35-39` asserts `def.labourPerUnit`. Change to:

```ts
  it("gives every production type a positive spaceCost, labour total, outputPerUnit", () => {
    for (const type of PRODUCTION_BUILDING_TYPES) {
      const def = BUILDING_TYPES[type];
      expect(def.spaceCost, type).toBeGreaterThan(0);
      expect(labourTotal(def.labour ?? { unskilled: 0, skill1: 0, skill2: 0 }), type).toBeGreaterThan(0);
      expect(def.outputPerUnit ?? 0, type).toBeGreaterThan(0);
    }
  });
```

Import `labourTotal` there.

- [ ] **Step 7: Update the stale unit tests that pass raw `labourPerUnit` math** — `lib/engine/__tests__/industry.test.ts` has an assertion (`sums count × labourPerUnit…`, ~line 36) that hard-codes 25. Replace that block with the new `labourDemand` test from Step 1 (delete the old `labourDemand` `it(...)` so there is exactly one). `lib/tick/processors/__tests__/economy.test.ts:371` is a comment (`2 buildings × 25 labourPerUnit`) — update the comment to reflect the good's new total if that test's population assumption changed; if the test still passes, leave the assertion and just fix the comment.

- [ ] **Step 8: Run the full unit project to catch every compile break**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts lib/constants/__tests__/industry.test.ts lib/engine/__tests__/directed-build.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — Expected: no errors (confirms no other `labourPerUnit` reader remains).

- [ ] **Step 9: Commit**

```bash
git add lib/constants/industry.ts lib/engine/industry.ts lib/engine/directed-build.ts lib/engine/__tests__/industry.test.ts lib/constants/__tests__/industry.test.ts
git commit
```
Message: `refactor(economy): labour becomes a per-good skill-partition vector`

---

### Task 2: Per-good space cost (general-space goods)

**Files:**
- Modify: `lib/constants/industry.ts`
- Test: `lib/constants/__tests__/industry.test.ts`

**Interfaces:**
- Produces: per-good `spaceCost` values on `BUILDING_TYPES` (read by the existing `effectiveSpaceCost`). No signature change.

- [ ] **Step 1: Write the failing test** — append to `lib/constants/__tests__/industry.test.ts`:

```ts
import { effectiveSpaceCost } from "@/lib/constants/industry";

describe("per-good space", () => {
  it("the most-integrated tier-2 goods occupy more general space than a default factory", () => {
    expect(effectiveSpaceCost("ship_frames")).toBeGreaterThan(effectiveSpaceCost("fuel"));
    expect(effectiveSpaceCost("reactor_cores")).toBeGreaterThan(effectiveSpaceCost("metals"));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts -t "per-good space"`
Expected: FAIL — all costs equal `DEFAULT_SPACE_COST`.

- [ ] **Step 3: Edit `lib/constants/industry.ts`** — add overrides and apply in the builder:

```ts
// ── Per-good general-space footprint (coarse first-cut; Task 8 calibrates) ──
// Differentiates tier-1/2 factory footprints; default 1.0. Tier-0 extractor footprint stays
// on the deposit-slot model (DEPOSIT_SLOT_FOOTPRINT), not spaceCost — see the S1 spec scope note.
const SPACE_OVERRIDES: Record<string, number> = {
  ship_frames: 4.0,
  reactor_cores: 3.0,
  machinery: 2.5,
  weapons_systems: 2.5,
};
```

In `buildProductionTypes()`, replace `spaceCost: DEFAULT_SPACE_COST` with `spaceCost: SPACE_OVERRIDES[goodId] ?? DEFAULT_SPACE_COST`.

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts -t "per-good space"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/industry.ts lib/constants/__tests__/industry.test.ts
git commit
```
Message: `feat(economy): per-good general-space footprint for integrated tier-2`

**PR1 boundary:** open the PR `feat/economy-specialisation` ← PR1 commits, or hold both commits and continue to PR2 on the same branch. Run `npm run simulate` once here to confirm coarse health (non-NaN, no collapse) before moving on.

---

# PR2 — Skill gates + academies

### Task 3: Academy building types + skill constants

**Files:**
- Modify: `lib/constants/industry.ts`
- Modify: `prisma/schema.prisma:290` (comment only)
- Test: `lib/constants/__tests__/industry.test.ts`

**Interfaces:**
- Produces: `VOCATIONAL_SCHOOL_TYPE = "vocational_school"`, `RESEARCH_INSTITUTE_TYPE = "research_institute"`, `ACADEMY_TYPES: string[]`; constants `SKILL1_PER_SCHOOL`, `SKILL2_PER_INSTITUTE`, `INPUT_DEMAND_MULTIPLIER`; `BuildingTypeDef.skill1Licensed?`/`skill2Licensed?`; `BUILDING_TYPES` entries for both academies (no `outputGood`, unskilled-only `labour`, a `spaceCost`, the licensed amount).

- [ ] **Step 1: Write the failing test** — append to `lib/constants/__tests__/industry.test.ts`:

```ts
import {
  BUILDING_TYPES, ACADEMY_TYPES, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE,
  SKILL1_PER_SCHOOL, SKILL2_PER_INSTITUTE, labourTotal,
} from "@/lib/constants/industry";

describe("academies", () => {
  it("are non-producing, unskilled-staffed, space-eating, skill-licensing buildings", () => {
    for (const type of ACADEMY_TYPES) {
      const def = BUILDING_TYPES[type];
      expect(def, type).toBeDefined();
      expect(def.outputGood, type).toBeUndefined();          // produce no good
      expect(def.spaceCost, type).toBeGreaterThan(0);         // eat general space
      const v = def.labour!;
      expect(labourTotal(v), type).toBeGreaterThan(0);        // need staffing
      expect(v.skill1, type).toBe(0);                         // staffed by unskilled only…
      expect(v.skill2, type).toBe(0);                         // …no academy to staff an academy
    }
  });
  it("each academy licenses exactly its own grade", () => {
    expect(BUILDING_TYPES[VOCATIONAL_SCHOOL_TYPE].skill1Licensed).toBe(SKILL1_PER_SCHOOL);
    expect(BUILDING_TYPES[VOCATIONAL_SCHOOL_TYPE].skill2Licensed ?? 0).toBe(0);
    expect(BUILDING_TYPES[RESEARCH_INSTITUTE_TYPE].skill2Licensed).toBe(SKILL2_PER_INSTITUTE);
    expect(BUILDING_TYPES[RESEARCH_INSTITUTE_TYPE].skill1Licensed ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts -t "academies"`
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Edit `lib/constants/industry.ts`** — add constants, fields, and the two building entries:

```ts
export const VOCATIONAL_SCHOOL_TYPE = "vocational_school";
export const RESEARCH_INSTITUTE_TYPE = "research_institute";
/** The two academy building type ids, in grade order. */
export const ACADEMY_TYPES: string[] = [VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE];

// ── Academy licensing (coarse first-cut; Task 8 calibrates) ──
// One academy licenses this much skilled-grade work system-wide; large enough that one
// academy serves several factories, so academies are lumpy/concentrated, not per-factory.
export const SKILL1_PER_SCHOOL = 150;
export const SKILL2_PER_INSTITUTE = 90;

/** Magnitude knob on recipe input-demand draws (S1 wires it; value stays neutral until Task 8 calibration). */
export const INPUT_DEMAND_MULTIPLIER = 1.0;
```

Add to `BuildingTypeDef`:

```ts
  /** skill-1 work this building licenses system-wide. Vocational school only. */
  skill1Licensed?: number;
  /** skill-2 work this building licenses system-wide. Research institute only. */
  skill2Licensed?: number;
```

Add to `BUILDING_TYPES` (alongside `[HOUSING_TYPE]`):

```ts
  [VOCATIONAL_SCHOOL_TYPE]: {
    spaceCost: 1.5,
    labour: { unskilled: 15, skill1: 0, skill2: 0 },
    skill1Licensed: SKILL1_PER_SCHOOL,
  },
  [RESEARCH_INSTITUTE_TYPE]: {
    spaceCost: 2.0,
    labour: { unskilled: 20, skill1: 0, skill2: 0 },
    skill2Licensed: SKILL2_PER_INSTITUTE,
  },
```

- [ ] **Step 4: Update `prisma/schema.prisma:290` comment** (no schema change):

```prisma
  buildingType String // production type id (== output good id) | "housing" | "vocational_school" | "research_institute"
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts -t "academies"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/constants/industry.ts lib/constants/__tests__/industry.test.ts prisma/schema.prisma
git commit
```
Message: `feat(economy): add vocational-school + research-institute academy building types`

---

### Task 4: Skill-ceiling gates in the production engine

**Files:**
- Modify: `lib/engine/industry.ts`
- Modify (signature ripple): `lib/constants/market-economy.ts`, `lib/tick/adapters/prisma/economy.ts`, `lib/tick/adapters/memory/economy.ts`, `lib/tick/processors/good-market-state.ts`, `scripts/economy-audit.ts`
- Test: `lib/engine/__tests__/industry.test.ts`, `lib/constants/__tests__/market-economy.test.ts`, `lib/tick/adapters/memory/__tests__/economy.test.ts`

**Interfaces:**
- Produces:
  - `interface LabourState { labourFulfil: number; skill1Fulfil: number; skill2Fulfil: number }`
  - `computeLabourState(buildings: Record<string, number>, population: number): LabourState`
  - `skill1Demand(buildings)`, `skill2Demand(buildings)`, `skill1Cap(buildings)`, `skill2Cap(buildings)` → `number`
  - `effectiveFulfilment(state: LabourState, tier: number): number` — `tier 0 → labourFulfil`; `tier 1 → min(labourFulfil, skill1Fulfil)`; `tier ≥ 2 → min(labourFulfil, skill1Fulfil, skill2Fulfil)`
  - **Changed signatures:** `buildingProduction(buildings, goodId, state: LabourState, yields)`; `inputDemandForGood(buildings, goodId, state: LabourState, yields)`
- Consumes: `BUILDING_TYPES[*].labour/.skill1Licensed/.skill2Licensed`, `labourTotal`, `GOOD_TIER_BY_KEY`, `INPUT_DEMAND_MULTIPLIER` (Task 3); `labourDemand`/`labourFulfillment` (existing).

- [ ] **Step 1: Write the failing tests** — append to `lib/engine/__tests__/industry.test.ts`:

```ts
import {
  computeLabourState, effectiveFulfilment, skill1Demand, skill2Demand, skill1Cap, skill2Cap,
} from "@/lib/engine/industry";
import { SKILL1_PER_SCHOOL, SKILL2_PER_INSTITUTE } from "@/lib/constants/industry";
import { unitResourceVector } from "@/lib/engine/resources";

describe("skill gates", () => {
  const huge = 10_000_000; // population large enough that labourFulfil = 1

  it("a frontier world with no academies cannot run any tier-1+ production", () => {
    const buildings = { metals: 2, electronics: 2, ore: 2, components: 2 };
    const state = computeLabourState(buildings, huge);
    expect(state.skill1Fulfil).toBe(0);
    expect(state.skill2Fulfil).toBe(0);
    expect(buildingProduction(buildings, "metals", state, unitResourceVector())).toBe(0);      // tier-1 gated by skill1
    expect(buildingProduction(buildings, "electronics", state, unitResourceVector())).toBe(0); // tier-2 gated by skill1+2
    expect(buildingProduction(buildings, "ore", state, unitResourceVector())).toBeGreaterThan(0); // tier-0 ungated
  });

  it("schools without an institute run tier-1 but still block tier-2", () => {
    // enough schools to license the skill1 demand, zero institutes.
    const buildings = { metals: 1, electronics: 1, components: 1, vocational_school: 5 };
    const state = computeLabourState(buildings, huge);
    expect(state.skill1Fulfil).toBe(1);
    expect(state.skill2Fulfil).toBe(0);
    expect(buildingProduction(buildings, "metals", state, unitResourceVector())).toBeGreaterThan(0);
    expect(buildingProduction(buildings, "electronics", state, unitResourceVector())).toBe(0);
  });

  it("skill demand sums shares across all goods; cap sums academy licensing", () => {
    const buildings = { metals: 2, electronics: 3, vocational_school: 2, research_institute: 1 };
    // metals skill1 7×2=14; electronics tier-2 default skill1 20×3=60 → 74
    expect(skill1Demand(buildings)).toBeCloseTo(2 * 7 + 3 * 20, 6);
    expect(skill2Demand(buildings)).toBeCloseTo(3 * 10, 6);
    expect(skill1Cap(buildings)).toBeCloseTo(2 * SKILL1_PER_SCHOOL, 6);
    expect(skill2Cap(buildings)).toBeCloseTo(1 * SKILL2_PER_INSTITUTE, 6);
  });

  it("effectiveFulfilment applies the tier-appropriate pools", () => {
    const s = { labourFulfil: 0.9, skill1Fulfil: 0.5, skill2Fulfil: 0.2 };
    expect(effectiveFulfilment(s, 0)).toBe(0.9);
    expect(effectiveFulfilment(s, 1)).toBe(0.5);
    expect(effectiveFulfilment(s, 2)).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts -t "skill gates"`
Expected: FAIL — `computeLabourState` etc. not exported; `buildingProduction` still takes a number.

- [ ] **Step 3: Edit `lib/engine/industry.ts`** — add the skill functions and re-gate production:

```ts
import { BUILDING_TYPES, labourTotal, INPUT_DEMAND_MULTIPLIER, /* …existing… */ } from "@/lib/constants/industry";

/** System-wide labour fulfilment, split into the headcount gate and the two skill-ceiling gates. */
export interface LabourState {
  /** min(1, population / Σ labour totals) — the headcount gate (unchanged). */
  labourFulfil: number;
  /** min(1, skill1Cap / skill1Demand) — technician licensing. 1 when nothing demands skill-1. */
  skill1Fulfil: number;
  /** min(1, skill2Cap / skill2Demand) — engineer licensing. 1 when nothing demands skill-2. */
  skill2Fulfil: number;
}

/** Σ count × labour.skill1 across all buildings. */
export function skill1Demand(buildings: Record<string, number>): number {
  let d = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const v = BUILDING_TYPES[type]?.labour;
    if (v) d += count * v.skill1;
  }
  return d;
}
/** Σ count × labour.skill2 across all buildings. */
export function skill2Demand(buildings: Record<string, number>): number {
  let d = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const v = BUILDING_TYPES[type]?.labour;
    if (v) d += count * v.skill2;
  }
  return d;
}
/** Σ vocational_school × SKILL1_PER_SCHOOL (read from skill1Licensed). */
export function skill1Cap(buildings: Record<string, number>): number {
  let c = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    c += count * (BUILDING_TYPES[type]?.skill1Licensed ?? 0);
  }
  return c;
}
/** Σ research_institute × SKILL2_PER_INSTITUTE (read from skill2Licensed). */
export function skill2Cap(buildings: Record<string, number>): number {
  let c = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    c += count * (BUILDING_TYPES[type]?.skill2Licensed ?? 0);
  }
  return c;
}

/** One ratio in [0,1]: cap/demand, or 1 when nothing is demanded. */
function poolFulfil(cap: number, demand: number): number {
  if (demand <= 0) return 1;
  return Math.min(1, Math.max(0, cap) / demand);
}

/** Compute the three-part labour state for one system once; reuse across its goods. */
export function computeLabourState(buildings: Record<string, number>, population: number): LabourState {
  return {
    labourFulfil: labourFulfillment(population, labourDemand(buildings)),
    skill1Fulfil: poolFulfil(skill1Cap(buildings), skill1Demand(buildings)),
    skill2Fulfil: poolFulfil(skill2Cap(buildings), skill2Demand(buildings)),
  };
}

/** Effective staffing ratio for a good of `tier`: each tier min()s only the pools it draws on. */
export function effectiveFulfilment(state: LabourState, tier: number): number {
  if (tier <= 0) return state.labourFulfil;
  if (tier === 1) return Math.min(state.labourFulfil, state.skill1Fulfil);
  return Math.min(state.labourFulfil, state.skill1Fulfil, state.skill2Fulfil);
}
```

Change `buildingProduction` to take the state and apply the tier gate:

```ts
export function buildingProduction(
  buildings: Record<string, number>,
  goodId: string,
  state: LabourState,
  yields: ResourceVector,
): number {
  const fulfillment = effectiveFulfilment(state, GOOD_TIER_BY_KEY[goodId] ?? 0);
  let rate = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const def = BUILDING_TYPES[type];
    if (def?.outputGood !== goodId) continue;
    rate += count * (def.outputPerUnit ?? 0) * fulfillment;
  }
  const resource = GOOD_PRODUCTION[goodId]?.resource;
  const yieldMult = (resource !== undefined && GOOD_TIER_BY_KEY[goodId] === 0) ? yields[resource] : 1;
  return rate * yieldMult;
}
```

Update `capacityGoodRates` to build the state once:

```ts
export function capacityGoodRates(buildings, population, yields): SubstrateGoodRate[] {
  const state = computeLabourState(buildings, population);
  const pop = Math.max(0, population);
  return GOOD_NAMES.map((goodId) => ({
    goodId,
    production: buildingProduction(buildings, goodId, state, yields),
    consumption: (GOOD_CONSUMPTION[goodId] ?? 0) * pop,
  }));
}
```

Change `inputDemandForGood` to take the state and apply the magnitude knob:

```ts
export function inputDemandForGood(buildings, goodId, state: LabourState, yields): number {
  let demand = 0;
  for (const consumer of GOOD_RECIPE_CONSUMERS[goodId] ?? []) {
    demand += buildingProduction(buildings, consumer.goodId, state, yields) * consumer.perOutput;
  }
  return demand * INPUT_DEMAND_MULTIPLIER;
}
```

Apply the same `INPUT_DEMAND_MULTIPLIER` factor in `inputDemandFromProduction` (so the two paths stay identical):

```ts
export function inputDemandFromProduction(goodId, productionByGood): number {
  let demand = 0;
  for (const consumer of GOOD_RECIPE_CONSUMERS[goodId] ?? []) {
    demand += (productionByGood.get(consumer.goodId) ?? 0) * consumer.perOutput;
  }
  return demand * INPUT_DEMAND_MULTIPLIER;
}
```

In `buildIndustryReadout`, replace `const fulfillment = labourFulfillment(population, demand);` with `const state = computeLabourState(buildings, population);` and pass `state` to the two `buildingProduction(...)` calls (lines ~308). Keep the returned `labourFulfillment` field as the headcount scalar: `labourFulfillment: state.labourFulfil`.

- [ ] **Step 4: Update the signature-ripple call sites.** Each currently computes `const fulfillment = labourFulfillment(pop, labourDemand(buildings))` then calls `buildingProduction(..., fulfillment, ...)` and/or `inputDemandForGood(..., fulfillment, ...)`. Replace the scalar with `const state = computeLabourState(buildings, pop)` and pass `state`:
  - `lib/tick/adapters/prisma/economy.ts:82,99` — `state` for the `buildingProduction` loop.
  - `lib/tick/adapters/memory/economy.ts:59,62` — same.
  - `lib/constants/market-economy.ts:116-117` (and `:81` `inputDemandForGood`) — `state` for both.
  - `lib/tick/processors/good-market-state.ts:29,38` — keep `capacityGoodRates` as-is; build `state` for the `inputDemandForGood` call (or read `inputDemandFromProduction` from the `rates` map — preferred, matches `trade-flow.ts`; if so, drop the standalone `inputDemandForGood` import here).
  - `scripts/economy-audit.ts:192-217` — `const state = computeLabourState(buildings, sys.population)`; pass `state` to `inputDemandForGood`. (`capacityGoodRates` call at `:194` unchanged.)

  > `lib/tick/adapters/prisma/population.ts:105`, `memory/population.ts:63`, and `processors/__tests__/population.test.ts:64` call `labourFulfillment` for the population-staffing ratio only (not production) — leave them; the headcount ratio is still correct for population.

- [ ] **Step 5: Update existing engine/adapter tests to pass a `LabourState`.** In `lib/engine/__tests__/industry.test.ts`, the existing `buildingProduction`/`inputDemandForGood` calls pass a raw number (e.g. `buildingProduction(buildings, "ore", 1, yields)`). Replace each scalar with a full-staffed state where the test intends "fully staffed", e.g. define a helper at top of file:

```ts
const FULL: LabourState = { labourFulfil: 1, skill1Fulfil: 1, skill2Fulfil: 1 };
const half: LabourState = { labourFulfil: 0.5, skill1Fulfil: 1, skill2Fulfil: 1 };
```

and rewrite calls: `buildingProduction(buildings, "ore", FULL, yields)`, the `0.5` case → `half`. For `inputDemandForGood` tests that derived `f = labourFulfillment(...)`, replace with `computeLabourState(buildings, pop)`. Mirror the same in `lib/constants/__tests__/market-economy.test.ts:47` and `lib/tick/adapters/memory/__tests__/economy.test.ts:30-31`.

  > The `inputDemandFromProduction` equality test (`industry.test.ts:139`) still holds — both sides now carry the same `INPUT_DEMAND_MULTIPLIER`. Confirm it passes.

- [ ] **Step 6: Run the affected suites + typecheck**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts lib/constants/__tests__/market-economy.test.ts lib/tick/adapters/memory/__tests__/economy.test.ts`
Then: `npx tsc --noEmit`
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/industry.ts lib/constants/market-economy.ts lib/tick/adapters scripts/economy-audit.ts lib/tick/processors/good-market-state.ts lib/engine/__tests__/industry.test.ts lib/constants/__tests__/market-economy.test.ts lib/tick/adapters/memory/__tests__/economy.test.ts
git commit
```
Message: `feat(economy): skill-ceiling gates on tier-1/2 production`

---

### Task 5: Build planner co-builds academies against skill-blocked deficits

**Files:**
- Modify: `lib/engine/directed-build.ts`
- Test: `lib/engine/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `skill1Demand`/`skill2Demand`/`skill1Cap`/`skill2Cap` (Task 4); `VOCATIONAL_SCHOOL_TYPE`/`RESEARCH_INSTITUTE_TYPE`/`SKILL1_PER_SCHOOL`/`SKILL2_PER_INSTITUTE`/`ACADEMY_TYPES`/`labourTotal` (Task 3); `BUILDING_TYPES`.
- Produces: planner emits `PlannedBuild` rows for academies alongside the production build they unblock; the spare-labour gate is spare-**unskilled**.

**Background:** In `planFactionBuilds` (Pass 2), each chosen opportunity builds `wantUnits` of a good. Today the only labour gate is `spareLabour / labourPerUnit`. With skill gates, a tier-1/2 build also needs the system's `skillCap ≥ skillDemand-after-build`. When the skill ceiling binds, the planner must build the academies to lift it (charged to the same budget/space), then build production with what remains. No academy is ever built except to unblock a reachable structural deficit (preserves the planner invariant).

- [ ] **Step 1: Write the failing test** — append to `lib/engine/__tests__/directed-build.test.ts` (follow the file's existing fixture style for `BuildSystemState`/`routeCost`; a self-route helper and a two-system deficit/surplus setup already exist there — reuse them):

```ts
import { VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE } from "@/lib/constants/industry";

describe("academy co-build", () => {
  it("builds the institute needed to run a tier-2 good that serves a reachable deficit", () => {
    // One site with population + space + tier-2 inputs available, but no academies, and a
    // reachable electronics deficit. Planner must emit vocational_school + research_institute
    // builds (electronics draws both skill1 and skill2) alongside the electronics build.
    const systems = makeElectronicsDeficitWithCapableSite(); // helper: see fixtures below
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute);
    const byType = new Map<string, number>();
    for (const b of builds) byType.set(b.buildingType, (byType.get(b.buildingType) ?? 0) + b.count);
    expect(byType.get("electronics") ?? 0).toBeGreaterThan(0);
    expect(byType.get(VOCATIONAL_SCHOOL_TYPE) ?? 0).toBeGreaterThan(0);   // electronics needs skill1 too
    expect(byType.get(RESEARCH_INSTITUTE_TYPE) ?? 0).toBeGreaterThan(0);  // and skill2
  });

  it("does not build academies when the deficit good is tier-0 (no skill draw)", () => {
    const systems = makeOreDeficitWithCapableSite();
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute);
    expect(builds.some((b) => b.buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);
    expect(builds.some((b) => b.buildingType === RESEARCH_INSTITUTE_TYPE)).toBe(false);
  });

  it("builds no academy when the existing skill ceiling already covers the build", () => {
    const systems = makeTier1DeficitWithSchoolsAlready(); // skill1Cap already ≥ post-build skill1Demand
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute);
    expect(builds.some((b) => b.buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);
  });
});
```

Define the three fixtures next to the test using the file's existing `BuildSystemState` builder. Each gives the capable site ample `population`, `generalSpace`, `unrest: 0`, locally-produced or reachable-surplus inputs, and a neighbour with a structural deficit of the target good. `selfAndNeighbourRoute` returns `0` for self and a finite cost between the two systems.

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "academy co-build"`
Expected: FAIL — no academy builds emitted.

- [ ] **Step 3: Implement the co-build in `lib/engine/directed-build.ts`.** Add a helper and call it inside the opportunity loop where `wantUnits` is computed (replacing the single-line labour gate at lines ~396-400):

```ts
import {
  BUILDING_TYPES, OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY,
  VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, SKILL1_PER_SCHOOL, SKILL2_PER_INSTITUTE, labourTotal,
} from "@/lib/constants/industry";
import {
  labourDemand, housingPopCap, skill1Demand, skill2Demand, skill1Cap, skill2Cap,
} from "@/lib/engine/industry";

/** Unskilled head count one building of `type` demands (academies + production draw unskilled to staff). */
function unskilledPerUnit(type: string): number {
  return BUILDING_TYPES[type]?.labour?.unskilled ?? 0;
}

/**
 * Plan the academies a site must add to license `prodUnits` of `goodId`, given its current buildings.
 * Returns the school/institute unit counts (fractional) needed to lift each skill ceiling to cover the
 * post-build skill demand, and the general space + budget + unskilled labour they consume. Tier-0 → none.
 */
function academyLift(
  site: BuildSystemState,
  goodId: string,
  prodUnits: number,
): { schools: number; institutes: number; space: number; units: number; unskilled: number } {
  const v = BUILDING_TYPES[goodId]?.labour;
  const tier = GOOD_TIER_BY_KEY[goodId] ?? 0;
  if (!v || tier === 0) return { schools: 0, institutes: 0, space: 0, units: 0, unskilled: 0 };

  const need1 = (skill1Demand(site.buildings) + prodUnits * v.skill1) - skill1Cap(site.buildings);
  const need2 = (skill2Demand(site.buildings) + prodUnits * v.skill2) - skill2Cap(site.buildings);
  const schools = need1 > 0 ? need1 / SKILL1_PER_SCHOOL : 0;
  const institutes = need2 > 0 ? need2 / SKILL2_PER_INSTITUTE : 0;

  const space =
    schools * effectiveSpaceCost(VOCATIONAL_SCHOOL_TYPE) +
    institutes * effectiveSpaceCost(RESEARCH_INSTITUTE_TYPE);
  const unskilled =
    schools * unskilledPerUnit(VOCATIONAL_SCHOOL_TYPE) +
    institutes * unskilledPerUnit(RESEARCH_INSTITUTE_TYPE);
  return { schools, institutes, space, units: schools + institutes, unskilled };
}
```

Then in the opportunity loop, after `servedOutput` is known, replace the labour gate + apply block. The desired production is `servedOutput / perUnit` capped by capacity and budget; academies are co-charged to budget, space, and spare unskilled:

```ts
    // Desired production before factor gates.
    let wantUnits = Math.min(capUnits, servedOutput / opp.perUnit, budget);
    if (wantUnits <= 0) continue;

    // Spare-UNSKILLED gate — production + co-built academies draw the unskilled pool.
    const spareUnskilled = Math.max(0, site.population - labourDemand(site.buildings));

    // Iterate-once to size production against the academies it needs (academy unskilled + space + budget
    // are charged to this same opportunity). Solve for the largest wantUnits whose academy lift fits.
    let lift = academyLift(site, opp.goodId, wantUnits);
    const remainingGeneral = site.generalSpace - generalSpaceUsed(site.buildings);
    const prodSpacePerUnit = effectiveSpaceCost(opp.goodId);
    const prodUnskilledPerUnit = unskilledPerUnit(opp.goodId);

    // Shrink wantUnits until production + lift fit budget, space, and spare unskilled.
    for (let guard = 0; guard < 8 && wantUnits > 0; guard++) {
      const totalBudget = wantUnits + lift.units;
      const totalSpace = wantUnits * prodSpacePerUnit + lift.space;
      const totalUnskilled = wantUnits * prodUnskilledPerUnit + lift.unskilled;
      const overBudget = totalBudget > budget ? budget / totalBudget : 1;
      const overSpace = totalSpace > remainingGeneral && totalSpace > 0 ? remainingGeneral / totalSpace : 1;
      const overUnskilled = totalUnskilled > spareUnskilled && totalUnskilled > 0 ? spareUnskilled / totalUnskilled : 1;
      const shrink = Math.min(overBudget, overSpace, overUnskilled);
      if (shrink >= 1) break;
      wantUnits *= shrink;
      lift = academyLift(site, opp.goodId, wantUnits);
    }
    if (wantUnits <= 0) continue;

    // Apply academies first (raise the ceiling on the working copy), then the production.
    for (const [type, count] of [
      [VOCATIONAL_SCHOOL_TYPE, lift.schools] as const,
      [RESEARCH_INSTITUTE_TYPE, lift.institutes] as const,
    ]) {
      if (count <= 0) continue;
      site.buildings[type] = (site.buildings[type] ?? 0) + count;
      builds.push({ systemId: site.systemId, buildingType: type, count });
      budget -= count;
    }

    site.buildings[opp.goodId] = (site.buildings[opp.goodId] ?? 0) + wantUnits;
    builds.push({ systemId: site.systemId, buildingType: opp.goodId, count: wantUnits });
    budget -= wantUnits;
```

Leave the existing "decrement served structural demand" block below unchanged. Remove the old `labourPerUnit`/`labourCapUnits`/`labourDemand`-based gate lines (replaced above).

> Self-pacing across cycles is automatic: academies are applied to the working copy, so a later opportunity at the same site sees the raised ceilings (`academyLift` returns 0 once covered). The concentration-moat scoring refinement stays deferred to Task 8 — scoring is unchanged here.

- [ ] **Step 4: Run to confirm passing + the existing planner suite still green**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: PASS (new `academy co-build` tests + all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit
```
Message: `feat(economy): autonomic planner co-builds academies for skill-gated deficits`

---

### Task 6: Seeder places academies so seeded tier-1/2 can run

**Files:**
- Modify: `lib/engine/industry-seed.ts`
- Test: `lib/engine/__tests__/industry-seed.test.ts`

**Interfaces:**
- Consumes: `skill1Demand`/`skill2Demand`, `computeLabourState`, `buildingProduction` (Task 4); academy constants (Task 3).
- Produces: `allocateIndustry` result `buildings` includes `vocational_school`/`research_institute` counts sized to the seeded skill demand; step 3b scales academies with production.

- [ ] **Step 1: Write the failing test** — append to `lib/engine/__tests__/industry-seed.test.ts`:

```ts
import { computeLabourState, buildingProduction } from "@/lib/engine/industry";
import { VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE } from "@/lib/constants/industry";

it("seeds academies so seeded tier-1/2 industry actually produces", () => {
  // A generously-sized system (use the file's existing rich-body fixture) seeds tier-1/2 factories.
  const result = allocateIndustry(richInput, makeRng(42));
  const hasTier1or2 = Object.keys(result.buildings).some((t) => GOOD_TIER_BY_KEY[t] >= 1);
  if (!hasTier1or2) return; // nothing to assert on a barren roll
  expect(result.buildings[VOCATIONAL_SCHOOL_TYPE] ?? 0).toBeGreaterThan(0);
  // a seeded tier-1 good must have non-zero production under the seeded academies + population.
  const pop = result.popCap;
  const state = computeLabourState(result.buildings, pop);
  const tier1 = Object.keys(result.buildings).find((t) => GOOD_TIER_BY_KEY[t] === 1)!;
  expect(buildingProduction(result.buildings, tier1, state, unitResourceVector())).toBeGreaterThan(0);
});
```

(Reuse the file's existing input fixture + `makeRng`; if no "rich" fixture exists, build one with ample `generalSpace`, `habitableSpace`, and multi-resource bodies so tier-1/2 seed.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/engine/__tests__/industry-seed.test.ts -t "seeds academies"`
Expected: FAIL — no academy entries, tier-1 production 0 under gates.

- [ ] **Step 3: Edit `lib/engine/industry-seed.ts`.** Add imports and insert step 2.5 between the factory pass and the population-centre pass (after the `for (let pass = 1; pass <= 2; pass++)` loop closes, before `// ── 3) Population centres`):

```ts
import { labourDemand, housingPopCap, skill1Demand, skill2Demand } from "@/lib/engine/industry";
import {
  BUILDING_TYPES, HOUSING_TYPE, PRODUCTION_BUILDING_TYPES, ACADEMY_TYPES,
  VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, SKILL1_PER_SCHOOL, SKILL2_PER_INSTITUTE,
  effectiveSpaceCost, POP_CENTRE_DENSITY,
} from "@/lib/constants/industry";
```

```ts
  // ── 2.5) Academies — license the seeded skill demand so tier-1/2 factories can run. ──
  // Sized to exactly cover the placed factories' skill draw; consume general space from the same
  // factory budget. Without these, every seeded tier-1/2 building would produce nothing (caps start at 0).
  const seededSkill1 = skill1Demand(buildings);
  const seededSkill2 = skill2Demand(buildings);
  const schoolCost = effectiveSpaceCost(VOCATIONAL_SCHOOL_TYPE);
  const instCost = effectiveSpaceCost(RESEARCH_INSTITUTE_TYPE);
  if (seededSkill1 > 0) {
    const schools = seededSkill1 / SKILL1_PER_SCHOOL;
    const affordable = Math.max(0, (factoryBudget - factoryUsed) / schoolCost);
    const count = Math.min(schools, affordable);
    if (count > 0) { buildings[VOCATIONAL_SCHOOL_TYPE] = count; factoryUsed += count * schoolCost; }
  }
  if (seededSkill2 > 0) {
    const institutes = seededSkill2 / SKILL2_PER_INSTITUTE;
    const affordable = Math.max(0, (factoryBudget - factoryUsed) / instCost);
    const count = Math.min(institutes, affordable);
    if (count > 0) { buildings[RESEARCH_INSTITUTE_TYPE] = count; factoryUsed += count * instCost; }
  }
```

In step 3b's scaling loop, also scale the academies (so caps stay matched to the scaled-down production). Change the loop to iterate production types **and** academies:

```ts
    for (const type of [...PRODUCTION_BUILDING_TYPES, ...ACADEMY_TYPES]) {
      const count = buildings[type];
      if (count === undefined || count <= 0) continue;
      const scaled = count * staffScale;
      if (scaled > 0) buildings[type] = scaled;
      else delete buildings[type];
    }
```

> `labourDemand` already counts academy unskilled (Task 1), so step 3 (`wantedPopCentres = labourDemand(buildings) / POP_CENTRE_DENSITY`) automatically houses the academy staff. No other change to steps 3/3b.

- [ ] **Step 4: Run the seeder suite + typecheck**

Run: `npx vitest run lib/engine/__tests__/industry-seed.test.ts`
Then `npx tsc --noEmit`.
Expected: PASS / no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/industry-seed.ts lib/engine/__tests__/industry-seed.test.ts
git commit
```
Message: `feat(economy): seed academies sized to seeded skill demand`

---

### Task 7: Decay rule for academies + skill-gated production wear

**Files:**
- Modify: `lib/engine/infrastructure-decay.ts`
- Test: `lib/engine/__tests__/infrastructure-decay.test.ts`

**Interfaces:**
- Consumes: `computeLabourState`, `effectiveFulfilment`, `skill1Demand`/`skill2Demand`/`skill1Cap`/`skill2Cap` (Task 4); `VOCATIONAL_SCHOOL_TYPE`/`RESEARCH_INSTITUTE_TYPE`, `GOOD_TIER_BY_KEY`.
- Produces: academy `used = count × min(1, skillDemand/skillCap)`; production `used` uses the skill-gated effective fulfilment.

- [ ] **Step 1: Write the failing tests** — append to `lib/engine/__tests__/infrastructure-decay.test.ts`:

```ts
import { VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, SKILL1_PER_SCHOOL } from "@/lib/constants/industry";

describe("academy decay", () => {
  const params = { disuseRate: 0.5, unrestRate: 0, unrestThreshold: 0.5 };
  it("sheds a vocational school that licenses more than the system demands", () => {
    // 2 schools license 2×SKILL1_PER_SCHOOL; demand from one metals fab (skill1 7) is tiny → mostly idle.
    const buildings = { metals: 1, vocational_school: 2, housing: 100 };
    const res = computeSystemDecay({ buildings, population: 100000, unrest: 0, outputUptake: () => 1 }, params);
    expect(res.newCounts[VOCATIONAL_SCHOOL_TYPE]).toBeLessThan(2);
  });
  it("does not shed a school whose licensing the system fully uses", () => {
    // skill1 demand ≈ school cap: many fabs vs one school.
    const fabs = Math.ceil(SKILL1_PER_SCHOOL / 7) + 5; // metals skill1 = 7
    const buildings: Record<string, number> = { metals: fabs, vocational_school: 1, housing: 100000 };
    const res = computeSystemDecay({ buildings, population: 100000, unrest: 0, outputUptake: () => 1 }, params);
    expect(res.newCounts[VOCATIONAL_SCHOOL_TYPE] ?? 1).toBeGreaterThanOrEqual(1 - 1e-9);
  });
  it("fully decays an academy orphaned by collapsed industry (no skill demand)", () => {
    const buildings = { research_institute: 1, housing: 10 };
    const res = computeSystemDecay({ buildings, population: 100, unrest: 0, outputUptake: () => 1 }, params);
    expect(res.newCounts[RESEARCH_INSTITUTE_TYPE]).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/engine/__tests__/infrastructure-decay.test.ts -t "academy decay"`
Expected: FAIL — academies currently decay toward `productionUsed` (outputGood undefined → uptake 1, fulfillment-based) which over-keeps them.

- [ ] **Step 3: Edit `lib/engine/infrastructure-decay.ts`.** Replace the scalar `fulfillment` with the full state and branch academies and skill-gated production:

```ts
import { computeLabourState, effectiveFulfilment, skill1Demand, skill2Demand, skill1Cap, skill2Cap } from "@/lib/engine/industry";
import { BUILDING_TYPES, HOUSING_TYPE, POP_CENTRE_DENSITY, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE } from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
```

In `computeSystemDecay`, replace the fulfillment line and the per-building `used` computation:

```ts
  const state = computeLabourState(buildings, population);
  const s1d = skill1Demand(buildings), s1c = skill1Cap(buildings);
  const s2d = skill2Demand(buildings), s2c = skill2Cap(buildings);

  const newCounts: Record<string, number> = {};
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    let used: number;
    if (type === HOUSING_TYPE) {
      used = housingUsed(population);
    } else if (type === VOCATIONAL_SCHOOL_TYPE) {
      used = count * (s1c > 0 ? Math.min(1, s1d / s1c) : 0);
    } else if (type === RESEARCH_INSTITUTE_TYPE) {
      used = count * (s2c > 0 ? Math.min(1, s2d / s2c) : 0);
    } else {
      const outputGood = BUILDING_TYPES[type]?.outputGood;
      const uptake = outputGood !== undefined ? input.outputUptake(outputGood) : 1;
      const fulfil = effectiveFulfilment(state, outputGood !== undefined ? (GOOD_TIER_BY_KEY[outputGood] ?? 0) : 0);
      used = productionUsed(count, fulfil, uptake);
    }
    const next = decayedCount(count, used, unrest, params);
    if (next < count) newCounts[type] = next;
  }
```

> Production `used` now uses `effectiveFulfilment` (skill-gated), so a skill-starved tier-2 building correctly reads as idle and decays — previously it would have looked fully staffed (`labourFulfil` only) and never shed.

- [ ] **Step 4: Run the decay suite + typecheck**

Run: `npx vitest run lib/engine/__tests__/infrastructure-decay.test.ts`
Then `npx tsc --noEmit`.
Expected: PASS / no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/infrastructure-decay.ts lib/engine/__tests__/infrastructure-decay.test.ts
git commit
```
Message: `feat(economy): academies decay toward skill demand; skill-gated production wear`

---

### Task 8: Coarse-health calibration & full verification

**Files:** none (constants already in place; tune values only if a health check fails).

This is a verification + coarse-tuning task, not TDD. The bar is **coarse health**, per the calibration principle — not precision.

- [ ] **Step 1: Full unit suite green**

Run: `npx vitest run`
Expected: all pass. Fix any remaining call-site breaks surfaced here.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: clean (build also catches the Tailwind/`docs` scan trap if a doc changed).

- [ ] **Step 3: Simulator health**

Run: `npm run simulate`
Expected: completes; no `NaN`/`Infinity`; greedy ≫ random; no runaway or universal pinning; liquidity present. If a value collapses the economy (e.g. `SKILL*_PER_*` so low nothing manufactures, or labour totals so high population can't staff anything), adjust only the coarse constants in `lib/constants/industry.ts` and re-run — do not change structure.

- [ ] **Step 4: Reseed + audit the gradient**

Run: `npx prisma db push` (if needed) then `npx prisma db seed` and `npm run audit:economy`
Expected: the audit shows the structural gradient surviving — frontier worlds (no academies) cannot self-supply tier-1/2, manufacturing concentrates where academies exist, and the matured spread does not flatten to ~1.0× as before. Record the before/after spread in the PR description. Precise tuning is deferred; only confirm the gradient direction is right.

- [ ] **Step 5: Open PR2** into `feat/economy-specialisation` with the audit before/after in the body. Note in the PR that the single full calibration of all S1 magnitudes (and the optional academy-overhead scoring moat) lands here per the spec.

---

## Self-Review

**Spec coverage** (against `economy-specialisation.md` "merged factor model"):
- Per-good labour 3-vector partitioning head count → Task 1. ✅
- Per-good space (general-space scope) → Task 2. ✅
- Academy building types (vocational school + research institute), licensing ceilings → Task 3. ✅
- Headcount gate (sum) + two skill-ceiling gates; each good min()s the pools it draws on by tier → Task 4 (`computeLabourState`/`effectiveFulfilment`). ✅
- Dev ladder emerges free (tier-2 draws skill1) → enforced by `effectiveFulfilment` tier-2 branch; covered by Task 4 "schools without institute" test. ✅
- Academy as buildable labour gate, transitively co-built, no speculative academies, self-pacing → Task 5. ✅
- Amplify input-demand magnitude knob → Task 3 (`INPUT_DEMAND_MULTIPLIER`) + Task 4 wiring (both input-demand paths). ✅
- Seed academies so seeded tier-1/2 runs → Task 6. ✅
- Academy decay toward skill demand → Task 7. ✅
- Population stays scalar; partition not additive → enforced by `labourTotal` summing shares (Task 1) and asserted in Task 1 tests. ✅
- 2-PR split, one calibration after → PR1 = Tasks 1–2, PR2 = Tasks 3–7, calibration = Task 8. ✅
- Concentration-moat scoring refinement deferred → noted in Task 5 + Task 8 (not built). ✅

**Type consistency:** `LabourVector` (constants) vs `LabourState` (engine) are distinct by design — vector = per-good requirement, state = per-system fulfilment. `buildingProduction`/`inputDemandForGood` take `LabourState` consistently across Tasks 4–7. `labourTotal` (constants) used in Tasks 1, 5. Academy type-id constants used identically in Tasks 3, 5, 6, 7.

**Placeholder scan:** all magnitudes are explicitly flagged coarse-first-cut → Task 8. No `TODO`/`TBD`; the only "tune later" is the sanctioned calibration task.

**Decomposition risk:** Task 4 is the largest (engine + signature ripple) — it is one atomic deliverable because the signature change must compile across all call sites at once; it cannot be partially merged.
