# S2 Specialisation Complexes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give matured manufacturing built comparative advantage — one capped, decaying "specialisation complex" anchor per system that grants a fixed yield multiplier to a whole family of related goods, so the galaxy specialises structurally instead of flattening.

**Architecture:** Five production families partition the 18 tier-1+ goods. A complex is a non-producing building (like an academy) that eats large general space + a little unskilled labour and buffs its family's production. The buff is derived from `buildings` and folded into `buildingProduction` (so it flows into production, input-demand, and the read services automatically). It decays toward the family throughput it buffs, is seeded at each system's dominant family, and is co-built by the autonomic planner exactly as S1 co-builds academies — charged to the same deficit-serving opportunity, self-limiting at scale. Nothing is restricted; the complex's footprint physically crowds out breadth.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Pure engine functions (zero DB). Follows the S1 academy pattern throughout.

**Spec:** `docs/planned/economy-specialisation-s2-complexes.md`. Read it before starting.

## Global Constraints

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown`** anywhere. Use precise types; typed `Record` keys from constants.
- **Engine functions are pure** — no DB imports in `lib/engine/**`. Test with Vitest.
- **Discriminated unions** for result types (`{ ok: true; … } | { ok: false; … }`), never `{ ok: boolean; … }`.
- **No postfix `!`** except `find(...)!` in tests (accepted project idiom).
- **Unit tests:** `npx vitest run` (or scope to a file). The `unit` project sets no `DATABASE_URL` — never statically import `@/lib/prisma` into a unit-tested module graph.
- **All magnitudes here are coarse first-cut** — calibrated in the single S1–S4 sim pass, not now. Do not tune them in this plan; wire the structure.
- **Comments describe the code, not the plan** — no "S2"/"Task N"/"PR" references in code comments.
- **Two PRs:** Phase 1 (Tasks 1–5, read layer) is one PR; Phase 2 (Tasks 6–8, build layer) is the second. Work on a shared feature branch `feat/economy-specialisation-s2`.

---

## File Structure

- `lib/constants/industry.ts` — add the family catalog (`SPECIALISATION_FAMILIES`), the five complex building types, derived maps (`FAMILY_BY_GOOD`, `COMPLEX_BY_TYPE`, `COMPLEX_TYPES`), and the `ANCHOR_*` knobs. Pure data.
- `lib/engine/industry.ts` — `familyAnchorBuff` (folded into `buildingProduction`), `familyThroughput`, `complexUsed`; complex branch in `buildIndustryReadout`.
- `lib/engine/infrastructure-decay.ts` — complex `used` branch in `computeSystemDecay`.
- `lib/constants/building-descriptions.ts` — bespoke "what it does" copy for the five complexes.
- `components/system/industry-panel.tsx` — render complexes as their own group (minimal reuse of `ProductionRow`).
- `lib/engine/industry-seed.ts` — seed each system's dominant-family complex.
- `lib/engine/directed-build.ts` — `complexLift`; fold the complex co-build into the opportunity loop.

---

# Phase 1 — Read layer (PR 1)

## Task 1: Family catalog + complex building types + constants

**Files:**
- Modify: `lib/constants/industry.ts`
- Test: `lib/constants/__tests__/industry.test.ts`

**Interfaces:**
- Produces: `SpecialisationFamily` interface `{ complexType: string; label: string; goods: string[]; buffMult: number }`; `SPECIALISATION_FAMILIES: SpecialisationFamily[]`; `FAMILY_BY_GOOD: Record<string, SpecialisationFamily>`; `COMPLEX_BY_TYPE: Record<string, SpecialisationFamily>`; `COMPLEX_TYPES: string[]`; constants `HEAVY_INDUSTRY_COMPLEX`/`CHEMICALS_COMPLEX`/`ELECTRONICS_COMPLEX`/`ARMAMENTS_COMPLEX`/`CONSUMER_COMPLEX`, `ANCHOR_FOOTPRINT`, `ANCHOR_UNSKILLED_LABOUR`, `ANCHOR_CAP`, `ANCHOR_RATED_COVERAGE`, `ANCHOR_MIN_THROUGHPUT`. Adds the five complex entries to `BUILDING_TYPES`.

- [ ] **Step 1: Write the failing test**

Add to `lib/constants/__tests__/industry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SPECIALISATION_FAMILIES, FAMILY_BY_GOOD, COMPLEX_BY_TYPE, COMPLEX_TYPES,
  BUILDING_TYPES, ANCHOR_FOOTPRINT, ANCHOR_UNSKILLED_LABOUR,
} from "@/lib/constants/industry";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";

describe("specialisation families", () => {
  it("partition every tier-1+ good into exactly one family", () => {
    const tier1plus = GOOD_NAMES.filter((g) => (GOOD_TIER_BY_KEY[g] ?? 0) >= 1);
    // every tier-1+ good has a family
    for (const g of tier1plus) expect(FAMILY_BY_GOOD[g], `${g} has a family`).toBeDefined();
    // no tier-0 good has a family
    for (const g of GOOD_NAMES.filter((g) => GOOD_TIER_BY_KEY[g] === 0)) {
      expect(FAMILY_BY_GOOD[g], `${g} is un-familied`).toBeUndefined();
    }
    // families are disjoint and cover all 18 tier-1+ goods exactly once
    const all = SPECIALISATION_FAMILIES.flatMap((f) => f.goods);
    expect(new Set(all).size).toBe(all.length); // no dupes
    expect(all.length).toBe(tier1plus.length);
  });

  it("register five complex building types with the anchor footprint + unskilled staffing", () => {
    expect(COMPLEX_TYPES.length).toBe(5);
    for (const f of SPECIALISATION_FAMILIES) {
      expect(COMPLEX_BY_TYPE[f.complexType]).toBe(f);
      const def = BUILDING_TYPES[f.complexType];
      expect(def?.spaceCost).toBe(ANCHOR_FOOTPRINT);
      expect(def?.labour).toEqual({ unskilled: ANCHOR_UNSKILLED_LABOUR, skill1: 0, skill2: 0 });
      expect(def?.outputGood).toBeUndefined(); // produces no good
      expect(def?.resource).toBeUndefined();   // not an extractor → bills to general space
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts`
Expected: FAIL — `SPECIALISATION_FAMILIES` is not exported.

- [ ] **Step 3: Add the catalog + constants + building types**

In `lib/constants/industry.ts`, after the academy type constants (near line 27), add:

```ts
// ── Specialisation complexes (S2 anchors) ──
export const HEAVY_INDUSTRY_COMPLEX = "heavy_industry_complex";
export const CHEMICALS_COMPLEX = "chemicals_complex";
export const ELECTRONICS_COMPLEX = "electronics_complex";
export const ARMAMENTS_COMPLEX = "armaments_complex";
export const CONSUMER_COMPLEX = "consumer_complex";

/** A production family and the anchor complex that buffs it. */
export interface SpecialisationFamily {
  /** Complex building-type id for this family. */
  complexType: string;
  /** Display name of the complex. */
  label: string;
  /** Tier-1+ goods this complex buffs (a partition — each good in exactly one family). */
  goods: string[];
  /** Full yield multiplier at complex count = 1 (per-family weighted so families balance). */
  buffMult: number;
}

