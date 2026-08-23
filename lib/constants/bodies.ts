import type {
  BodyArchetypeId, ResourceType, ResourceVector, SunClass,
} from "@/lib/types/game";
import { makeResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";

export { RESOURCE_TYPES };

// ── Body archetypes ───────────────────────────────────────────────
// Each body is a climate class on a freezing→volcanic spectrum. Every row now authors three
// independent budgets (people land, industry land, per-resource deposit counts) plus a
// habitability score, alongside the legacy partition columns kept transitionally below.

/** An authored [min, max] range, drawn uniform-in-range at generation. */
export interface CountRange {
  min: number;
  max: number;
}

export interface BodyArchetype {
  id: BodyArchetypeId;
  name: string;

  // ── Score / land / deposit model (habitability-seeding) ──────────
  /** Habitability score per pop type, in [0, 1]. One column ships (the default temperate preference). */
  scores: { default: number };
  /** People-land range — authored on every class that could ever host people (dark below threshold). */
  peopleLand: CountRange;
  /** Industry-land range — generous by default; a cramped archetype is a deliberate authoring choice. */
  industryLand: CountRange;
  /**
   * Per-resource authored extractor counts (integer [min, max] per resource). The typical band
   * is derived from demand at the 10,000-pop anchor: Σ GOOD_CONSUMPTION/OUTPUT_PER_UNIT × pop
   * across goods that consume the resource (e.g. water ≈ 35 extractors at anchor pop); the rich
   * end of a range reaches toward the 20,000-pop max. Bands are spread so a poor roll genuinely
   * binds extraction rather than sitting slack.
   */
  depositCounts: Partial<Record<ResourceType, CountRange>>;
  /** Extraction work modifier in (0, 1] — per-body difficulty, kept as its own aggregate (never folded into yieldMult). */
  extractionModifier: number;
  /** Hostile classes contribute NO deposits until a future technology unlocks them. */
  techLocked: boolean;
  /** Body-type danger contribution — summed into each system's body danger baseline. */
  dangerBaseline: number;

  // ── Legacy partition columns — superseded by the authored budgets; deleted when generation
  // reads the budget columns. ────────────────────────────────────────────────────────────────
  habitable: boolean;
  resourceBase: ResourceVector;
  /** Relative weight of fungible/buildable general space on this body type (higher = more land to develop). */
  generalWeight: number;
  /** Fraction of general space that is habitable (supports population centres). Range [0, 1]. */
  habitableFraction: number;
}

export const BODY_ARCHETYPES: Record<BodyArchetypeId, BodyArchetype> = {
  temperate_world: {
    id: "temperate_world", name: "Temperate World",
    scores: { default: 1.0 },
    peopleLand: { min: 450, max: 550 },
    industryLand: { min: 180, max: 300 },
    depositCounts: {
      minerals: { min: 1, max: 4 }, ore: { min: 1, max: 4 },
      biomass: { min: 3, max: 12 }, arable: { min: 18, max: 40 }, water: { min: 13, max: 29 },
    },
    extractionModifier: 1.0, techLocked: false, dangerBaseline: 0,
    habitable: true,
    resourceBase: makeResourceVector({ minerals: 1, ore: 1, biomass: 2, arable: 3, water: 2 }),
    generalWeight: 9, habitableFraction: 0.7,
  },
  gaia_world: {
    id: "gaia_world", name: "Gaia World",
    scores: { default: 1.0 },
    peopleLand: { min: 700, max: 1000 },
    industryLand: { min: 200, max: 300 },
    depositCounts: {
      arable: { min: 6, max: 14 }, water: { min: 7, max: 16 }, biomass: { min: 2, max: 6 },
    },
    extractionModifier: 1.0, techLocked: false, dangerBaseline: 0,
    habitable: true,
    resourceBase: makeResourceVector({ arable: 1, water: 1, biomass: 1 }),
    generalWeight: 10, habitableFraction: 0.9,
  },
  jungle_world: {
    id: "jungle_world", name: "Jungle World",
    scores: { default: 0.7 },
    peopleLand: { min: 400, max: 550 },
    industryLand: { min: 140, max: 240 },
    depositCounts: {
      ore: { min: 1, max: 4 }, biomass: { min: 5, max: 18 },
      arable: { min: 12, max: 26 }, water: { min: 13, max: 29 },
    },
    extractionModifier: 0.85, techLocked: false, dangerBaseline: 0,
    habitable: true,
    resourceBase: makeResourceVector({ ore: 1, biomass: 3, arable: 2, water: 2 }),
    generalWeight: 7, habitableFraction: 0.5,
  },
  ocean_world: {
    id: "ocean_world", name: "Ocean World",
    scores: { default: 0.65 },
    peopleLand: { min: 350, max: 500 },
    industryLand: { min: 120, max: 220 },
    depositCounts: {
      biomass: { min: 3, max: 12 }, arable: { min: 6, max: 14 }, water: { min: 20, max: 45 },
    },
    extractionModifier: 0.9, techLocked: false, dangerBaseline: 0,
    habitable: true,
    resourceBase: makeResourceVector({ biomass: 2, arable: 1, water: 3 }),
    generalWeight: 6, habitableFraction: 0.45,
  },
  boreal_world: {
    id: "boreal_world", name: "Boreal World",
    scores: { default: 0.6 },
    peopleLand: { min: 300, max: 450 },
    industryLand: { min: 100, max: 200 },
    depositCounts: {
      biomass: { min: 3, max: 12 }, water: { min: 13, max: 29 },
      arable: { min: 12, max: 26 }, ore: { min: 1, max: 4 },
    },
    extractionModifier: 0.85, techLocked: false, dangerBaseline: 0,
    habitable: true,
    resourceBase: makeResourceVector({ biomass: 2, water: 2, arable: 2, ore: 1 }),
    generalWeight: 6, habitableFraction: 0.4,
  },
  arid_world: {
    id: "arid_world", name: "Arid World",
    // Below HABITABILITY_THRESHOLD: hot-preference / terraforming territory — dark land until unlocked.
    scores: { default: 0.35 },
    peopleLand: { min: 150, max: 250 },
    industryLand: { min: 80, max: 180 },
    depositCounts: {
      minerals: { min: 2, max: 7 }, ore: { min: 2, max: 7 },
      arable: { min: 6, max: 14 }, radioactive: { min: 2, max: 7 },
    },
    extractionModifier: 0.8, techLocked: false, dangerBaseline: 0,
    habitable: true,
    resourceBase: makeResourceVector({ minerals: 2, ore: 2, arable: 1, radioactive: 1 }),
    generalWeight: 5, habitableFraction: 0.22,
  },
  tundra_world: {
    id: "tundra_world", name: "Tundra World",
    // Below HABITABILITY_THRESHOLD: cold-preference / terraforming territory — dark land until unlocked.
    scores: { default: 0.3 },
    peopleLand: { min: 100, max: 200 },
    industryLand: { min: 60, max: 150 },
    depositCounts: {
      water: { min: 13, max: 29 }, biomass: { min: 2, max: 6 }, arable: { min: 6, max: 14 },
    },
    extractionModifier: 0.75, techLocked: false, dangerBaseline: 0,
    habitable: false,
    resourceBase: makeResourceVector({ water: 2, biomass: 1, arable: 1 }),
    generalWeight: 4, habitableFraction: 0.05,
  },
  frozen_world: {
    id: "frozen_world", name: "Frozen World",
    scores: { default: 0.1 },
    peopleLand: { min: 0, max: 0 },
    industryLand: { min: 60, max: 150 },
    depositCounts: {
      gas: { min: 2, max: 6 }, ore: { min: 1, max: 4 }, water: { min: 20, max: 45 },
    },
    extractionModifier: 0.6, techLocked: false, dangerBaseline: 0,
    habitable: false,
    resourceBase: makeResourceVector({ gas: 1, ore: 1, water: 3 }),
    generalWeight: 3, habitableFraction: 0.03,
  },
  volcanic_world: {
    id: "volcanic_world", name: "Volcanic World",
    scores: { default: 0.05 },
    peopleLand: { min: 0, max: 0 },
    industryLand: { min: 80, max: 180 },
    depositCounts: {
      gas: { min: 2, max: 6 }, minerals: { min: 2, max: 7 },
      ore: { min: 3, max: 10 }, radioactive: { min: 4, max: 13 },
    },
    // Hostile — the stated hostile case: locked until a future technology.
    extractionModifier: 0.4, techLocked: true, dangerBaseline: 0.05,
    habitable: false,
    resourceBase: makeResourceVector({ gas: 1, minerals: 2, ore: 3, radioactive: 2 }),
    generalWeight: 2, habitableFraction: 0.02,
  },
  barren_rock: {
    id: "barren_rock", name: "Barren Rock",
    scores: { default: 0.05 },
    peopleLand: { min: 0, max: 0 },
    industryLand: { min: 60, max: 150 },
    depositCounts: {
      minerals: { min: 2, max: 7 }, ore: { min: 2, max: 7 }, radioactive: { min: 2, max: 7 },
    },
    // The mining-outpost backbone — deliberately NOT tech-locked (claim-1 evidence: dead-body deposits
    // carry colonisability today).
    extractionModifier: 0.7, techLocked: false, dangerBaseline: 0,
    habitable: false,
    resourceBase: makeResourceVector({ minerals: 2, ore: 2, radioactive: 1 }),
    generalWeight: 3, habitableFraction: 0.03,
  },
  asteroid_belt: {
    id: "asteroid_belt", name: "Asteroid Belt",
    scores: { default: 0.02 },
    peopleLand: { min: 0, max: 0 },
    industryLand: { min: 40, max: 120 },
    depositCounts: {
      minerals: { min: 3, max: 10 }, ore: { min: 3, max: 10 }, radioactive: { min: 2, max: 7 },
    },
    // The mining-outpost backbone — deliberately NOT tech-locked (claim-1 evidence: dead-body deposits
    // carry colonisability today).
    extractionModifier: 0.6, techLocked: false, dangerBaseline: 0,
    habitable: false,
    resourceBase: makeResourceVector({ minerals: 3, ore: 3, radioactive: 1 }),
    generalWeight: 2, habitableFraction: 0.02,
  },
  gas_giant: {
    id: "gas_giant", name: "Gas Giant",
    scores: { default: 0 },
    peopleLand: { min: 0, max: 0 },
    industryLand: { min: 40, max: 100 },
    depositCounts: {
      gas: { min: 5, max: 17 }, water: { min: 7, max: 16 },
    },
    // Gas giant deposits are locked until a future technology.
    extractionModifier: 0.3, techLocked: true, dangerBaseline: 0,
    habitable: false,
    resourceBase: makeResourceVector({ gas: 3, water: 1 }),
    generalWeight: 1, habitableFraction: 0,
  },
};

// ── Habitability thresholds and the count-damping ladder ───────────

/** A body's default-pop score must clear this to contribute people land ("above threshold"). */
export const HABITABILITY_THRESHOLD = 0.5;

/**
 * Multiplies an above-threshold class's roll weight by the count of above-threshold bodies
 * already rolled in the system, applied BEFORE the `w > 0` candidate filter. Index 0 (the
 * first habitable body) is always 1 — not calibration-owned. Indices 1-2 are first-cut
 * calibration outputs (constrained by the ≥2-in-5-10%, =3-in-≤1.5% targets; `npm run
 * report:coherence` owns the final tuning). Index 3 is a FIXED hard 0 — not tunable — so a
 * 4th above-threshold body is impossible by table, never by chance.
 */
export const HABITABLE_COUNT_DAMPING: readonly number[] = [1, 0.35, 0.08, 0] as const;

// ── Sun classes ───────────────────────────────────────────────────
// weight = selection weight; archetypeWeights absent/0 = suppressed.

export interface SunClassDef {
  id: SunClass;
  name: string;
  weight: number;
  bodyCount: { min: number; max: number };
  archetypeWeights: Partial<Record<BodyArchetypeId, number>>;
}

export const SUN_CLASSES: Record<SunClass, SunClassDef> = {
  yellow: {
    id: "yellow", name: "Yellow (Sol-like)", weight: 45, bodyCount: { min: 4, max: 8 },
    archetypeWeights: {
      temperate_world: 9, ocean_world: 6, jungle_world: 6, boreal_world: 3.5, gaia_world: 0.8,
      arid_world: 12, tundra_world: 8, volcanic_world: 10, frozen_world: 8,
      barren_rock: 16, gas_giant: 10, asteroid_belt: 10,
    },
  },
  blue_white: {
    id: "blue_white", name: "Blue–white (hot)", weight: 13, bodyCount: { min: 2, max: 5 },
    archetypeWeights: {
      // No above-threshold class, by design — blue-white waits for terraforming/adapted pop types.
      volcanic_world: 4, barren_rock: 3, asteroid_belt: 3, arid_world: 1, gas_giant: 1,
    },
  },
  orange_dwarf: {
    id: "orange_dwarf", name: "Orange dwarf (cool)", weight: 30, bodyCount: { min: 3, max: 7 },
    archetypeWeights: {
      temperate_world: 5, ocean_world: 8, jungle_world: 5, boreal_world: 9, gaia_world: 0.8,
      arid_world: 10, tundra_world: 10, frozen_world: 12,
      barren_rock: 14, gas_giant: 13, asteroid_belt: 12.5,
    },
  },
  red_dwarf: {
    id: "red_dwarf", name: "Red dwarf (cold)", weight: 12, bodyCount: { min: 2, max: 5 },
    archetypeWeights: {
      // No above-threshold class, by design — red-dwarf waits for terraforming/adapted pop types.
      arid_world: 1, tundra_world: 3, frozen_world: 4, barren_rock: 3, gas_giant: 3, asteroid_belt: 3,
    },
  },
};
