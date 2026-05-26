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
 * and partition the score range [-100, +100] without gaps; multipliers are
 * symmetric so equal-magnitude positive/negative standings mirror each other.
 */
export const REPUTATION_TIERS: readonly ReputationTier[] = [
  {
    standing: "champion",
    name: "Champion",
    minScore: 75,
    maxScore: 100,
    buyMultiplier: 0.92,
    sellMultiplier: 1.08,
    tradeDenied: false,
  },
  {
    standing: "trusted",
    name: "Trusted",
    minScore: 25,
    maxScore: 74,
    buyMultiplier: 0.96,
    sellMultiplier: 1.04,
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
  const tier = REPUTATION_TIERS.find((t) => clamped >= t.minScore && clamped <= t.maxScore);
  if (!tier) {
    // Unreachable: REPUTATION_TIERS partition the full clamped range without gaps.
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