/** The five vertical production families. Buff multipliers are lighter on the heavyweight families. */
export const SPECIALISATION_FAMILIES: SpecialisationFamily[] = [
  { complexType: HEAVY_INDUSTRY_COMPLEX, label: "Heavy Industry Complex", buffMult: 1.4,
    goods: ["metals", "alloys", "hull_plating", "components", "machinery", "ship_frames"] },
  { complexType: CHEMICALS_COMPLEX, label: "Chemical Combine", buffMult: 1.5,
    goods: ["fuel", "chemicals", "polymers", "medicine"] },
  { complexType: ELECTRONICS_COMPLEX, label: "Electronics Complex", buffMult: 1.5,
    goods: ["electronics", "targeting_arrays"] },
  { complexType: ARMAMENTS_COMPLEX, label: "Armaments Complex", buffMult: 1.4,
    goods: ["munitions", "weapons", "weapons_systems", "reactor_cores"] },
  { complexType: CONSUMER_COMPLEX, label: "Consumer Works", buffMult: 1.5,
    goods: ["consumer_goods", "luxuries"] },
];

/** good id → its family. Un-familied (tier-0) goods return undefined. */
export const FAMILY_BY_GOOD: Record<string, SpecialisationFamily> = (() => {
  const out: Record<string, SpecialisationFamily> = {};
  for (const f of SPECIALISATION_FAMILIES) for (const g of f.goods) out[g] = f;
  return out;
})();

/** complex building-type id → its family. */
export const COMPLEX_BY_TYPE: Record<string, SpecialisationFamily> = (() => {
  const out: Record<string, SpecialisationFamily> = {};
  for (const f of SPECIALISATION_FAMILIES) out[f.complexType] = f;
  return out;
})();

/** The five complex building type ids. */
export const COMPLEX_TYPES: string[] = SPECIALISATION_FAMILIES.map((f) => f.complexType);

