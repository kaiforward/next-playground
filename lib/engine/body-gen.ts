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
  /** Σ body-archetype danger baselines — environmental danger from this system's bodies. */
  bodyDanger: number;
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
  const bodyDanger = bodies.reduce(
    (sum, b) => sum + BODY_ARCHETYPES[b.bodyType].dangerBaseline,
    0,
  );

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

  return { sunClass, bodies, aggregate, popCap, population, bodyDanger, features };
}
