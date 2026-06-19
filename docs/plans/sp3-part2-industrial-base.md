# SP3 Part 2 — Industrial Base & Build Space Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace labour-only (`labourFactor`) production with a capacity-driven industrial base — a seeded-static set of generic one-good buildings bounded by a per-system build-space budget, staffed by population (labour fulfilment), with housing raising `popCap`.

**Architecture:** A new pure constants catalog (`lib/constants/industry.ts`) and pure engine (`lib/engine/industry.ts`) define building types and the capacity-driven production math. A pure seeding allocator (`lib/engine/industry-seed.ts`) distributes each system's build-space budget across extractors / manufacturers / housing at world-gen. The two economy adapters (prisma + memory) compute `baseProductionRate` from buildings via the shared engine instead of from `physicalRates`; the economy **processor body and `EconomyWorld` interface are unchanged**. Tier-1+ recipes stay inert (input-gating is Part 3). Consumption (`perCapitaNeed × population`) is unchanged.

**Tech Stack:** TypeScript 5 (strict), Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), PostgreSQL, Vitest 4. Pure engine functions live in `lib/engine/`, constants in `lib/constants/`, DB access in adapters/services.

## Global Constraints

Copied verbatim from project conventions (CLAUDE.md) and the SP3 spec (`docs/planned/economy-simulation-supply-chain.md`). Every task implicitly includes these:

- **No `as` type assertions** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown`** anywhere except `JSON.parse` results narrowed immediately. Use typed keys (union types / `Record<GoodId, …>`), never `Record<string, unknown>`.
- **Engine functions are pure** — zero DB imports in `lib/engine/`. Test with Vitest.
- **Prisma singleton** in `lib/prisma.ts`; Client imported from `@/app/generated/prisma/client`. Never `new PrismaClient()`.
- **Unit project has NO `DATABASE_URL`** — never static-import `@/lib/prisma` (transitively) into a unit-tested module graph. `lib/engine/*` and `lib/constants/*` must not import prisma.
- **Batch all DB writes** inside `$transaction` / seed via `createMany` / `createManyAndReturn` / `unnest()` — no per-row loops at 10K scale. Guard `NaN`/`Infinity` before raw SQL.
- **`Int` column ceiling** is `2,147,483,647` (Postgres `int4`); `buildSpace`/`count` are `Float`, so safe — but never write `Infinity`/`NaN`.
- **`find(...)!` postfix `!` in tests is the project idiom** — fine to use.
- **Comments describe the code**, never the plan/phase/PR. No "Part 2" / "Phase B" references in shipped code or comments.
- **Calibration is coarse only** — the triangle knobs (`BASE_SPACE`, `spaceCost`, `labourPerUnit`, `outputPerUnit`, `popProvided`, fill-fraction curve) are first-draft and simulator-discovered. SP5 reshapes the equilibrium; do not over-tune.
- **Building representation is an abstract per-`(system, buildingType)` count (`Float`)**, not entities. Static at runtime — written only at seed. No construction state, no ownership.
- **Building type id is its own namespace.** In SP3 a production building type's id **equals its output good id** (1:1), plus the singleton `"housing"`. `buildingType → outputGood` is modelled many-to-one so `*_mk2` types are a pure data addition later.

---

## Reference: current production path (as-is)

The flip replaces the **production** half of two call sites. Read these before starting:

- `lib/engine/physical-economy.ts` — `physicalRates(goodId, aggregate, population)` returns `{ production = coeff × labourFactor(pop) × (resource ? aggregate[resource] : 1), consumption = need × pop }`. **Stays** for the seed-cover heuristic (`getInitialStock`) and is the source of the good→resource mapping (`GOOD_PRODUCTION[g].resource`).
- `lib/tick/adapters/prisma/economy.ts:78` and `lib/tick/adapters/memory/economy.ts:64` — both call `physicalRates(...)` and set `baseProductionRate` / `baseConsumptionRate` on each `MarketView`. **Production half is replaced** by capacity-driven; consumption half is kept.
- `lib/tick/processors/economy.ts` — consumes `MarketView.baseProductionRate` via `resolveMarketTickEntry`. **Unchanged.** Strike suppression (`productionSuppress`) still multiplies production in `buildMarketTickEntry`.
- `lib/services/universe.ts:294` — `substrateGoodRates(aggregate, population)` feeds the system read service `goods` display. **Switched** to capacity-driven so the readout matches the tick.
- `lib/constants/market-economy.ts:85` — `getInitialStock` uses `physicalRates` for seed producer-share. **Unchanged** (spec §10 step 4 keeps it).

## File Structure

**New files:**
- `lib/constants/industry.ts` — building-type catalog (26 production + `housing`), build-space knobs, calibration tables, `effectiveSpaceCost` modifier hook.
- `lib/constants/__tests__/industry.test.ts` — catalog completeness (every good has exactly one production type; housing present; positive knobs).
- `lib/engine/industry.ts` — pure capacity math: `bodyBuildSpace`, `labourDemand`, `labourFulfillment`, `buildSpaceUsed`, `housingPopCap`, `buildingProduction`, `capacityGoodRates`.
- `lib/engine/__tests__/industry.test.ts` — unit tests for the above.
- `lib/engine/industry-seed.ts` — pure `allocateIndustry(input, rng)` generation allocator.
- `lib/engine/__tests__/industry-seed.test.ts` — invariant tests (space ≤ budget, labour supply ≈ demand, tier-0 ≤ deposit, determinism).

**Modified files:**
- `prisma/schema.prisma` — `SystemBuilding` model + `StarSystem.buildSpace`.
- `lib/engine/body-gen.ts` — `GeneratedSubstrate` gains `buildings` + `buildSpace`; popCap/population recomputed via the allocator.
- `lib/engine/universe-gen.ts` — `GeneratedSystem` gains `buildings` + `buildSpace`; pass-through in `generateSystems`.
- `prisma/seed.ts` — write `buildSpace`; create `SystemBuilding` rows (batched).
- `lib/engine/simulator/types.ts` — `SimSystem` gains `buildings`.
- `lib/engine/simulator/world.ts` — seed `buildings` onto `SimSystem`.
- `lib/tick/adapters/memory/economy.ts` — capacity-driven production.
- `lib/tick/adapters/prisma/economy.ts` — load `SystemBuilding` per region; capacity-driven production.
- `lib/services/universe.ts` — capacity-driven production in the read service.
- `lib/test-utils/fixtures.ts` — seed buildings + buildSpace for test systems.
- `docs/active/gameplay/economy.md`, `docs/active/gameplay/system-traits.md`, `docs/SPEC.md` — reflect the model (Phase C).

**Phasing → 3 PRs into shared `feat/economy-sp3`:**
- **Phase A** (Tasks 1–4): pure foundation + schema. Nothing wired; suite stays green; zero behaviour change.
- **Phase B** (Tasks 5–11): wire generation/seed/sim/fixtures + flip both adapters and the read service to capacity-driven. The industrial base goes live and consistent.
- **Phase C** (Tasks 12–13): coarse simulator calibration of the triangle + docs.

---

## Phase A — Pure foundation + schema

### Task 1: `SystemBuilding` schema + `StarSystem.buildSpace`

**Files:**
- Modify: `prisma/schema.prisma` (StarSystem model + new SystemBuilding model)

**Interfaces:**
- Produces: `SystemBuilding { id, systemId, buildingType: String, count: Float }` with `@@unique([systemId, buildingType])` + `@@index([systemId])`; `StarSystem.buildSpace: Float @default(0)`; relation `StarSystem.buildings SystemBuilding[]`.

- [ ] **Step 1: Add `buildSpace` to `StarSystem`**

In `prisma/schema.prisma`, in the `StarSystem` model, after the `bodyDanger` field add:

```prisma
  buildSpace       Float   @default(0)  // total build-space budget, Σ body BASE_SPACE × size × habitability
```

And in the `StarSystem` relations block (near `bodies SystemBody[]`) add:

```prisma
  buildings         SystemBuilding[]
```

- [ ] **Step 2: Add the `SystemBuilding` model**

Add a new model (place it directly after `SystemBody`):

```prisma
model SystemBuilding {
  id           String @id @default(cuid())
  systemId     String
  buildingType String // production type id (== output good id) | "housing"
  count        Float  @default(0)

  system StarSystem @relation(fields: [systemId], references: [id], onDelete: Cascade)

  @@unique([systemId, buildingType])
  @@index([systemId])
}
```

- [ ] **Step 3: Generate the client and push the schema**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` with no errors.

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.` (the new table + column are created).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no usages yet; only the generated client changed).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma app/generated/prisma
git commit -m "feat(economy): add SystemBuilding table and StarSystem.buildSpace"
```

---

### Task 2: Building-type catalog constants (`lib/constants/industry.ts`)

**Files:**
- Create: `lib/constants/industry.ts`
- Test: `lib/constants/__tests__/industry.test.ts`

**Interfaces:**
- Consumes: `GOOD_NAMES` from `@/lib/constants/goods`; `GOOD_RECIPES` from `@/lib/constants/recipes`; `GOOD_PRODUCTION` from `@/lib/constants/physical-economy`; `ResourceType` from `@/lib/types/game`.
- Produces:
  - `HOUSING_TYPE = "housing"` (const)
  - `interface BuildingTypeDef { outputGood?: string; inputs?: Record<string, number>; resource?: ResourceType; spaceCost: number; labourPerUnit?: number; outputPerUnit?: number; popProvided?: number }`
  - `BUILDING_TYPES: Record<string, BuildingTypeDef>` — 26 production entries keyed by good id + `housing`
  - `BASE_SPACE: number`, `sizeFactor(size: number): number`, `habitabilityFactor(habitable: boolean): number`, `effectiveSpaceCost(buildingType: string): number`
  - `PRODUCTION_BUILDING_TYPES: string[]` (the 26 good-id keys)

> **Calibration note (Phase C tunes these):** `BASE_SPACE`, the habitability/size factors, `OUTPUT_PER_UNIT`, `DEFAULT_LABOUR_PER_UNIT`, and `HOUSING_POP_PROVIDED` are first-draft. `OUTPUT_PER_UNIT` is seeded from the SP1 production coeffs so a built-out world roughly reproduces SP1 output; the simulator retunes in Task 12.

- [ ] **Step 1: Write the failing test**

Create `lib/constants/__tests__/industry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GOOD_NAMES } from "@/lib/constants/goods";
import {
  BUILDING_TYPES,
  PRODUCTION_BUILDING_TYPES,
  HOUSING_TYPE,
  BASE_SPACE,
  sizeFactor,
  habitabilityFactor,
  effectiveSpaceCost,
} from "@/lib/constants/industry";

describe("BUILDING_TYPES catalog", () => {
  it("has exactly one production building type per good (id === output good id)", () => {
    for (const goodId of GOOD_NAMES) {
      const def = BUILDING_TYPES[goodId];
      expect(def, `building type: ${goodId}`).toBeDefined();
      expect(def.outputGood).toBe(goodId);
    }
    expect(PRODUCTION_BUILDING_TYPES).toHaveLength(GOOD_NAMES.length);
  });

  it("defines no production building type without a backing good", () => {
    const known = new Set(GOOD_NAMES);
    for (const type of PRODUCTION_BUILDING_TYPES) {
      expect(known.has(type), `stray production type: ${type}`).toBe(true);
    }
  });

  it("has a housing type that provides popCap and produces nothing", () => {
    const housing = BUILDING_TYPES[HOUSING_TYPE];
    expect(housing).toBeDefined();
    expect(housing.outputGood).toBeUndefined();
    expect(housing.popProvided).toBeGreaterThan(0);
  });

  it("gives every production type a positive spaceCost, labourPerUnit, outputPerUnit", () => {
    for (const type of PRODUCTION_BUILDING_TYPES) {
      const def = BUILDING_TYPES[type];
      expect(def.spaceCost, type).toBeGreaterThan(0);
      expect(def.labourPerUnit ?? 0, type).toBeGreaterThan(0);
      expect(def.outputPerUnit ?? 0, type).toBeGreaterThan(0);
    }
  });

  it("carries the SP1 good→resource mapping on tier-0 extractor types only", () => {
    // Tier-0 goods (resource-driven) have a `resource`; tier-1+ do not.
    expect(BUILDING_TYPES["ore"].resource).toBe("ore");
    expect(BUILDING_TYPES["food"].resource).toBe("arable");
    expect(BUILDING_TYPES["metals"].resource).toBeUndefined();
  });

  it("carries inert recipe inputs on tier-1+ production types (Part 3 gates them)", () => {
    expect(BUILDING_TYPES["metals"].inputs).toEqual({ ore: 1 });
    expect(BUILDING_TYPES["ore"].inputs).toBeUndefined();
  });

  it("exposes build-space factor helpers", () => {
    expect(BASE_SPACE).toBeGreaterThan(0);
    expect(sizeFactor(1)).toBeGreaterThan(0);
    expect(habitabilityFactor(true)).toBeGreaterThan(habitabilityFactor(false));
    expect(effectiveSpaceCost("ore")).toBe(BUILDING_TYPES["ore"].spaceCost);
    expect(effectiveSpaceCost(HOUSING_TYPE)).toBe(BUILDING_TYPES[HOUSING_TYPE].spaceCost);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts`
Expected: FAIL — `Cannot find module '@/lib/constants/industry'`.

- [ ] **Step 3: Write the implementation**

Create `lib/constants/industry.ts`:

```typescript
/**
 * Building-type catalog — the generic one-good industrial base.
 *
 * Each building type carries static, hard-coded properties: what it produces,
 * its recipe inputs, build-space footprint, labour to staff, and per-building
 * output. The catalog is data, not branches — a denser or upgraded type is a
 * new entry. In this model a production building type's id equals its output
 * good id (1:1); `buildingType → outputGood` is many-to-one so `*_mk2` types
 * are a pure data addition. The lone non-production type is `housing`, which
 * raises popCap and produces nothing.
 *
 * Magnitudes are first-draft and simulator-calibrated; only relative shape
 * matters (deposit caps tier-0 extractor count; manufacturers are space/labour
 * bound). Recipe `inputs` are inert here — input-gating arrives with the
 * supply-chain cascade.
 */
