import type {
  BodyArchetypeId, ResourceType, SunClass,
} from "@/lib/types/game";
import { RESOURCE_TYPES } from "@/lib/engine/resources";

export { RESOURCE_TYPES };

// ── Body archetypes ───────────────────────────────────────────────
// Each body is a climate class on a freezing→volcanic spectrum. Every row authors two
// independent budgets — people land, per-resource deposit counts — plus a habitability
// score, an extraction work modifier and a tech lock. Industry buildings bill no land:
// labour, demand and decay bound them.

/** An authored [min, max] range, drawn uniform-in-range at generation. */
export interface CountRange {
  min: number;
  max: number;
}

export interface BodyArchetype {
  id: BodyArchetypeId;
  name: string;

  // ── Score / land / deposit model ──────────────────────────────────
  /** Habitability score per pop type, in [0, 1]. One column ships (the default temperate preference). */
  scores: { default: number };
  /** People-land range — authored on every class that could ever host people (dark below threshold). */
  peopleLand: CountRange;
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
}

export const BODY_ARCHETYPES: Record<BodyArchetypeId, BodyArchetype> = {
  temperate_world: {
    id: "temperate_world", name: "Temperate World",
    scores: { default: 1.0 },
    peopleLand: { min: 450, max: 550 },
    depositCounts: {
      minerals: { min: 1, max: 4 }, ore: { min: 1, max: 4 },
      biomass: { min: 3, max: 12 }, arable: { min: 18, max: 40 }, water: { min: 13, max: 29 },
    },
    extractionModifier: 1.0, techLocked: false, dangerBaseline: 0,
  },
  gaia_world: {
    id: "gaia_world", name: "Gaia World",
    scores: { default: 1.0 },
    peopleLand: { min: 700, max: 1000 },
    depositCounts: {
      arable: { min: 6, max: 14 }, water: { min: 7, max: 16 }, biomass: { min: 2, max: 6 },
    },
    extractionModifier: 1.0, techLocked: false, dangerBaseline: 0,
  },
  jungle_world: {
    id: "jungle_world", name: "Jungle World",
    scores: { default: 0.7 },
    peopleLand: { min: 400, max: 550 },
    depositCounts: {
      ore: { min: 1, max: 4 }, biomass: { min: 5, max: 18 },
      arable: { min: 12, max: 26 }, water: { min: 13, max: 29 },
    },
    extractionModifier: 0.85, techLocked: false, dangerBaseline: 0,
  },
  ocean_world: {
    id: "ocean_world", name: "Ocean World",
    scores: { default: 0.65 },
    peopleLand: { min: 350, max: 500 },
    depositCounts: {
      biomass: { min: 3, max: 12 }, arable: { min: 6, max: 14 }, water: { min: 20, max: 45 },
    },
    extractionModifier: 0.9, techLocked: false, dangerBaseline: 0,
  },
  boreal_world: {
    id: "boreal_world", name: "Boreal World",
    scores: { default: 0.6 },
    peopleLand: { min: 300, max: 450 },
    depositCounts: {
      biomass: { min: 3, max: 12 }, water: { min: 13, max: 29 },
      arable: { min: 12, max: 26 }, ore: { min: 1, max: 4 },
    },
    extractionModifier: 0.85, techLocked: false, dangerBaseline: 0,
  },
  arid_world: {
    id: "arid_world", name: "Arid World",
    // Below HABITABILITY_THRESHOLD: hot-preference / terraforming territory — dark land until unlocked.
    scores: { default: 0.35 },
    peopleLand: { min: 150, max: 250 },
    depositCounts: {
      minerals: { min: 2, max: 7 }, ore: { min: 2, max: 7 },
      arable: { min: 6, max: 14 }, radioactive: { min: 2, max: 7 },
    },
    extractionModifier: 0.8, techLocked: false, dangerBaseline: 0,
  },
  tundra_world: {
    id: "tundra_world", name: "Tundra World",
    // Below HABITABILITY_THRESHOLD: cold-preference / terraforming territory — dark land until unlocked.
    scores: { default: 0.3 },
    peopleLand: { min: 100, max: 200 },
    depositCounts: {
      water: { min: 13, max: 29 }, biomass: { min: 2, max: 6 }, arable: { min: 6, max: 14 },
    },
    extractionModifier: 0.75, techLocked: false, dangerBaseline: 0,
  },
  frozen_world: {
    id: "frozen_world", name: "Frozen World",
    scores: { default: 0.1 },
    peopleLand: { min: 0, max: 0 },
    depositCounts: {
      gas: { min: 2, max: 6 }, ore: { min: 1, max: 4 }, water: { min: 20, max: 45 },
    },
    extractionModifier: 0.6, techLocked: false, dangerBaseline: 0,
  },
  volcanic_world: {
    id: "volcanic_world", name: "Volcanic World",
    scores: { default: 0.05 },
    peopleLand: { min: 0, max: 0 },
    depositCounts: {
      gas: { min: 2, max: 6 }, minerals: { min: 2, max: 7 },
      ore: { min: 3, max: 10 }, radioactive: { min: 4, max: 13 },
    },
    // Hostile — the stated hostile case: locked until a future technology.
    extractionModifier: 0.4, techLocked: true, dangerBaseline: 0.05,
  },
  barren_rock: {
    id: "barren_rock", name: "Barren Rock",
    scores: { default: 0.05 },
    peopleLand: { min: 0, max: 0 },
    depositCounts: {
      minerals: { min: 2, max: 7 }, ore: { min: 2, max: 7 }, radioactive: { min: 2, max: 7 },
    },
    // The mining-outpost backbone — deliberately NOT tech-locked: dead-body deposits carry
    // colonisability today.
    extractionModifier: 0.7, techLocked: false, dangerBaseline: 0,
  },
  asteroid_belt: {
    id: "asteroid_belt", name: "Asteroid Belt",
    scores: { default: 0.02 },
    peopleLand: { min: 0, max: 0 },
    depositCounts: {
      minerals: { min: 3, max: 10 }, ore: { min: 3, max: 10 }, radioactive: { min: 2, max: 7 },
    },
    // The mining-outpost backbone — deliberately NOT tech-locked: dead-body deposits carry
    // colonisability today.
    extractionModifier: 0.6, techLocked: false, dangerBaseline: 0,
  },
  gas_giant: {
    id: "gas_giant", name: "Gas Giant",
    scores: { default: 0 },
    peopleLand: { min: 0, max: 0 },
    depositCounts: {
      gas: { min: 5, max: 17 }, water: { min: 7, max: 16 },
    },
    // Gas giant deposits are locked until a future technology.
    extractionModifier: 0.3, techLocked: true, dangerBaseline: 0,
  },
};

