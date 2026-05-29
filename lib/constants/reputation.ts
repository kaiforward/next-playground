import type { ReputationStanding } from "@/lib/types/game";

export interface ReputationTier {
  standing: ReputationStanding;
  name: string;
  /** Inclusive lower bound on the reputation score. */
  minScore: number;
  /** Inclusive upper bound on the reputation score. */
  maxScore: number;
  /** Multiplier applied to buy price (lower is better for the player). */
  buyMultiplier: number;
  /** Multiplier applied to sell price (higher is better for the player). */
  sellMultiplier: number;
  /** True when trades are denied at this standing regardless of multipliers. */
  tradeDenied: boolean;
}

/**
 * Reputation tiers per layer-2-faction-foundation.md §3. Bounds are inclusive
 * and partition the score range [-100, +100] without gaps.
 *
 * Multiplier design — the favourable (positive-standing) multipliers act as a
 * NEGATIVE spread: a buy discount + sell premium narrows the effective bid-ask
 * gap. They MUST stay small enough that, even at the tightest government spread,
 * an instant same-market buy→resell still can't profit — i.e.
 * (1+minSpread)·buyMult ≥ (1−minSpread)·sellMult. At minSpread ≈ 0.0425
 * (authoritarian) that caps the symmetric swing at ~±2% (verified incl. integer
 * rounding). Going wider reopens the resell exploit. The unfavourable
 * (distrusted) multipliers are NOT bounded this way — they only worsen trades,
 * so they can't be exploited and stay a meaningful deterrent. This asymmetry is
 * intentional. (Interim: the richer reputation reward will move off the price
 * spread entirely — see the reputation redesign.)
 */
export const REPUTATION_TIERS: readonly ReputationTier[] = [
  {
    standing: "champion",
    name: "Champion",
    minScore: 75,
    maxScore: 100,
    buyMultiplier: 0.98,
    sellMultiplier: 1.02,
    tradeDenied: false,
  },
  {
    standing: "trusted",
    name: "Trusted",
    minScore: 25,
    maxScore: 74,
    buyMultiplier: 0.99,
    sellMultiplier: 1.01,
    tradeDenied: false,
  },
  {
    standing: "neutral",
    name: "Neutral",
    minScore: -24,
    maxScore: 24,
    buyMultiplier: 1.0,
    sellMultiplier: 1.0,
    tradeDenied: false,
  },
  {
    standing: "distrusted",
    name: "Distrusted",
    minScore: -74,
    maxScore: -25,
    buyMultiplier: 1.08,
    sellMultiplier: 0.92,
    tradeDenied: false,
  },
  {
    standing: "hostile",
    name: "Hostile",
    minScore: -100,
    maxScore: -75,
    buyMultiplier: 1.0,
    sellMultiplier: 1.0,
    tradeDenied: true,
  },
] as const;

/** Resolve a numeric reputation score to its tier definition. */
export function getReputationTier(score: number): ReputationTier {
  const clamped = Math.max(-100, Math.min(100, score));
  // REPUTATION_TIERS is ordered highest-min-first, so the first tier whose
  // minScore is at-or-below the (clamped) score wins. Matching by minScore
  // alone — not the [minScore, maxScore] range — keeps half-integer scores
  // (the Float column produces e.g. 24.25) from falling into a gap between
  // adjacent integer-bounded tiers.
  const tier = REPUTATION_TIERS.find((t) => clamped >= t.minScore);
  if (!tier) {
    // Unreachable: the lowest tier's minScore is the clamp floor.
    throw new Error(`No reputation tier matched score ${score}`);
  }
  return tier;
}

/** Resolve buy/sell multipliers from a reputation standing label. */
export function getReputationMultipliers(
  standing: ReputationStanding,
): { buy: number; sell: number } {
  const tier = REPUTATION_TIERS.find((t) => t.standing === standing);
  if (!tier) {
    throw new Error(`Unknown reputation standing: "${standing}"`);
  }
  return { buy: tier.buyMultiplier, sell: tier.sellMultiplier };
}

// ── Trade-driven reputation accrual ─────────────────────────────

/**
 * Reputation awarded for one successful trade against a faction-owned market.
 */
export const REPUTATION_TRADE_GAIN_PER_TRADE = 0.5;

/**
 * Maximum reputation a player can accrue per (faction, tick) across all trade
 * actions. Keeps the gain visible without enabling grind-spam farming.
 */
export const REPUTATION_TRADE_GAIN_CAP_PER_TICK = 2.0;
