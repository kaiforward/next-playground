/**
 * Substrate generation — pure, zero DB dependency,
 * deterministic given a seeded RNG. Rolls a system's sun class, body set — each body authoring
 * its own people-land / deposit-count budgets directly — and population.
 */
import type {
  BodyArchetypeId, ResourceVector, SunClass,
} from "@/lib/types/game";
import {
  BODY_ARCHETYPES, HABITABILITY_THRESHOLD, HABITABLE_COUNT_LADDER, SUN_CLASSES,
  type SunClassDef,
} from "@/lib/constants/bodies";
import { emptyResourceVector, sumResourceVectors, unitResourceVector, RESOURCE_TYPES, countWeightedMean } from "./resources";
import type { RNG } from "./universe-gen";
import { randInt } from "./universe-gen";
import { depositGradeVector } from "@/lib/engine/deposit-grade";
import { rollQualityBand } from "./substrate-space";

/** Body size is display flavour only — decoupled from every budget. */
const DISPLAY_SIZE_MIN = 0.5;
const DISPLAY_SIZE_MAX = 1.5;

export interface GeneratedBody {
  bodyType: BodyArchetypeId;
  /** Display flavour only — carries no budget meaning. */
  size: number;
  /** Authored people-land budget — contributes to the system aggregate only when this body's
   *  default-pop score clears HABITABILITY_THRESHOLD and the class is unlocked (dark land otherwise). */
  peopleLand: number;
  /** Authored per-resource deposit counts (integers). */
  counts: ResourceVector;
  /** Quality-band multiplier per resource (0 for absent resources). */
  quality: ResourceVector;
}

