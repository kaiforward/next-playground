/**
 * Faction treasury surfaces — reads come straight off the persisted
 * `WorldFactionTreasury` row (Plans 1–2 persist everything the UI shows, so
 * there is nothing to recompute); the policy write is the player seat's only
 * treasury verb and is gated to `world.player.controlledFactionId`.
 */
import { getWorld } from "@/lib/world/store";
import { ServiceError } from "./errors";
import type { FactionTreasuryData } from "@/lib/types/api";

export function getFactionTreasury(factionId: string): FactionTreasuryData {
  const world = getWorld();
  const treasury = world.treasuries.find((t) => t.factionId === factionId);
  if (!treasury) {
    throw new ServiceError(`Faction ${factionId} not found.`, 404);
  }
  const s = treasury.lastSettlement;
  const net = s
    ? s.headsIncome +
      s.productionIncome -
      (s.paid.maintenance + s.paid.logistics + s.paid.construction)
    : 0;
  return {
    factionId,
    balance: treasury.balance,
    taxLevel: treasury.taxLevel,
    bands: treasury.bands,
    funded: treasury.funded,
    net,
    lastSettlement: s,
  };
}