// ── Anchor knobs (coarse first-cut; tune against sim equilibrium) ──
/** General-space footprint of one full complex (count = 1) — the largest building type; a shipyard is 4.0. */
export const ANCHOR_FOOTPRINT = 8;
/** Modest unskilled head count one full complex draws to run (like an academy). */
export const ANCHOR_UNSKILLED_LABOUR = 12;
/** Max complexes per system, total across all families ("one industrial identity"). */
export const ANCHOR_CAP = 1;
/** Family output throughput one full complex is rated to buff — sets decay `used` + the planner's amortisation. */
export const ANCHOR_RATED_COVERAGE = scaleValue(20);
/** Seed/build a complex only where projected family throughput reaches this floor (amortisation). */
export const ANCHOR_MIN_THROUGHPUT = scaleValue(10);
```

Then add a builder for the complex building types and spread it into `BUILDING_TYPES`. After `buildProductionTypes` (near line 158), add:

```ts
function buildComplexTypes(): Record<string, BuildingTypeDef> {
  const out: Record<string, BuildingTypeDef> = {};
  for (const f of SPECIALISATION_FAMILIES) {
    out[f.complexType] = {
      spaceCost: ANCHOR_FOOTPRINT,
      labour: { unskilled: ANCHOR_UNSKILLED_LABOUR, skill1: 0, skill2: 0 },
    };
  }
  return out;
}
```

And update the `BUILDING_TYPES` literal:

```ts
export const BUILDING_TYPES: Record<string, BuildingTypeDef> = {
  ...buildProductionTypes(),
  ...buildComplexTypes(),
  [HOUSING_TYPE]: { spaceCost: DEFAULT_SPACE_COST, popProvided: POP_CENTRE_DENSITY },
  [VOCATIONAL_SCHOOL_TYPE]: { /* unchanged */
    spaceCost: 1.5, labour: { unskilled: 15, skill1: 0, skill2: 0 }, skill1Licensed: SKILL1_PER_SCHOOL },
  [RESEARCH_INSTITUTE_TYPE]: { /* unchanged */
    spaceCost: 2.0, labour: { unskilled: 20, skill1: 0, skill2: 0 }, skill2Licensed: SKILL2_PER_INSTITUTE },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/industry.ts lib/constants/__tests__/industry.test.ts
git commit -m "feat(economy): specialisation family catalog + complex building types"
```

---

## Task 2: `familyAnchorBuff` folded into production

**Files:**
- Modify: `lib/engine/industry.ts`
- Test: `lib/engine/__tests__/industry.test.ts`

**Interfaces:**
- Consumes: `FAMILY_BY_GOOD`, `SpecialisationFamily` (Task 1).
- Produces: `familyAnchorBuff(buildings: Record<string, number>, goodId: string): number`. Folded into `buildingProduction` so `capacityGoodRates` / `inputDemandForGood` inherit it.

- [ ] **Step 1: Write the failing test**

Add to `lib/engine/__tests__/industry.test.ts`:

```ts
import { familyAnchorBuff, buildingProduction, inputDemandForGood } from "@/lib/engine/industry";
import { unitResourceVector } from "@/lib/engine/resources";
import { HEAVY_INDUSTRY_COMPLEX } from "@/lib/constants/industry";

const FULL = { labourFulfil: 1, skill1Fulfil: 1, skill2Fulfil: 1 };
const YIELDS = unitResourceVector();

describe("familyAnchorBuff", () => {
  it("is 1 for a tier-0 (un-familied) good regardless of complexes", () => {
    expect(familyAnchorBuff({ [HEAVY_INDUSTRY_COMPLEX]: 1 }, "water")).toBe(1);
  });
  it("is 1 when the family's complex is absent", () => {
    expect(familyAnchorBuff({ metals: 5 }, "metals")).toBe(1);
  });
  it("reaches the family's full multiplier at count = 1, scaling linearly below", () => {
    expect(familyAnchorBuff({ [HEAVY_INDUSTRY_COMPLEX]: 1 }, "metals")).toBeCloseTo(1.4);
    expect(familyAnchorBuff({ [HEAVY_INDUSTRY_COMPLEX]: 0.5 }, "metals")).toBeCloseTo(1.2);
  });
  it("caps at count = 1 (never runs away)", () => {
    expect(familyAnchorBuff({ [HEAVY_INDUSTRY_COMPLEX]: 3 }, "metals")).toBeCloseTo(1.4);
  });
});

describe("buildingProduction with a complex", () => {
  it("multiplies a family good's output by the buff", () => {
    const base = buildingProduction({ metals: 2 }, "metals", FULL, YIELDS);
    const buffed = buildingProduction({ metals: 2, [HEAVY_INDUSTRY_COMPLEX]: 1 }, "metals", FULL, YIELDS);
    expect(buffed / base).toBeCloseTo(1.4);
  });
  it("flows into input-demand (a buffed consumer draws more of its input)", () => {
    // metals ← ore; a Heavy complex buffs metals output → ore input-demand rises in step.
    const base = inputDemandForGood({ metals: 2 }, "ore", FULL, YIELDS);
    const buffed = inputDemandForGood({ metals: 2, [HEAVY_INDUSTRY_COMPLEX]: 1 }, "ore", FULL, YIELDS);
    expect(buffed / base).toBeCloseTo(1.4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts -t "familyAnchorBuff"`
Expected: FAIL — `familyAnchorBuff` is not exported.

- [ ] **Step 3: Implement `familyAnchorBuff` and fold it into `buildingProduction`**

In `lib/engine/industry.ts`, add `FAMILY_BY_GOOD` to the constants import, then add near `buildingProduction`:

```ts
/**
 * Yield multiplier a system's specialisation complex grants to `goodId`. 1 for un-familied
 * (tier-0) goods and for families whose complex is absent. Scales linearly with the complex's
 * count in [0,1], reaching the family's full multiplier at count = 1 (the cap) — never beyond.
 * Derived from `buildings`, so it needs no new production-signature.
 */
export function familyAnchorBuff(buildings: Record<string, number>, goodId: string): number {
  const family = FAMILY_BY_GOOD[goodId];
  if (!family) return 1;
  const count = buildings[family.complexType] ?? 0;
  if (count <= 0) return 1;
  return 1 + (family.buffMult - 1) * Math.min(1, count);
}
```

Change the final return of `buildingProduction` (line ~341) from:

```ts
  return rate * yieldMult;
```
to:
```ts
  return rate * yieldMult * familyAnchorBuff(buildings, goodId);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts`
Expected: PASS (existing industry tests still green — buff is 1 wherever no complex exists).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/industry.ts lib/engine/__tests__/industry.test.ts
git commit -m "feat(economy): fold specialisation buff into building production"
```

---

## Task 3: Family throughput, complex `used`, and decay

**Files:**
- Modify: `lib/engine/industry.ts` (helpers), `lib/engine/infrastructure-decay.ts` (decay branch)
- Test: `lib/engine/__tests__/industry.test.ts`, `lib/engine/__tests__/infrastructure-decay.test.ts`

**Interfaces:**
- Consumes: `OUTPUT_PER_UNIT`, `COMPLEX_BY_TYPE`, `ANCHOR_RATED_COVERAGE`, `SpecialisationFamily` (Task 1).
- Produces: `familyThroughput(buildings: Record<string, number>, family: SpecialisationFamily): number`; `complexUsed(count: number, throughput: number, rated: number): number`. Both used by decay and (Task 4) the readout.

- [ ] **Step 1: Write the failing helper test**

Add to `lib/engine/__tests__/industry.test.ts`:

```ts
import { familyThroughput, complexUsed } from "@/lib/engine/industry";
import { SPECIALISATION_FAMILIES, HEAVY_INDUSTRY_COMPLEX, ANCHOR_RATED_COVERAGE } from "@/lib/constants/industry";

const HEAVY = SPECIALISATION_FAMILIES.find((f) => f.complexType === HEAVY_INDUSTRY_COMPLEX)!;

describe("familyThroughput / complexUsed", () => {
  it("sums the family's factory output capacity (unbuffed)", () => {
    const one = familyThroughput({ metals: 1 }, HEAVY);
    expect(familyThroughput({ metals: 2 }, HEAVY)).toBeCloseTo(2 * one);
    expect(familyThroughput({}, HEAVY)).toBe(0);
  });
  it("holds a complex fully used when throughput ≥ its rated coverage", () => {
    expect(complexUsed(1, ANCHOR_RATED_COVERAGE * 2, ANCHOR_RATED_COVERAGE)).toBeCloseTo(1);
  });
  it("drops a complex's used toward throughput/rated when the family is thin", () => {
    expect(complexUsed(1, ANCHOR_RATED_COVERAGE * 0.25, ANCHOR_RATED_COVERAGE)).toBeCloseTo(0.25);
  });
  it("is 0 for an orphaned complex (no family production)", () => {
    expect(complexUsed(1, 0, ANCHOR_RATED_COVERAGE)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts -t "familyThroughput"`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement the helpers**

In `lib/engine/industry.ts`, add `OUTPUT_PER_UNIT`, `COMPLEX_BY_TYPE`, `ANCHOR_RATED_COVERAGE`, and `type SpecialisationFamily` to the constants import, then add:

```ts
/**
 * The unbuffed output capacity a system's built factories give a family — Σ over the family's
 * goods of count × outputPerUnit. The stable, built-base-driven "demand" a complex is measured
 * against (mirrors an academy's skill demand); independent of staffing/selling swings.
 */
export function familyThroughput(buildings: Record<string, number>, family: SpecialisationFamily): number {
  let t = 0;
  for (const g of family.goods) t += (buildings[g] ?? 0) * (OUTPUT_PER_UNIT[g] ?? 0);
  return t;
}

/**
 * A specialisation complex's in-use units = min(count, throughput / rated) — how much of its rated
 * family coverage the built factories actually draw. Thriving family → used ≈ count (holds at cap);
 * orphaned family (throughput → 0) → used → 0 (rots away). The complex analogue of an academy's
 * count × min(1, demand/cap).
 */
export function complexUsed(count: number, throughput: number, rated: number): number {
  if (count <= 0) return 0;
  return Math.min(count, rated > 0 ? throughput / rated : 0);
}
```

- [ ] **Step 4: Write the failing decay test**

Add to `lib/engine/__tests__/infrastructure-decay.test.ts`:

```ts
import { computeSystemDecay } from "@/lib/engine/infrastructure-decay";
import { HEAVY_INDUSTRY_COMPLEX, ANCHOR_RATED_COVERAGE, OUTPUT_PER_UNIT } from "@/lib/constants/industry";

const PARAMS = { disuseRate: 0.1, unrestRate: 0, unrestThreshold: 0.6 };
const noUptake = () => 1;

describe("complex decay", () => {
  it("holds a complex serving a thriving family (used ≈ count)", () => {
    // metals throughput well above rated coverage → complex fully used → no decay.
    const metals = (ANCHOR_RATED_COVERAGE * 2) / (OUTPUT_PER_UNIT.metals ?? 1);
    const buildings = { metals, [HEAVY_INDUSTRY_COMPLEX]: 1 };
    const { newCounts } = computeSystemDecay({ buildings, population: 1e9, unrest: 0, outputUptake: noUptake }, PARAMS);
    expect(newCounts[HEAVY_INDUSTRY_COMPLEX]).toBeUndefined(); // did not decay
  });
  it("rots an orphaned complex (no family factories left) toward 0", () => {
    const buildings = { [HEAVY_INDUSTRY_COMPLEX]: 1 };
    const { newCounts } = computeSystemDecay({ buildings, population: 1e9, unrest: 0, outputUptake: noUptake }, PARAMS);
    expect(newCounts[HEAVY_INDUSTRY_COMPLEX]).toBeLessThan(1); // decayed (used = 0 → full disuse gap)
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/infrastructure-decay.test.ts -t "complex decay"`
Expected: FAIL — complex is currently treated as a tier-0 producer (fulfilment-based used), so an orphaned complex with `population 1e9` reads fully used and does not decay.

- [ ] **Step 6: Add the complex decay branch**

In `lib/engine/infrastructure-decay.ts`: add `familyThroughput`, `complexUsed` to the `@/lib/engine/industry` import; add `COMPLEX_BY_TYPE`, `ANCHOR_RATED_COVERAGE` to the `@/lib/constants/industry` import. In `computeSystemDecay`, add a branch before the final `else` (after the `RESEARCH_INSTITUTE_TYPE` branch, ~line 120):

```ts
    } else if (COMPLEX_BY_TYPE[type]) {
      // A complex's used = how much of its rated family coverage the built factories draw.
      // Orphaned (family gone) → used 0 → rots away, freeing the space + the cap slot.
      used = complexUsed(count, familyThroughput(buildings, COMPLEX_BY_TYPE[type]), ANCHOR_RATED_COVERAGE);
```

- [ ] **Step 7: Run both test files to verify they pass**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts lib/engine/__tests__/infrastructure-decay.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/engine/industry.ts lib/engine/infrastructure-decay.ts lib/engine/__tests__/industry.test.ts lib/engine/__tests__/infrastructure-decay.test.ts
git commit -m "feat(economy): complex decays toward family throughput"
```

---

## Task 4: Readout branch + building descriptions

**Files:**
- Modify: `lib/engine/industry.ts` (`buildIndustryReadout`), `lib/constants/building-descriptions.ts`
- Test: `lib/engine/__tests__/industry.test.ts`, `lib/constants/__tests__/building-descriptions.test.ts`

**Interfaces:**
- Consumes: `familyThroughput`, `complexUsed` (Task 3), `COMPLEX_BY_TYPE`, `ANCHOR_RATED_COVERAGE` (Task 1).
- Produces: complexes appear in `SystemIndustryReadout.buildings` with `tier: 0`, family-utilisation `used`/`staffedFraction`, no `output`. `describeBuilding(complexType)` returns bespoke copy.

- [ ] **Step 1: Write the failing readout test**

Add to `lib/engine/__tests__/industry.test.ts`:

```ts
import { buildIndustryReadout } from "@/lib/engine/industry";

describe("buildIndustryReadout — complex row", () => {
  it("emits a complex entry with family-utilisation used (not labour-based)", () => {
    const buildings = { [HEAVY_INDUSTRY_COMPLEX]: 1 }; // orphaned: no metals factories
    const r = buildIndustryReadout(buildings, 1e9, {}, () => 0, unitResourceVector());
    const row = r.buildings.find((b) => b.buildingType === HEAVY_INDUSTRY_COMPLEX)!;
    expect(row.used).toBe(0);            // orphaned → 0, despite population being huge
    expect(row.output).toBeUndefined();  // produces no good
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts -t "complex row"`
Expected: FAIL — the complex currently falls through to the producer branch: `used = count × labourFulfil` ≈ 1, not 0.

- [ ] **Step 3: Add the readout complex branch**

In `lib/engine/industry.ts` `buildIndustryReadout`, inside the `for (const [buildingType, count] of Object.entries(buildings))` loop, add a branch right after the `HOUSING_TYPE` block (before `const def = BUILDING_TYPES[buildingType]`, ~line 550):

```ts
    if (COMPLEX_BY_TYPE[buildingType]) {
      const used = complexUsed(count, familyThroughput(buildings, COMPLEX_BY_TYPE[buildingType]), ANCHOR_RATED_COVERAGE);
      const staffedFraction = count > 0 ? used / count : 0;
      buildingEntries.push({ buildingType, tier: 0, count, used, staffedFraction });
      continue;
    }
```

- [ ] **Step 4: Write the failing description test**

Add to `lib/constants/__tests__/building-descriptions.test.ts`:

```ts
import { describeBuilding } from "@/lib/constants/building-descriptions";
import { COMPLEX_TYPES } from "@/lib/constants/industry";

describe("complex descriptions", () => {
  it("gives every complex bespoke non-empty copy", () => {
    for (const t of COMPLEX_TYPES) {
      expect(describeBuilding(t).length, `${t} has copy`).toBeGreaterThan(20);
    }
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run lib/constants/__tests__/building-descriptions.test.ts`
Expected: FAIL — `describeBuilding` returns "" for complex types (not in GOODS, no bespoke entry).

- [ ] **Step 6: Add bespoke complex copy**

In `lib/constants/building-descriptions.ts`, import the five complex type ids, and add entries to `BUILDING_DESCRIPTIONS`:

```ts
  [HEAVY_INDUSTRY_COMPLEX]:
    "Heavy Industry Complex — an integrated metallurgical anchor. Grants a system-wide yield bonus to the whole heavy chain (metals, alloys, hull plating, components, machinery, ship frames). One complex per system; its large footprint crowds out breadth, so the world specialises and imports the rest. Decays toward the family output it actually buffs.",
  [CHEMICALS_COMPLEX]:
    "Chemical Combine — refineries, reactors, and process plant. Grants a system-wide yield bonus to fuel, chemicals, polymers, and medicine. One complex per system; a large footprint that forces specialisation. Decays toward the chemical output it buffs.",
  [ELECTRONICS_COMPLEX]:
    "Electronics Complex — fabs and clean-room assembly. Grants a system-wide yield bonus to electronics and targeting arrays. One complex per system; a large footprint that forces specialisation. Decays toward the electronics output it buffs.",
  [ARMAMENTS_COMPLEX]:
    "Armaments Complex — ordnance works and weapon-systems integration. Grants a system-wide yield bonus to munitions, weapons, weapons systems, and reactor cores. One complex per system; a large footprint that forces specialisation. Decays toward the armaments output it buffs.",
  [CONSUMER_COMPLEX]:
    "Consumer Works — light manufacturing and finishing. Grants a system-wide yield bonus to consumer goods and luxuries. One complex per system; a large footprint that forces specialisation. Decays toward the consumer output it buffs.",
```

Update the import at the top of the file:

```ts
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE,
  HEAVY_INDUSTRY_COMPLEX, CHEMICALS_COMPLEX, ELECTRONICS_COMPLEX, ARMAMENTS_COMPLEX, CONSUMER_COMPLEX,
} from "@/lib/constants/industry";
```

- [ ] **Step 7: Run both test files to verify they pass**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts lib/constants/__tests__/building-descriptions.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/engine/industry.ts lib/constants/building-descriptions.ts lib/engine/__tests__/industry.test.ts lib/constants/__tests__/building-descriptions.test.ts
git commit -m "feat(economy): surface specialisation complexes in the industry readout"
```

---

## Task 5: Industry panel — render complexes as their own group

**Files:**
- Modify: `components/system/industry-panel.tsx`

**Interfaces:**
- Consumes: `COMPLEX_TYPES`, `COMPLEX_BY_TYPE` (Task 1); the readout complex rows (Task 4).

> **UI scope:** this is minimal reuse of the existing `ProductionRow` + tooltip — a new label, a group filter, and a "Specialisation" section. It introduces no new visual language, so it does **not** need the collaborative HTML-prototype design pass. Any *richer* complex visualisation (per-good buff badges, a family diagram) is a separate change that WOULD get that pass — do not add it here.

- [ ] **Step 1: Add a complex label map + extend `label`**

In `components/system/industry-panel.tsx`, add `COMPLEX_TYPES, COMPLEX_BY_TYPE` to the `@/lib/constants/industry` import. Add a label map beside `ACADEMY_LABELS` (~line 92) and extend `label`:

```ts
/** Complex building types aren't in GOODS — name them from the family catalog. */
const COMPLEX_LABELS: Record<string, string> = Object.fromEntries(
  COMPLEX_TYPES.map((t) => [t, COMPLEX_BY_TYPE[t].label]),
);

function label(id: string): string {
  if (id === HOUSING_TYPE) return "Housing";
  return ACADEMY_LABELS[id] ?? COMPLEX_LABELS[id] ?? GOODS[id]?.name ?? id;
}
```

- [ ] **Step 2: Exclude complexes from extractors and add a complexes group**

In `IndustryPanel`, update the grouping (~line 522) — complexes have readout `tier: 0`, so they must be filtered out of `extractors` (like academies) and collected separately:

```ts
  const extractors = buildings.filter(
    (b) => b.tier === 0 && !ACADEMY_TYPES.includes(b.buildingType) && !COMPLEX_TYPES.includes(b.buildingType),
  );
  const housing = buildings.filter((b) => b.tier === -1);
  const factories = buildings.filter((b) => b.tier >= 1);
  const academies = buildings.filter((b) => ACADEMY_TYPES.includes(b.buildingType));
  const complexes = buildings.filter((b) => COMPLEX_TYPES.includes(b.buildingType));
```

- [ ] **Step 3: Render the complexes group under General land**

In the "General land" Card, after the `academies` block (~line 622), add:

```tsx
        {complexes.length > 0 && (
          <>
            <RoleLabel>Specialisation</RoleLabel>
            <div>
              {complexes.map((b) => <ProductionRow key={b.buildingType} b={b} unrest={unrest} labour={labour} density={density} />)}
            </div>
          </>
        )}
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Visual smoke (manual)**

Run: `npm run dev`, open a developed system's Industry panel. A system carrying a complex shows a **Specialisation** group under General land with the complex's name, a health glyph, and a "what it does" tooltip. (Complexes only appear once seeded/built — Phase 2 — so on a pre-Phase-2 DB this group may be empty; that's expected. Verify no console errors and existing groups render unchanged.)

- [ ] **Step 6: Commit**

```bash
git add components/system/industry-panel.tsx
git commit -m "feat(economy): render specialisation complexes in the industry panel"
```

**End of Phase 1 → open PR 1 (`feat/economy-specialisation-s2` → shared/main per workflow).** Complexes now exist as buildings, buff production, decay correctly, and display — but nothing builds them yet.

---

# Phase 2 — Build layer (PR 2)

## Task 6: Seed each system's dominant-family complex

**Files:**
- Modify: `lib/engine/industry-seed.ts`
- Test: `lib/engine/__tests__/industry-seed.test.ts`

**Interfaces:**
- Consumes: `familyThroughput` (Task 3); `SPECIALISATION_FAMILIES`, `COMPLEX_TYPES`, `ANCHOR_CAP`, `ANCHOR_RATED_COVERAGE`, `ANCHOR_MIN_THROUGHPUT` (Task 1).
- Produces: a seeded system with meaningful family industry carries its dominant family's complex; the staffing self-consistency pass scales it alongside production.

- [ ] **Step 1: Write the failing test**

Add to `lib/engine/__tests__/industry-seed.test.ts` (follow the file's existing fixture helpers for `AllocateInput` + RNG; construct a deposit-rich, high-`fill` input so a real heavy chain seeds):

```ts
import { COMPLEX_TYPES } from "@/lib/constants/industry";

it("seeds a specialisation complex at a developed system's dominant family", () => {
  // A large, deposit-rich, high-fill system seeds a broad heavy chain → clears the throughput floor.
  const result = allocateIndustry(bigDepositRichInput(), makeRng(42));
  const complexes = COMPLEX_TYPES.filter((t) => (result.buildings[t] ?? 0) > 0);
  expect(complexes.length).toBeLessThanOrEqual(1);   // cap: at most one, of one family
  expect(complexes.length).toBe(1);                  // developed system → one seeded
});

it("seeds no complex on a thin frontier system (below the throughput floor)", () => {
  const result = allocateIndustry(tinyInput(), makeRng(7));
  const complexes = COMPLEX_TYPES.filter((t) => (result.buildings[t] ?? 0) > 0);
  expect(complexes.length).toBe(0);
});
```

> If `bigDepositRichInput()` / `tinyInput()` helpers don't already exist in the test file, add them modelled on the existing `AllocateInput` fixtures — `bigDepositRichInput` with large `slotCap` across ore+minerals, generous `generalSpace`/`habitableSpace`, `fill: 1`; `tinyInput` with minimal slots/space/`fill`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/industry-seed.test.ts -t "specialisation complex"`
Expected: FAIL — no complex is ever seeded.

- [ ] **Step 3: Seed the dominant-family complex**

In `lib/engine/industry-seed.ts`: add `familyThroughput` to the `@/lib/engine/industry` import; add `SPECIALISATION_FAMILIES, COMPLEX_TYPES, ANCHOR_CAP, ANCHOR_RATED_COVERAGE, ANCHOR_MIN_THROUGHPUT` to the `@/lib/constants/industry` import. Add a step after the academies block (2.5) and before population centres (3):

```ts
  // ── 2.6) Specialisation complex — the dominant family's anchor. ──
  // Pick the family this system produces most of; if its factory throughput clears the amortisation
  // floor, place its complex (sized to its rated coverage, capped) from the same factory budget, so a
  // matured galaxy opens already specialised. The complex draws unskilled labour, so it flows through
  // the staffing self-consistency pass below like a factory.
  let bestFamily = SPECIALISATION_FAMILIES[0];
  let bestThroughput = 0;
  for (const f of SPECIALISATION_FAMILIES) {
    const t = familyThroughput(buildings, f);
    if (t > bestThroughput) { bestThroughput = t; bestFamily = f; }
  }
  if (bestThroughput >= ANCHOR_MIN_THROUGHPUT) {
    const wanted = Math.min(ANCHOR_CAP, bestThroughput / ANCHOR_RATED_COVERAGE);
    const cost = effectiveSpaceCost(bestFamily.complexType);
    const affordable = Math.max(0, (factoryBudget - factoryUsed) / cost);
    const count = Math.min(wanted, affordable);
    if (count > 0) { buildings[bestFamily.complexType] = count; factoryUsed += count * cost; }
  }
```

Then add complexes to the staffing self-consistency scale list (step 3b, ~line 229):

```ts
    for (const type of [...PRODUCTION_BUILDING_TYPES, ...ACADEMY_TYPES, ...COMPLEX_TYPES]) {
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/engine/__tests__/industry-seed.test.ts`
Expected: PASS (existing seed tests still green).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/industry-seed.ts lib/engine/__tests__/industry-seed.test.ts
git commit -m "feat(economy): seed specialisation complexes at dominant families"
```

---

## Task 7: Autonomic build — co-build the complex

**Files:**
- Modify: `lib/engine/directed-build.ts`
- Test: `lib/engine/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `familyAnchorBuff`, `familyThroughput` (Tasks 2–3); `FAMILY_BY_GOOD`, `COMPLEX_TYPES`, `ANCHOR_CAP`, `ANCHOR_RATED_COVERAGE`, `ANCHOR_MIN_THROUGHPUT` (Task 1); `OUTPUT_PER_UNIT` (existing import).
- Produces: `planFactionBuilds` co-builds a family complex at high-throughput sites, charged to the same opportunity; respects the cap; and buffed sites need fewer units (concentration).

- [ ] **Step 1: Write the failing test**

Add to `lib/engine/__tests__/directed-build.test.ts` (reuse the file's existing `BuildSystemState` / `routeCost` fixture helpers). Two systems: a producer site with lots of space + population + local inputs, and a reachable deficit sink with a large family shortfall.

```ts
import { COMPLEX_TYPES, HEAVY_INDUSTRY_COMPLEX } from "@/lib/constants/industry";

it("co-builds a family complex at a site serving a large family deficit", () => {
  const builds = planFactionBuilds(heavyDeficitScenario(), reachable);
  const complex = builds.find((b) => COMPLEX_TYPES.includes(b.buildingType));
  expect(complex?.buildingType).toBe(HEAVY_INDUSTRY_COMPLEX);
  // never more than the cap
  const total = builds.filter((b) => COMPLEX_TYPES.includes(b.buildingType)).reduce((s, b) => s + b.count, 0);
  expect(total).toBeLessThanOrEqual(1);
});

it("does not co-build a complex for a tiny family deficit (below the throughput floor)", () => {
  const builds = planFactionBuilds(tinyHeavyDeficitScenario(), reachable);
  expect(builds.some((b) => COMPLEX_TYPES.includes(b.buildingType))).toBe(false);
});
```

> `heavyDeficitScenario()` — a producer site with `generalSpace` ≫ `ANCHOR_FOOTPRINT`, high `population`, `ore`/`minerals` produced locally (so metals inputs are available), and a reachable sink with a metals shortfall large enough that the site commits `≥ ANCHOR_MIN_THROUGHPUT` of metals output. `tinyHeavyDeficitScenario()` — same shape but a shortfall small enough that committed throughput stays below the floor.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts -t "complex"`
Expected: FAIL — no complex build is ever emitted.

- [ ] **Step 3: Add `complexLift`**

In `lib/engine/directed-build.ts`: add `familyAnchorBuff, familyThroughput` to the `@/lib/engine/industry` import; add `FAMILY_BY_GOOD, COMPLEX_TYPES, ANCHOR_CAP, ANCHOR_RATED_COVERAGE, ANCHOR_MIN_THROUGHPUT` to the `@/lib/constants/industry` import. Add beside `academyLift` (~line 274):

```ts
/**
 * Plan the specialisation complex a site should co-build to anchor `goodId`'s family, given the
 * `prodUnits` of it committed this opportunity. Zero lift when: the good is un-familied, the site
 * already holds a complex (cap 1, any family), or the projected family throughput (existing family
 * factories + this build's UNBUFFED output capacity) is below the amortisation floor. Sized to the
 * complex's rated coverage, capped.
 */
function complexLift(
  site: BuildSystemState,
  goodId: string,
  prodUnits: number,
): { complexType?: string; count: number; space: number; units: number; unskilled: number } {
  const zero = { count: 0, space: 0, units: 0, unskilled: 0 };
  const family = FAMILY_BY_GOOD[goodId];
  if (!family) return zero;
  let existing = 0;
  for (const t of COMPLEX_TYPES) existing += site.buildings[t] ?? 0;
  if (existing >= ANCHOR_CAP) return zero;
  const projected = familyThroughput(site.buildings, family) + prodUnits * (OUTPUT_PER_UNIT[goodId] ?? 0);
  if (projected < ANCHOR_MIN_THROUGHPUT) return zero;
  const count = Math.min(ANCHOR_CAP - existing, projected / ANCHOR_RATED_COVERAGE);
  if (count <= 0) return zero;
  return {
    complexType: family.complexType,
    count,
    space: count * effectiveSpaceCost(family.complexType),
    units: count,
    unskilled: count * unskilledPerUnit(family.complexType),
  };
}
```

- [ ] **Step 4: Use the buff in opportunity sizing + fold the complex into the co-build**

In `planFactionBuilds`:

**(a)** When building opportunities (~line 370), score family goods at their *buffed* per-unit so seeded-complex sites already rank higher (the snowball). The current code computes `perUnit` once per good, outside the site loop:

```ts
    const perUnit = OUTPUT_PER_UNIT[goodId] ?? 0;
    if (perUnit <= 0) continue;
```

Rename that outer constant to `baseUnit` (it's now the pre-buff figure):

```ts
    const baseUnit = OUTPUT_PER_UNIT[goodId] ?? 0;
    if (baseUnit <= 0) continue;
```

Then inside the `for (const site of working.values())` loop, compute the site-specific buffed per-unit and store it on the opportunity:

```ts
      const perUnit = baseUnit * familyAnchorBuff(site.buildings, goodId);
```
(Use this `perUnit` in the score loop and store `perUnit` on the pushed `BuildOpportunity` as today.)

**(b)** In the execution loop (~line 411), recompute the buffed per-unit against the *current* working copy (a complex may have been co-built this pass at this site), and fold `complexLift` into the shrink loop next to `academyLift`. Replace the academy-sizing block (~lines 446–467) with:

```ts
    // Buffed output per unit against the live working copy (reflects any complex already here).
    const perUnit = (OUTPUT_PER_UNIT[opp.goodId] ?? 0) * familyAnchorBuff(site.buildings, opp.goodId);

    let aLift = academyLift(site, opp.goodId, wantUnits);
    let cLift = complexLift(site, opp.goodId, wantUnits);
    const remainingGeneral = site.generalSpace - generalSpaceUsed(site.buildings);
    const prodSpacePerUnit = GOOD_TIER_BY_KEY[opp.goodId] === 0 ? 0 : effectiveSpaceCost(opp.goodId);
    const prodLabourPerUnit = labourTotal(BUILDING_TYPES[opp.goodId]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 });

    // Shrink wantUnits until production + academy lift + complex lift fit budget, space, and spare labour.
    for (let guard = 0; guard < 8 && wantUnits > 0; guard++) {
      const totalBudget = wantUnits + aLift.units + cLift.units;
      const totalSpace = wantUnits * prodSpacePerUnit + aLift.space + cLift.space;
      const totalLabour = wantUnits * prodLabourPerUnit + aLift.unskilled + cLift.unskilled;
      const overBudget = totalBudget > budget ? budget / totalBudget : 1;
      const overSpace = totalSpace > remainingGeneral && totalSpace > 0 ? remainingGeneral / totalSpace : 1;
      const overLabour = totalLabour > spareLabour && totalLabour > 0 ? spareLabour / totalLabour : 1;
      const shrink = Math.min(overBudget, overSpace, overLabour);
      if (shrink >= 1) break;
      wantUnits *= shrink;
      aLift = academyLift(site, opp.goodId, wantUnits);
      cLift = complexLift(site, opp.goodId, wantUnits);
    }
    if (wantUnits <= 0) continue;
```

Note: `wantUnits`/`servedOutput` earlier in the loop already use `opp.perUnit` (the buffed per-unit stored at creation); this recomputed `perUnit` is used for `producedOutput` when decrementing served demand below — update that line to use the recomputed `perUnit` (`let producedOutput = wantUnits * perUnit;`).

**(c)** In the defensive final guard block (~lines 475–494), include `cLift` in the three totals exactly as `aLift`, and re-run `cLift = complexLift(site, opp.goodId, wantUnits)` alongside the `aLift` recompute.

**(d)** Apply the complex before the academies + production (~line 499), so later opportunities at this site see the buff:

```ts
    if (cLift.complexType && cLift.count > 0) {
      site.buildings[cLift.complexType] = (site.buildings[cLift.complexType] ?? 0) + cLift.count;
      builds.push({ systemId: site.systemId, buildingType: cLift.complexType, count: cLift.count });
      budget -= cLift.count;
    }
```

Rename the local `lift` → `aLift` consistently through the block (the two `[VOCATIONAL_SCHOOL_TYPE, aLift.schools]` / `[RESEARCH_INSTITUTE_TYPE, aLift.institutes]` apply lines, ~499–507).

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: PASS (existing planner tests still green — un-familied goods and low-throughput sites emit no complex).

- [ ] **Step 6: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "feat(economy): autonomic build co-builds specialisation complexes"
```

---

## Task 8: Full suite + simulation sanity

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `npx vitest run`
Expected: all green. If any pre-existing production-magnitude assertion now shifts because a *seeded* complex buffs output, update it to reflect the buffed value (do not weaken the assertion's intent).

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both succeed (build catches the Tailwind/doc scan issues `tsc` misses).

- [ ] **Step 3: Economy simulation sanity**

Run: `npm run simulate`
Expected: completes without NaN/Infinity/crash; greedy strategy still ≫ random; no runaway. (This is a coarse health check — precise gradient calibration is the deferred single S1–S4 pass, not this plan.)

- [ ] **Step 4: Audit the gradient shifted the right way (optional, informative)**

Run: `npm run audit:economy`
Expected: informational — with complexes seeded + built, the matured price spread should hold higher than the pre-S2 ~1.06×. Record the number in the PR description; do not tune to a target here.

- [ ] **Step 5: Commit any test updates from Step 1**

```bash
git add -A
git commit -m "test(economy): reconcile magnitude assertions with seeded complex buffs"
```

**End of Phase 2 → open PR 2.** After both PRs merge, the S2 spec moves from `docs/planned/` to `docs/active/gameplay/` and this build plan is deleted (per the docs convention).

---

## Self-Review

**Spec coverage** (against `economy-specialisation-s2-complexes.md`):
- Five families + partition → Task 1. ✓
- Fixed buff, `count ∈ [0,1]`, `1 + (B−1)·count`, per-family weighting → Tasks 1–2. ✓
- Buff into production + input-demand → Task 2. ✓
- Decay toward family throughput, orphan rots → Task 3. ✓
- Readout + descriptions + panel → Tasks 4–5. ✓
- Seed dominant family → Task 6. ✓
- Planner transitive co-build, cap, snowball, attract-not-restrict (space via the shrink loop) → Task 7. ✓
- Self-balancing by demand-pull → emergent from the existing structural-deficit planner (no code — verified it still holds in Task 7's low-deficit test). ✓
- Magnitudes deferred to calibration → constants first-cut, Task 8 does coarse sanity only. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. Test fixtures reference existing per-file helpers with an explicit note to add them modelled on existing fixtures where absent (Tasks 6–7) — this is the one spot an implementer must author a fixture; the shape is specified.

**Type consistency:** `familyAnchorBuff(buildings, goodId)`, `familyThroughput(buildings, family)`, `complexUsed(count, throughput, rated)`, `complexLift(site, goodId, prodUnits)` used identically across tasks. `SpecialisationFamily` fields (`complexType`/`label`/`goods`/`buffMult`) consistent. Complex readout `tier: 0` handled by type-based filters in the panel (Task 5), matching how academies are handled. `ANCHOR_*` names consistent throughout.
