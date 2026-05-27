import type { Doctrine, GovernmentType } from "@/lib/types/game";

// ── Score range ─────────────────────────────────────────────────

export const RELATIONS_MIN = -100;
export const RELATIONS_MAX = 100;

/** Clamp a relation score to the legal range. */
export function clampRelationScore(score: number): number {
  return Math.max(RELATIONS_MIN, Math.min(RELATIONS_MAX, score));
}

// ── Drift coefficients ──────────────────────────────────────────

/**
 * Per-driver coefficients applied once per relations processor tick (every
 * `RELATIONS_FREQUENCY` ticks). Magnitudes are deliberately small — drift
 * should produce visible movement over 100s of ticks (~minutes of real time),
 * not instant flips. The simulator tunes from here.
 */
export const DRIFT_COEFFICIENTS = {
  /** Constant downward bias — "conflict is the default; peace needs maintenance". */
  baselineBias: -0.05,
  /** Per shared border (jump-lane between owned systems on each side). */
  perBorderFriction: -0.02,
  /** Per active alliance pact (positive maintenance drift). */
  alliancePresent: 0.15,
  /** Per common rival pair (both factions hostile to the same third party). */
  perCommonEnemy: 0.08,
  /** Per cross-pair where one faction allies with the other's rival. */
  allianceWithEnemy: -0.05,
  /** Scale on trade volume (units traded between the two factions since last drift tick). */
  perTradeUnit: 0.0002,
  /** Cap on trade-volume contribution per drift tick to avoid runaway positives. */
  maxTradeBonus: 0.5,
} as const;

// ── Doctrine compatibility ──────────────────────────────────────

/**
 * Persistent per-tick delta from the doctrine pair. Positive = compatibility,
 * negative = clash. Symmetric: `[A][B] === [B][A]` by construction. Low
 * magnitudes — doctrine biases behavior; it doesn't dominate it.
 *
 * Sourced from faction-system.md §2 ("Doctrine incompatibility" / "Doctrine
 * compatibility" drivers).
 */
export const DOCTRINE_COMPATIBILITY: Record<Doctrine, Record<Doctrine, number>> = {
  expansionist: {
    expansionist: -0.04, // two expansionists collide on borders
    protectionist: -0.06, // textbook clash — pushers meet defenders
    mercantile: -0.01,
    hegemonic: -0.02,
    opportunistic: -0.02,
  },
  protectionist: {
    expansionist: -0.06,
    protectionist: 0.03, // mutual respect for borders
    mercantile: 0.01,
    hegemonic: -0.04, // hegemons disrespect borders
    opportunistic: -0.02,
  },
  mercantile: {
    expansionist: -0.01,
    protectionist: 0.01,
    mercantile: 0.02, // trade-aligned
    hegemonic: -0.02,
    opportunistic: 0.00,
  },
  hegemonic: {
    expansionist: -0.02,
    protectionist: -0.04,
    mercantile: -0.02,
    hegemonic: -0.03, // peer hegemons clash
    opportunistic: -0.02,
  },
  opportunistic: {
    expansionist: -0.02,
    protectionist: -0.02,
    mercantile: 0.00,
    hegemonic: -0.02,
    opportunistic: -0.03, // hyenas circling each other
  },
};

// ── Government opposition ───────────────────────────────────────

/**
 * Persistent per-tick ideological friction between government types. Only
 * stores oppositions (negative deltas); same-type or non-listed pairs
 * contribute 0. Symmetric — lookups try both `[A][B]` and `[B][A]`.
 *
 * Per faction-system.md §6 "Emergent Rivalries" and §2 "Government opposition".
 */
const GOV_OPPOSITION_INTERNAL: Partial<
  Record<GovernmentType, Partial<Record<GovernmentType, number>>>
