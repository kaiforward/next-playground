import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
import { GOODS } from "@/lib/constants/goods";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { bandForMultiplier, depositDisplayName } from "@/lib/engine/substrate-space";
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

/** One good's trade profile, prepared for the Astrography diverging-bar display. */
export interface TradeBar {
  goodId: string;
  name: string;
  production: number;
  consumption: number;
  /** production − consumption: positive = net export, negative = net import. */
  net: number;
  /** production / largest single rate across all goods, in [0, 1]. */
  prodFraction: number;
  /** consumption / largest single rate across all goods, in [0, 1]. */
  consFraction: number;
}

/**
 * Prepares a system's per-good production/consumption rates for the trade-profile
 * display: resolves names, computes the net balance, normalizes both directions
 * to the largest single rate across all goods (so the bars share one scale), and
 * sorts net exporters first, net importers last.
 */
export function prepareTradeBars(goods: SubstrateGoodRate[]): TradeBar[] {
  const maxRate = goods.reduce(
    (max, g) => Math.max(max, g.production, g.consumption),
    0,
  );
  const norm = (v: number) => (maxRate > 0 ? v / maxRate : 0);

  return goods
    .map((g) => ({
      goodId: g.goodId,
      name: GOODS[g.goodId]?.name ?? g.goodId,
      production: g.production,
      consumption: g.consumption,
      net: g.production - g.consumption,
      prodFraction: norm(g.production),
      consFraction: norm(g.consumption),
    }))
    .sort((a, b) => b.net - a.net);
}
