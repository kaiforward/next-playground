# Economy Simulation — SP1 PR3a: Build the New Universe & Reseed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace trait-based universe generation with the physical substrate (sun → bodies → resource vectors → features → population), persist it via a batched seed, full reseed, and keep the economy running unchanged through a derived economy-type **shim** — additively, with no `TraitId` narrowing and no new migration.

**Architecture:** A new pure `body-gen.ts` rolls the substrate per system; a new pure `economy-shim.ts` derives the legacy `EconomyType` label from the aggregate + population. `generateSystems` is rewritten to call them; `GeneratedSystem` gains `sunClass`/`bodies`/`aggregate`/`popCap`/`population` and its `traits` become the rolled features. `prisma/seed.ts` is rewritten to persist the substrate in chunked batches. The economy engine, tick, adapters, simulator wiring, `TRAITS` catalog, and `TraitId` are untouched — the game plays via the shim.

**Tech Stack:** Next.js 16, TypeScript 5 (strict, no `as`/`unknown`), Prisma 7 (`prisma-client` + `@prisma/adapter-pg`), PostgreSQL, Vitest 4. Seeded determinism via `mulberry32`.

---

## Context

This is **PR3a** of SP1 Part 1, per [the PR3 design](./economy-simulation-sp1-pr3-design.md) and the
[SP1 substrate spec](../planned/economy-simulation-substrate.md). PR1 (foundation) + PR2 (detach consumers) have
shipped to the shared `feat/economy-simulation` branch. PR3a is **additive + reseed** (this plan). PR3b (prune
`TraitId`, strip economy fields, rewire LOCATIONS to bodies, danger-from-bodies, add DB guards) is a **separate
plan authored after PR3a ships**.

Work on a phase branch off the shared branch, PR into the shared branch (per the workflow convention):

```bash
git checkout feat/economy-simulation
git checkout -b feat/economy-simulation-pr3a
```

### Decisions locked (from the PR3 design)

- **2-PR split** (PR3a build+reseed → PR3b prune+reconnect); **IID sun rolls**; **coherent + healthy** economy
  bar (not byte-identical); **0–2 features**; **trait production bonus retired in PR3b** (kept here);
  **danger-from-bodies in PR3b**.
- **Guards + `resourceVectorFromColumns` deferred to PR3b** — PR3a never reads the substrate back from the DB, so
  those helpers would be dead code now. PR3a's bridge is **writes + aggregate only**.
- No new migration: PR1 already added every column (`StarSystem.sunClass/population/popCap/agg*`, `SystemBody.*`).

### Conventions (enforced — see `CLAUDE.md`)

- **No `as`** except `as const` / `lib/types/guards.ts`. The new code avoids it by iterating typed constant
  values (`Object.values(SUN_CLASSES)` whose `.id` is already `SunClass`, etc.) instead of casting string keys.
- **No `unknown` / `Record<string, unknown>`.** Typed unions only.
- Engine helpers pure (zero DB import), Vitest-tested. Discriminated/typed data.
- **Frequent commits** — one per task.

---

## File structure (PR3a)

**Create:**
- `lib/constants/substrate-gen.ts` — `SUBSTRATE_GEN` tuning constants (size band, jitter, richness chance, pop
  scale/ref/fill curve, feature-count band, shim thresholds).
- `lib/engine/economy-shim.ts` — `deriveEconomyTypeLabel(aggregate, population) → EconomyType` (deleted in Part 2).
- `lib/engine/body-gen.ts` — `generateSubstrate(rng)` + `GeneratedBody`/`GeneratedSubstrate`/`FEATURE_TRAIT_IDS`.
- `lib/engine/__tests__/economy-shim.test.ts`, `lib/engine/__tests__/body-gen.test.ts`.
- `scripts/substrate-coherence.ts` — one-off galaxy resource-mix/economy-distribution report (verification).

**Modify:**
- `lib/engine/resources.ts` — add `aggregateColumns`, `bodyResourceColumns`, `sumResourceVectors`.
- `lib/engine/__tests__/resources.test.ts` — tests for the three new helpers.
- `lib/engine/universe-gen.ts` — rewrite `generateSystems`; extend `GeneratedSystem`.
- `lib/engine/__tests__/universe-gen.test.ts` — rewrite the `generateSystems` describe block.
- `lib/engine/trait-gen.ts` — remove `generateSystemTraits`, `deriveEconomyType`, `STRONG_AFFINITY_TRAIT_IDS`.
- `lib/engine/__tests__/trait-gen.test.ts` — drop the two removed-function describe blocks.
- `prisma/seed.ts` — batched substrate persistence + full reseed.

**Untouched (proves "keep running"):** `lib/constants/traits.ts` (full 52-trait catalog), `TraitId`
(`lib/types/game.ts`), `lib/constants/locations.ts`, the economy engine/tick/adapters, `computeSystemDanger`,
`computeTraitProductionBonus`/`computeTraitDanger` (both stay), `lib/engine/simulator/world.ts` (reads
`s.economyType` + `s.traits`, both still present).

---

## Task 1: Resource-vector bridge helpers (writes + aggregate)

**Files:**
- Modify: `lib/engine/resources.ts`
- Test: `lib/engine/__tests__/resources.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `lib/engine/__tests__/resources.test.ts` (after the existing `makeResourceVector` block):

```typescript
import {
  aggregateColumns, bodyResourceColumns, sumResourceVectors,
} from "../resources";

describe("aggregateColumns", () => {
  it("maps a vector to the StarSystem agg* columns", () => {
    const cols = aggregateColumns(makeResourceVector({ gas: 1, ore: 2, water: 3 }));
    expect(cols).toEqual({
      aggGas: 1, aggMinerals: 0, aggOre: 2, aggBiomass: 0,
      aggArable: 0, aggWater: 3, aggRadioactive: 0,
    });
  });
});

describe("bodyResourceColumns", () => {
  it("maps a vector to the SystemBody res* columns", () => {
    const cols = bodyResourceColumns(makeResourceVector({ minerals: 4, radioactive: 1 }));
    expect(cols).toEqual({
      resGas: 0, resMinerals: 4, resOre: 0, resBiomass: 0,
      resArable: 0, resWater: 0, resRadioactive: 1,
    });
  });
});