import type { ResourceType } from "@/lib/types/game";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { GOOD_PRODUCTION } from "@/lib/constants/physical-economy";

export const HOUSING_TYPE = "housing";

export interface BuildingTypeDef {
  /** Good this type produces (=== type id in this model). Undefined for housing. */
  outputGood?: string;
  /** Recipe: input good → units per output. Tier-1+ only; inert until input-gating. */
  inputs?: Record<string, number>;
  /** Tier-0 deposit resource that caps this extractor's seeded count. Tier-0 only. */
  resource?: ResourceType;
  /** Build-space units one building occupies. */
  spaceCost: number;
  /** Population needed to fully staff one building. Production types only. */
  labourPerUnit?: number;
  /** Output units one building yields at full labour (and inputs). Production types only. */
  outputPerUnit?: number;
  /** popCap added per building. Housing only. */
  popProvided?: number;
}

// ── Build-space knobs (first-draft; Phase C calibrates) ──
/** Build-space granted by a habitable body of size 1. */
export const BASE_SPACE = 40;
/** Habitable worlds host industry; belts / gas giants barely. */
export const HABITABILITY_FACTOR = { habitable: 1.0, uninhabitable: 0.15 } as const;
/** Default build-space footprint of one building. */
export const DEFAULT_SPACE_COST = 1.0;
/** Default population to fully staff one production building. */
export const DEFAULT_LABOUR_PER_UNIT = 25;
/** popCap one housing building provides. Below labourPerUnit by design (the §5 asymmetry). */
export const HOUSING_POP_PROVIDED = 20;

/**
 * Per-good per-building output at full labour. First-draft = SP1 production
 * coeff, so a fully built-out, deposit-rich world roughly reproduces SP1
 * output. Independent of the SP1 table going forward — Phase C tunes here.
 */
export const OUTPUT_PER_UNIT: Record<string, number> = Object.fromEntries(
  GOOD_NAMES.map((g) => [g, GOOD_PRODUCTION[g]?.coeff ?? 1]),
);

function buildProductionTypes(): Record<string, BuildingTypeDef> {
  const out: Record<string, BuildingTypeDef> = {};
  for (const goodId of GOOD_NAMES) {
    const recipe = GOOD_RECIPES[goodId];
    const resource = GOOD_PRODUCTION[goodId]?.resource;
    out[goodId] = {
      outputGood: goodId,
      ...(recipe ? { inputs: recipe } : {}),
      ...(resource ? { resource } : {}),
      spaceCost: DEFAULT_SPACE_COST,
      labourPerUnit: DEFAULT_LABOUR_PER_UNIT,
      outputPerUnit: OUTPUT_PER_UNIT[goodId],
    };
  }
  return out;
}

export const BUILDING_TYPES: Record<string, BuildingTypeDef> = {
  ...buildProductionTypes(),
  [HOUSING_TYPE]: { spaceCost: DEFAULT_SPACE_COST, popProvided: HOUSING_POP_PROVIDED },
};

/** The 26 production building type ids (good ids), in canonical good order. */
export const PRODUCTION_BUILDING_TYPES: string[] = [...GOOD_NAMES];

export function sizeFactor(size: number): number {
  return Math.max(0, size);
}

export function habitabilityFactor(habitable: boolean): number {
  return habitable ? HABITABILITY_FACTOR.habitable : HABITABILITY_FACTOR.uninhabitable;
}

/**
 * Build-space footprint of one building of `buildingType`. A modifier hook —
 * global upgrades (a denser type, a tech) multiply here without touching call
 * sites. Identity over the catalog cost in this model.
 */