> = {
  federation: { authoritarian: -0.04 },
  authoritarian: { federation: -0.04, cooperative: -0.03 },
  corporate: { cooperative: -0.03 },
  cooperative: { corporate: -0.03, authoritarian: -0.03 },
  militarist: { theocratic: -0.03 },
  theocratic: { militarist: -0.03 },
};

/** Look up the symmetric government-opposition delta between two government types. */
export function getGovernmentOpposition(
  a: GovernmentType,
  b: GovernmentType,
): number {
  return (
    GOV_OPPOSITION_INTERNAL[a]?.[b] ??
    GOV_OPPOSITION_INTERNAL[b]?.[a] ??
    0
  );
}

// ── Relation tiers (5 bands per faction-system.md §2) ───────────

export type RelationTier =
  | "allied"
  | "friendly"
  | "neutral"
  | "unfriendly"
  | "hostile";

interface RelationTierBounds {
  tier: RelationTier;
  /** Inclusive lower bound. */
  minScore: number;
  /** Inclusive upper bound. */
  maxScore: number;
}

export const RELATION_TIERS: readonly RelationTierBounds[] = [
  { tier: "allied",     minScore: 75,   maxScore: 100  },
  { tier: "friendly",   minScore: 25,   maxScore: 74   },
  { tier: "neutral",    minScore: -24,  maxScore: 24   },
  { tier: "unfriendly", minScore: -74,  maxScore: -25  },
  { tier: "hostile",    minScore: -100, maxScore: -75  },
] as const;

export function getRelationTier(score: number): RelationTier {
  const c = clampRelationScore(score);
  // RELATION_TIERS is ordered highest-min-first, so the first tier whose
  // minScore is at-or-below the (clamped) score wins. Matching by minScore
  // alone — not the [minScore, maxScore] range — keeps half-integer scores
  // (the Float column produces e.g. 24.25) from falling into a gap between
  // adjacent integer-bounded tiers.
  const match = RELATION_TIERS.find((t) => c >= t.minScore);
  if (!match) {
    // Unreachable: the lowest tier's minScore is the clamp floor.
    throw new Error(`No relation tier matched score ${score}`);
  }
  return match.tier;
}

// ── Alliance lifecycle ──────────────────────────────────────────

export const ALLIANCE = {
  /** Crossing this score spawns a `pact_under_negotiation` event for the pair. */
  negotiationThreshold: 75,
  /** Score must hold at or above this through the window for the alliance to form. */
  holdThreshold: 60,
  /** Active alliance enters dissolution if the pair drops below this score. */
  dissolutionThreshold: 50,
  /** Inclusive duration range (ticks) for a negotiation event. */
  negotiationWindow: [5, 10] as const satisfies readonly [number, number],
  /** Duration (ticks) of the dissolution warning event before the pact is removed. */
  dissolutionWindow: 5,
} as const;

// ── Border-conflict event ──────────────────────────────────────

/**
 * Relations frequency: the processor runs every Nth tick. Border-conflict
 * spawn detection is keyed off this — a pair is checked once per relations
 * tick, not every game tick.
 */
export const RELATIONS_FREQUENCY = 3;

// ── History ring buffer ────────────────────────────────────────

/** Max entries kept in FactionRelation.historyJson — short, for UI/debug. */
export const RELATION_HISTORY_MAX = 10;

// ── Lifecycle sentinels ────────────────────────────────────────

/**
 * Sentinel `phaseDuration` for relations-owned events (pact_under_negotiation,
 * alliance_dissolved). The events processor skips these event types via the
 * `RELATIONS_OWNED_LIFECYCLE` guard, so the value never actually drives a
 * transition — but it must fit in PostgreSQL int4 (max 2,147,483,647).
 *
 * Two billion ticks ≈ 63 years at one tick/second, so this is "forever" for
 * any conceivable game lifetime. Previously this was `Number.MAX_SAFE_INTEGER`,
 * which overflowed int4 and aborted relations-event inserts (see PR #70
 * post-merge fix).
 */
export const RELATIONS_PHASE_SENTINEL = 2_000_000_000;
