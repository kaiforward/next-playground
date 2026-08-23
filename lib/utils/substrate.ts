import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { bandForMultiplier, depositDisplayName } from "@/lib/engine/substrate-space";
import { HABITABILITY_THRESHOLD } from "@/lib/constants/bodies";
import type { QualityBandId, ResourceType, ResourceVector } from "@/lib/types/game";

/** One body's deposit as a named physical feature — astrography flavour. */
export interface DepositFeature {
  resource: ResourceType;
  band: QualityBandId;
  /** Generated display name, e.g. "Rich ore body". */
  name: string;
}

/**
 * The deposits physically present on one body, as named features ordered
 * richest-first. This is the static intrinsic grade ("what is in the ground") —
 * distinct from the industry panel's worked-slot / effective-yield view. A
 * resource with no slots on the body is absent.
 */
export function bodyDepositFeatures(slots: ResourceVector, quality: ResourceVector): DepositFeature[] {
  return RESOURCE_TYPES.filter((r) => slots[r] > 0)
    .map((r) => {
      const band = bandForMultiplier(quality[r]);
      return { resource: r, band, name: depositDisplayName(r, band) };
    })
    .sort((a, b) => quality[b.resource] - quality[a.resource]);
}

/**
 * Buckets a body's default-pop habitability score into the same band vocabulary the deposit-grade
 * presentation uses (`QUALITY_BAND_DOT`/`QUALITY_BAND_TEXT`/`QUALITY_BAND_LABEL`), so Astrography
 * shows a score BAND rather than the retired bare-number/`habitable: boolean` reading. The deposit
 * `QUALITY_BANDS` multiplier ranges (0.4-2.5) don't cover a [0,1] score, so this is its own
 * threshold ladder, authored against the archetype table (`lib/constants/bodies.ts`): "rich" is the
 * two 1.0-score classes (temperate/gaia) alone; "good" starts at `HABITABILITY_THRESHOLD` so every
 * people-land-contributing class (jungle 0.7, ocean 0.65, boreal 0.6) reads as habitable; "average"
 * covers the sub-threshold-but-still-authored arid/tundra classes (0.35/0.3) whose people land is
 * dark, not absent; "poor" is everything at or below the effectively-dead tail (frozen through
 * gas_giant, 0.1 down to 0).
 */
export function habitabilityScoreBand(score: number): QualityBandId {
  if (score >= 0.9) return "rich";
  if (score >= HABITABILITY_THRESHOLD) return "good";
  if (score >= 0.2) return "average";
  return "poor";
}

/** One body's static occupancy inputs — score, people land, and lock state, exactly what the
 *  fill-best-first fold (`lib/engine/habitability.ts`) sorts on. */
export interface OccupancyBody {
  id: string;
  score: number;
  peopleLand: number;
  locked: boolean;
}

/**
 * Which people-land-contributing bodies sit inside a system's current fill-best-first occupied
 * prefix — the astrography-panel counterpart of `systemHabitabilityQuality`'s per-body fold,
 * re-deriving occupancy from the SAME cached `frontierIndex` rather than re-running the fold (the
 * fold's own caching policy lives in the population processor, not here; this only re-sorts and
 * slices what it already cached). Bodies are filtered to the SAME contributing set the fold and
 * `lib/world/tick.ts`'s `habitabilityBodiesBySystem` use (unlocked, score ≥
 * `HABITABILITY_THRESHOLD`) and sorted score-descending; the prefix up to and including
 * `frontierIndex` is occupied — bodies at or after the marginal (partially-filled) body are not.
 * A system with no cached quality (never assessed — pre-founding, or a fixture with no cached
 * fold) marks nothing occupied rather than guessing from `population` directly: an unassessed system
 * has no occupancy story yet, and inventing one here would disagree with the fold whenever it
 * finally runs.
 */
export function occupiedBodyIds(
  bodies: OccupancyBody[],
  habitabilityQuality: { quality: number; frontierIndex: number } | undefined,
): Set<string> {
  if (!habitabilityQuality) return new Set();
  const contributing = bodies
    .filter((b) => !b.locked && b.score >= HABITABILITY_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  return new Set(contributing.slice(0, habitabilityQuality.frontierIndex + 1).map((b) => b.id));
}

