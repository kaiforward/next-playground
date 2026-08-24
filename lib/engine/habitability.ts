/**
 * Fill-best-first habitability quality. People-land bodies are occupied best-score-first: a
 * system's quality is the people-land-weighted mean score over the prefix the current population
 * actually occupies, so a system fills its best world before its worse ones ever count against it.
 *
 * Pure, zero I/O. The population processor's per-cycle fold
 * (`lib/tick/processors/population.ts`) is the only caller; it decides WHEN to apply a fresh
 * result to the cached system-row reading (only on a `frontierIndex` change — population movement
 * within the same body leaves the cache untouched). This function always computes fresh from
 * whatever `bodies`/`population` it is handed — it has no caching policy of its own.
 */
import { POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { HABITABILITY_THRESHOLD } from "@/lib/constants/bodies";

/** One people-land-contributing body's static summary — the fold's only per-body inputs. */
export interface HabitabilityBody {
  score: number;
  peopleLand: number;
}

export interface SystemHabitabilityQuality {
  /** People-land-weighted mean score over the occupied prefix. */
  quality: number;
  /**
   * Index into the SCORE-DESCENDING sort of `bodies` of the marginal (partially- or
   * newly-occupied) body: 0 while occupation sits inside the single best body (the common case —
   * most systems have exactly one contributing body), the sorted list's last index once
   * population has overrun every body's land (the clamp arm). The caller's fold-site cache uses a
   * change in this value as its sole recompute trigger.
   */
  frontierIndex: number;
  /**
   * True only when `frontierIndex` names a body genuinely mid-fill — some but not all of its land
   * occupied, with land still unoccupied beyond it. False for the two arms that also produce a
   * `frontierIndex` but are NOT a marginal body in that sense: the zero-occupancy arm (nobody has
   * landed anywhere yet — `frontierIndex` 0 just names the best body as next-to-fill, not
   * partially filled) and the clamp arm (population has overrun every body's land — the last body
   * is fully occupied, not partial). Read-side consumers (`habitabilityFillOrder`,
   * `habitability-tooltip-content.tsx`) use this to avoid labelling a saturated system's last body
   * or a zero-pop system's first body "Partial".
   */
  partial: boolean;
}

/**
 * Sorts `bodies` by score descending — re-sorted on every call, never assumed from the caller's
 * ordering (the sort is part of this seam) — and walks cumulative people land best-body-first
 * until it reaches `population / POP_CENTRE_DENSITY` (the land the current population actually
 * occupies). Edge states:
 *  - population 0 (or any non-positive occupied-land reading) reads the TOP body's score
 *    outright — a seed colony opens at its best world's quality, not a mean;
 *  - an occupied-land figure at or past the total across every body (housing-rot overshoot, or a
 *    population above what the built land can hold) clamps at the all-bodies people-land-weighted
 *    mean — the prefix cannot extend past the last body;
 *  - a `bodies` list with zero total people land reads the top body's score too (defensive: real
 *    play never reaches this — the colonisability floor guarantees at least one contributing body
 *    with positive land — but a 0/0 division is never allowed to surface as NaN).
 * An empty `bodies` list (no people-land-contributing body at all) reads a neutral 0 — also
 * defensive-only for the same reason.
 */
export function systemHabitabilityQuality(
  bodies: HabitabilityBody[],
  population: number,
): SystemHabitabilityQuality {
  if (bodies.length === 0) {
    return { quality: 0, frontierIndex: -1, partial: false };
  }
  const sorted = [...bodies].sort((a, b) => b.score - a.score);
  const totalLand = sorted.reduce((sum, b) => sum + b.peopleLand, 0);
  const occupiedLand = Math.max(0, population) / POP_CENTRE_DENSITY;

  if (totalLand <= 0 || occupiedLand <= 0) {
    return { quality: sorted[0].score, frontierIndex: 0, partial: false };
  }
  if (occupiedLand >= totalLand) {
    const weighted = sorted.reduce((sum, b) => sum + b.score * b.peopleLand, 0);
    return { quality: weighted / totalLand, frontierIndex: sorted.length - 1, partial: false };
  }

  let cumulative = 0;
  let weighted = 0;
  for (let i = 0; i < sorted.length; i++) {
    const landHere = Math.min(sorted[i].peopleLand, occupiedLand - cumulative);
    weighted += sorted[i].score * landHere;
    cumulative += landHere;
    if (cumulative >= occupiedLand) {
      return { quality: weighted / occupiedLand, frontierIndex: i, partial: true };
    }
  }
  // Unreachable given occupiedLand < totalLand above (the walk must cross occupiedLand before
  // exhausting every body's land) — kept as a defensive fallback, never a silent NaN.
  return { quality: weighted / cumulative, frontierIndex: sorted.length - 1, partial: true };
}

/**
 * The fold's contributing-body predicate: unlocked, and score at or above `HABITABILITY_THRESHOLD`
 * (the same floor `systemHabitabilityQuality` implicitly assumes its `bodies` argument was already
 * filtered to — see the module docstring). THE canonical statement of "does this body contribute
 * people land at all" — every read-side site that needs to answer that question imports this rather
 * than restating the two conditions inline (score-vs-threshold, unlocked) where they can silently
 * drift apart. `lib/world/tick.ts`'s `habitabilityBodiesBySystem` (assembling this fold's own input)
 * and `lib/utils/substrate.ts`'s `contributingBodiesSorted` (the read-side order every occupancy
 * consumer shares) both consume it.
 */
export function isContributingBody(body: { score: number; locked: boolean }): boolean {
  return !body.locked && body.score >= HABITABILITY_THRESHOLD;
}

/**
 * `isContributingBody`, filtered and sorted score-descending — the fold's own occupancy order, and
 * the shared order every read-side occupancy consumer (`occupiedBodyIds`, `habitabilityFillOrder`,
 * both `lib/utils/substrate.ts`) derives from rather than re-sorting independently.
 */
export function contributingBodiesSorted<T extends { score: number; locked: boolean }>(bodies: T[]): T[] {
  return bodies.filter(isContributingBody).sort((a, b) => b.score - a.score);
}

/**
 * THE shared three-tier effective-quality resolution every read-side consumer of habitability
 * quality shares: the persisted fold-site cache if present; else a fresh compute
 * (`systemHabitabilityQuality`) over this system's contributing bodies at its current population —
 * a just-founded or just-crossed colony's first read, before the tick has had a cycle to cache one;
 * else `undefined`. The fresh tier requires a real population as well as a contributing body:
 * the fold's zero-occupancy arm names the best body as "next to fill" (`frontierIndex` 0), so
 * computing it for an EMPTY system would mark that body occupied on every unclaimed system in the
 * galaxy — nobody lives there, nothing is occupied, the resolution is `undefined`. Callers apply
 * their own neutral default on top of `undefined` (population growth reads 1×, occupancy shows
 * nothing occupied) — this function never fabricates one, so two call sites can never silently
 * choose different defaults. `lib/services/system-population.ts` (the growth-multiplier read) and
 * `lib/services/universe.ts`'s `getSystemSubstrate` (the occupied-body-id read) both resolve
 * through this rather than either reading the raw cache alone — a system whose fold hasn't run yet
 * would otherwise show a real percentage with zero bodies marked occupied.
 */
export function resolveEffectiveHabitabilityQuality<T extends HabitabilityBody & { locked: boolean }>(
  cached: SystemHabitabilityQuality | undefined,
  bodies: T[],
  population: number,
): SystemHabitabilityQuality | undefined {
  if (cached !== undefined) return cached;
  if (population <= 0) return undefined;

  const contributing = contributingBodiesSorted(bodies);
  return contributing.length > 0 ? systemHabitabilityQuality(contributing, population) : undefined;
}
