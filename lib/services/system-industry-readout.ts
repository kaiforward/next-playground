/**
 * The one assembly of `buildIndustryReadout`'s world-state context — the buildings roster, the
 * effective yields vector, and the four market accessors it reads per good — shared by every service
 * that needs a system's industry readout (the Industry panel's full read in
 * `lib/services/universe.ts`, and the alert bar's idle-capacity read in `lib/services/alerts.ts`).
 *
 * It lives here rather than inside either consumer because both need the identical context and
 * neither owns it: a fifth accessor, or a change to the persisted-vs-recomputed `honestUseRate`
 * fallback, must move both readouts at once or the Industry panel and the Industry idle alert stop
 * agreeing about what "idle" means.
 *
 * Callers add their own extra work on top (slot caps, worked deposits, pop needs) at their own call
 * site — this owns the shared context only.
 */
import type { WorldSystem } from "@/lib/world/types";
import type { ResourceVector } from "@/lib/types/game";
import { buildingsBySystem, marketsBySystem } from "@/lib/services/world-index";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { buildIndustryReadout, type SystemIndustryReadout } from "@/lib/engine/industry";
import { useRatesByGood, type UseRate } from "@/lib/engine/honest-demand";

export interface SystemIndustryReadoutResult {
  /** The system's building roster, straight off the shared world index — NOT a copy. Every consumer
   *  below reads it (`buildIndustryReadout`, `extractorsByResource`, `capacityGoodRates`,
   *  `summariseSpace`) and none writes to it, so handing out the cached record is safe. A caller that
   *  needs to FOLD anything into the roster (queued construction levels, say) must shallow-copy at
   *  its own call site before writing — the cached record is shared with every other reader this
   *  tick. */
  buildings: Record<string, number>;
  /** Per-resource effective yields — carried out because callers need the same vector for their own
   *  deposit and capacity reads, and recomputing it would be a second source for one figure. */
  yields: ResourceVector;
  readout: SystemIndustryReadout;
}

/**
 * Assemble one system's industry readout from world state.
 *
 * Market rows supply four per-good inputs, keyed by good KEY (world market rows already use good
 * keys as `goodId`): the pricing demand rate, the persisted use figure, the anchor multiplier and
 * the wanted-but-unfunded logistics bit. `marketStock` comes from the same pass.
 *
 * A row with no persisted `honestUseRate` (a legacy save, or a fixture that never set one)
 * recomputes live rather than reading as 0 — a 0 would weld the brake knee to the output term alone
 * and misread a real draw as none. The recompute is lazy and memoised across goods, so a system
 * whose rows all carry the figure never runs it.
 */
export function readSystemIndustry(system: WorldSystem): SystemIndustryReadoutResult {
  const buildings: Record<string, number> = buildingsBySystem().get(system.id) ?? {};

  const marketStock: Record<string, number> = {};
  const demandRateByGood: Record<string, number> = {};
  // Map, not Record: key absence (no persisted figure / no market row) must be type-visible to its
  // readers rather than resolving through an implicit `undefined` index.
  const honestUseRateByGood = new Map<string, number>();
  const anchorMultByGood = new Map<string, number>();
  const logisticsFundingBoundByGood: Record<string, boolean> = {};
  let rowSuppressRate: number | undefined;
  for (const row of marketsBySystem().get(system.id) ?? []) {
    marketStock[row.goodId] = row.stock;
    demandRateByGood[row.goodId] = row.demandRate;
    if (typeof row.honestUseRate === "number" && Number.isFinite(row.honestUseRate)) {
      honestUseRateByGood.set(row.goodId, row.honestUseRate);
    }
    anchorMultByGood.set(row.goodId, row.anchorMult);
    rowSuppressRate ??= row.productionSuppressRate;
    logisticsFundingBoundByGood[row.goodId] = row.logisticsFundingBound ?? false;
  }

  const yields = resourceVectorFromColumns(
    {
      yieldGas: system.yieldGas, yieldMinerals: system.yieldMinerals, yieldOre: system.yieldOre,
      yieldBiomass: system.yieldBiomass, yieldArable: system.yieldArable,
      yieldWater: system.yieldWater, yieldRadioactive: system.yieldRadioactive,
    },
    "yield",
  );

  let recomputedUse: Map<string, UseRate> | undefined;
  const honestUseRateOf = (goodKey: string): number => {
    const persisted = honestUseRateByGood.get(goodKey);
    if (persisted !== undefined) return persisted;
    recomputedUse ??= useRatesByGood({
      buildings,
      population: system.population,
      yields,
      productionSuppress: rowSuppressRate ?? 1,
    });
    return recomputedUse.get(goodKey)?.total ?? 0;
  };

  const readout = buildIndustryReadout(buildings, system.population, marketStock, yields, {
    demandRateOf: (goodKey) => demandRateByGood[goodKey] ?? 0,
    honestUseRateOf,
    anchorMultOf: (goodKey) => anchorMultByGood.get(goodKey) ?? 1,
    logisticsFundingBoundOf: (goodKey) => logisticsFundingBoundByGood[goodKey] ?? false,
  });

  return { buildings, yields, readout };
}
