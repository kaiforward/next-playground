# Economy Simulation — SP1 Part 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the physical-substrate *foundation* — additive Prisma schema (`SystemBody` + denormalized aggregates + `population` on `StarSystem`), the typed resource-vector type system, and the validated design-data tables (sun classes, body archetypes, richness modifiers, and the full 52-trait migration map) — with **zero wiring**, so the game runs identically while the new structures sit ready for the rebuild.

**Architecture:** Bottom-up and purely additive. New literal-union types in `lib/types/game.ts`; new constant tables in `lib/constants/`; a tiny pure resource-vector helper in `lib/engine/`; new `SystemBody` model + defaulted columns on `StarSystem`. Nothing reads or writes the new structures yet — the old trait→economy generation path is untouched, the old seed is untouched, the economy tick is untouched. Correctness is enforced by data-integrity tests (every archetype defines all 7 resources; the migration map classifies all 52 traits exactly once; every mission-eligible trait survives as a feature).

**Tech Stack:** Next.js 16, TypeScript 5 (strict), Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), PostgreSQL, Vitest 4. Seeded determinism via `mulberry32`.

---

## Context: where this sits

This is **Part 1 (Foundation)**, the first of **three PRs** that make up SP1 Part 1 of the [Economy Simulation Vision](../planned/economy-simulation-vision.md) / [SP1 Substrate spec](../planned/economy-simulation-substrate.md):

| PR | Name | What it does | This plan |
|----|------|--------------|-----------|
| **PR1** | **Foundation** | Additive schema + types + constant tables + migration map. No wiring. Game runs unchanged. | ✅ **fully planned below** |
| PR2 | Detach consumers | Re-point survey/danger/events + rendering to "features", behaviour-preserving against today's world. | 🗺️ roadmap only (§ PR2) |
| PR3 | Rebuild + reseed | Rewrite generation + seed, full reseed, economy via the derived economy-type shim, prune catalog, strip dead fields. | 🗺️ roadmap only (§ PR3) |