export function effectiveSpaceCost(buildingType: string): number {
  return BUILDING_TYPES[buildingType]?.spaceCost ?? DEFAULT_SPACE_COST;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/constants/__tests__/industry.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/constants/industry.ts lib/constants/__tests__/industry.test.ts
git commit -m "feat(economy): add building-type catalog and build-space knobs"
```

---

### Task 3: Capacity-driven production engine (`lib/engine/industry.ts`)

**Files:**
- Create: `lib/engine/industry.ts`
- Test: `lib/engine/__tests__/industry.test.ts`

**Interfaces:**
- Consumes: `BUILDING_TYPES`, `BASE_SPACE`, `sizeFactor`, `habitabilityFactor`, `effectiveSpaceCost`, `HOUSING_TYPE`, `PRODUCTION_BUILDING_TYPES` from `@/lib/constants/industry`; `GOOD_NAMES` from `@/lib/constants/goods`; `GOOD_CONSUMPTION` from `@/lib/constants/physical-economy`; `SubstrateGoodRate` from `@/lib/engine/physical-economy`.
- Produces:
  - `bodyBuildSpace(size: number, habitable: boolean): number`
  - `labourDemand(buildings: Record<string, number>): number`
  - `labourFulfillment(population: number, demand: number): number`
  - `buildSpaceUsed(buildings: Record<string, number>): number`
  - `housingPopCap(buildings: Record<string, number>): number`
  - `buildingProduction(buildings: Record<string, number>, goodId: string, fulfillment: number): number`
  - `capacityGoodRates(buildings: Record<string, number>, population: number): SubstrateGoodRate[]`

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/industry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  bodyBuildSpace,
  labourDemand,
  labourFulfillment,
  buildSpaceUsed,
  housingPopCap,
  buildingProduction,
  capacityGoodRates,
} from "@/lib/engine/industry";
import {
  BASE_SPACE,
  DEFAULT_LABOUR_PER_UNIT,
  HOUSING_POP_PROVIDED,
  OUTPUT_PER_UNIT,
  HOUSING_TYPE,
} from "@/lib/constants/industry";

describe("bodyBuildSpace", () => {
  it("scales with size and habitability", () => {
    expect(bodyBuildSpace(1, true)).toBeCloseTo(BASE_SPACE, 6);
    expect(bodyBuildSpace(2, true)).toBeCloseTo(BASE_SPACE * 2, 6);
    expect(bodyBuildSpace(1, false)).toBeLessThan(bodyBuildSpace(1, true));
  });
});

describe("labourDemand", () => {
  it("sums count × labourPerUnit across production types; housing demands none", () => {
    const buildings = { ore: 4, metals: 2, [HOUSING_TYPE]: 10 };
    expect(labourDemand(buildings)).toBeCloseTo(6 * DEFAULT_LABOUR_PER_UNIT, 6);
  });
});

describe("labourFulfillment", () => {
  it("is 1 when no labour is demanded", () => {
    expect(labourFulfillment(0, 0)).toBe(1);
  });
  it("is min(1, population / demand)", () => {
    expect(labourFulfillment(100, 50)).toBe(1);
    expect(labourFulfillment(50, 100)).toBeCloseTo(0.5, 6);
  });
});

describe("buildSpaceUsed", () => {
  it("sums count × effectiveSpaceCost across all building types incl. housing", () => {
    const buildings = { ore: 3, [HOUSING_TYPE]: 5 };
    expect(buildSpaceUsed(buildings)).toBeCloseTo(8, 6); // default spaceCost 1.0
  });
});

describe("housingPopCap", () => {
  it("returns housing.count × popProvided", () => {
    expect(housingPopCap({ [HOUSING_TYPE]: 5, ore: 3 })).toBeCloseTo(5 * HOUSING_POP_PROVIDED, 6);
    expect(housingPopCap({ ore: 3 })).toBe(0);
  });
});

describe("buildingProduction", () => {
  it("is count × outputPerUnit × fulfillment for the matching production type", () => {
    const buildings = { ore: 5 };
    expect(buildingProduction(buildings, "ore", 1)).toBeCloseTo(5 * OUTPUT_PER_UNIT["ore"], 6);
    expect(buildingProduction(buildings, "ore", 0.5)).toBeCloseTo(5 * OUTPUT_PER_UNIT["ore"] * 0.5, 6);
  });
  it("is 0 for a good with no buildings", () => {
    expect(buildingProduction({ ore: 5 }, "metals", 1)).toBe(0);
  });
});

describe("capacityGoodRates", () => {
  it("returns one entry per good with capacity production and population consumption", () => {
    const rates = capacityGoodRates({ ore: 4 }, 1000);
    const ore = rates.find((r) => r.goodId === "ore")!;
    const food = rates.find((r) => r.goodId === "food")!;
    expect(ore.production).toBeGreaterThan(0);
    expect(ore.consumption).toBeGreaterThan(0); // everyone consumes ore a little
    expect(food.production).toBe(0); // no food buildings
    expect(food.consumption).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts`
Expected: FAIL — `Cannot find module '@/lib/engine/industry'`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/industry.ts`:

```typescript
/**
 * Pure capacity-driven production math — zero DB dependency.
 *
 * Production derives from the built industrial base, not raw population:
 *   production_g = Σ_{t: outputGood_t = g} count_t × outputPerUnit_t × labourFulfillment
 * Labour is a single system-wide ratio (uniform proportional allocation):
 *   labourFulfillment = min(1, population / Σ count_t × labourPerUnit_t)
 * Input-gating (the recipe `inputs`) is not applied here — that is the
 * supply-chain cascade. The same functions feed the live tick, the simulator,
 * and the substrate read service.
 */
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import { GOOD_NAMES } from "@/lib/constants/goods";
import {
  BASE_SPACE,
  BUILDING_TYPES,
  HOUSING_TYPE,
  effectiveSpaceCost,
  habitabilityFactor,
  sizeFactor,
} from "@/lib/constants/industry";

/** Build-space a single body contributes: BASE_SPACE × size × habitability. */
export function bodyBuildSpace(size: number, habitable: boolean): number {
  return BASE_SPACE * sizeFactor(size) * habitabilityFactor(habitable);
}

/** Σ count × labourPerUnit across production types. Housing demands no labour. */
export function labourDemand(buildings: Record<string, number>): number {
  let demand = 0;
  for (const [type, count] of Object.entries(buildings)) {
    const labour = BUILDING_TYPES[type]?.labourPerUnit;
    if (labour) demand += count * labour;
  }
  return demand;
}

/** Uniform proportional labour fulfilment in [0, 1]. 1 when nothing demands labour. */
export function labourFulfillment(population: number, demand: number): number {
  if (demand <= 0) return 1;
  return Math.min(1, Math.max(0, population) / demand);
}

/** Σ count × effectiveSpaceCost across all building types (incl. housing). */
export function buildSpaceUsed(buildings: Record<string, number>): number {
  let used = 0;
  for (const [type, count] of Object.entries(buildings)) {
    used += count * effectiveSpaceCost(type);
  }
  return used;
}

/** popCap contribution from housing: count × popProvided. */
export function housingPopCap(buildings: Record<string, number>): number {
  const count = buildings[HOUSING_TYPE] ?? 0;
  const provided = BUILDING_TYPES[HOUSING_TYPE]?.popProvided ?? 0;
  return count * provided;
}

/**
 * Capacity-driven production rate for one good. Sums every production type
 * whose outputGood matches (1:1 today, many-to-one ready). InputGate = 1.
 */
export function buildingProduction(
  buildings: Record<string, number>,
  goodId: string,
  fulfillment: number,
): number {
  let rate = 0;
  for (const [type, count] of Object.entries(buildings)) {
    if (count <= 0) continue;
    const def = BUILDING_TYPES[type];
    if (def?.outputGood !== goodId) continue;
    rate += count * (def.outputPerUnit ?? 0) * fulfillment;
  }
  return rate;
}

/**
 * Per-good production + consumption for one system from its industrial base.
 * The read-service shape (mirrors `substrateGoodRates`), now capacity-driven on
 * the production axis; consumption stays perCapitaNeed × population.
 */
export function capacityGoodRates(
  buildings: Record<string, number>,
  population: number,
): SubstrateGoodRate[] {
  const fulfillment = labourFulfillment(population, labourDemand(buildings));
  const pop = Math.max(0, population);
  return GOOD_NAMES.map((goodId) => ({
    goodId,
    production: buildingProduction(buildings, goodId, fulfillment),
    consumption: (GOOD_CONSUMPTION[goodId] ?? 0) * pop,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts`
Expected: PASS (all groups).

- [ ] **Step 5: Verify the module loads with no DATABASE_URL (no prisma taint)**

Run: `npx vitest run lib/engine/__tests__/industry.test.ts lib/constants/__tests__/industry.test.ts`
Expected: PASS — confirms `lib/engine/industry.ts` and `lib/constants/industry.ts` pull no prisma into the unit graph.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/industry.ts lib/engine/__tests__/industry.test.ts
git commit -m "feat(economy): add capacity-driven production engine"
```

---

### Task 4: Generation seeding allocator (`lib/engine/industry-seed.ts`)

**Files:**
- Create: `lib/engine/industry-seed.ts`
- Test: `lib/engine/__tests__/industry-seed.test.ts`

**Interfaces:**
- Consumes: `BUILDING_TYPES`, `HOUSING_TYPE`, `PRODUCTION_BUILDING_TYPES`, `effectiveSpaceCost` from `@/lib/constants/industry`; `labourDemand`, `housingPopCap`, `buildSpaceUsed` from `@/lib/engine/industry`; `GOOD_TIER_BY_KEY` from `@/lib/constants/goods`; `GOOD_RECIPES` from `@/lib/constants/recipes`; `ResourceVector` from `@/lib/types/game`; `RNG` from `@/lib/engine/universe-gen`.
- Produces:
  - `interface AllocateInput { aggregate: ResourceVector; buildSpace: number; bodyBaselinePopCap: number; fill: number }`
  - `interface AllocateResult { buildings: Record<string, number>; buildSpace: number; popCap: number }`
  - `allocateIndustry(input: AllocateInput, rng: RNG): AllocateResult`

> **Design (spec §10, coarse):** allocate the space budget input-consistently — tier-0 extractors up to `min(deposit, spaceShare)`; tier-1+ only where their direct inputs are locally producible (don't build Smelters with no Ore path); housing sized so `popCap` ≥ the labour the production buildings demand. Scale everything by `fill`; never exceed `buildSpace`. The allocator's outputs and the four triangle knobs are the primary thing the simulator tunes (Task 12); the **tests assert invariants, not magic numbers**, so they survive retuning.

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/industry-seed.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { allocateIndustry } from "@/lib/engine/industry-seed";
import { buildSpaceUsed, labourDemand, housingPopCap } from "@/lib/engine/industry";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import { makeResourceVector } from "@/lib/engine/resources";
import { mulberry32 } from "@/lib/engine/universe-gen";

const richBody = {
  aggregate: makeResourceVector({ ore: 8, minerals: 6, arable: 4, water: 4, gas: 3, biomass: 3, radioactive: 1 }),
  buildSpace: 120,
  bodyBaselinePopCap: 1200,
};

describe("allocateIndustry", () => {
  it("never exceeds the build-space budget", () => {
    const r = allocateIndustry({ ...richBody, fill: 0.9 }, mulberry32(1));
    expect(buildSpaceUsed(r.buildings)).toBeLessThanOrEqual(r.buildSpace + 1e-6);
  });

  it("caps tier-0 extractor count at the deposit magnitude", () => {
    const r = allocateIndustry({ ...richBody, fill: 0.9 }, mulberry32(2));
    for (const goodId of Object.keys(GOOD_PRODUCTION)) {
      const resource = GOOD_PRODUCTION[goodId]?.resource;
      if (!resource) continue;
      expect(r.buildings[goodId] ?? 0, goodId).toBeLessThanOrEqual(richBody.aggregate[resource] + 1e-6);
    }
  });

  it("seeds labour supply ≈ demand (housing covers production labour within tolerance)", () => {
    const r = allocateIndustry({ ...richBody, fill: 0.8 }, mulberry32(3));
    const demand = labourDemand(r.buildings);
    if (demand > 0) {
      // popCap must be able to staff the built industry (supply ≥ demand at seed).
      expect(r.popCap).toBeGreaterThanOrEqual(demand * 0.9);
    }
  });

  it("recomputes popCap = bodyBaseline + housing contribution", () => {
    const r = allocateIndustry({ ...richBody, fill: 0.8 }, mulberry32(4));
    expect(r.popCap).toBeCloseTo(richBody.bodyBaselinePopCap + housingPopCap(r.buildings), 6);
  });

  it("does not build a manufacturer whose inputs have no local production path", () => {
    // A body with only arable: can produce food/textiles, not metals (needs ore).
    const arableOnly = {
      aggregate: makeResourceVector({ arable: 6, water: 3 }),
      buildSpace: 80,
      bodyBaselinePopCap: 600,
    };
    const r = allocateIndustry({ ...arableOnly, fill: 0.9 }, mulberry32(5));
    expect(r.buildings["metals"] ?? 0).toBe(0); // no ore deposit and no ore building → no metals
  });

  it("seeds a near-empty base at fill 0 and a fuller base at fill 0.9", () => {
    const low = allocateIndustry({ ...richBody, fill: 0.05 }, mulberry32(6));
    const high = allocateIndustry({ ...richBody, fill: 0.9 }, mulberry32(6));
    expect(buildSpaceUsed(high.buildings)).toBeGreaterThan(buildSpaceUsed(low.buildings));
  });

  it("is deterministic for a fixed seed", () => {
    const a = allocateIndustry({ ...richBody, fill: 0.7 }, mulberry32(42));
    const b = allocateIndustry({ ...richBody, fill: 0.7 }, mulberry32(42));
    expect(a.buildings).toEqual(b.buildings);
  });
});
```

> Confirm the import paths for `makeResourceVector` (`@/lib/engine/resources`) and the seeded RNG factory before running — search for `mulberry32` (it is the project's seeded RNG used across simulator tests) and adjust the import if its module differs.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/industry-seed.test.ts`
Expected: FAIL — `Cannot find module '@/lib/engine/industry-seed'`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/industry-seed.ts`:

```typescript
/**
 * Generation seeding allocator — pure, zero DB dependency.
 *
 * Distributes a system's build-space budget across extractors, manufacturers,
 * and housing into a partial, varied, self-consistent industrial base:
 *   1. tier-0 extractors up to min(deposit, space share)
 *   2. tier-1+ manufacturers only where their direct inputs are locally
 *      producible (input-consistent — no Smelters without an Ore path)
 *   3. housing sized so popCap can staff the production labour demanded
 *   4. everything scaled by a development-fill fraction, capped at buildSpace
 * Coarse by design — the four triangle knobs and this heuristic are the
 * primary simulator-tuned surface. Deterministic given the RNG.
 */
import type { ResourceVector } from "@/lib/types/game";
import type { RNG } from "@/lib/engine/universe-gen";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  PRODUCTION_BUILDING_TYPES,
  effectiveSpaceCost,
  DEFAULT_LABOUR_PER_UNIT,
  HOUSING_POP_PROVIDED,
} from "@/lib/constants/industry";
import { labourDemand, housingPopCap, buildSpaceUsed } from "@/lib/engine/industry";

export interface AllocateInput {
  /** System aggregate resource vector (tier-0 deposit caps). */
  aggregate: ResourceVector;
  /** Total build-space budget (Σ body BASE_SPACE × size × habitability). */
  buildSpace: number;
  /** popCap from bodies before housing (SP1 body baseline). */
  bodyBaselinePopCap: number;
  /** Development fill fraction in [0, 1] — varied by habitability at the caller. */
  fill: number;
}

export interface AllocateResult {
  buildings: Record<string, number>;
  buildSpace: number;
  popCap: number;
}

/** Fraction of the budget reserved for production vs housing before fill scaling. */
const PRODUCTION_SHARE = 0.6;
/** Per-manufacturer target count before fill scaling (coarse). */
const MANUFACTURER_BASE_COUNT = 2;

export function allocateIndustry(input: AllocateInput, rng: RNG): AllocateResult {
  const { aggregate, buildSpace, bodyBaselinePopCap } = input;
  const fill = Math.max(0, Math.min(1, input.fill));
  const buildings: Record<string, number> = {};

  // Budget split: most of the space goes to production, the rest to housing.
  const productionBudget = buildSpace * PRODUCTION_SHARE * fill;
  let productionUsed = 0;

  // 1) Tier-0 extractors — capped by deposit ∩ a per-resource space share.
  //    Light per-build jitter (deterministic via rng) varies the galaxy.
  for (const goodId of PRODUCTION_BUILDING_TYPES) {
    const def = BUILDING_TYPES[goodId];
    if (GOOD_TIER_BY_KEY[goodId] !== 0 || !def.resource) continue;
    const deposit = aggregate[def.resource] ?? 0;
    if (deposit <= 0) continue;
    const jitter = 0.85 + rng() * 0.3;
    const wanted = deposit * jitter;
    const cost = effectiveSpaceCost(goodId);
    const affordable = (productionBudget - productionUsed) / cost;
    const count = Math.max(0, Math.min(wanted, affordable));
    if (count > 0) {
      buildings[goodId] = count;
      productionUsed += count * cost;
    }
  }

  // 2) Tier-1+ manufacturers — only where every recipe input is locally
  //    producible (a tier-0 deposit, or a tier-1 input we just placed).
  //    Two passes so tier-2 can see tier-1 placements.
  for (let pass = 1; pass <= 2; pass++) {
    for (const goodId of PRODUCTION_BUILDING_TYPES) {
      const tier = GOOD_TIER_BY_KEY[goodId];
      if (tier === 0 || tier !== pass) continue;
      if ((buildings[goodId] ?? 0) > 0) continue;
      const recipe = GOOD_RECIPES[goodId] ?? {};
      const inputsLocal = Object.keys(recipe).every((input) => (buildings[input] ?? 0) > 0);
      if (!inputsLocal) continue;
      const jitter = 0.6 + rng() * 0.8;
      const wanted = MANUFACTURER_BASE_COUNT * jitter;
      const cost = effectiveSpaceCost(goodId);
      const affordable = (productionBudget - productionUsed) / cost;
      const count = Math.max(0, Math.min(wanted, affordable));
      if (count > 0) {
        buildings[goodId] = count;
        productionUsed += count * cost;
      }
    }
  }

  // 3) Housing — enough to staff the production labour demanded, within the
  //    remaining budget. popProvided < labourPerUnit forces a mixed build-out.
  const demand = labourDemand(buildings);
  const labourCovered = Math.min(bodyBaselinePopCap, demand);
  const labourShortfall = Math.max(0, demand - labourCovered);
  const housingWanted = labourShortfall / HOUSING_POP_PROVIDED;
  const housingCost = effectiveSpaceCost(HOUSING_TYPE);
  const housingAffordable = (buildSpace - buildSpaceUsedRaw(buildings)) / housingCost;
  const housingCount = Math.max(0, Math.min(housingWanted, housingAffordable));
  if (housingCount > 0) buildings[HOUSING_TYPE] = housingCount;

  const popCap = bodyBaselinePopCap + housingPopCap(buildings);
  return { buildings, buildSpace, popCap };
}

/** Internal: build-space used without importing the public symbol name twice. */
function buildSpaceUsedRaw(buildings: Record<string, number>): number {
  return buildSpaceUsed(buildings);
}
```

> `MANUFACTURER_BASE_COUNT`, `PRODUCTION_SHARE`, and the jitter bands are first-draft seeding heuristics; Task 12 tunes them against the simulator. The invariant tests above do not pin them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/industry-seed.test.ts`
Expected: PASS (all 7 invariants). If the "labour supply ≈ demand" test fails, the housing sizing in step 3 is the lever — it must cover `demand - bodyBaselinePopCap`.

- [ ] **Step 5: Run the full unit suite (Phase A regression gate)**

Run: `npx vitest run --project unit`
Expected: PASS — nothing is wired into the tick/seed yet, so all prior tests (1110+) stay green.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/industry-seed.ts lib/engine/__tests__/industry-seed.test.ts
git commit -m "feat(economy): add generation seeding allocator for the industrial base"
```

**→ Phase A complete. Open the Phase A PR into `feat/economy-sp3` (squash if subjects carry build-noise, else ff). Review against the quality checklist before Phase B.**

---

## Phase B — Wire generation/seed/sim, flip production to capacity-driven

> **Ordering invariant:** each task below leaves the suite green at its commit. Generation (Task 5) seeds buildings before any adapter reads them; fixtures (Task 6) seed buildings before the prisma-adapter integration test (Task 9) asserts capacity behaviour; the simulator world (Task 8) seeds buildings before the memory adapter flips (Task 7).

### Task 5: Extend generation — buildings + buildSpace + housing popCap

**Files:**
- Modify: `lib/engine/body-gen.ts` (`GeneratedSubstrate`, `generateSubstrate`)
- Modify: `lib/engine/universe-gen.ts` (`GeneratedSystem`, `generateSystems` pass-through)
- Test: `lib/engine/__tests__/body-gen.test.ts` (extend existing — confirm path first)

**Interfaces:**
- Consumes: `bodyBuildSpace` from `@/lib/engine/industry`; `allocateIndustry` from `@/lib/engine/industry-seed`.
- Produces: `GeneratedSubstrate` + `GeneratedSystem` gain `buildings: Record<string, number>` and `buildSpace: number`; `popCap`/`population` now reflect housing.

- [ ] **Step 1: Write the failing test**

Confirm the body-gen test path: `npx vitest run lib/engine/__tests__/body-gen.test.ts` (adjust path if it differs). Add to that file:

```typescript
import { bodyBuildSpace, housingPopCap, buildSpaceUsed } from "@/lib/engine/industry";

describe("generateSubstrate — industrial base", () => {
  it("emits a buildSpace equal to the sum of body contributions", () => {
    const sub = generateSubstrate(mulberry32(7));
    const expected = sub.bodies.reduce((s, b) => s + bodyBuildSpace(b.size, b.habitable), 0);
    expect(sub.buildSpace).toBeCloseTo(expected, 6);
  });

  it("emits a buildings map within the build-space budget", () => {
    const sub = generateSubstrate(mulberry32(8));
    expect(buildSpaceUsed(sub.buildings)).toBeLessThanOrEqual(sub.buildSpace + 1e-6);
  });

  it("folds housing into popCap (popCap ≥ body baseline)", () => {
    const sub = generateSubstrate(mulberry32(9));
    expect(sub.popCap).toBeGreaterThanOrEqual(housingPopCap(sub.buildings) - 1e-6);
  });

  it("seeds population at or below popCap", () => {
    const sub = generateSubstrate(mulberry32(10));
    expect(sub.population).toBeLessThanOrEqual(sub.popCap + 1e-6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/body-gen.test.ts`
Expected: FAIL — `sub.buildSpace`/`sub.buildings` undefined.

- [ ] **Step 3: Extend `GeneratedSubstrate` and `generateSubstrate`**

In `lib/engine/body-gen.ts`:

Add to the `GeneratedSubstrate` interface:

```typescript
  /** Total build-space budget — Σ body BASE_SPACE × size × habitability. */
  buildSpace: number;
  /** Seeded industrial base — buildingType → count. */
  buildings: Record<string, number>;
```

Add imports at the top:

```typescript
import { bodyBuildSpace } from "@/lib/engine/industry";
import { allocateIndustry } from "@/lib/engine/industry-seed";
```

Replace the population computation tail of `generateSubstrate` (currently computes `popCap`, `fill`, `population`, then `features`) so housing folds into popCap. The body baseline popCap stays `rawCap × POP_SCALE`; the allocator adds housing:

```typescript
  // ── Build-space + population ──
  const rawCap = bodies.reduce((sum, b) => sum + b.popCapWeight * b.size, 0);
  const bodyBaselinePopCap = rawCap * SUBSTRATE_GEN.POP_SCALE;
  const buildSpace = bodies.reduce((sum, b) => sum + bodyBuildSpace(b.size, b.habitable), 0);

  const popNorm = clamp(bodyBaselinePopCap / SUBSTRATE_GEN.POP_REF, 0, 1);
  const fill = clamp(
    SUBSTRATE_GEN.POP_FILL_BASE
      + SUBSTRATE_GEN.POP_FILL_SLOPE * popNorm
      + (rng() - 0.5) * SUBSTRATE_GEN.POP_FILL_JITTER,
    SUBSTRATE_GEN.POP_FILL_MIN,
    SUBSTRATE_GEN.POP_FILL_MAX,
  );

  const allocation = allocateIndustry(
    { aggregate, buildSpace, bodyBaselinePopCap, fill },
    rng,
  );
  const popCap = allocation.popCap;
  const population = Math.round(popCap * fill);

  const features = rollFeatures(rng);

  return {
    sunClass,
    bodies,
    aggregate,
    popCap,
    population,
    bodyDanger,
    features,
    buildSpace,
    buildings: allocation.buildings,
  };
```

> The `fill` curve still keys off the body-baseline popCap (development proxy) — developed worlds seed near capacity, frontier near-empty, producing instant economic geography (spec §10 step 2). `allocateIndustry` consumes the same `fill`.

- [ ] **Step 4: Extend `GeneratedSystem` and `generateSystems`**

In `lib/engine/universe-gen.ts`:

Add to the `GeneratedSystem` interface (near `popCap` / `bodyDanger`):

```typescript
  /** Total build-space budget. */
  buildSpace: number;
  /** Seeded industrial base — buildingType → count. */
  buildings: Record<string, number>;
```

In `generateSystems`, in the `systems.push({...})` literal, add the pass-through fields (alongside `popCap: substrate.popCap`):

```typescript
      buildSpace: substrate.buildSpace,
      buildings: substrate.buildings,
```

- [ ] **Step 5: Run the tests + type-check**

Run: `npx vitest run lib/engine/__tests__/body-gen.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: FAIL only at the consumers that must now supply `buildSpace`/`buildings` — note them; they are wired in Tasks 6–8. If any *engine* test breaks because popCap shifted, fix the test's expectation (the new model includes housing).

- [ ] **Step 6: Commit**

```bash
git add lib/engine/body-gen.ts lib/engine/universe-gen.ts lib/engine/__tests__/body-gen.test.ts
git commit -m "feat(economy): seed build space and an industrial base at world-gen"
```

---

### Task 6: Seed `SystemBuilding` rows + `buildSpace` (live seed + fixtures)

**Files:**
- Modify: `prisma/seed.ts`
- Modify: `lib/test-utils/fixtures.ts`

**Interfaces:**
- Consumes: `GeneratedSystem.buildSpace` / `.buildings`; the chunked-insert helpers `createManyChunked` / `createManyAndReturnChunked` already in `seed.ts`.
- Produces: persisted `StarSystem.buildSpace` + one `SystemBuilding` row per `(system, buildingType)` with `count > 0`.

- [ ] **Step 1: Write `buildSpace` onto systems in `prisma/seed.ts`**

In the `prisma.starSystem.createManyAndReturn({ data: batch.map((sys) => ({ ... })) })` block, add to the per-system object (next to `popCap: sys.popCap`):

```typescript
        buildSpace: sys.buildSpace,
```

- [ ] **Step 2: Create `SystemBuilding` rows (batched) in `prisma/seed.ts`**

After the bodies seeding block (`await createManyChunked(bodyData, ...)`), add:

```typescript
  // ── Seed industrial base (batched) — one row per (system, buildingType) present ──
  const buildingData = universe.systems.flatMap((sys) =>
    Object.entries(sys.buildings)
      .filter(([, count]) => count > 0)
      .map(([buildingType, count]) => ({
        systemId: systemIds[sys.index],
        buildingType,
        count,
      })),
  );
  await createManyChunked(buildingData, (batch) =>
    prisma.systemBuilding.createMany({ data: batch }),
  );
```

> Confirm `systemIds`/`sys.index` are the exact symbols used by the bodies block above and reuse them verbatim (the bodies block uses `systemId: systemIds[sys.index]`).

- [ ] **Step 3: Seed buildings + buildSpace in `lib/test-utils/fixtures.ts`**

The fixtures build three test systems from explicit substrates (`agriSubstrate`, `indSubstrate`, `techSubstrate`). For each, derive a seeded industrial base so integration tests have buildings. Add an import:

```typescript
import { allocateIndustry } from "@/lib/engine/industry-seed";
import { mulberry32 } from "@/lib/engine/universe-gen";
```

For each test system, before its `prisma.starSystem.create(...)`, compute an allocation (use a fixed seed + a coarse buildSpace so tests are deterministic):

```typescript
  const agriAllocation = allocateIndustry(
    { aggregate: agriSubstrate.aggregate, buildSpace: 120, bodyBaselinePopCap: agriSubstrate.population, fill: 0.8 },
    mulberry32(101),
  );
```

Add `buildSpace: agriAllocation.buildSpace` to the `data` of `agriSystem`'s `create` (and the equivalent for the industrial + tech systems with their own allocations + distinct seeds). After the systems are created, batch-create their buildings:

```typescript
  const fixtureBuildingData = [
    { systemId: agriSystem.id, buildings: agriAllocation.buildings },
    { systemId: indSystem.id, buildings: indAllocation.buildings },
    { systemId: techSystem.id, buildings: techAllocation.buildings },
  ].flatMap(({ systemId, buildings }) =>
    Object.entries(buildings)
      .filter(([, count]) => count > 0)
      .map(([buildingType, count]) => ({ systemId, buildingType, count })),
  );
  await prisma.systemBuilding.createMany({ data: fixtureBuildingData });
```

> Match the exact variable names the fixtures use (`agriSystem`, `indSystem` or `industrialSystem`, `techSystem`) — read the file first and adapt. Verify `mulberry32` import path.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS for seed.ts + fixtures.ts (generation now supplies `buildSpace`/`buildings`; the simulator world and adapters are still pending — Tasks 7–8 — so simulator-world type errors may remain; that is expected until Task 8).

- [ ] **Step 5: Reseed the database (smoke)**

Run: `npx prisma db push --force-reset && npx prisma db seed`
Expected: seed completes; no `P2020`/`ValueOutOfRange`; `SystemBuilding` rows created. (At default scale this is fast; at 10K it exercises the chunked path.)

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts lib/test-utils/fixtures.ts
git commit -m "feat(economy): seed SystemBuilding rows and buildSpace"
```

---

### Task 7: Simulator `SimSystem.buildings` + world seeding

**Files:**
- Modify: `lib/engine/simulator/types.ts` (`SimSystem`)
- Modify: `lib/engine/simulator/world.ts` (`createSimWorld`)

**Interfaces:**
- Produces: `SimSystem.buildings: Record<string, number>`, seeded from `GeneratedSystem.buildings` in `createSimWorld`.

- [ ] **Step 1: Add `buildings` to `SimSystem`**

In `lib/engine/simulator/types.ts`, in the `SimSystem` interface (after `unrest`):

```typescript
  /** Seeded industrial base — buildingType → count. Static at runtime. */
  buildings: Record<string, number>;
```

- [ ] **Step 2: Seed it in `createSimWorld`**

In `lib/engine/simulator/world.ts`, in the `universe.systems.map((s, i) => ({ ... }))` system literal, add (after `unrest: 0`):

```typescript
      buildings: s.buildings,
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: the only remaining errors are in the memory economy adapter (Task 8) which will read `sys.buildings`. SimSystem now satisfies the new field.

- [ ] **Step 4: Commit**

```bash
git add lib/engine/simulator/types.ts lib/engine/simulator/world.ts
git commit -m "feat(economy): carry the industrial base into the simulator world"
```

---

### Task 8: Memory economy adapter — capacity-driven production

**Files:**
- Modify: `lib/tick/adapters/memory/economy.ts`
- Test: `lib/tick/adapters/memory/__tests__/economy.test.ts` (confirm path; create if absent)

**Interfaces:**
- Consumes: `labourDemand`, `labourFulfillment`, `buildingProduction` from `@/lib/engine/industry`; `consumptionRate` from `@/lib/engine/physical-economy` (Task adds it — see step 3); `SimSystem.buildings`.
- Produces: `MarketView.baseProductionRate` from buildings; `baseConsumptionRate` unchanged.

- [ ] **Step 1: Add a consumption-only helper to `physical-economy.ts`**

In `lib/engine/physical-economy.ts`, add (and refactor `physicalRates` to use it, keeping its behaviour identical):

```typescript
/** Population-scaled consumption rate for a good: perCapitaNeed × population. */
export function consumptionRate(goodId: string, population: number): number {
  const need = GOOD_CONSUMPTION[goodId] ?? 0;
  return need * Math.max(0, population);
}
```

Then in `physicalRates`, replace the consumption lines with `const consumption = consumptionRate(goodId, population);`. Run `npx vitest run lib/engine/__tests__/physical-economy.test.ts` — expected PASS (no behaviour change).

- [ ] **Step 2: Write the failing adapter test**

Create/extend `lib/tick/adapters/memory/__tests__/economy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { buildingProduction, labourFulfillment, labourDemand } from "@/lib/engine/industry";
import { OUTPUT_PER_UNIT } from "@/lib/constants/industry";
import { makeResourceVector } from "@/lib/engine/resources";
import type { SimSystem, SimMarketEntry, SimRegion } from "@/lib/engine/simulator/types";

function sys(overrides: Partial<SimSystem>): SimSystem {
  return {
    id: "s1", name: "S1", economyType: "extraction", regionId: "r1",
    factionId: "f1", governmentType: "frontier",
    aggregate: makeResourceVector({ ore: 8 }), population: 1000, popCap: 1200,
    traits: [], bodyDanger: 0, unrest: 0, buildings: { ore: 5 },
    ...overrides,
  };
}

const region: SimRegion = { id: "r1", name: "R1" };
const market = (goodId: string): SimMarketEntry => ({
  systemId: "s1", goodId, basePrice: 35, stock: 100, anchorMult: 1,
  demandRate: 1, priceFloor: 0.5, priceCeiling: 2,
});

describe("InMemoryEconomyWorld — capacity-driven production", () => {
  it("derives baseProductionRate from buildings × outputPerUnit × labourFulfillment", async () => {
    const world = new InMemoryEconomyWorld(
      { systems: [sys({})], markets: [market("ore")], modifiers: [] },
      [region],
    );
    const views = await world.getMarketsForRegion("r1");
    const ore = views.find((v) => v.goodId === "ore")!;
    const fulfillment = labourFulfillment(1000, labourDemand({ ore: 5 }));
    expect(ore.baseProductionRate).toBeCloseTo(buildingProduction({ ore: 5 }, "ore", fulfillment), 6);
  });

  it("produces nothing for a good with no buildings", async () => {
    const world = new InMemoryEconomyWorld(
      { systems: [sys({ buildings: {} })], markets: [market("ore")], modifiers: [] },
      [region],
    );
    const views = await world.getMarketsForRegion("r1");
    expect(views[0].baseProductionRate).toBeUndefined();
  });

  it("throttles output when population cannot staff the buildings", async () => {
    const staffed = new InMemoryEconomyWorld(
      { systems: [sys({ population: 100000 })], markets: [market("ore")], modifiers: [] }, [region],
    );
    const starved = new InMemoryEconomyWorld(
      { systems: [sys({ population: 1 })], markets: [market("ore")], modifiers: [] }, [region],
    );
    const a = (await staffed.getMarketsForRegion("r1"))[0].baseProductionRate ?? 0;
    const b = (await starved.getMarketsForRegion("r1"))[0].baseProductionRate ?? 0;
    expect(a).toBeGreaterThan(b);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/tick/adapters/memory/__tests__/economy.test.ts`
Expected: FAIL — production still computed from `physicalRates` (ore would still produce via deposit×labour, but the exact value won't match `buildingProduction`, and the no-buildings case still produces).

- [ ] **Step 4: Flip the adapter**

In `lib/tick/adapters/memory/economy.ts`:

Replace the import of `physicalRates`:

```typescript
import { consumptionRate } from "@/lib/engine/physical-economy";
import { labourDemand, labourFulfillment, buildingProduction } from "@/lib/engine/industry";
```

Rewrite the production/consumption derivation inside `getMarketsForRegion`. Compute `labourFulfillment` once per system (cache by systemId), then per market:

```typescript
  getMarketsForRegion(regionId: string): Promise<MarketView[]> {
    const sysById = new Map(this.systems.map((s) => [s.id, s]));
    const fulfillmentBySystem = new Map<string, number>();
    const views: MarketView[] = [];
    for (const m of this.markets) {
      const sys = sysById.get(m.systemId);
      if (!sys || sys.regionId !== regionId) continue;
      let fulfillment = fulfillmentBySystem.get(sys.id);
      if (fulfillment === undefined) {
        fulfillment = labourFulfillment(sys.population, labourDemand(sys.buildings));
        fulfillmentBySystem.set(sys.id, fulfillment);
      }
      const production = buildingProduction(sys.buildings, m.goodId, fulfillment);
      const consumption = consumptionRate(m.goodId, sys.population);
      views.push({
        id: `${m.systemId}|${m.goodId}`,
        systemId: m.systemId,
        goodId: m.goodId,
        basePrice: m.basePrice,
        stock: m.stock,
        governmentType: sys.governmentType,
        baseProductionRate: production > 0 ? production : undefined,
        baseConsumptionRate: consumption > 0 ? consumption : undefined,
        traits: sys.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })),
      });
    }
    return Promise.resolve(views);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/tick/adapters/memory/__tests__/economy.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the simulator unit test (regression)**

Run: `npx vitest run lib/engine/simulator`
Expected: PASS — the simulator now models capacity-driven production. Some equilibrium-shape assertions may shift; if a test pins exact stock/price magnitudes that the new model changes, update it to assert direction-of-travel (per the project's `economy.integration.test.ts` convention). Note any genuinely broken target for Task 12.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/physical-economy.ts lib/tick/adapters/memory/economy.ts lib/tick/adapters/memory/__tests__/economy.test.ts
git commit -m "feat(economy): capacity-driven production in the in-memory adapter"
```

---

### Task 9: Prisma economy adapter — load buildings + capacity-driven production

**Files:**
- Modify: `lib/tick/adapters/prisma/economy.ts`
- Test: `lib/tick/processors/__tests__/integration/economy.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `labourDemand`, `labourFulfillment`, `buildingProduction` from `@/lib/engine/industry`; `consumptionRate` from `@/lib/engine/physical-economy`; the seeded `SystemBuilding` rows (via fixtures, Task 6).
- Produces: `MarketView.baseProductionRate` from buildings.

- [ ] **Step 1: Write the failing integration test**

Extend `economy.integration.test.ts` with a test that a system holding extractors raises that good's stock, and a system with no buildings for a good does not produce it:

```typescript
  it("raises stock for a good the system has buildings for, but not for one it lacks", async () => {
    // Fixtures seed each test system's industrial base via allocateIndustry.
    // The agricultural system has food/textiles extractors (arable deposit) but
    // no weapons plant — assert food climbs while weapons does not.
    const foodGoodId = universe.goodIds["food"];
    const weaponsGoodId = universe.goodIds["weapons"];
    const station = universe.stations.agricultural;

    await prisma.stationMarket.updateMany({
      where: { stationId: station.id, goodId: { in: [foodGoodId, weaponsGoodId] } },
      data: { stock: 50 },
    });

    // Run enough ticks that the agricultural region is processed several times.
    for (let t = 0; t < 60; t++) await runProcessor(t);

    const food = await prisma.stationMarket.findFirstOrThrow({ where: { stationId: station.id, goodId: foodGoodId } });
    const weapons = await prisma.stationMarket.findFirstOrThrow({ where: { stationId: station.id, goodId: weaponsGoodId } });
    expect(food.stock).toBeGreaterThan(50);   // produced (has food buildings)
    expect(weapons.stock).toBeLessThanOrEqual(55); // not produced (no weapons plant) — drifts on consumption/noise only
  });
```

> Confirm `universe.goodIds` / `universe.stations` shapes against the existing `seedTestUniverse` helper and the agricultural fixture's allocated buildings (it seeds from `agriSubstrate.aggregate = { arable, water, biomass }`, so it gets food/textiles/water extractors, no ore→metals chain, no weapons). Adjust the good pair if the agricultural allocation differs.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project integration economy.integration`
Expected: FAIL — the prisma adapter still uses `physicalRates`, so `weapons` (labour-only, tier-2) would also produce.

- [ ] **Step 3: Flip the prisma adapter**

In `lib/tick/adapters/prisma/economy.ts`:

Replace the `physicalRates` import:

```typescript
import { consumptionRate } from "@/lib/engine/physical-economy";
import { labourDemand, labourFulfillment, buildingProduction } from "@/lib/engine/industry";
```

In `getMarketsForRegion`, load the region's buildings once and build a `Map<systemId, Record<buildingType, count>>`, then compute per-system fulfilment and per-market production. Add the building query alongside the existing `stationMarket.findMany`:

```typescript
    const buildingRows = await this.tx.systemBuilding.findMany({
      where: { system: { regionId } },
      select: { systemId: true, buildingType: true, count: true },
    });
    const buildingsBySystem = new Map<string, Record<string, number>>();
    for (const b of buildingRows) {
      const map = buildingsBySystem.get(b.systemId) ?? {};
      map[b.buildingType] = b.count;
      buildingsBySystem.set(b.systemId, map);
    }
    const fulfillmentBySystem = new Map<string, number>();
```

Then replace the per-row production/consumption derivation (the `physicalRates(...)` line and the two `baseProductionRate`/`baseConsumptionRate` fields) with:

```typescript
      const buildings = buildingsBySystem.get(sys.id) ?? {};
      let fulfillment = fulfillmentBySystem.get(sys.id);
      if (fulfillment === undefined) {
        fulfillment = labourFulfillment(sys.population, labourDemand(buildings));
        fulfillmentBySystem.set(sys.id, fulfillment);
      }
      const goodKey = GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name;
      const production = buildingProduction(buildings, goodKey, fulfillment);
      const consumption = consumptionRate(goodKey, sys.population);
```

(Keep the `aggregate`/`resourceVectorFromColumns` block only if still needed elsewhere — production no longer uses it, so the `aggBySystem` cache and the `resourceVectorFromColumns` import can be removed. Remove them to avoid dead code; the `agg*` columns stay in the schema for `getInitialStock` seeding.) Leave `baseProductionRate: production > 0 ? production : undefined` and `baseConsumptionRate: consumption > 0 ? consumption : undefined`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project integration economy.integration`
Expected: PASS.

- [ ] **Step 5: Run the full integration suite (regression)**

Run: `npx vitest run --project integration`
Expected: PASS (93+). Fix any test pinning exact production magnitudes to assert direction-of-travel.

- [ ] **Step 6: Commit**

```bash
git add lib/tick/adapters/prisma/economy.ts lib/tick/processors/__tests__/integration/economy.integration.test.ts
git commit -m "feat(economy): capacity-driven production in the prisma adapter"
```

---

### Task 10: Read service — capacity-driven production display

**Files:**
- Modify: `lib/services/universe.ts` (the system detail read, ~line 294)

**Interfaces:**
- Consumes: `capacityGoodRates` from `@/lib/engine/industry`; `SystemBuilding` rows for the system.
- Produces: the read service `goods` field shows capacity-driven production (matches the tick).

- [ ] **Step 1: Load the system's buildings in the read service**

In `lib/services/universe.ts`, wherever the system detail is loaded, include its buildings. If the system is fetched via `prisma.starSystem.findUnique/findFirst`, add `buildings: { select: { buildingType: true, count: true } }` to the `include`. Build a `Record<string, number>`:

```typescript
    const buildings: Record<string, number> = {};
    for (const b of system.buildings) buildings[b.buildingType] = b.count;
```

- [ ] **Step 2: Swap `substrateGoodRates` → `capacityGoodRates`**

Replace the import and the call:

```typescript
import { capacityGoodRates } from "@/lib/engine/industry";
```

```typescript
    goods: capacityGoodRates(buildings, system.population),
```

(Leave `substrateGoodRates`/`physicalRates` in `physical-economy.ts` — still used by `getInitialStock`.)

- [ ] **Step 3: Type-check + targeted test**

Run: `npx tsc --noEmit`
Expected: PASS.

If a universe-service test asserts on `goods`, run it and update expectations to the capacity model:
Run: `npx vitest run lib/services` (adjust to the actual test path) — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/services/universe.ts
git commit -m "feat(economy): show capacity-driven production in the system read service"
```

---

### Task 11: Phase B regression gate

**Files:** none (verification only)

- [ ] **Step 1: Full unit + integration suites**

Run: `npx vitest run --project unit`
Expected: PASS (all). Note the count vs the Phase A baseline (~1110+).

Run: `npx vitest run --project integration`
Expected: PASS (93+).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — zero errors across the repo.

- [ ] **Step 3: Sanity simulation (does it run end-to-end?)**

Run: `npm run simulate`
Expected: completes without crashing; prints strategy summaries. Equilibrium targets may not yet be hit — that is Task 12. Capture the output (stocks, price dispersion, population trend) as the calibration baseline.

- [ ] **Step 4: Commit (if any test fixups were needed)**

```bash
git add -A
git commit -m "test(economy): align expectations with capacity-driven production"
```

**→ Phase B complete. Open the Phase B PR into `feat/economy-sp3`. The industrial base is live and internally consistent; calibration follows.**

---

## Phase C — Coarse calibration + docs

### Task 12: Simulator-driven coarse calibration of the triangle

**Files:**
- Modify (calibration values only): `lib/constants/industry.ts` (`BASE_SPACE`, `HABITABILITY_FACTOR`, `OUTPUT_PER_UNIT`, `DEFAULT_LABOUR_PER_UNIT`, `HOUSING_POP_PROVIDED`), `lib/engine/industry-seed.ts` (`PRODUCTION_SHARE`, `MANUFACTURER_BASE_COUNT`, jitter bands)
- Optional: extend `lib/engine/simulator/` market-health reporting with build-space utilisation + labour fulfilment metrics if the existing output is insufficient to judge the targets.

**Targets (spec §13 — coarse; do not over-tune):**
1. **Triangle stability** — seeded systems sit at labour supply ≈ demand; `buildSpaceUsed ≤ buildSpace`; no system seeded starved (fulfilment ≪ 1) or fully idle at tick 0.
2. **Specialisation emerges** — production profiles diverge by build-space allocation; resource-rich → core raw flows and core → frontier manufactured flows are visible in trade activity / price dispersion.
3. **Cascades not in scope** (Part 3) — but confirm no runaway: stocks stay in `[5, 200]`; population stable-but-growing (SP2 target) over the run.
4. **Existing targets hold** — greedy strategy ≫ random; cross-system price dispersion present; population does not collapse.

- [ ] **Step 1: Establish the baseline**

Run: `npm run simulate -- --json` and save to a scratch file. Record: final stock distribution (any pinned at 5 or 200?), price dispersion per tier, total population trend (growing/stable/collapsing), greedy-vs-random gap, and (if instrumented) mean labour fulfilment + build-space utilisation across systems.

- [ ] **Step 2: Add a calibration experiment config (if useful)**

Create `experiments/sp3-industrial-base.yaml` mirroring the existing example configs (label, seed 42, ticks 500, a greedy + random + balanced bot mix). Run: `npm run simulate -- --config experiments/sp3-industrial-base.yaml`.

- [ ] **Step 3: Tune toward the targets (iterate)**

Adjust, in order of leverage, re-running `npm run simulate` after each change:
- **Labour fulfilment ≪ 1 at seed** → housing under-seeded: raise `HOUSING_POP_PROVIDED` or the housing target in `allocateIndustry` step 3, or lower `DEFAULT_LABOUR_PER_UNIT`.
- **Stocks pinned at 200 (overproduction)** → lower `OUTPUT_PER_UNIT` for the offending tier, or lower `MANUFACTURER_BASE_COUNT` / tier-0 deposit jitter.
- **Stocks pinned at 5 (underproduction)** → raise the relevant `OUTPUT_PER_UNIT`, or raise `BASE_SPACE` / `PRODUCTION_SHARE` so more buildings seed.
- **No specialisation (every system looks the same)** → widen the `fill` spread (already keyed to popNorm) and confirm tier-0 deposit caps bite — the deposit cap is what makes resource-poor worlds import.
- **Population collapse** → production too low vs consumption; raise output or lower per-capita need is out of scope (SP1 table) — prefer raising output / build space.

Each iteration: change a constant, run `npm run simulate`, compare to targets. **Stop when targets are coarsely met** — the spec forbids over-tuning (SP5 reshapes the equilibrium).

- [ ] **Step 4: Re-run the allocator invariant tests**

Run: `npx vitest run lib/engine/__tests__/industry-seed.test.ts`
Expected: PASS — the invariant tests (not magic numbers) must still hold after retuning. If a constant change broke an invariant, the allocator logic (not the test) needs adjusting.

- [ ] **Step 5: Full suite + final simulate**

Run: `npx vitest run` (both projects) — Expected: PASS.
Run: `npm run simulate` — Expected: targets coarsely met; capture the final numbers for the commit message / docs.

- [ ] **Step 6: Commit**

```bash
git add lib/constants/industry.ts lib/engine/industry-seed.ts experiments/sp3-industrial-base.yaml lib/engine/simulator
git commit -m "feat(economy): calibrate the build-space/labour/pop triangle"
```

---

### Task 13: Update active docs

**Files:**
- Modify: `docs/active/gameplay/economy.md`
- Modify: `docs/active/gameplay/system-traits.md`
- Modify: `docs/SPEC.md` (Economy paragraph)

> Do **not** move `docs/planned/economy-simulation-supply-chain.md` to `active/` yet — SP3 is not fully shipped until Part 3. Do **not** delete this plan yet (the spec/CLAUDE.md say delete the build plan once the *feature* ships, i.e. after Part 3). These doc edits update the already-active economy spec to describe the new production model.

- [ ] **Step 1: Update `economy.md` production section**

Replace the `prodRate = coeff × labourFactor(population) × ...` description with the capacity-driven model: `production_g = Σ buildings × outputPerUnit × labourFulfillment`; `labourFulfillment = min(1, population / Σ count × labourPerUnit)`; tier-0 extractor count capped by deposit ∩ build space; tier-1+ space/labour bound (recipes inert until input-gating); housing → `popCap = bodyBaseline + Σ housing × popProvided`; the build-space budget per body. Note `labourFactor` survives only in the `getInitialStock` seed-cover heuristic. Keep the `[PENDING: …]` convention for the Part 3 input-gating cascade.

- [ ] **Step 2: Update `system-traits.md`**

Note the new physical state: `StarSystem.buildSpace` (denormalized from bodies, like `agg*`), the `SystemBuilding` per-`(system, buildingType)` count table (seeded-static), and that `popCap` now includes housing. Economy-type label is now differentiated by build-space allocation.

- [ ] **Step 3: Update `docs/SPEC.md`**

In the Economy paragraph, change "Production and consumption derive directly from each system's physical substrate — resource-driven production for raw goods (deposits × labour)" to reflect capacity-driven production from a seeded industrial base bounded by build space, with population as the labour pool. Keep it to 1–2 sentences consistent with the section's altitude.

- [ ] **Step 4: Commit**

```bash
git add docs/active/gameplay/economy.md docs/active/gameplay/system-traits.md docs/SPEC.md
git commit -m "docs(economy): document capacity-driven production and build space"
```

**→ Phase C complete. Open the Phase C PR into `feat/economy-sp3`. SP3 Part 2 is done; Part 3 (input-gating cascade) is next. Do NOT merge `feat/economy-sp3` → main until Part 3 lands.**

---

## Self-Review (run before executing)

**Spec coverage (vs `economy-simulation-supply-chain.md` Part 2 row, §4–§6, §10):**
- `SystemBuilding` table + `StarSystem.buildSpace` → Task 1. ✓
- Four building properties (`outputGood`, `inputs`, `spaceCost`, `labourPerUnit`, `popProvided`) + `spaceCost` modifier hook → Task 2 (`effectiveSpaceCost`). ✓
- Capacity-driven production replacing `labourFactor` → Tasks 3, 8, 9. ✓
- Uniform labour fulfilment (`min(1, pop/labourDemand)`) → Task 3 (`labourFulfillment`). ✓
- Housing → `popCap = bodyBaseline + Σ housing × popProvided` → Tasks 3 (`housingPopCap`), 5 (gen). ✓
- Generation-seeding allocator → Task 4; wired in Tasks 5, 6, 7. ✓
- Build-space budget per body (`BASE_SPACE × size × habitability`), tier-0 deposit cap → Tasks 2, 3 (`bodyBuildSpace`), 4 (deposit cap). ✓
- Tier-1+ un-gated (recipes inert) → recipes carried as `inputs` but never applied in `buildingProduction`. ✓
- No new processor / unchanged `EconomyWorld` interface (spec §11) → adapters compute production; processor untouched. ✓ (Architecture note explains the Part 2/3 boundary on tier-ordering.)
- Reseed + simulator recalibration (coarse) → Tasks 6 (reseed), 12 (calibrate). ✓
- UI readouts are Part 3 → only the existing read-service `goods` field is kept honest (Task 10); no new UI. ✓

**Placeholder scan:** no "TBD"/"handle edge cases"/"similar to Task N" — each step shows the code or the exact command + expected output. Calibration numbers are explicitly first-draft with the tuning task (12) owning them. ✓

**Type consistency:** `buildings: Record<string, number>` is the single shape across allocator output, `GeneratedSubstrate`, `GeneratedSystem`, `SimSystem`, both adapters, and the read service. `labourFulfillment(population, demand)`, `buildingProduction(buildings, goodId, fulfillment)`, `labourDemand(buildings)`, `housingPopCap(buildings)`, `buildSpaceUsed(buildings)`, `bodyBuildSpace(size, habitable)`, `capacityGoodRates(buildings, population)`, `allocateIndustry(input, rng)` — signatures match between definition (Tasks 2–4) and every call site (Tasks 5–10). `effectiveSpaceCost(buildingType)` is the only space-cost accessor. ✓

**Confirmed import paths:** `mulberry32` → `@/lib/engine/universe-gen` (Tasks 4, 6); `makeResourceVector` → `@/lib/engine/resources` (Tasks 4, 8); body-gen test → `lib/engine/__tests__/body-gen.test.ts` exists (Task 5).

**Open verification points for the executor (confirm against the real files, do not assume):**
- Exact fixture variable names in `lib/test-utils/fixtures.ts` (`indSystem` vs `industrialSystem`) and the `seedTestUniverse` `goodIds`/`stations` shapes (Tasks 6, 9).
- The exact `prisma/seed.ts` symbols `systemIds` / `sys.index` reused for buildings (Task 6).
- Whether `body-gen.test.ts` already imports `generateSubstrate` + `mulberry32` (it should) — reuse its existing imports when extending it (Task 5).
