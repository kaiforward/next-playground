import { prisma } from "@/lib/prisma";
import { getReputationTier } from "@/lib/constants/reputation";
import type { ReputationStanding } from "@/lib/types/game";

/** Per-player, per-faction reputation entry returned to clients. */
export interface PlayerFactionReputationInfo {
  factionId: string;
  factionName: string;
  factionColor: string;
  score: number;
  standing: ReputationStanding;
  buyMultiplier: number;
  sellMultiplier: number;
  tradeDenied: boolean;
  updatedAtTick: number;
}

/**
 * Per-tick reputation gain cap, applied per (player, faction) per tick across
 * all trade actions. Prevents grind-spam farming a single faction's score.
 */
export const REPUTATION_TRADE_GAIN_PER_TRADE = 0.5;
export const REPUTATION_TRADE_GAIN_CAP_PER_TICK = 2.0;

/**
 * Compute the maximum delta we'll add to (player, faction) reputation this
 * tick, given how much rep that pair has already accrued. Returns 0 if the
 * per-tick cap is exhausted.
 */
export function clampReputationGain(currentTickGain: number, candidate: number): number {
  const remaining = REPUTATION_TRADE_GAIN_CAP_PER_TICK - currentTickGain;
  if (remaining <= 0) return 0;
  return Math.min(candidate, remaining);
}

/**
 * List every faction reputation row for a player, enriched with the live
 * tier multipliers/standing. Returns rows for every faction known to the
 * world even if no row exists yet for this player (those rows render as
 * score 0 / neutral).
 */
export async function getPlayerReputation(
  playerId: string,
): Promise<PlayerFactionReputationInfo[]> {
  const [factions, reps] = await Promise.all([
    prisma.faction.findMany({
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
    prisma.playerFactionReputation.findMany({
      where: { playerId },
      select: { factionId: true, score: true, updatedAtTick: true },
    }),
  ]);

  const byFaction = new Map(reps.map((r) => [r.factionId, r]));

  return factions.map((f) => {
    const row = byFaction.get(f.id);
    const score = row?.score ?? 0;
    const tier = getReputationTier(score);
    return {
      factionId: f.id,
      factionName: f.name,
      factionColor: f.color,
      score,
      standing: tier.standing,
      buyMultiplier: tier.buyMultiplier,
      sellMultiplier: tier.sellMultiplier,
      tradeDenied: tier.tradeDenied,
      updatedAtTick: row?.updatedAtTick ?? 0,
    };
  });
}

/**
 * Read a single (player, faction) standing without enriching with all rows.
 * Used by trade services to decide gating + multipliers without an extra
 * round-trip to load the full reputation list.
 */
export async function getStandingAt(
  playerId: string,
  factionId: string,
): Promise<{
  score: number;
  standing: ReputationStanding;
  buyMultiplier: number;
  sellMultiplier: number;
  tradeDenied: boolean;
}> {
  const row = await prisma.playerFactionReputation.findUnique({
    where: { playerId_factionId: { playerId, factionId } },
    select: { score: true },
  });
  const score = row?.score ?? 0;
  const tier = getReputationTier(score);
  return {
    score,
    standing: tier.standing,
    buyMultiplier: tier.buyMultiplier,
    sellMultiplier: tier.sellMultiplier,
    tradeDenied: tier.tradeDenied,
  };
}