PR2 and PR3 get their own bite-sized plans authored **after PR1 ships** (each informed by PR1's real outcome). This document is complete and executable for **PR1 only**; the PR2/PR3 sections are deliberate forward outlines, not tasks.

### Decisions locked (from brainstorming, 2026-06-15)

- **Sequencing:** substrate-first (SP1 spec §1).
- **Resource-vector storage:** **scalar columns everywhere** — 7 `Float` columns per vector on `SystemBody` and on the `StarSystem` aggregate; a shared typed `ResourceVector` (`Record<ResourceType, number>`) bridges columns ↔ object in code. Natively Prisma-typed, fastest on the 10K hot path, SQL-aggregatable, no JSON narrowing. The 7 resource types are locked, so columns never migrate.
- **PR slicing:** 3 PRs — Foundation → Detach → Rebuild (this is PR1).
- **Feature spawning (PR3):** uniform + small count band, drop the guaranteed-economy-affinity first roll.
- **Richness modifiers:** stored as a `String[]` of modifier ids on the body; magnitude baked into the resource columns at generation (PR3).

### Conventions (enforced — see `CLAUDE.md`)

- **No `as`** except `as const` and inside `lib/types/guards.ts`. (PR1 adds no guards — the new columns aren't read from the DB until PR3, so caller-less guards would be dead code. Guards land in PR3.)
- **No `unknown` / no `Record<string, unknown>`.** Typed key unions only. `Record<ResourceType, number>` is correct and idiomatic (mirrors `Record<EconomyType, ...>`).
- New union types are **literal unions in `lib/types/game.ts`**, with constant tables keyed `Record<Union, …>` in `lib/constants/` (the exact `TraitId` ↔ `TRAITS` pattern).
- Engine helpers are pure (zero DB import), Vitest-tested.
- Discriminated unions for variant data (`{ kind: "archetype"; … } | { kind: "richness"; … } | { kind: "feature" }`).

---

## File structure (PR1)

**Create:**
- `lib/constants/bodies.ts` — `RESOURCE_TYPES`, `BODY_ARCHETYPES`, `SUN_CLASSES`, `RICHNESS_MODIFIERS` + their interfaces.
- `lib/constants/trait-migration.ts` — `TraitMigration` discriminated union + `TRAIT_MIGRATION` map (all 52 traits).
- `lib/engine/resources.ts` — `emptyResourceVector()`, `makeResourceVector(partial)` (pure).
- `lib/engine/__tests__/resources.test.ts`
- `lib/constants/__tests__/bodies.test.ts`
- `lib/constants/__tests__/trait-migration.test.ts`

**Modify:**
- `lib/types/game.ts` — add `ResourceType`, `SunClass`, `BodyArchetypeId`, `RichnessModifierId` literal unions + `ResourceVector` type alias.
- `prisma/schema.prisma` — add `SystemBody` model; add `sunClass`, `population`, `popCap`, 7 `agg*` columns + `bodies` relation to `StarSystem`.

**Untouched (proves "no wiring"):** `lib/engine/trait-gen.ts`, `lib/engine/universe-gen.ts`, `prisma/seed.ts`, every economy/tick/service/UI file. They keep running the old path.

---

## PR1 Tasks

### Task 1: Resource-vector type system

**Files:**
- Modify: `lib/types/game.ts` (add after the existing `EconomyType` / `TraitCategory` unions)

- [ ] **Step 1: Add the literal unions + `ResourceVector` alias**

In `lib/types/game.ts`, add:

```typescript
// ── Physical substrate (economy-simulation SP1) ───────────────────

/** The seven locked tier-0 resource types a body's resource base spans. */
export type ResourceType =
  | "gas"
  | "minerals"
  | "ore"
  | "biomass"
  | "arable"
  | "water"
  | "radioactive";

/** A magnitude per resource type. Used for body resource bases and system aggregates. */
export type ResourceVector = Record<ResourceType, number>;

/** Sun class — gates which body archetypes a system can roll. */
export type SunClass = "blue_white" | "yellow" | "orange_dwarf" | "red_dwarf";

/** Body archetype ids (one per curated world/belt kind). */
export type BodyArchetypeId =
  | "garden_world"
  | "ocean_world"
  | "jungle_world"
  | "arid_world"
  | "volcanic_world"
  | "frozen_world"
  | "barren_rock"
  | "gas_giant"
  | "asteroid_belt";

/** Richness-modifier ids — rare multipliers on a single resource (the old "resource traits"). */
export type RichnessModifierId =
  | "hydrocarbon_deposits"
  | "fertile_soil"
  | "coral_reefs"
  | "tectonic_concentration"
  | "mineral_moons"
  | "ice_rings"
  | "rare_earth"
  | "heavy_metals"
  | "organic_compounds"
  | "helium3"
  | "radioactive_lode"
  | "superdense"
  | "glacial_aquifer";
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors). These are pure type additions with no consumers yet.

- [ ] **Step 3: Commit**

```bash
git add lib/types/game.ts
git commit -m "feat(economy): add resource-vector & substrate union types"
```

---

### Task 2: Pure resource-vector helper

**Files:**
- Create: `lib/engine/resources.ts`
- Test: `lib/engine/__tests__/resources.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/engine/__tests__/resources.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { emptyResourceVector, makeResourceVector } from "../resources";
import type { ResourceType } from "@/lib/types/game";

const ALL: ResourceType[] = [
  "gas", "minerals", "ore", "biomass", "arable", "water", "radioactive",
];

describe("emptyResourceVector", () => {
  it("returns all seven types at zero", () => {
    const v = emptyResourceVector();
    expect(Object.keys(v).sort()).toEqual([...ALL].sort());
    for (const t of ALL) expect(v[t]).toBe(0);
  });

  it("returns a fresh object each call (no shared mutation)", () => {
    const a = emptyResourceVector();
    a.gas = 5;
    expect(emptyResourceVector().gas).toBe(0);
  });
});

describe("makeResourceVector", () => {
  it("fills unspecified types with zero", () => {
    const v = makeResourceVector({ gas: 3, ore: 2 });
    expect(v.gas).toBe(3);
    expect(v.ore).toBe(2);
    expect(v.minerals).toBe(0);
    expect(v.water).toBe(0);
    expect(Object.keys(v).sort()).toEqual([...ALL].sort());
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/engine/__tests__/resources.test.ts`
Expected: FAIL — `Cannot find module '../resources'`.

- [ ] **Step 3: Implement the helper**

Create `lib/engine/resources.ts`:

```typescript
/**
 * Pure resource-vector helpers — zero DB dependency.
 * A ResourceVector is a magnitude per tier-0 resource type.
 */
import type { ResourceType, ResourceVector } from "@/lib/types/game";

/** The seven locked tier-0 resource types, in canonical order. */
export const RESOURCE_TYPES: readonly ResourceType[] = [
  "gas", "minerals", "ore", "biomass", "arable", "water", "radioactive",
] as const;

/** A fresh vector with every resource at zero. */
export function emptyResourceVector(): ResourceVector {
  return { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 };
}

/** Build a full vector from a partial, filling unspecified types with zero. */
export function makeResourceVector(partial: Partial<ResourceVector>): ResourceVector {
  const v = emptyResourceVector();
  for (const type of RESOURCE_TYPES) {
    const supplied = partial[type];
    if (supplied !== undefined) v[type] = supplied;
  }
  return v;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run lib/engine/__tests__/resources.test.ts`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/resources.ts lib/engine/__tests__/resources.test.ts
git commit -m "feat(economy): add pure resource-vector helpers"
```

---

### Task 3: Body-archetype & sun-class constant tables

**Files:**
- Create: `lib/constants/bodies.ts`
- Test: `lib/constants/__tests__/bodies.test.ts`

> Resource magnitudes below are **relative weights (0–3)** from SP1 spec §3.2 — *not* final tuned numbers. PR3 + the simulator turn these into magnitudes via variance × size × richness. Pop-cap weights use the band High=12 / Med=7 / Low=3 / VeryLow=1.

- [ ] **Step 1: Write the failing test**

Create `lib/constants/__tests__/bodies.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  BODY_ARCHETYPES, SUN_CLASSES, RICHNESS_MODIFIERS, RESOURCE_TYPES,
} from "../bodies";
import type { BodyArchetypeId, ResourceType, SunClass } from "@/lib/types/game";

const ARCHETYPE_IDS = Object.keys(BODY_ARCHETYPES) as BodyArchetypeId[];
const SUN_CLASS_IDS = Object.keys(SUN_CLASSES) as SunClass[];

describe("BODY_ARCHETYPES", () => {
  it("every archetype defines all seven resource types", () => {
    for (const id of ARCHETYPE_IDS) {
      const keys = Object.keys(BODY_ARCHETYPES[id].resourceBase).sort();
      expect(keys).toEqual([...RESOURCE_TYPES].sort());
    }
  });

  it("every archetype has a positive pop-cap weight and a defined habitability", () => {
    for (const id of ARCHETYPE_IDS) {
      expect(BODY_ARCHETYPES[id].popCapWeight).toBeGreaterThan(0);
      expect(typeof BODY_ARCHETYPES[id].habitable).toBe("boolean");
    }
  });

  it("the id key matches the entry's id field", () => {
    for (const id of ARCHETYPE_IDS) expect(BODY_ARCHETYPES[id].id).toBe(id);
  });
});

describe("SUN_CLASSES", () => {
  it("every class has a positive weight and a sane body-count band", () => {
    for (const id of SUN_CLASS_IDS) {
      const c = SUN_CLASSES[id];
      expect(c.weight).toBeGreaterThan(0);
      expect(c.bodyCount.min).toBeGreaterThanOrEqual(1);
      expect(c.bodyCount.max).toBeGreaterThanOrEqual(c.bodyCount.min);
    }
  });

  it("archetype weights reference valid archetypes, are non-negative, and at least one is positive", () => {
    for (const id of SUN_CLASS_IDS) {
      const weights = SUN_CLASSES[id].archetypeWeights;
      let anyPositive = false;
      for (const [arch, w] of Object.entries(weights)) {
        expect(ARCHETYPE_IDS).toContain(arch);
        expect(w).toBeGreaterThanOrEqual(0);
        if (w > 0) anyPositive = true;
      }
      expect(anyPositive).toBe(true);
    }
  });
});

describe("RICHNESS_MODIFIERS", () => {
  it("every modifier targets a valid resource, multiplies > 1, and has positive rarity", () => {
    const resourceSet = new Set<ResourceType>(RESOURCE_TYPES);
    for (const [id, mod] of Object.entries(RICHNESS_MODIFIERS)) {
      expect(mod.id).toBe(id);
      expect(resourceSet.has(mod.resource)).toBe(true);
      expect(mod.multiplier).toBeGreaterThan(1);
      expect(mod.rarity).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/constants/__tests__/bodies.test.ts`
Expected: FAIL — `Cannot find module '../bodies'`.

- [ ] **Step 3: Implement the constant tables**

Create `lib/constants/bodies.ts`:

```typescript
import type {
  BodyArchetypeId, ResourceType, ResourceVector, RichnessModifierId, SunClass,
} from "@/lib/types/game";
import { makeResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";

export { RESOURCE_TYPES };

// ── Body archetypes ───────────────────────────────────────────────
// resourceBase magnitudes are RELATIVE weights (0–3), tuned to real
// magnitudes in PR3 via variance × size × richness. (SP1 spec §3.2)

export interface BodyArchetype {
  id: BodyArchetypeId;
  name: string;
  habitable: boolean;
  resourceBase: ResourceVector;
  /** Relative population-capacity weight (band: High 12 / Med 7 / Low 3 / VeryLow 1). */
  popCapWeight: number;
  /** Body-type danger contribution (consumed by PR2's danger-from-bodies derivation). */
  dangerBaseline: number;
}

export const BODY_ARCHETYPES: Record<BodyArchetypeId, BodyArchetype> = {
  garden_world: {
    id: "garden_world", name: "Garden World", habitable: true,
    resourceBase: makeResourceVector({ minerals: 1, ore: 1, biomass: 2, arable: 3, water: 2 }),
    popCapWeight: 12, dangerBaseline: 0,
  },
  ocean_world: {
    id: "ocean_world", name: "Ocean World", habitable: true,
    resourceBase: makeResourceVector({ biomass: 2, arable: 1, water: 3 }),
    popCapWeight: 12, dangerBaseline: 0,
  },
  jungle_world: {
    id: "jungle_world", name: "Jungle World", habitable: true,
    resourceBase: makeResourceVector({ ore: 1, biomass: 3, arable: 2, water: 2 }),
    popCapWeight: 7, dangerBaseline: 0,
  },
  arid_world: {
    id: "arid_world", name: "Arid World", habitable: true,
    resourceBase: makeResourceVector({ minerals: 2, ore: 2, arable: 1, radioactive: 1 }),
    popCapWeight: 3, dangerBaseline: 0,
  },
  volcanic_world: {
    id: "volcanic_world", name: "Volcanic World", habitable: false,
    resourceBase: makeResourceVector({ gas: 1, minerals: 2, ore: 3, radioactive: 2 }),
    popCapWeight: 1, dangerBaseline: 0.05,
  },
  frozen_world: {
    id: "frozen_world", name: "Frozen World", habitable: false,
    resourceBase: makeResourceVector({ gas: 1, ore: 1, water: 3 }),
    popCapWeight: 1, dangerBaseline: 0,
  },
  barren_rock: {
    id: "barren_rock", name: "Barren Rock", habitable: false,
    resourceBase: makeResourceVector({ minerals: 2, ore: 2, radioactive: 1 }),
    popCapWeight: 1, dangerBaseline: 0,
  },
  gas_giant: {
    id: "gas_giant", name: "Gas Giant", habitable: false,
    resourceBase: makeResourceVector({ gas: 3, water: 1 }),
    popCapWeight: 1, dangerBaseline: 0,
  },
  asteroid_belt: {
    id: "asteroid_belt", name: "Asteroid Belt", habitable: false,
    resourceBase: makeResourceVector({ minerals: 3, ore: 3, radioactive: 1 }),
    popCapWeight: 1, dangerBaseline: 0,
  },
};

// ── Sun classes ───────────────────────────────────────────────────
// weight = selection weight; archetypeWeights absent/0 = suppressed. (SP1 spec §3.1)

export interface SunClassDef {
  id: SunClass;
  name: string;
  weight: number;
  bodyCount: { min: number; max: number };
  archetypeWeights: Partial<Record<BodyArchetypeId, number>>;
}

export const SUN_CLASSES: Record<SunClass, SunClassDef> = {
  yellow: {
    id: "yellow", name: "Yellow (Sol-like)", weight: 35, bodyCount: { min: 2, max: 5 },
    archetypeWeights: {
      garden_world: 4, ocean_world: 3, jungle_world: 3, arid_world: 2,
      volcanic_world: 1, frozen_world: 1, barren_rock: 2, gas_giant: 2, asteroid_belt: 2,
    },
  },
  blue_white: {
    id: "blue_white", name: "Blue–white (hot)", weight: 20, bodyCount: { min: 1, max: 4 },
    archetypeWeights: {
      volcanic_world: 4, barren_rock: 3, asteroid_belt: 3, arid_world: 1, gas_giant: 1,
    },
  },
  orange_dwarf: {
    id: "orange_dwarf", name: "Orange dwarf (cool)", weight: 25, bodyCount: { min: 2, max: 4 },
    archetypeWeights: {
      garden_world: 1, ocean_world: 3, jungle_world: 1, arid_world: 2,
      frozen_world: 3, barren_rock: 2, gas_giant: 2, asteroid_belt: 2,
    },
  },
  red_dwarf: {
    id: "red_dwarf", name: "Red dwarf (cold)", weight: 20, bodyCount: { min: 1, max: 3 },
    archetypeWeights: {
      arid_world: 1, frozen_world: 3, barren_rock: 3, gas_giant: 3, asteroid_belt: 3,
    },
  },
};

// ── Richness modifiers ────────────────────────────────────────────
// Rare multipliers on a single resource (the old "resource traits"). multiplier &
// rarity are first-draft, tuned in PR3. id matches the TRAIT_MIGRATION richness target.

export interface RichnessModifier {
  id: RichnessModifierId;
  name: string;
  resource: ResourceType;
  multiplier: number;
  /** Relative roll weight when richness is rolled onto an eligible body. */
  rarity: number;
  description: string;
}

export const RICHNESS_MODIFIERS: Record<RichnessModifierId, RichnessModifier> = {
  hydrocarbon_deposits: { id: "hydrocarbon_deposits", name: "Hydrocarbon Deposits", resource: "gas", multiplier: 1.5, rarity: 1, description: "Seas of liquid hydrocarbons — a rich gas/chemical feedstock." },
  fertile_soil: { id: "fertile_soil", name: "Fertile Lowlands", resource: "arable", multiplier: 1.5, rarity: 1, description: "Exceptionally fertile soil over wide lowlands." },
  coral_reefs: { id: "coral_reefs", name: "Coral Archipelago", resource: "biomass", multiplier: 1.4, rarity: 1, description: "Vast shallow-sea ecosystems teeming with marine biomass." },
  tectonic_concentration: { id: "tectonic_concentration", name: "Tectonic Forge", resource: "ore", multiplier: 1.5, rarity: 1, description: "Geological pressure concentrates ore near the surface." },
  mineral_moons: { id: "mineral_moons", name: "Mineral-Rich Moons", resource: "minerals", multiplier: 1.4, rarity: 1, description: "Satellite bodies with solid mineral deposits." },
  ice_rings: { id: "ice_rings", name: "Ring System", resource: "water", multiplier: 1.4, rarity: 1, description: "Dense bands of ice yield abundant water." },
  rare_earth: { id: "rare_earth", name: "Rare Earth Deposits", resource: "minerals", multiplier: 1.5, rarity: 1, description: "Concentrations of rare-earth elements." },
  heavy_metals: { id: "heavy_metals", name: "Heavy Metal Veins", resource: "ore", multiplier: 1.6, rarity: 1, description: "Rich veins of titanium, tungsten, and uranium." },
  organic_compounds: { id: "organic_compounds", name: "Organic Compounds", resource: "biomass", multiplier: 1.4, rarity: 1, description: "Pre-biotic chemistry and complex organic deposits." },
  helium3: { id: "helium3", name: "Helium-3 Reserves", resource: "gas", multiplier: 1.6, rarity: 1, description: "Strategically valuable fusion-fuel gas reserves." },
  radioactive_lode: { id: "radioactive_lode", name: "Radioactive Deposits", resource: "radioactive", multiplier: 1.6, rarity: 1, description: "Fissile-material reserves — high value, hazardous." },
  superdense: { id: "superdense", name: "Superdense Core", resource: "ore", multiplier: 1.6, rarity: 1, description: "An ultra-dense core yields extreme ore concentrations." },
  glacial_aquifer: { id: "glacial_aquifer", name: "Glacial Aquifer", resource: "water", multiplier: 1.6, rarity: 1, description: "Immense underground frozen-water reserves." },
};
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run lib/constants/__tests__/bodies.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/bodies.ts lib/constants/__tests__/bodies.test.ts
git commit -m "feat(economy): add body-archetype, sun-class & richness-modifier tables"
```

---

### Task 4: The 52-trait migration map

**Files:**
- Create: `lib/constants/trait-migration.ts`
- Test: `lib/constants/__tests__/trait-migration.test.ts`

> **The rule** (SP1 spec §4.1): each old trait becomes **archetype** (world/body type), **richness** (abundance of one tier-0 resource), or **feature** (narrative — survives in `SystemTrait`).
> **Hard override:** any trait in `SURVEY/SALVAGE/RECON_ELIGIBLE_TRAITS` **must** be a feature, or its missions break. This forces `crystalline_formations` and `tidally_locked_world` to features even though they read as resource/body — the override is intentional and the test below enforces it.
> Counts: **8 archetype**, **13 richness**, **31 feature** = 52. (`barren_rock` is generation-only — no source trait maps to it.)

- [ ] **Step 1: Write the failing test**

Create `lib/constants/__tests__/trait-migration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { TRAIT_MIGRATION } from "../trait-migration";
import { BODY_ARCHETYPES, RICHNESS_MODIFIERS } from "../bodies";
import { ALL_TRAIT_IDS } from "@/lib/constants/traits";
import {
  SURVEY_ELIGIBLE_TRAITS, SALVAGE_ELIGIBLE_TRAITS, RECON_ELIGIBLE_TRAITS,
} from "@/lib/constants/missions";

describe("TRAIT_MIGRATION", () => {
  it("classifies every trait exactly once and adds no extras", () => {
    expect(Object.keys(TRAIT_MIGRATION).sort()).toEqual([...ALL_TRAIT_IDS].sort());
  });

  it("archetype targets are valid body archetypes", () => {
    for (const m of Object.values(TRAIT_MIGRATION)) {
      if (m.kind === "archetype") expect(BODY_ARCHETYPES[m.archetype]).toBeDefined();
    }
  });

  it("richness targets are valid richness modifiers", () => {
    for (const m of Object.values(TRAIT_MIGRATION)) {
      if (m.kind === "richness") expect(RICHNESS_MODIFIERS[m.modifier]).toBeDefined();
    }
  });

  it("every mission-eligible trait survives as a feature", () => {
    const eligible = new Set<string>([
      ...SURVEY_ELIGIBLE_TRAITS, ...SALVAGE_ELIGIBLE_TRAITS, ...RECON_ELIGIBLE_TRAITS,
    ]);
    for (const traitId of eligible) {
      expect(TRAIT_MIGRATION[traitId]?.kind).toBe("feature");
    }
  });

  it("has the expected bucket counts (8 archetype / 13 richness / 31 feature)", () => {
    const counts = { archetype: 0, richness: 0, feature: 0 };
    for (const m of Object.values(TRAIT_MIGRATION)) counts[m.kind]++;
    expect(counts).toEqual({ archetype: 8, richness: 13, feature: 31 });
  });
});
```

> Note: this test imports `ALL_TRAIT_IDS`, `SURVEY/SALVAGE/RECON_ELIGIBLE_TRAITS` — confirm the exact export names in `lib/constants/missions.ts` while writing; adjust the import if they differ. If a list is exported under a different name, fix the import, not the assertion.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/constants/__tests__/trait-migration.test.ts`
Expected: FAIL — `Cannot find module '../trait-migration'`.

- [ ] **Step 3: Implement the migration map**

Create `lib/constants/trait-migration.ts`:

```typescript
import type { BodyArchetypeId, RichnessModifierId, TraitId } from "@/lib/types/game";

/** How an old trait is reclassified in the substrate rebuild. */
export type TraitMigration =
  | { kind: "archetype"; archetype: BodyArchetypeId }
  | { kind: "richness"; modifier: RichnessModifierId }
  | { kind: "feature" };

/**
 * The full reclassification of the legacy 52-trait catalog (SP1 spec §4.1).
 * - archetype: trait was a world/body type → becomes a body archetype (trait disappears).
 * - richness:  trait was "abundant resource X" → becomes a richness modifier (trait disappears).
 * - feature:   trait was narrative → survives in SystemTrait, economy fields retired (PR3).
 *
 * Override: every SURVEY/SALVAGE/RECON-eligible trait is a feature (else its missions break) —
 * this is why crystalline_formations & tidally_locked_world are features, not richness/archetype.
 */
export const TRAIT_MIGRATION: Record<TraitId, TraitMigration> = {
  // ── Archetypes (8) — world/body types ──
  habitable_world: { kind: "archetype", archetype: "garden_world" },
  ocean_world: { kind: "archetype", archetype: "ocean_world" },
  jungle_world: { kind: "archetype", archetype: "jungle_world" },
  desert_world: { kind: "archetype", archetype: "arid_world" },
  volcanic_world: { kind: "archetype", archetype: "volcanic_world" },
  frozen_world: { kind: "archetype", archetype: "frozen_world" },
  gas_giant: { kind: "archetype", archetype: "gas_giant" },
  asteroid_belt: { kind: "archetype", archetype: "asteroid_belt" },

  // ── Richness modifiers (13) — abundance of one tier-0 resource ──
  hydrocarbon_seas: { kind: "richness", modifier: "hydrocarbon_deposits" },
  fertile_lowlands: { kind: "richness", modifier: "fertile_soil" },
  coral_archipelago: { kind: "richness", modifier: "coral_reefs" },
  tectonic_forge: { kind: "richness", modifier: "tectonic_concentration" },
  mineral_rich_moons: { kind: "richness", modifier: "mineral_moons" },
  ring_system: { kind: "richness", modifier: "ice_rings" },
  rare_earth_deposits: { kind: "richness", modifier: "rare_earth" },
  heavy_metal_veins: { kind: "richness", modifier: "heavy_metals" },
  organic_compounds: { kind: "richness", modifier: "organic_compounds" },
  helium3_reserves: { kind: "richness", modifier: "helium3" },
  radioactive_deposits: { kind: "richness", modifier: "radioactive_lode" },
  superdense_core: { kind: "richness", modifier: "superdense" },
  glacial_aquifer: { kind: "richness", modifier: "glacial_aquifer" },

  // ── Features (31) — narrative survivors (incl. mission-eligible overrides) ──
  tidally_locked_world: { kind: "feature" },   // override: survey-eligible
  crystalline_formations: { kind: "feature" }, // override: survey-eligible
  geothermal_vents: { kind: "feature" },
  exotic_matter_traces: { kind: "feature" },
  binary_star: { kind: "feature" },
  lagrange_stations: { kind: "feature" },
  captured_rogue_body: { kind: "feature" },
  deep_space_beacon: { kind: "feature" },
  nebula_proximity: { kind: "feature" },
  solar_flare_activity: { kind: "feature" },
  gravitational_anomaly: { kind: "feature" },
  dark_nebula: { kind: "feature" },
  precursor_ruins: { kind: "feature" },
  subspace_rift: { kind: "feature" },
  pulsar_proximity: { kind: "feature" },
  ion_storm_corridor: { kind: "feature" },
  bioluminescent_ecosystem: { kind: "feature" },
  signal_anomaly: { kind: "feature" },
  xenobiology_preserve: { kind: "feature" },
  ancient_minefield: { kind: "feature" },
  pirate_stronghold: { kind: "feature" },
  ancient_trade_route: { kind: "feature" },
  generation_ship_wreckage: { kind: "feature" },
  orbital_ring_remnant: { kind: "feature" },
  seed_vault: { kind: "feature" },
  colonial_capital: { kind: "feature" },
  free_port_declaration: { kind: "feature" },
  shipbreaking_yards: { kind: "feature" },
  derelict_fleet: { kind: "feature" },
  abandoned_station: { kind: "feature" },
  smuggler_haven: { kind: "feature" },
};
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run lib/constants/__tests__/trait-migration.test.ts`
Expected: PASS. If "classifies every trait exactly once" fails, the catalog count differs from 52 — reconcile against `ALL_TRAIT_IDS` (do not silently drop a trait). If "mission-eligible … feature" fails, a list member was bucketed as archetype/richness — flip it to feature.

- [ ] **Step 5: Commit**

```bash
git add lib/constants/trait-migration.ts lib/constants/__tests__/trait-migration.test.ts
git commit -m "feat(economy): add 52-trait substrate migration map"
```

---

### Task 5: Additive Prisma schema (`SystemBody` + `StarSystem` aggregates)

**Files:**
- Modify: `prisma/schema.prisma` (`StarSystem` model at ~line 195; add `SystemBody` after it)

> All new `StarSystem` columns get defaults and `SystemBody` starts empty, so existing rows + the **unchanged** seed still work and nothing reads these yet. PR3 populates them at reseed.

- [ ] **Step 1: Add the new columns to `StarSystem`**

In `prisma/schema.prisma`, inside `model StarSystem { … }`, add after `tradeVolumeAccum`:

```prisma
  // ── Physical substrate (economy-simulation SP1) ──
  sunClass         String  @default("yellow")  // SunClass — overwritten at PR3 reseed
  population       Int     @default(0)          // abstract magnitude
  popCap           Float   @default(0)          // Σ(body popCapWeight × size)
  aggGas           Float   @default(0)
  aggMinerals      Float   @default(0)
  aggOre           Float   @default(0)
  aggBiomass       Float   @default(0)
  aggArable        Float   @default(0)
  aggWater         Float   @default(0)
  aggRadioactive   Float   @default(0)
```

And add to the relations block (next to `traits SystemTrait[]`):

```prisma
  bodies            SystemBody[]
```

- [ ] **Step 2: Add the `SystemBody` model**

Immediately after the `StarSystem` model's closing brace, add:

```prisma
model SystemBody {
  id                String  @id @default(cuid())
  systemId          String
  bodyType          String  // BodyArchetypeId
  habitable         Boolean @default(false)
  size              Float   @default(1)
  // Resource base — scalar columns (one ResourceVector). Caps on tier-0 yield.
  resGas            Float   @default(0)
  resMinerals       Float   @default(0)
  resOre            Float   @default(0)
  resBiomass        Float   @default(0)
  resArable         Float   @default(0)
  resWater          Float   @default(0)
  resRadioactive    Float   @default(0)
  popCapWeight      Float   @default(0)
  richnessModifiers String[] @default([])  // RichnessModifierId[]

  system StarSystem @relation(fields: [systemId], references: [id], onDelete: Cascade)

  @@index([systemId])
}
```

- [ ] **Step 3: Validate the schema**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀".

- [ ] **Step 4: Regenerate the client**

Run: `npx prisma generate`
Expected: client regenerates with `SystemBody` and the new `StarSystem` fields, no errors.

- [ ] **Step 5: Push to the dev database**

Requires the local Postgres running (see `/bootstrap`). Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." (Additive — no destructive prompts. Existing rows take defaults; `SystemBody` is empty.)

- [ ] **Step 6: Confirm the app still typechecks & builds**

Run: `npx tsc --noEmit`
Expected: PASS — no consumer references the new fields yet.

Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(economy): add SystemBody model + StarSystem substrate aggregates (additive)"
```

---

### Task 6: PR1 verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite is green**

Run: `npm run test:unit` (falls back to `npx vitest run` if that script is absent)
Expected: PASS, including the three new test files.

- [ ] **Step 2: Economy plays identically — simulator parity**

Run: `npm run simulate`
Expected: completes 500 ticks at seed 42 with the same equilibrium summary as before this PR (PR1 touches no economy code or generation). If the numbers moved, something is wired that shouldn't be — investigate before proceeding.

- [ ] **Step 3: Confirm "no wiring"**

Run a search to prove the new modules have no production consumers yet:
Expected: `bodies`, `trait-migration`, and `resources` are imported **only** from their own test files (plus `bodies.ts` importing `resources.ts`). `trait-gen.ts`, `universe-gen.ts`, and `seed.ts` are unchanged in this PR (`git diff --stat main..HEAD` shows only the files listed in the File Structure section).

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/economy-simulation
gh pr create --base main --title "feat(economy): SP1 Part 1 PR1 — substrate foundation (schema, types, tables)" \
  --body "Additive foundation for the economy-simulation substrate. New SystemBody schema + StarSystem aggregates, ResourceVector type system, and validated design-data tables (archetypes, sun classes, richness modifiers, 52-trait migration map). No wiring — game runs identically; simulate parity holds. Next: PR2 (detach consumers)."
```

> If the project convention is to PR into the shared branch rather than `main` directly, target the shared `feat/economy-simulation` branch per the workflow memory. Confirm before pushing.

---

## PR1 success criteria

1. `SystemBody` model + `StarSystem` aggregates (`sunClass`, `population`, `popCap`, 7 `agg*`) exist and `prisma db push` succeeds.
2. `ResourceType`, `SunClass`, `BodyArchetypeId`, `RichnessModifierId`, `ResourceVector` are declared in `lib/types/game.ts`.
3. `BODY_ARCHETYPES` (9), `SUN_CLASSES` (4), `RICHNESS_MODIFIERS` (13), and `TRAIT_MIGRATION` (52, validated 8/13/31) are present and tested.
4. Every mission-eligible trait is classified as a feature (test-enforced).
5. `npm run test:unit` and `npm run simulate` both pass, with simulate **parity** to pre-PR1 (no economy/generation change).
6. No `as` (outside `as const`), no `unknown`, no `Record<string, unknown>`. The new modules have no production consumers.

---

## PR2 — Detach consumers (roadmap; bite-sized plan authored after PR1)

**Goal:** Sever the survey/danger/events/rendering consumers from the economy-trait coupling, **behaviour-preserving against today's world**, so PR3 can prune the catalog and strip economy fields without breaking them.

**Why these, and only these:** PR1's migration test guarantees every mission-eligible trait survives as a feature — so survey/salvage/recon need **near-zero** change (the spec's prediction). The real work is danger and the "features" accessor.

Likely tasks:
- **`features` accessor.** Add a helper that returns the narrative-trait subset of a system's traits (driven by `TRAIT_MIGRATION[...].kind === "feature"`). Today every trait is still present, so in PR2 this filters the current rows; post-reseed it's all that remains. Re-point survey/salvage/recon candidate selection and the system-detail/`enrichTraits` rendering to read through it.
- **Danger re-base.** Today `computeTraitDanger` sums `dangerModifier` over *all* traits — including ones that become archetypes (`volcanic_world` +0.05) or richness (`radioactive_deposits` +0.04), whose danger would vanish at reseed. Introduce a "danger from features + body-type baselines" derivation (`BODY_ARCHETYPES[…].dangerBaseline` already exists from PR1). In PR2 there are no bodies yet, so a transition path keeps the pre-reseed danger identical (sum surviving-feature `dangerModifier` + the body-type danger of the *archetype the system's body-defining trait maps to*), flipping to real `SystemBody` rows in PR3.
- **Events.** Confirm event spawn weighting reads government/features only; remove any economic-trait dependency. (Per SP1 spec §4.4 events only get *decoupled* here — the physical-perturbation redesign is SP4.)
- **Verification:** danger/survey/mission outputs unchanged for the current seed; `npm run simulate` parity; full suite green.

Open item to resolve in the PR2 plan: whether the transition danger path is worth its complexity or whether a small, documented danger delta at reseed is acceptable (PR3 reseeds anyway).

## PR3 — Rebuild + reseed (roadmap; bite-sized plan authored after PR2)

**Goal:** Replace trait-based generation with sun → bodies → features → population, persist it, full reseed, and run the economy via the derived economy-type shim. After PR3, "Part 1" is done (SP1 spec §11).

Likely tasks:
- **Generation rewrite** (`lib/engine/universe-gen.ts` + retire trait economy bits in `lib/engine/trait-gen.ts`): per system — roll `sunClass` (weighted by `SUN_CLASSES[*].weight`), roll body count + archetype mix (`bodyCount`, `archetypeWeights`), per body roll size + `makeResourceVector` from the archetype profile × variance + roll richness modifiers (mutating one resource column), sum bodies → system aggregate vector + `popCap`, seed `population` (partial/varied fraction of `popCap` by habitability), roll 0–N **features** uniformly (drop the guaranteed-economy first roll), derive the economy-type **shim** label. Extend `GeneratedSystem` with `sunClass`, `bodies[]`, aggregate vector, `popCap`, `population`.
- **Economy-type shim** (`lib/engine/` — deleted in SP1 Part 2): `deriveEconomyTypeLabel(aggregate: ResourceVector, population: number) → EconomyType`. Heuristic (tunable): dominant arable/biomass → `agricultural`; dominant ore/minerals/gas/radioactive → `extraction`; high population + balanced → `core`/`industrial`; refinery/tech fall out of mixes. Must return one of the 6 `EconomyType` values so `getInitialStock`, the sim world, and `Region.dominantEconomy` keep working **unchanged** (call site: `universe-gen.ts:211/362`).
- **Add the column↔vector bridge** (`lib/engine/resources.ts`): `resourceVectorFromColumns(row)` / column-spread for writes, plus `sumResourceVectors(...)` for the aggregate — *now* they have callers.
- **Add guards** (`lib/types/guards.ts`): `toSunClass`, `toBodyArchetypeId`, `toResourceType`, `toRichnessModifierId` — for reading `SystemBody.bodyType` / `sunClass` / `richnessModifiers[]` back from the DB.
- **Seed rewrite** (`prisma/seed.ts`): write `SystemBody` rows (batched — `createMany`/`unnest` per the 10K-scale gotcha, not per-row), the denormalized aggregates + `population` + `sunClass` on `StarSystem`, and the pruned `SystemTrait` (feature) rows. **Full reseed.**
- **Prune & strip:** reduce the `TRAITS` catalog to the 31 feature survivors and retire their `economyAffinity` / `productionGoods` fields; flip the danger derivation to real bodies; update `lib/types/game.ts` `TraitId` to the feature subset; update map/`system-traits.md`.
- **Verification:** generated universes are coherent (sun-gated, populated, resource-bearing), partial/varied (developed-core-vs-frontier), `npm run simulate` still passes via the shim, full suite + build green. **Resource-mix gate:** the simulator must confirm a healthy galaxy-wide mix — every tier-0 resource adequately produced, and no region catastrophically starved of a staple (especially arable→food) — re-tuning the `SUN_CLASSES` weights if not. Some regional scarcity is *wanted* (it drives the need-cascade trade loop); the gate only catches the pathological extreme, and we tune emergently rather than hard-coding guarantees.

Open items for the PR3 plan: exact shim heuristic thresholds; archetype variance band + size model; partial-seed fraction curve vs habitability; population magnitude scale (calibrated with per-capita rates in Part 2); whether to also batch the existing market seed writes; whether sun class rolls **IID per system** (food producers sprinkle evenly across regions — the safe default for trade gameplay) or with regional correlation (more evocative stellar regions, but higher food-desert risk).

---

## Self-review notes (author, pre-handoff)

- **Spec coverage (PR1 scope):** schema (§3.3, §1 body-model decision) ✓ Task 5; resource-vector typing (§12 schema item) ✓ Tasks 1–2; archetypes/sun classes/richness (§3.1–§3.4) ✓ Task 3; 52-trait migration (§4.1) ✓ Task 4; "economy plays identically / no wiring" (§2 Part-1-lands-alone, §11.5) ✓ Task 6. Population *derivation* + generation + shim are correctly deferred to PR3 (§5, §6, §7) — PR1 only adds the `population`/`popCap` columns.
- **Placeholder scan:** none — every step has concrete code/commands. PR2/PR3 sections are explicitly roadmap, not tasks.
- **Type consistency:** `ResourceVector` = `Record<ResourceType, number>` used uniformly; `BODY_ARCHETYPES`/`SUN_CLASSES`/`RICHNESS_MODIFIERS`/`TRAIT_MIGRATION` keyed by the Task 1 unions; `RESOURCE_TYPES` defined once in `resources.ts` and re-exported from `bodies.ts`; richness `modifier` ids in `TRAIT_MIGRATION` match `RICHNESS_MODIFIERS` keys (Task 4 test enforces).
- **Known follow-up wired forward:** the `crystalline_formations` / `tidally_locked_world` → feature override (mission survival) is captured in Task 4 + its test, and the danger-vanish risk it creates is explicitly handed to PR2.
