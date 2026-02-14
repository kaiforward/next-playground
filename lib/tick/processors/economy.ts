import type { TickProcessor, TickProcessorResult, TxClient } from "../types";
import { simulateEconomyTick, type EconomySimParams } from "@/lib/engine/tick";
import {
  getProducedGoods,
  getConsumedGoods,
  getProductionRate,
  getConsumptionRate,
} from "@/lib/constants/universe";
import { ECONOMY_CONSTANTS, EQUILIBRIUM_TARGETS } from "@/lib/constants/economy";
import { GOODS } from "@/lib/constants/goods";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import { aggregateModifiers, type ModifierRow } from "@/lib/engine/events";
import type { EconomyType } from "@/lib/types/game";

/** Reverse lookup: Good.name → GOODS key (e.g. "Food" → "food"). */
const goodNameToKey = new Map(
  Object.entries(GOODS).map(([key, def]) => [def.name, key]),
);

/** Build EconomySimParams from constants (done once, reused every tick). */
const simParams: EconomySimParams = {
  reversionRate: ECONOMY_CONSTANTS.REVERSION_RATE,
  noiseAmplitude: ECONOMY_CONSTANTS.NOISE_AMPLITUDE,
  minLevel: ECONOMY_CONSTANTS.MIN_LEVEL,
  maxLevel: ECONOMY_CONSTANTS.MAX_LEVEL,
  productionRate: ECONOMY_CONSTANTS.PRODUCTION_RATE,
  consumptionRate: ECONOMY_CONSTANTS.CONSUMPTION_RATE,
  equilibrium: EQUILIBRIUM_TARGETS,
};

/**
 * Update market supply/demand for a batch of markets.
 * Uses individual Prisma updates inside the shared transaction — single commit,
 * safe, and fast enough for ~150 rows on SQLite.
 *
 * TODO: Replace with parameterized batch SQL (`UPDATE...FROM VALUES`) after
 * PostgreSQL migration (Step 5).
 */
async function batchUpdateMarkets(
  tx: TxClient,
  updates: { id: string; supply: number; demand: number }[],
): Promise<void> {
  for (const u of updates) {
    await tx.stationMarket.update({
      where: { id: u.id },
      data: { supply: u.supply, demand: u.demand },
    });
  }
}

export const economyProcessor: TickProcessor = {
  name: "economy",
  // Runs every tick; round-robin region selection happens inside process()
  frequency: 1,
  dependsOn: ["events"],

  async process(ctx): Promise<TickProcessorResult> {
    // Get all regions to determine round-robin target
    const regions = await ctx.tx.region.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    if (regions.length === 0) {
      return { globalEvents: { economyTick: [{ marketCount: 0, regionName: null }] } };
    }

    // Round-robin: one region per tick
    const regionIndex = ctx.tick % regions.length;
    const targetRegion = regions[regionIndex];

    // Fetch markets for this region only
    const markets = await ctx.tx.stationMarket.findMany({
      where: {
        station: {
          system: { regionId: targetRegion.id },
        },
      },
      include: {
        good: true,
        station: { include: { system: true } },
      },
    });

    // Collect system IDs in this region for modifier querying
    const systemIds = [...new Set(markets.map((m) => m.station.system.id))];

    // Query active economy modifiers targeting systems in this region or the region itself
    const rawModifiers = systemIds.length > 0
      ? await ctx.tx.eventModifier.findMany({
          where: {
            domain: "economy",
            OR: [
              { targetType: "system", targetId: { in: systemIds } },
              { targetType: "region", targetId: targetRegion.id },
            ],
          },
        })
      : [];

    // Index modifiers by system ID (region-scoped modifiers apply to all systems)
    const regionMods = rawModifiers.filter((m) => m.targetType === "region");
    const modifiersBySystem = new Map<string, ModifierRow[]>();
    for (const sysId of systemIds) {
      modifiersBySystem.set(sysId, [...regionMods]);
    }
    for (const mod of rawModifiers) {
      if (mod.targetType === "system" && mod.targetId) {
        modifiersBySystem.get(mod.targetId)?.push(mod);
      }
    }

    // Build tick entries for the simulation engine
    const tickEntries = markets.map((m) => {
      const econ = m.station.system.economyType as EconomyType;
      const goodKey = goodNameToKey.get(m.good.name) ?? m.good.name;
      const sysMods = modifiersBySystem.get(m.station.system.id) ?? [];
      const agg = sysMods.length > 0
        ? aggregateModifiers(sysMods, goodKey, MODIFIER_CAPS)
        : undefined;

      const goodDef = GOODS[goodKey];
      return {
        goodId: goodKey,
        supply: m.supply,
        demand: m.demand,
        basePrice: m.good.basePrice,
        economyType: econ,
        produces: getProducedGoods(econ),
        consumes: getConsumedGoods(econ),
        productionRate: getProductionRate(econ, goodKey),
        consumptionRate: getConsumptionRate(econ, goodKey),
        volatility: goodDef?.volatility,
        equilibriumProduces: goodDef?.equilibrium.produces,
        equilibriumConsumes: goodDef?.equilibrium.consumes,
        ...(agg && {
          supplyTargetShift: agg.supplyTargetShift,
          demandTargetShift: agg.demandTargetShift,
          productionMult: agg.productionMult,
          consumptionMult: agg.consumptionMult,
          reversionMult: agg.reversionMult,
        }),
      };
    });

    // Run simulation
    const simulated = simulateEconomyTick(tickEntries, simParams);

    // Batch write results
    const updates = markets.map((m, i) => ({
      id: m.id,
      supply: simulated[i].supply,
      demand: simulated[i].demand,
    }));

    await batchUpdateMarkets(ctx.tx, updates);

    const modCount = rawModifiers.length;
    console.log(
      `[economy] Region "${targetRegion.name}" (${regionIndex + 1}/${regions.length}): ${markets.length} markets` +
      (modCount > 0 ? `, ${modCount} active modifier(s)` : ""),
    );

    return {
      globalEvents: {
        economyTick: [{
          regionId: targetRegion.id,
          regionName: targetRegion.name,
          marketCount: markets.length,
        }],
      },
    };
  },
};