export interface GeneratedSubstrate {
  sunClass: SunClass;
  bodies: GeneratedBody[];
  popCap: number;
  population: number;
  /** Σ body-archetype danger baselines — environmental danger from this system's bodies. */
  bodyDanger: number;
  /** Seeded industrial base — buildingType → count. */
  buildings: Record<string, number>;
  /** Sum of per-body people land over above-threshold, unlocked bodies. */
  peopleLand: number;
  /** Σ body deposit counts — total extractor capacity per resource across the system, over unlocked bodies. */
  depositCounts: ResourceVector;
  /**
   * Effective per-resource yield multiplier — the deposit-count-weighted mean quality of the system's
   * unlocked deposits, Σ(counts·quality) / Σ counts (1.0 where the system has no counts for that
   * resource). The grade a fully-worked field realises; independent of how many extractors are
   * actually placed (`depositGrade`).
   */
  yieldMult: ResourceVector;
  /**
   * Effective per-resource extraction-work efficiency — the deposit-count-weighted mean of the
   * contributing (unlocked) bodies' `extractionModifier` (1.0 where the system has no counts for
   * that resource). Kept as its OWN aggregate, never folded into `yieldMult`.
   */
  extractionEfficiency: ResourceVector;
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

/**
 * Weighted archetype roll among the sun class's positive-weight archetypes. `aboveThresholdCount`
 * is the count of above-threshold (default-pop score ≥ HABITABILITY_THRESHOLD) bodies already
 * rolled in this system this generation pass — every above-threshold candidate's weight is
 * multiplied by `HABITABLE_COUNT_LADDER[min(aboveThresholdCount, ladder length − 1)]` BEFORE the
 * `w > 0` filter, so a damped-to-zero class drops out of the roll entirely at that count (the
 * ladder's fixed terminal 0 makes a 4th above-threshold body impossible by table). Dead classes
 * are never damped and so remain rollable at every ladder step.
 */
function rollArchetype(rng: RNG, sun: SunClassDef, aboveThresholdCount: number): BodyArchetypeId {
  const candidates: { id: BodyArchetypeId; weight: number }[] = [];
  for (const arch of Object.values(BODY_ARCHETYPES)) {
    let w = sun.archetypeWeights[arch.id] ?? 0;
    if (arch.scores.default >= HABITABILITY_THRESHOLD) {
      const idx = Math.min(aboveThresholdCount, HABITABLE_COUNT_LADDER.length - 1);
      w *= HABITABLE_COUNT_LADDER[idx];
    }
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

/** Draws one body's budgets uniform-in-range from its archetype's authored bands; counts integer. */
function rollBody(rng: RNG, archId: BodyArchetypeId): GeneratedBody {
  const arch = BODY_ARCHETYPES[archId];
  const size = DISPLAY_SIZE_MIN + rng() * (DISPLAY_SIZE_MAX - DISPLAY_SIZE_MIN);
  const peopleLand = arch.peopleLand.min + rng() * (arch.peopleLand.max - arch.peopleLand.min);

  const counts = emptyResourceVector();
  const quality = emptyResourceVector();
  for (const r of RESOURCE_TYPES) {
    const range = arch.depositCounts[r];
    if (range === undefined) continue;
    counts[r] = Math.round(range.min + rng() * (range.max - range.min));
    quality[r] = rollQualityBand(rng).multiplier;
  }

  return { bodyType: archId, size, peopleLand, counts, quality };
}

export function generateSubstrate(rng: RNG): GeneratedSubstrate {
  const sunClass = rollSunClass(rng);
  const sun = SUN_CLASSES[sunClass];

  const bodyCount = randInt(rng, sun.bodyCount.min, sun.bodyCount.max);
  const bodies: GeneratedBody[] = [];
  let aboveThresholdCount = 0;
  for (let i = 0; i < bodyCount; i++) {
    const archId = rollArchetype(rng, sun, aboveThresholdCount);
    bodies.push(rollBody(rng, archId));
    if (BODY_ARCHETYPES[archId].scores.default >= HABITABILITY_THRESHOLD) aboveThresholdCount++;
  }

  const agg = substrateAggregates(bodies);

  // Bare substrate: no seeded industry or population. Faction capitals are stamped with the home-system
  // prefab (see world-gen); every other system starts as an empty deposit field and is colonised into.
  // Deposit grade (yieldMult) is a pure property of the ground — the fully-worked mean quality of the
  // field, independent of how a system is later developed.
  return {
    sunClass,
    bodies,
    popCap: 0,
    population: 0,
    buildings: {},
    ...agg,
  };
}

/**
 * All per-system aggregates derived purely from a body list — the single source both bare-substrate
 * generation and the homeworld-prefab stamp use, so a homeworld's aggregates can never drift from a
 * regular system's. Tech-locked classes contribute NO counts and NO extractionEfficiency weight;
 * below-threshold (or locked) classes contribute no people land — their authored peopleLand stays
 * visible per-body (dark land) but never reaches the system aggregate. Body danger sums over ALL
 * bodies regardless of lock — a locked volcanic world is still dangerous ground.
 */
export function substrateAggregates(bodies: GeneratedBody[]): {
  peopleLand: number;
  depositCounts: ResourceVector;
  yieldMult: ResourceVector;
  extractionEfficiency: ResourceVector;
  bodyDanger: number;
} {
  const unlocked = bodies.filter((b) => !BODY_ARCHETYPES[b.bodyType].techLocked);
  const aboveThreshold = unlocked.filter(
    (b) => BODY_ARCHETYPES[b.bodyType].scores.default >= HABITABILITY_THRESHOLD,
  );

  const peopleLand = aboveThreshold.reduce((s, b) => s + b.peopleLand, 0);
  const depositCounts = sumResourceVectors(unlocked.map((b) => b.counts));
  const yieldMult = depositGradeVector(unlocked);
  const extractionEfficiency = extractionEfficiencyVector(unlocked);

  return {
    peopleLand,
    depositCounts,
    yieldMult,
    extractionEfficiency,
    bodyDanger: bodies.reduce((sum, b) => sum + BODY_ARCHETYPES[b.bodyType].dangerBaseline, 0),
  };
}

/**
 * Per-resource extraction-work efficiency: the deposit-count-weighted mean of `extractionModifier`
 * across the bodies hosting that resource (1.0 — a neutral multiplier — where none do). `bodies`
 * must already be filtered to unlocked classes; a locked class must contribute zero weight here.
 */
function extractionEfficiencyVector(bodies: GeneratedBody[]): ResourceVector {
  const out = unitResourceVector();
  for (const r of RESOURCE_TYPES) {
    out[r] = countWeightedMean(
      bodies, (b) => b.counts[r], (b) => BODY_ARCHETYPES[b.bodyType].extractionModifier,
    );
  }
  return out;
}