describe("sumResourceVectors", () => {
  it("sums element-wise across vectors", () => {
    const sum = sumResourceVectors([
      makeResourceVector({ gas: 1, ore: 2 }),
      makeResourceVector({ ore: 3, water: 5 }),
    ]);
    expect(sum.gas).toBe(1);
    expect(sum.ore).toBe(5);
    expect(sum.water).toBe(5);
    expect(sum.minerals).toBe(0);
  });

  it("returns an all-zero vector for an empty list", () => {
    const sum = sumResourceVectors([]);
    expect(sum).toEqual(makeResourceVector({}));
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/engine/__tests__/resources.test.ts`
Expected: FAIL — `aggregateColumns`/`bodyResourceColumns`/`sumResourceVectors` are not exported.

- [ ] **Step 3: Implement the helpers**

Append the following to `lib/engine/resources.ts` (it already exports `emptyResourceVector` and `RESOURCE_TYPES`,
used below — no new imports needed):

```typescript
/** Spread a vector onto the StarSystem aggregate columns (agg*). */
export function aggregateColumns(v: ResourceVector): {
  aggGas: number; aggMinerals: number; aggOre: number; aggBiomass: number;
  aggArable: number; aggWater: number; aggRadioactive: number;
} {
  return {
    aggGas: v.gas, aggMinerals: v.minerals, aggOre: v.ore, aggBiomass: v.biomass,
    aggArable: v.arable, aggWater: v.water, aggRadioactive: v.radioactive,
  };
}

/** Spread a vector onto the SystemBody resource columns (res*). */
export function bodyResourceColumns(v: ResourceVector): {
  resGas: number; resMinerals: number; resOre: number; resBiomass: number;
  resArable: number; resWater: number; resRadioactive: number;
} {
  return {
    resGas: v.gas, resMinerals: v.minerals, resOre: v.ore, resBiomass: v.biomass,
    resArable: v.arable, resWater: v.water, resRadioactive: v.radioactive,
  };
}

/** Element-wise sum of resource vectors (the system aggregate from its bodies). */
export function sumResourceVectors(vectors: ResourceVector[]): ResourceVector {
  const acc = emptyResourceVector();
  for (const v of vectors) {
    for (const type of RESOURCE_TYPES) acc[type] += v[type];
  }
  return acc;
}
```

> `resourceVectorFromColumns` (DB read-back) is intentionally NOT added here — it has no PR3a caller; it lands in
> PR3b with the first reader.

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run lib/engine/__tests__/resources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/resources.ts lib/engine/__tests__/resources.test.ts
git commit -m "feat(economy): add resource-vector column bridge + sum helper"
```

---

## Task 2: Substrate generation tuning constants

**Files:**
- Create: `lib/constants/substrate-gen.ts`

> Pure data; the tunable knobs from the design (§9), surfaced as one frozen object so the verification step can
> calibrate them. Values are first-draft `[TUNE]` defaults.

- [ ] **Step 1: Create the constants**

Create `lib/constants/substrate-gen.ts`:

```typescript
/**
 * Tunable parameters for substrate generation (economy-simulation SP1 PR3a).
 * First-draft defaults; calibrated via `npm run simulate` + scripts/substrate-coherence.ts.
 */
export const SUBSTRATE_GEN = {
  /** Body size multiplier band, uniform. */
  SIZE_MIN: 0.5,
  SIZE_MAX: 1.5,
  /** Per-resource magnitude jitter: base × (1 ± RESOURCE_JITTER). */
  RESOURCE_JITTER: 0.25,
  /** Probability a body rolls one richness modifier. */
  RICHNESS_CHANCE: 0.18,
  /** Abstract population scale: popCap = Σ(body popCapWeight × size) × POP_SCALE. */
  POP_SCALE: 100,
  /** Reference popCap treated as "fully developed" for the seed-fill curve. */
  POP_REF: 2000,
  /** Seed-fill curve: fill = BASE + SLOPE·popNorm + (rng−0.5)·JITTER, clamped [MIN, MAX]. */
  POP_FILL_BASE: 0.1,
  POP_FILL_SLOPE: 0.6,
  POP_FILL_JITTER: 0.2,
  POP_FILL_MIN: 0.05,
  POP_FILL_MAX: 0.9,
  /** Narrative feature count per system, uniform inclusive. */
  FEATURE_COUNT: { min: 0, max: 2 },
  /** Economy-type shim thresholds (see economy-shim.ts). */
  ECON_POP_HIGH: 1000,        // population reference for "high population"
  ECON_POP_HIGH_FRAC: 0.6,    // popNorm ≥ this → developed economy
  ECON_RAW_DOMINANT: 0.5,     // raw share ≥ this → extraction / industrial
  ECON_FOOD_DOMINANT: 0.45,   // food share ≥ this → agricultural
  ECON_RAW_MIXED: 0.3,        // below this raw share + high pop → tech
} as const;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add lib/constants/substrate-gen.ts
git commit -m "feat(economy): add substrate generation tuning constants"
```

---

## Task 3: Economy-type shim

**Files:**
- Create: `lib/engine/economy-shim.ts`
- Test: `lib/engine/__tests__/economy-shim.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/economy-shim.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveEconomyTypeLabel } from "../economy-shim";
import { makeResourceVector } from "../resources";

describe("deriveEconomyTypeLabel", () => {
  it("returns extraction for a zero aggregate (matches legacy fallback)", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({}), 0)).toBe("extraction");
  });

  it("classifies an arable/biomass-dominant low-pop system as agricultural", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ arable: 8, biomass: 4, ore: 1 }), 100))
      .toBe("agricultural");
  });

  it("classifies an ore/mineral-dominant low-pop system as extraction", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ ore: 6, minerals: 6, water: 1 }), 100))
      .toBe("extraction");
  });

  it("classifies a mid-pop mixed system as refinery", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ water: 4, ore: 2, biomass: 1, gas: 1 }), 400))
      .toBe("refinery");
  });

  it("classifies a populous balanced/food system as core", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ arable: 4, biomass: 3, water: 4, ore: 2 }), 1500))
      .toBe("core");
  });

  it("classifies a populous raw-heavy system as industrial", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ ore: 6, minerals: 5, gas: 3 }), 1500))
      .toBe("industrial");
  });

  it("classifies a populous low-resource system as tech", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ water: 5, biomass: 1 }), 1500))
      .toBe("tech");
  });

  it("always returns one of the six economy types", () => {
    const result = deriveEconomyTypeLabel(makeResourceVector({ gas: 2, ore: 2, water: 2 }), 500);
    expect(["agricultural", "extraction", "refinery", "industrial", "tech", "core"]).toContain(result);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/engine/__tests__/economy-shim.test.ts`
Expected: FAIL — `Cannot find module '../economy-shim'`.

- [ ] **Step 3: Implement the shim**

Create `lib/engine/economy-shim.ts`:

```typescript
/**
 * Derived economy-type SHIM (economy-simulation SP1 Part 1).
 *
 * Economy type used to be derived from trait affinities. Those are gone — the
 * economic signal now comes from a system's physical substrate. This single
 * function maps the aggregate resource vector + population to one of the six
 * legacy `EconomyType` labels, so `getInitialStock`, `ECONOMY_PRODUCTION/
 * CONSUMPTION`, the economy tick, and `Region.dominantEconomy` keep working
 * unchanged. DELETED in SP1 Part 2 when production/consumption derive from
 * bodies + population directly. Thresholds are tuned via the simulator.
 */
import type { EconomyType, ResourceVector } from "@/lib/types/game";
import { RESOURCE_TYPES } from "./resources";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function deriveEconomyTypeLabel(
  aggregate: ResourceVector,
  population: number,
): EconomyType {
  const total = RESOURCE_TYPES.reduce((sum, type) => sum + aggregate[type], 0);
  if (total <= 0) return "extraction";

  const foodShare = (aggregate.arable + aggregate.biomass) / total;
  const rawShare =
    (aggregate.ore + aggregate.minerals + aggregate.gas + aggregate.radioactive) / total;
  const popNorm = clamp01(population / SUBSTRATE_GEN.ECON_POP_HIGH);

  // Populous systems become developed economies regardless of raw base.
  if (popNorm >= SUBSTRATE_GEN.ECON_POP_HIGH_FRAC) {
    if (rawShare >= SUBSTRATE_GEN.ECON_RAW_DOMINANT) return "industrial";
    if (foodShare < SUBSTRATE_GEN.ECON_FOOD_DOMINANT && rawShare < SUBSTRATE_GEN.ECON_RAW_MIXED) {
      return "tech";
    }
    return "core";
  }

  // Sparse/mid population: identity follows the dominant resource.
  if (foodShare >= SUBSTRATE_GEN.ECON_FOOD_DOMINANT) return "agricultural";
  if (rawShare >= SUBSTRATE_GEN.ECON_RAW_DOMINANT) return "extraction";

  // Mixed raw base, neither food- nor raw-dominant → refinery.
  return "refinery";
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run lib/engine/__tests__/economy-shim.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/economy-shim.ts lib/engine/__tests__/economy-shim.test.ts
git commit -m "feat(economy): add derived economy-type shim"
```

---

## Task 4: Substrate body generator

**Files:**
- Create: `lib/engine/body-gen.ts`
- Test: `lib/engine/__tests__/body-gen.test.ts`

> Pure, deterministic given a seeded RNG. Avoids `as` by iterating typed constant *values* (whose `.id` fields
> already carry the union type) rather than casting string keys. RNG draw order is fixed: sun → bodies (in order)
> → population → features.

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/body-gen.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mulberry32 } from "../universe-gen";
import { generateSubstrate, FEATURE_TRAIT_IDS } from "../body-gen";
import { SUN_CLASSES, RICHNESS_MODIFIERS } from "@/lib/constants/bodies";
import { RESOURCE_TYPES } from "../resources";
import { isFeatureTrait } from "@/lib/utils/traits";

function sample(n: number) {
  const rng = mulberry32(42);
  return Array.from({ length: n }, () => generateSubstrate(rng));
}

describe("FEATURE_TRAIT_IDS", () => {
  it("is exactly the 31 narrative survivors", () => {
    expect(FEATURE_TRAIT_IDS.length).toBe(31);
    for (const id of FEATURE_TRAIT_IDS) expect(isFeatureTrait(id)).toBe(true);
  });
});

describe("generateSubstrate", () => {
  it("rolls a valid sun class and at least one body", () => {
    for (const s of sample(200)) {
      expect(SUN_CLASSES[s.sunClass]).toBeDefined();
      expect(s.bodies.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("only rolls archetypes the sun class permits", () => {
    for (const s of sample(200)) {
      const weights = SUN_CLASSES[s.sunClass].archetypeWeights;
      for (const b of s.bodies) expect(weights[b.bodyType] ?? 0).toBeGreaterThan(0);
    }
  });

  it("body sizes fall in the configured band", () => {
    for (const s of sample(100)) {
      for (const b of s.bodies) {
        expect(b.size).toBeGreaterThanOrEqual(0.5);
        expect(b.size).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it("aggregate equals the element-wise sum of body resource bases", () => {
    for (const s of sample(50)) {
      for (const type of RESOURCE_TYPES) {
        const summed = s.bodies.reduce((acc, b) => acc + b.resourceBase[type], 0);
        expect(s.aggregate[type]).toBeCloseTo(summed, 6);
      }
    }
  });

  it("seeds population between 0 and pop cap", () => {
    for (const s of sample(200)) {
      expect(s.population).toBeGreaterThanOrEqual(0);
      expect(s.population).toBeLessThanOrEqual(s.popCap);
    }
  });

  it("rolls 0–2 features, all narrative survivors, no duplicates", () => {
    for (const s of sample(200)) {
      expect(s.features.length).toBeGreaterThanOrEqual(0);
      expect(s.features.length).toBeLessThanOrEqual(2);
      const ids = s.features.map((f) => f.traitId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const f of s.features) expect(isFeatureTrait(f.traitId)).toBe(true);
    }
  });

  it("richness modifiers only target a resource present on the body", () => {
    for (const s of sample(300)) {
      for (const b of s.bodies) {
        for (const modId of b.richnessModifiers) {
          expect(b.resourceBase[RICHNESS_MODIFIERS[modId].resource]).toBeGreaterThan(0);
        }
      }
    }
  });

  it("is deterministic for the same seed", () => {
    const a = generateSubstrate(mulberry32(7));
    const b = generateSubstrate(mulberry32(7));
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/engine/__tests__/body-gen.test.ts`
Expected: FAIL — `Cannot find module '../body-gen'`.

- [ ] **Step 3: Implement the generator**

Create `lib/engine/body-gen.ts`:

```typescript
/**
 * Substrate generation (economy-simulation SP1 PR3a) — pure, zero DB dependency,
 * deterministic given a seeded RNG. Rolls a system's sun class, body set,
 * per-body resource vectors + richness modifiers, aggregate vector, population,
 * and narrative features. Replaces the old trait-rolling path.
 */
import type {
  BodyArchetypeId, ResourceVector, RichnessModifierId, SunClass, TraitId,
} from "@/lib/types/game";
import { BODY_ARCHETYPES, SUN_CLASSES, RICHNESS_MODIFIERS, type SunClassDef } from "@/lib/constants/bodies";
import { makeResourceVector, sumResourceVectors, RESOURCE_TYPES } from "./resources";
import { ALL_TRAIT_IDS, QUALITY_TIERS } from "@/lib/constants/traits";
import { TRAIT_MIGRATION } from "@/lib/constants/trait-migration";
import { toQualityTier } from "@/lib/types/guards";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import type { GeneratedTrait } from "./trait-gen";
import type { RNG } from "./universe-gen";
import { weightedPick, randInt } from "./universe-gen";

export interface GeneratedBody {
  bodyType: BodyArchetypeId;
  habitable: boolean;
  size: number;
  resourceBase: ResourceVector;
  popCapWeight: number;
  richnessModifiers: RichnessModifierId[];
}

export interface GeneratedSubstrate {
  sunClass: SunClass;
  bodies: GeneratedBody[];
  aggregate: ResourceVector;
  popCap: number;
  population: number;
  features: GeneratedTrait[];
}

/** The 31 narrative feature trait ids — the survivors of the substrate rebuild. */
export const FEATURE_TRAIT_IDS: readonly TraitId[] =
  ALL_TRAIT_IDS.filter((id) => TRAIT_MIGRATION[id].kind === "feature");

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Weighted sun-class roll. Returns the typed `SunClass` id directly (no cast). */
function rollSunClass(rng: RNG): SunClass {
  const classes = Object.values(SUN_CLASSES);
  const total = classes.reduce((sum, c) => sum + c.weight, 0);
  let roll = rng() * total;
  for (const c of classes) {
    roll -= c.weight;
    if (roll <= 0) return c.id;
  }
  return classes[classes.length - 1].id;
}

/** Weighted archetype roll among the sun class's positive-weight archetypes. */
function rollArchetype(rng: RNG, sun: SunClassDef): BodyArchetypeId {
  const candidates: { id: BodyArchetypeId; weight: number }[] = [];
  for (const arch of Object.values(BODY_ARCHETYPES)) {
    const w = sun.archetypeWeights[arch.id] ?? 0;
    if (w > 0) candidates.push({ id: arch.id, weight: w });
  }
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = rng() * total;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) return c.id;
  }
  return candidates[candidates.length - 1].id;
}

/** Pick a richness modifier whose target resource is present on this body, or null. */
function rollRichness(rng: RNG, resourceBase: ResourceVector): RichnessModifierId | null {
  const candidates = Object.values(RICHNESS_MODIFIERS).filter(
    (m) => resourceBase[m.resource] > 0,
  );
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, m) => sum + m.rarity, 0);
  let roll = rng() * total;
  for (const m of candidates) {
    roll -= m.rarity;
    if (roll <= 0) return m.id;
  }
  return candidates[candidates.length - 1].id;
}

function rollBody(rng: RNG, archId: BodyArchetypeId): GeneratedBody {
  const arch = BODY_ARCHETYPES[archId];
  const size = SUBSTRATE_GEN.SIZE_MIN + rng() * (SUBSTRATE_GEN.SIZE_MAX - SUBSTRATE_GEN.SIZE_MIN);

  const base: Partial<ResourceVector> = {};
  for (const type of RESOURCE_TYPES) {
    const b = arch.resourceBase[type];
    if (b > 0) {
      const jitter = 1 + (rng() - 0.5) * 2 * SUBSTRATE_GEN.RESOURCE_JITTER;
      base[type] = b * size * jitter;
    }
  }
  const resourceBase = makeResourceVector(base);

  const richnessModifiers: RichnessModifierId[] = [];
  if (rng() < SUBSTRATE_GEN.RICHNESS_CHANCE) {
    const modId = rollRichness(rng, resourceBase);
    if (modId) {
      resourceBase[RICHNESS_MODIFIERS[modId].resource] *= RICHNESS_MODIFIERS[modId].multiplier;
      richnessModifiers.push(modId);
    }
  }

  return {
    bodyType: archId,
    habitable: arch.habitable,
    size,
    resourceBase,
    popCapWeight: arch.popCapWeight,
    richnessModifiers,
  };
}

function rollFeatures(rng: RNG): GeneratedTrait[] {
  const count = randInt(rng, SUBSTRATE_GEN.FEATURE_COUNT.min, SUBSTRATE_GEN.FEATURE_COUNT.max);
  const pool = [...FEATURE_TRAIT_IDS];
  const features: GeneratedTrait[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    const traitId = pool[idx];
    pool.splice(idx, 1);
    const quality = toQualityTier(Number(weightedPick(rng, {
      "1": QUALITY_TIERS[1].rarity,
      "2": QUALITY_TIERS[2].rarity,
      "3": QUALITY_TIERS[3].rarity,
    })));
    features.push({ traitId, quality });
  }
  return features;
}

export function generateSubstrate(rng: RNG): GeneratedSubstrate {
  const sunClass = rollSunClass(rng);
  const sun = SUN_CLASSES[sunClass];

  const bodyCount = randInt(rng, sun.bodyCount.min, sun.bodyCount.max);
  const bodies: GeneratedBody[] = [];
  for (let i = 0; i < bodyCount; i++) {
    bodies.push(rollBody(rng, rollArchetype(rng, sun)));
  }

  const aggregate = sumResourceVectors(bodies.map((b) => b.resourceBase));

  const rawCap = bodies.reduce((sum, b) => sum + b.popCapWeight * b.size, 0);
  const popCap = rawCap * SUBSTRATE_GEN.POP_SCALE;
  const popNorm = clamp(popCap / SUBSTRATE_GEN.POP_REF, 0, 1);
  const fill = clamp(
    SUBSTRATE_GEN.POP_FILL_BASE
      + SUBSTRATE_GEN.POP_FILL_SLOPE * popNorm
      + (rng() - 0.5) * SUBSTRATE_GEN.POP_FILL_JITTER,
    SUBSTRATE_GEN.POP_FILL_MIN,
    SUBSTRATE_GEN.POP_FILL_MAX,
  );
  const population = Math.round(popCap * fill);

  const features = rollFeatures(rng);

  return { sunClass, bodies, aggregate, popCap, population, features };
}
```

> `SunClassDef` must be exported from `lib/constants/bodies.ts`. It currently is (`export interface
> SunClassDef`). If a future edit removes the export, re-add it — `body-gen.ts` imports the type.

- [ ] **Step 4: Run to confirm pass**

Run: `npx vitest run lib/engine/__tests__/body-gen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/body-gen.ts lib/engine/__tests__/body-gen.test.ts
git commit -m "feat(economy): add substrate body generator (sun, bodies, features, population)"
```

---

## Task 5: Rewrite `generateSystems` + extend `GeneratedSystem`

**Files:**
- Modify: `lib/engine/universe-gen.ts` (`GeneratedSystem` ~line 25, imports ~line 6-8, `generateSystems` ~line 339-380)
- Modify: `lib/engine/__tests__/universe-gen.test.ts` (the `generateSystems` describe block ~line 223-302)

- [ ] **Step 1: Update the failing test first**

In `lib/engine/__tests__/universe-gen.test.ts`, add these imports near the top (after the existing imports):

```typescript
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { isFeatureTrait } from "@/lib/utils/traits";
```

Then **replace** the two tests `"derives economy types from traits with no region theme bias"` and `"every
system has at least 2 traits"` inside the `describe("generateSystems", …)` block with:

```typescript
  it("assigns every system a sun class and at least one body", () => {
    const { systems } = makeRegionsAndSystems();
    for (const sys of systems) {
      expect(SUN_CLASSES[sys.sunClass]).toBeDefined();
      expect(sys.bodies.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("aggregate equals the element-wise sum of body resource bases", () => {
    const { systems } = makeRegionsAndSystems();
    for (const sys of systems.slice(0, 50)) {
      for (const type of RESOURCE_TYPES) {
        const summed = sys.bodies.reduce((acc, b) => acc + b.resourceBase[type], 0);
        expect(sys.aggregate[type]).toBeCloseTo(summed, 6);
      }
    }
  });

  it("seeds population between 0 and pop cap", () => {
    const { systems } = makeRegionsAndSystems();
    for (const sys of systems) {
      expect(sys.population).toBeGreaterThanOrEqual(0);
      expect(sys.population).toBeLessThanOrEqual(sys.popCap);
    }
  });

  it("rolls 0–2 features per system, all narrative survivors", () => {
    const { systems } = makeRegionsAndSystems();
    for (const sys of systems) {
      expect(sys.traits.length).toBeGreaterThanOrEqual(0);
      expect(sys.traits.length).toBeLessThanOrEqual(2);
      for (const t of sys.traits) expect(isFeatureTrait(t.traitId)).toBe(true);
    }
  });

  it("derives all six economy types from the substrate, none dominating", () => {
    const { systems } = makeRegionsAndSystems();
    const econCounts = new Map<string, number>();
    for (const sys of systems) {
      econCounts.set(sys.economyType, (econCounts.get(sys.economyType) ?? 0) + 1);
    }
    expect(econCounts.size).toBe(6);
    for (const [, count] of econCounts) {
      expect(count / systems.length).toBeLessThan(0.5);
    }
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run lib/engine/__tests__/universe-gen.test.ts`
Expected: FAIL — `sys.sunClass`/`sys.bodies`/`sys.aggregate`/`sys.population` don't exist on `GeneratedSystem`.

- [ ] **Step 3: Extend `GeneratedSystem` and its imports**

In `lib/engine/universe-gen.ts`, **replace** the imports block (lines ~6-8):

```typescript
import type { EconomyType } from "@/lib/types/game";
import type { GeneratedTrait } from "./trait-gen";
import { generateSystemTraits, deriveEconomyType } from "./trait-gen";
```

with:

```typescript
import type { EconomyType, ResourceVector, SunClass } from "@/lib/types/game";
import type { GeneratedTrait } from "./trait-gen";
import { generateSubstrate, type GeneratedBody } from "./body-gen";
import { deriveEconomyTypeLabel } from "./economy-shim";
```

Then **replace** the `GeneratedSystem` interface (lines ~25-35):

```typescript
export interface GeneratedSystem {
  index: number;
  name: string;
  economyType: EconomyType;
  traits: GeneratedTrait[];
  x: number;
  y: number;
  regionIndex: number;
  isGateway: boolean;
  description: string;
}
```

with:

```typescript
export interface GeneratedSystem {
  index: number;
  name: string;
  economyType: EconomyType;
  /** Physical substrate (economy-simulation SP1). */
  sunClass: SunClass;
  bodies: GeneratedBody[];
  aggregate: ResourceVector;
  popCap: number;
  population: number;
  /** Narrative features (the pruned trait subset). */
  traits: GeneratedTrait[];
  x: number;
  y: number;
  regionIndex: number;
  isGateway: boolean;
  description: string;
}
```

- [ ] **Step 4: Rewrite the system-build loop**

In `lib/engine/universe-gen.ts`, inside `generateSystems`, **replace** the Step-3 build loop (lines ~358-377):

```typescript
  // Step 3: Build GeneratedSystem for each point
  const systems: GeneratedSystem[] = [];
  for (let i = 0; i < points.length; i++) {
    const traits = generateSystemTraits(rng);
    const economyType = deriveEconomyType(traits, rng);
    const regionIndex = regionAssignments[i];
    const localIndex = regionLocalCount[regionIndex]++;

    systems.push({
      index: i,
      name: `${regions[regionIndex].name}-${localIndex + 1}`,
      economyType,
      traits,
      x: points[i].x,
      y: points[i].y,
      regionIndex,
      isGateway: false,
      description: "",
    });
  }

  return systems;
```

with:

```typescript
  // Step 3: Build GeneratedSystem for each point from its physical substrate
  const systems: GeneratedSystem[] = [];
  for (let i = 0; i < points.length; i++) {
    const substrate = generateSubstrate(rng);
    const economyType = deriveEconomyTypeLabel(substrate.aggregate, substrate.population);
    const regionIndex = regionAssignments[i];
    const localIndex = regionLocalCount[regionIndex]++;

    systems.push({
      index: i,
      name: `${regions[regionIndex].name}-${localIndex + 1}`,
      economyType,
      sunClass: substrate.sunClass,
      bodies: substrate.bodies,
      aggregate: substrate.aggregate,
      popCap: substrate.popCap,
      population: substrate.population,
      traits: substrate.features,
      x: points[i].x,
      y: points[i].y,
      regionIndex,
      isGateway: false,
      description: "",
    });
  }

  return systems;
```

- [ ] **Step 5: Run the test; tune until green**

Run: `npx vitest run lib/engine/__tests__/universe-gen.test.ts`
Expected: PASS. If `"derives all six economy types … none dominating"` fails (a type missing, or one > 50%),
**this is the economy-distribution calibration**: adjust the `ECON_*` thresholds in
`lib/constants/substrate-gen.ts` and/or the `weight`/`archetypeWeights` in `lib/constants/bodies.ts`, re-run until
green. Keep changes small; note that `refinery` and `tech` are the rarest buckets.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/universe-gen.ts lib/engine/__tests__/universe-gen.test.ts
git commit -m "feat(economy): generate systems from physical substrate via shim"
```

---

## Task 6: Trim the legacy trait-generation functions

**Files:**
- Modify: `lib/engine/trait-gen.ts`
- Modify: `lib/engine/__tests__/trait-gen.test.ts`

> `generateSystemTraits`, `deriveEconomyType`, and `STRONG_AFFINITY_TRAIT_IDS` are now dead (Task 5 stopped
> calling them). Remove them. **Keep** `GeneratedTrait`, `computeTraitProductionBonus`, and `computeTraitDanger`
> (the catalog is still full; production bonus is retired in PR3b).

- [ ] **Step 1: Delete the dead functions and unused imports**

In `lib/engine/trait-gen.ts`:
- Delete the `STRONG_AFFINITY_TRAIT_IDS` const (~lines 23-26), the `generateSystemTraits` function (~lines 28-77),
  and the `deriveEconomyType` function + its `ALL_ECONOMY_TYPES` const (~lines 119-173).
- **Replace** the import block (lines ~6-12) with only what remains in use:

```typescript
import type { QualityTier, TraitId } from "@/lib/types/game";
import { TRAITS, QUALITY_TIERS } from "@/lib/constants/traits";
import { getFeatureTraits } from "@/lib/utils/traits";
```

The file should now contain only: the `GeneratedTrait` interface, `computeTraitProductionBonus`, and
`computeTraitDanger`.

- [ ] **Step 2: Drop the tests for the removed functions**

In `lib/engine/__tests__/trait-gen.test.ts`:
- Delete the `describe("generateSystemTraits", …)` and `describe("deriveEconomyType", …)` blocks.
- Remove `generateSystemTraits` and `deriveEconomyType` from the import statement (keep
  `computeTraitProductionBonus`, `computeTraitDanger`, and any RNG/test helpers the remaining blocks use).

- [ ] **Step 3: Run the trait-gen + universe-gen tests**

Run: `npx vitest run lib/engine/__tests__/trait-gen.test.ts lib/engine/__tests__/universe-gen.test.ts`
Expected: PASS. (`computeTraitProductionBonus`/`computeTraitDanger` tests still pass — those functions are
unchanged.)

- [ ] **Step 4: Typecheck (catches any lingering reference)**

Run: `npx tsc --noEmit`
Expected: PASS — no remaining import of `generateSystemTraits`/`deriveEconomyType` anywhere.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/trait-gen.ts lib/engine/__tests__/trait-gen.test.ts
git commit -m "refactor(economy): remove legacy trait-roll + economy derivation"
```

---

## Task 7: Rewrite the seed to persist the substrate (batched) + reseed

**Files:**
- Modify: `prisma/seed.ts`

> The current seed loops `await prisma.starSystem.create(...)` once per system (and per-row connection/priceHistory
> creates). At 10K scale that's tens of thousands of round-trips. Rewrite the big-N writes as chunked batches.
> Chunk size 2000 keeps every batch under Postgres's 65535 bind-parameter ceiling (systems = 12 cols → 24K params).

- [ ] **Step 1: Fix imports + add chunk helpers**

In `prisma/seed.ts`:
- **Add** the bridge helpers import (after the existing `getInitialStock` import):

```typescript
import { aggregateColumns, bodyResourceColumns } from "@/lib/engine/resources";
```

- **Remove** the now-unused `toEconomyType` import (`import { toEconomyType } from "@/lib/types/guards";`). Its
  only use was the per-market `toEconomyType(sys.economyType)` call, which Step 2 drops because
  `GeneratedSystem.economyType` is already `EconomyType`. (`deriveDominantEconomy` in the region block does NOT
  use it.) Leaving it would fail strict TS as an unused import.

Then **add** these helpers above `async function main()`:

```typescript
const CHUNK_SIZE = 2000;

/** Insert rows in chunks (fire-and-forget) to stay under Postgres's param ceiling. */
async function createManyChunked<T>(
  rows: T[],
  insert: (batch: T[]) => Promise<{ count: number }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await insert(rows.slice(i, i + CHUNK_SIZE));
  }
}

/** Insert rows in chunks, accumulating the returned rows. */
async function createManyAndReturnChunked<T, R>(
  rows: T[],
  insert: (batch: T[]) => Promise<R[]>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    out.push(...(await insert(rows.slice(i, i + CHUNK_SIZE))));
  }
  return out;
}
```

- [ ] **Step 2: Replace the per-system seed loop with batched substrate writes**

In `prisma/seed.ts`, **replace** the entire `// ── Seed systems + stations + markets ──` block (the
`const systemIds = …` declaration through the `Created … star systems …` log, lines ~123-168) with:

```typescript
  // ── Seed systems (batched) ──
  // Names are @unique, so we map returned ids back to the generator index by name.
  const createdSystems = await createManyAndReturnChunked(
    universe.systems,
    (batch) =>
      prisma.starSystem.createManyAndReturn({
        data: batch.map((sys) => ({
          name: sys.name,
          economyType: sys.economyType,
          x: sys.x,
          y: sys.y,
          description: sys.description,
          regionId: regionIds[sys.regionIndex],
          isGateway: sys.isGateway,
          sunClass: sys.sunClass,
          population: sys.population,
          popCap: sys.popCap,
          ...aggregateColumns(sys.aggregate),
        })),
        select: { id: true, name: true },
      }),
  );
  const systemIdByName = new Map(createdSystems.map((s) => [s.name, s.id]));
  const systemIds: string[] = universe.systems.map((s) => {
    const id = systemIdByName.get(s.name);
    if (!id) throw new Error(`System "${s.name}" missing from createManyAndReturn result`);
    return id;
  });

  // ── Seed stations (batched, one per system) ──
  const createdStations = await createManyAndReturnChunked(
    universe.systems,
    (batch) =>
      prisma.station.createManyAndReturn({
        data: batch.map((sys) => ({
          name: `${sys.name} Station`,
          systemId: systemIds[sys.index],
        })),
        select: { id: true, systemId: true },
      }),
  );
  const stationIdBySystemId = new Map(createdStations.map((s) => [s.systemId, s.id]));

  // ── Seed markets (batched, every system × good) ──
  const marketData = universe.systems.flatMap((sys) => {
    const stationId = stationIdBySystemId.get(systemIds[sys.index]);
    if (!stationId) throw new Error(`Station missing for system "${sys.name}"`);
    return Object.entries(goodRecords).map(([goodKey, goodRec]) => ({
      stationId,
      goodId: goodRec.id,
      stock: getInitialStock(sys.economyType, goodKey),
    }));
  });
  await createManyChunked(marketData, (batch) =>
    prisma.stationMarket.createMany({ data: batch }),
  );

  // ── Seed bodies (batched) ──
  const bodyData = universe.systems.flatMap((sys) =>
    sys.bodies.map((b) => ({
      systemId: systemIds[sys.index],
      bodyType: b.bodyType,
      habitable: b.habitable,
      size: b.size,
      ...bodyResourceColumns(b.resourceBase),
      popCapWeight: b.popCapWeight,
      richnessModifiers: b.richnessModifiers,
    })),
  );
  await createManyChunked(bodyData, (batch) =>
    prisma.systemBody.createMany({ data: batch }),
  );

  // ── Seed feature traits (batched) ──
  const traitData = universe.systems.flatMap((sys) =>
    sys.traits.map((t) => ({
      systemId: systemIds[sys.index],
      traitId: t.traitId,
      quality: t.quality,
    })),
  );
  await createManyChunked(traitData, (batch) =>
    prisma.systemTrait.createMany({ data: batch }),
  );

  const totalBodies = bodyData.length;
  const totalTraits = traitData.length;
  console.log(
    `  Created ${universe.systems.length} star systems with stations, markets, ${totalBodies} bodies, and ${totalTraits} feature traits`,
  );
```

> Note: `getInitialStock` takes `sys.economyType` directly — it's already `EconomyType` on `GeneratedSystem`, so
> the previous `toEconomyType(...)` round-trip is dropped (and its import removed in Step 1).

- [ ] **Step 3: Batch the connection + price-history loops**

In `prisma/seed.ts`, **replace** the `// ── Seed price history (one row per system) ──` loop (~lines 263-269)
with:

```typescript
  // ── Seed price history (batched, one row per system) ──
  await createManyChunked(
    systemIds.map((systemId) => ({ systemId, entries: "[]" })),
    (batch) => prisma.priceHistory.createMany({ data: batch }),
  );
  console.log(`  Created ${systemIds.length} price history rows`);
```

And **replace** the `// ── Seed connections (already bidirectional from generator) ──` loop (~lines 271-281)
with:

```typescript
  // ── Seed connections (batched; already bidirectional from generator) ──
  await createManyChunked(
    universe.connections.map((conn) => ({
      fromSystemId: systemIds[conn.fromSystemIndex],
      toSystemId: systemIds[conn.toSystemIndex],
      fuelCost: conn.fuelCost,
    })),
    (batch) => prisma.systemConnection.createMany({ data: batch }),
  );
  console.log(`  Created ${universe.connections.length} connections`);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Confirms the batched `data` shapes match the Prisma create-many input types.)

- [ ] **Step 5: Regenerate client + full reseed**

The schema columns already exist (PR1), so `db push` is a no-op; reseed against the running local Postgres (see
`/bootstrap` if it isn't up):

```bash
npx prisma generate
npx prisma db push
npx prisma db seed
```

Expected: seed completes, logging non-zero bodies + feature traits, e.g.
`Created 600 star systems with stations, markets, NNNN bodies, and NNN feature traits`.

- [ ] **Step 6: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(economy): seed physical substrate (bodies, aggregates, population) batched"
```

---

## Task 8: PR3a verification gate

**Files:**
- Create: `scripts/substrate-coherence.ts`

- [ ] **Step 1: Full unit suite green**

Run: `npx vitest run`
Expected: PASS, including the new `resources`, `economy-shim`, `body-gen` files and the rewritten
`universe-gen`/`trait-gen` tests.

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both PASS.

- [ ] **Step 3: Write the coherence report script**

Create `scripts/substrate-coherence.ts`:

```typescript
/**
 * One-off PR3a verification: report the generated galaxy's economy-type
 * distribution, galaxy-wide aggregate resource totals, and the weakest region's
 * arable (food) share. Run: npx tsx --tsconfig tsconfig.json scripts/substrate-coherence.ts
 */
import { generateUniverse, type GenParams } from "@/lib/engine/universe-gen";
import { UNIVERSE_GEN, REGION_NAMES } from "@/lib/constants/universe-gen";
import { RESOURCE_TYPES, sumResourceVectors } from "@/lib/engine/resources";

const params: GenParams = {
  seed: UNIVERSE_GEN.SEED,
  regionCount: UNIVERSE_GEN.REGION_COUNT,
  totalSystems: UNIVERSE_GEN.TOTAL_SYSTEMS,
  mapSize: UNIVERSE_GEN.MAP_SIZE,
  mapPadding: UNIVERSE_GEN.MAP_PADDING,
  poissonMinDistance: UNIVERSE_GEN.POISSON_MIN_DISTANCE,
  poissonKCandidates: UNIVERSE_GEN.POISSON_K_CANDIDATES,
  regionMinDistance: UNIVERSE_GEN.REGION_MIN_DISTANCE,
  extraEdgeFraction: UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES,
  gatewayFuelMultiplier: UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER,
  gatewaysPerBorder: UNIVERSE_GEN.GATEWAYS_PER_BORDER,
  intraRegionBaseFuel: UNIVERSE_GEN.INTRA_REGION_BASE_FUEL,
  maxPlacementAttempts: UNIVERSE_GEN.MAX_PLACEMENT_ATTEMPTS,
  minorFactionCount: UNIVERSE_GEN.MINOR_FACTION_COUNT,
};

const u = generateUniverse(params, REGION_NAMES);

const econ = new Map<string, number>();
for (const s of u.systems) econ.set(s.economyType, (econ.get(s.economyType) ?? 0) + 1);
console.log("Economy-type distribution:");
for (const [k, v] of [...econ].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v} (${((v / u.systems.length) * 100).toFixed(1)}%)`);
}

const galaxy = sumResourceVectors(u.systems.map((s) => s.aggregate));
const totalAll = RESOURCE_TYPES.reduce((sum, t) => sum + galaxy[t], 0);
console.log("\nGalaxy resource mix:");
for (const t of RESOURCE_TYPES) {
  console.log(`  ${t.padEnd(12)} ${galaxy[t].toFixed(0)} (${((galaxy[t] / totalAll) * 100).toFixed(1)}%)`);
}

let worst = { region: -1, arableShare: Infinity };
for (let ri = 0; ri < u.regions.length; ri++) {
  const agg = sumResourceVectors(
    u.systems.filter((s) => s.regionIndex === ri).map((s) => s.aggregate),
  );
  const tot = RESOURCE_TYPES.reduce((sum, t) => sum + agg[t], 0);
  const share = tot > 0 ? agg.arable / tot : 0;
  if (share < worst.arableShare) worst = { region: ri, arableShare: share };
}
console.log(
  `\nWeakest-arable region: #${worst.region} at ${(worst.arableShare * 100).toFixed(1)}% arable share`,
);

const pop = u.systems.map((s) => s.population).sort((a, b) => a - b);
console.log(
  `\nPopulation spread: min ${pop[0]}, median ${pop[Math.floor(pop.length / 2)]}, max ${pop[pop.length - 1]}`,
);
```

- [ ] **Step 4: Run the coherence report and judge the resource-mix gate**

Run: `npx tsx --tsconfig tsconfig.json scripts/substrate-coherence.ts`
Expected / gate:
- All six economy types present, none > ~50%.
- Every tier-0 resource has a non-trivial galaxy share (no resource at ~0%).
- The weakest-arable region still has a non-zero arable share (no region starved of food).
- Population spread shows a clear range (developed cores vs near-empty frontier).

If the gate fails, tune `lib/constants/bodies.ts` (`SUN_CLASSES` weights / `archetypeWeights`) and/or the
`ECON_*` thresholds in `lib/constants/substrate-gen.ts`, re-run Task 5's test + this script until both pass. Some
regional scarcity is *wanted* (it drives trade) — the gate only catches the pathological extreme.

- [ ] **Step 5: Simulator parity (healthy, not byte-identical)**

Run: `npm run simulate`
Expected: completes 500 ticks at seed 42 with a **healthy** equilibrium (no crashes; prices/stocks stable, not
collapsing or exploding). It will NOT match pre-PR3a numbers — generation changed the economy-type distribution
(expected, per the design's "coherent + healthy" bar). Eyeball that no good is pinned at floor/ceiling galaxy-wide.

- [ ] **Step 6: Commit the script and open the PR**

```bash
git add scripts/substrate-coherence.ts
git commit -m "chore(economy): add substrate coherence report script"
git push -u origin feat/economy-simulation-pr3a
gh pr create --base feat/economy-simulation \
  --title "feat(economy): SP1 PR3a — build the new universe & reseed (additive)" \
  --body "Rewrites universe generation onto the physical substrate (sun → bodies → resource vectors → features → population), persists it via a batched seed, and keeps the economy running unchanged through the derived economy-type shim. No TraitId narrowing, no new migration. Simulate stays healthy (not byte-identical — generation changed). Next: PR3b (prune TraitId, strip economy fields, rewire LOCATIONS to bodies, danger-from-bodies, DB guards)."
```

> PR targets the shared `feat/economy-simulation` branch, per the workflow convention (not `main`).

---

## PR3a success criteria

1. `generateSystems` produces sun-gated body sets, aggregate vectors, populated systems (≤ cap), and 0–2
   narrative features — all unit-tested (`body-gen`, `economy-shim`, `resources`, rewritten `universe-gen`).
2. `deriveEconomyTypeLabel` yields all six economy types (none dominating), keeping `getInitialStock` /
   `ECONOMY_PRODUCTION` / the economy tick / `Region.dominantEconomy` working unchanged.
3. The seed persists `SystemBody` rows + `StarSystem.sunClass/population/popCap/agg*` + feature `SystemTrait`
   rows, batched (chunked under the PG param ceiling); full reseed succeeds.
4. Legacy `generateSystemTraits`/`deriveEconomyType`/`STRONG_AFFINITY_TRAIT_IDS` removed; catalog + `TraitId`
   untouched; `computeTraitProductionBonus`/`computeTraitDanger` retained.
5. Full unit suite + `tsc` + `build` green; `npm run simulate` healthy; the coherence script's resource-mix gate
   passes.
6. No `as` (outside `as const`), no `unknown`, no `Record<string, unknown>`; no dead code (guards +
   `resourceVectorFromColumns` deferred to PR3b).

---

## Self-review notes (author, pre-handoff)

- **Spec coverage (PR3a scope):** generation rewrite (design §3, §6) ✓ Tasks 4-5; shim (§4, §7) ✓ Task 3; bridge
  writes/aggregate (§5) ✓ Task 1; batched seed + reseed (§5, §9 reseed) ✓ Task 7; tuning constants (§9) ✓ Task 2;
  legacy removal ✓ Task 6; verification incl. resource-mix gate (§8) ✓ Task 8. Deferred to PR3b (design §7):
  `TraitId` narrow, economy-field strip, `computeTraitProductionBonus` retirement, LOCATIONS rewire,
  danger-from-bodies, DB guards, `resourceVectorFromColumns` — none in PR3a scope.
- **Placeholder scan:** none — every code step has complete content. The `[TUNE]` defaults in Task 2 are concrete
  values, calibrated in Task 8.
- **Type consistency:** `GeneratedBody`/`GeneratedSubstrate` defined in Task 4 are imported by Task 5;
  `aggregateColumns`/`bodyResourceColumns` (Task 1) consumed by Task 7; `deriveEconomyTypeLabel(aggregate,
  population)` signature consistent across Tasks 3, 5; `FEATURE_TRAIT_IDS`/`isFeatureTrait` used consistently in
  Tasks 4-5; `SUBSTRATE_GEN` keys referenced in shim (Task 3) + body-gen (Task 4) all exist in Task 2.
- **No-cast check:** sun/archetype/richness rolls iterate typed constant `Object.values(...)` (`.id` is the union
  type) — no string→union casts; quality uses the existing `toQualityTier` guard. Seed uses non-null assertions
  (`!` via thrown guards), not `as`.