// ── Habitability thresholds and the count-damping ladder ───────────

/** A body's default-pop score must clear this to contribute people land ("above threshold"). */
export const HABITABILITY_THRESHOLD = 0.5;

/**
 * Multiplies an above-threshold class's roll weight by the count of above-threshold bodies
 * already rolled in the system, applied BEFORE the `w > 0` candidate filter. Index 0 (the
 * first habitable body) is always 1 — not calibration-owned. Indices 1-2 are calibrated
 * outputs: index 0 sets ≥1-habitable share alone (it never touches indices 1-2,
 * so the two bands tune independently), while indices 1-2 set the ≥2/=3 shares against the
 * yellow/orange archetype weights below. A closed-form per-body-roll model UNDERSTATES the
 * real ≥2/=3 shares — 600 systems share one continuous PRNG stream per seed, so a table
 * change ripples into every later system's draws; `npm run report:coherence` is the only
 * reliable readout and must be re-run (not re-derived) after either table changes. At the
 * retuned yellow/orange above-threshold weights, 1.1/0.3 lands the galaxy-wide ≥2 share at
 * 5.9-9.0% (band 5-10%) and =3 at 0.0-0.2% (band ≤1.5%) across 6 census seeds. Index 3 is a
 * FIXED hard 0 — not tunable — so a 4th above-threshold body is impossible by table, never by
 * chance.
 */
export const HABITABLE_COUNT_LADDER: readonly number[] = [1, 1.1, 0.3, 0] as const;

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
    // Above-threshold weights retuned (from 9/6/6/3.5/0.8 = 25.3): the class needed to fall
    // from ~81% to ~50% single-class ≥1-habitable share (bodyCount 4-8, dead sum 74 unchanged),
    // solved as aboveSum/(aboveSum+74) ≈ 0.11, aboveSum ≈ 9.2 — same proportions, scaled by ~0.36.
    archetypeWeights: {
      temperate_world: 3.25, ocean_world: 2.2, jungle_world: 2.2, boreal_world: 1.25, gaia_world: 0.3,
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
    // Above-threshold weights retuned (from 5/8/5/9/0.8 = 27.8): same derivation as
    // yellow — dead sum 71.5 unchanged, aboveSum/(aboveSum+71.5) ≈ 0.11, aboveSum ≈ 8.8, same
    // proportions scaled by ~0.318, landing single-class ≥1 at ~43%.
    archetypeWeights: {
      temperate_world: 1.6, ocean_world: 2.5, jungle_world: 1.6, boreal_world: 2.85, gaia_world: 0.25,
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
