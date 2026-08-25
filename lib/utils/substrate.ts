import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { bandForMultiplier, depositDisplayName } from "@/lib/engine/substrate-space";
import { HABITABILITY_THRESHOLD } from "@/lib/constants/bodies";
import { contributingBodiesSorted } from "@/lib/engine/habitability";
import type { PotentialYieldRow } from "@/lib/engine/worked-deposits";
import type { QualityBandId, ResourceType, ResourceVector } from "@/lib/types/game";

/** One body's deposit as a named physical feature — astrography flavour. */
export interface DepositFeature {
  resource: ResourceType;
  band: QualityBandId;
  /** Generated display name, e.g. "Rich ore body". */
  name: string;
  /** Slots of this deposit inside the system's current worked prefix — the physical occupancy of
   *  THIS body's own ground, never a yield percentage (that stays system-level, see body-card.tsx). */
  worked: number;
  /** Total slots authored on this body — same figure as `slots[resource]`, carried per-feature so
   *  the render site never re-indexes the vector. */
  total: number;
}

/**
 * The deposits physically present on one body, as named features ordered
 * richest-first. This is the static intrinsic grade ("what is in the ground") —
 * distinct from the industry panel's system-level effective-yield view. A
 * resource with no slots on the body is absent. `worked` is per-body slot occupancy
 * (`workedByBody`, `lib/engine/worked-deposits.ts`) — a physical fact about this body,
 * not the system's blended yield.
 */
export function bodyDepositFeatures(
  slots: ResourceVector, quality: ResourceVector, worked: ResourceVector,
): DepositFeature[] {
  return RESOURCE_TYPES.filter((r) => slots[r] > 0)
    .map((r) => {
      const band = bandForMultiplier(quality[r]);
      return { resource: r, band, name: depositDisplayName(r, band), worked: worked[r], total: slots[r] };
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

/** One body's static occupancy inputs — score and lock state, exactly what the fill-best-first
 *  fold's contributing-body filter+sort (`lib/engine/habitability.ts`) reads. `occupiedBodyIds`
 *  itself never reads people land — it only needs WHICH bodies are contributing and their sort
 *  order, then slices by the cached `frontierIndex` — so it is not part of this shape. */
export interface OccupancyBody {
  id: string;
  score: number;
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
  const contributing = contributingBodiesSorted(bodies);
  return new Set(contributing.slice(0, habitabilityQuality.frontierIndex + 1).map((b) => b.id));
}

/** One body's identity for resolving `potentialYieldByResource`'s bare `bodyIndex` back to
 *  something a player reads — same array, same order the engine fold was given. */
export interface PotentialYieldBodyIdentity {
  id: string;
  archetypeName: string;
}

/** One body's contribution to a resource's potential-yield row — the Astrography potential-yield
 *  table's per-body breakdown. `groundValue` is the modifier this body's slots realise (quality ×
 *  its archetype's extraction modifier), not a system-blended figure. */
export interface PotentialYieldBodyView {
  bodyId: string;
  archetypeName: string;
  slotCount: number;
  groundValue: number;
  locked: boolean;
}

/** One resource's potential-yield row: the mean ground value over every deposit slot in the
 *  system — locked bodies included — plus the total slot count, its quality band (same band
 *  vocabulary the deposit table already uses), and a per-body breakdown. Absent entirely for a
 *  resource with no slots anywhere in the system (`potentialYieldByResource` never emits a zero
 *  row). */
export interface PotentialYieldRowView {
  resource: ResourceType;
  yieldMult: number;
  slotCount: number;
  band: QualityBandId;
  byBody: PotentialYieldBodyView[];
}

/**
 * Resolves the engine fold's `PotentialYieldRow[]` (bare `bodyIndex`) against a system's own
 * bodies, in the SAME order the fold was given them, into the Astrography table's presentation
 * shape — band-coloured, body identity resolved, still richest-slot-first inside each row's
 * `byBody` (the fold already sorted slots that way).
 */
export function potentialYieldRows(
  rows: PotentialYieldRow[],
  bodies: PotentialYieldBodyIdentity[],
): PotentialYieldRowView[] {
  return rows.map((r) => ({
    resource: r.resource,
    yieldMult: r.yieldMult,
    slotCount: r.slotCount,
    band: bandForMultiplier(r.yieldMult),
    byBody: r.byBody.map((b) => ({
      bodyId: bodies[b.bodyIndex].id,
      archetypeName: bodies[b.bodyIndex].archetypeName,
      slotCount: b.slotCount,
      groundValue: b.groundValue,
      locked: b.locked,
    })),
  }));
}

/** One people-land-contributing body's static identity for the fill-order decomposition —
 *  `habitabilityFillOrder`'s only per-body input. */
export interface FillOrderBody {
  className: string;
  score: number;
  peopleLand: number;
  locked: boolean;
}

/** One row of the Population tab's growth-multiplier decomposition — a fill-order-sorted body plus
 *  whether it sits inside the occupied prefix, whether it IS the marginal body the fold names
 *  `frontierIndex`, and — only meaningful when `frontier` is true — whether that body is genuinely
 *  mid-fill (`partial`) rather than the zero-occupancy or all-bodies-full arms, which also name a
 *  `frontierIndex` but are not a partially-filled body. No `peopleLand`: nothing downstream of this
 *  row reads it (the tooltip shows score and occupancy only). */
export interface FillOrderRow {
  className: string;
  score: number;
  occupied: boolean;
  frontier: boolean;
  partial: boolean;
}

/**
 * The Population tab's per-body growth-quality story (spec §3: quality is always a story about
 * bodies, never a bare number) — every people-land-contributing body in fill-best-first (score-
 * descending) order, marking which sit inside the occupied prefix and which one is the marginal
 * body the cached fold's `frontierIndex` names. Same contributing-body source `occupiedBodyIds`
 * reads, so the two can never disagree about which bodies are occupied. An unassessed system
 * (`habitabilityQuality` undefined) marks nothing occupied and nothing as frontier, mirroring
 * `occupiedBodyIds`'s own "no occupancy story yet" reasoning.
 */
export function habitabilityFillOrder(
  bodies: FillOrderBody[],
  habitabilityQuality: { quality: number; frontierIndex: number; partial: boolean } | undefined,
): FillOrderRow[] {
  const contributing = contributingBodiesSorted(bodies);
  return contributing.map((b, i) => {
    const frontier = habitabilityQuality !== undefined && i === habitabilityQuality.frontierIndex;
    return {
      className: b.className,
      score: b.score,
      occupied: habitabilityQuality !== undefined && i <= habitabilityQuality.frontierIndex,
      frontier,
      partial: frontier && (habitabilityQuality?.partial ?? false),
    };
  });
}

