/**
 * Faction treasury surfaces — reads come straight off the persisted
 * `WorldFactionTreasury` row (Plans 1–2 persist everything the UI shows, so
 * there is nothing to recompute); the policy write is the player seat's only
 * treasury verb and is gated to `world.player.controlledFactionId`.
 */
import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import { clamp } from "@/lib/utils/math";
import { TREASURY } from "@/lib/constants/treasury";
import { ServiceError } from "./errors";
import type { FactionTreasuryData, TreasuryPolicyData } from "@/lib/types/api";
import type { TreasuryBands } from "@/lib/engine/treasury";
import type { TreasuryPolicyInput } from "@/lib/schemas/treasury";

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

export type UpdateTreasuryPolicyResult =
  | { ok: true; data: TreasuryPolicyData }
  | { ok: false; error: string };

/**
 * The player seat's treasury verb: set the tax level and/or the three band
 * sliders. Clamps again at this boundary (schema-independent) — the
 * maintenance floor is enforced at every write boundary by design.
 */
export function updateTreasuryPolicy(
  factionId: string,
  input: TreasuryPolicyInput,
): UpdateTreasuryPolicyResult {
  if (!hasWorld()) return { ok: false, error: "No world loaded." };
  const world = getWorld();
  if (!world.player) return { ok: false, error: "This world has no player seat." };
  if (world.player.controlledFactionId !== factionId) {
    return { ok: false, error: "You do not control this faction." };
  }
  const treasury = world.treasuries.find((t) => t.factionId === factionId);
  if (!treasury) return { ok: false, error: `Faction ${factionId} has no treasury.` };

  const bands: TreasuryBands = input.bands
    ? {
        maintenance: clamp(input.bands.maintenance, TREASURY.MAINTENANCE_SLIDER_FLOOR, 1),
        logistics: clamp(input.bands.logistics, 0, 1),
        construction: clamp(input.bands.construction, 0, 1),
      }
    : treasury.bands;
  const taxLevel = input.taxLevel ?? treasury.taxLevel;

  setWorld({
    ...world,
    treasuries: world.treasuries.map((t) =>
      t.factionId === factionId ? { ...t, taxLevel, bands } : t,
    ),
  });
  return { ok: true, data: { taxLevel, bands } };
}
