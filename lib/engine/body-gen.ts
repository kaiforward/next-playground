/**
 * Substrate generation — pure, zero DB dependency,
 * deterministic given a seeded RNG. Rolls a system's sun class, body set,
 * per-body surface partition (deposit slots + quality bands), population, and
 * narrative features. Replaces the old trait-rolling path.
 */
import type {
  BodyArchetypeId, ResourceVector, SunClass,
} from "@/lib/types/game";
import { BODY_ARCHETYPES, SUN_CLASSES, type SunClassDef } from "@/lib/constants/bodies";
import { emptyResourceVector, sumResourceVectors, RESOURCE_TYPES } from "./resources";
import { ALL_TRAIT_IDS, QUALITY_TIERS } from "@/lib/constants/traits";
import { toQualityTier } from "@/lib/types/guards";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import type { GeneratedTrait } from "./trait-gen";
import type { RNG } from "./universe-gen";
import { weightedPick, randInt } from "./universe-gen";
import { allocateIndustry } from "@/lib/engine/industry-seed";
import { partitionBody, rollQualityBand } from "./substrate-space";

export interface GeneratedBody {
  bodyType: BodyArchetypeId;
  habitable: boolean;
  size: number;
  /** Available extractor slots per resource — derived from surface partition. */
  slots: ResourceVector;
  /** Quality-band multiplier per resource (0 for absent resources). */
  quality: ResourceVector;
  /** General-purpose surface space (non-deposit fraction). */
  generalSpace: number;
  /** Habitable fraction of general space. */
  habitableSpace: number;
}

export interface GeneratedSubstrate {
  sunClass: SunClass;
  bodies: GeneratedBody[];
  popCap: number;
  population: number;
  /** Σ body-archetype danger baselines — environmental danger from this system's bodies. */
  bodyDanger: number;
  features: GeneratedTrait[];
  /** Seeded industrial base — buildingType → count. */
  buildings: Record<string, number>;
  /** Total finite surface space across all bodies (SPACE_PER_SIZE × Σ size). */
  availableSpace: number;
  /** Sum of per-body general-purpose space. */
  generalSpace: number;
  /** Sum of per-body habitable space. */
  habitableSpace: number;
  /** Σ body deposit slots — total extractor capacity per resource across the system. */
  slotCap: ResourceVector;
  /** Effective per-resource yield multiplier — mean quality of the filled deposit slots (1.0 where none filled). */
  yieldMult: ResourceVector;
}

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

function rollBody(rng: RNG, archId: BodyArchetypeId): GeneratedBody {
  const arch = BODY_ARCHETYPES[archId];
  const size = SUBSTRATE_GEN.SIZE_MIN + rng() * (SUBSTRATE_GEN.SIZE_MAX - SUBSTRATE_GEN.SIZE_MIN);

  // Surface partition into deposit slots + per-resource quality bands.
  const part = partitionBody(arch, size, rng);
  const quality = emptyResourceVector();
  for (const r of RESOURCE_TYPES) {
    if (arch.resourceBase[r] > 0) quality[r] = rollQualityBand(rng).multiplier;
  }

  return {
    bodyType: archId,
    habitable: arch.habitable,
    size,
    slots: part.slots,
    quality,
    generalSpace: part.generalSpace,
    habitableSpace: part.habitableSpace,
  };
}

function rollFeatures(rng: RNG): GeneratedTrait[] {
  const count = randInt(rng, SUBSTRATE_GEN.FEATURE_COUNT.min, SUBSTRATE_GEN.FEATURE_COUNT.max);
  const pool = [...ALL_TRAIT_IDS];
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

  const bodyDanger = bodies.reduce(
    (sum, b) => sum + BODY_ARCHETYPES[b.bodyType].dangerBaseline,
    0,
  );

  // ── Per-system available-space aggregates ──
  const availableSpace = SUBSTRATE_GEN.SPACE_PER_SIZE * bodies.reduce((s, b) => s + b.size, 0);
  const generalSpace = bodies.reduce((s, b) => s + b.generalSpace, 0);
  const habitableSpace = bodies.reduce((s, b) => s + b.habitableSpace, 0);
  const slotCap = sumResourceVectors(bodies.map((b) => b.slots));

  // ── Development fill — driven by habitable land (full-fold retires bodyBaselinePopCap) ──
  const popNorm = clamp(habitableSpace / SUBSTRATE_GEN.HABITABLE_REF, 0, 1);
  const fill = clamp(
    SUBSTRATE_GEN.POP_FILL_BASE
      + SUBSTRATE_GEN.POP_FILL_SLOPE * popNorm
      + (rng() - 0.5) * SUBSTRATE_GEN.POP_FILL_JITTER,
    SUBSTRATE_GEN.POP_FILL_MIN,
    SUBSTRATE_GEN.POP_FILL_MAX,
  );

  const allocation = allocateIndustry(
    { bodies, slotCap, generalSpace, habitableSpace, fill },
    rng,
  );
  const popCap = allocation.popCap;
  const population = Math.round(popCap * fill);

  const features = rollFeatures(rng);

  return {
    sunClass,
    bodies,
    popCap,
    population,
    bodyDanger,
    features,
    buildings: allocation.buildings,
    availableSpace,
    generalSpace,
    habitableSpace,
    slotCap,
    yieldMult: allocation.yieldMult,
  };
}
