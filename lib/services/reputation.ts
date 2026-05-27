import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getReputationTier,
  REPUTATION_TRADE_GAIN_CAP_PER_TICK,
  REPUTATION_TRADE_GAIN_PER_TRADE,
} from "@/lib/constants/reputation";
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

/**
 * Within a trade transaction: re-read the fresh (player, faction) reputation
 * row, gate-check hostile standing against the FRESH score (TOCTOU-safe),
 * and accrue a per-tick-capped reputation gain via `clampReputationGain`.
 *
 * Callers compute price multipliers from a pre-tx snapshot for stable
 * pricing; this helper exists for the in-tx gate + accrual only.
 *
 * Returns `{ tradeDenied: true }` if the fresh score is in the hostile band,
 * in which case the caller should throw to roll back the transaction. When
 * not denied, the upsert (if any) commits with the rest of the trade.
 *
 * Per-tick cap accounting: the row's `currentTickGainThisTick` accumulates
 * gain within `updatedAtTick`. On the first accrual of a new tick the
 * accumulator resets to the granted gain. Concurrency: read-then-upsert is
 * not strictly atomic across transactions but bounded — sequential trades
 * from one player respect the cap; concurrent trades may overshoot by at
 * most `REPUTATION_TRADE_GAIN_PER_TRADE` per concurrent request.
 */
export async function accrueTradeReputationInTx(
  tx: Prisma.TransactionClient,
  playerId: string,
  factionId: string,
  currentTick: number,
): Promise<{ tradeDenied: boolean }> {
  const existing = await tx.playerFactionReputation.findUnique({
    where: { playerId_factionId: { playerId, factionId } },
    select: { score: true, updatedAtTick: true, currentTickGainThisTick: true },
  });

  const freshScore = existing?.score ?? 0;
  if (getReputationTier(freshScore).tradeDenied) {
    return { tradeDenied: true };
  }

  const accruedThisTick =
    existing && existing.updatedAtTick === currentTick
      ? existing.currentTickGainThisTick
      : 0;
  const gain = clampReputationGain(accruedThisTick, REPUTATION_TRADE_GAIN_PER_TRADE);

  if (gain <= 0) {
    return { tradeDenied: false };
  }

  await tx.playerFactionReputation.upsert({
    where: { playerId_factionId: { playerId, factionId } },
    update: {
      score: { increment: gain },
      currentTickGainThisTick: accruedThisTick + gain,
      updatedAtTick: currentTick,
    },
    create: {
      playerId,
      factionId,
      score: gain,
      currentTickGainThisTick: gain,
      updatedAtTick: currentTick,
    },
  });

  return { tradeDenied: false };
}
