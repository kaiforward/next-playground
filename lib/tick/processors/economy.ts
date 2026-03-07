import type { TickProcessor, TickProcessorResult, TxClient } from "../types";
import { simulateEconomyTick, updateProsperity, buildMarketTickEntry, type EconomySimParams, type ProsperityParams } from "@/lib/engine/tick";
import {
  getProducedGoods,
  getConsumedGoods,
  getProductionRate,
  getConsumptionRate,
} from "@/lib/constants/universe";
import {
  ECONOMY_CONSTANTS,
  EQUILIBRIUM_TARGETS,
  getConsumeEquilibrium,
  PROSPERITY_DECAY_RATE,
  PROSPERITY_MAX_GAIN,
  PROSPERITY_TARGET_VOLUME,
  PROSPERITY_MIN,
  PROSPERITY_MAX,
  PROSPERITY_MULT_AT_MIN,
  PROSPERITY_MULT_AT_ZERO,
  PROSPERITY_MULT_AT_MAX,
} from "@/lib/constants/economy";
import { GOODS, GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import { aggregateModifiers, type ModifierRow } from "@/lib/engine/events";
import { GOVERNMENT_TYPES, adjustEquilibriumSpread } from "@/lib/constants/government";
import { toEconomyType, toGovernmentType, toTraitId, toQualityTier } from "@/lib/types/guards";

/** Prosperity params built from constants (done once, reused every tick). */
const prosperityParams: ProsperityParams = {
  decayRate: PROSPERITY_DECAY_RATE,
  maxGain: PROSPERITY_MAX_GAIN,
  targetVolume: PROSPERITY_TARGET_VOLUME,
  min: PROSPERITY_MIN,
  max: PROSPERITY_MAX,
  multAtMin: PROSPERITY_MULT_AT_MIN,
  multAtZero: PROSPERITY_MULT_AT_ZERO,
  multAtMax: PROSPERITY_MULT_AT_MAX,
};

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

/** Bulk-update market supply/demand in a single SQL round-trip. */
async function batchUpdateMarkets(
  tx: TxClient,
  updates: { id: string; supply: number; demand: number }[],
): Promise<void> {
  if (updates.length === 0) return;

  const ids = updates.map((u) => u.id);
  const supplies = updates.map((u) => isFinite(u.supply) ? u.supply : 0);
  const demands = updates.map((u) => isFinite(u.demand) ? u.demand : 0);

  await tx.$executeRaw`
    UPDATE "StationMarket" AS sm
    SET "supply" = batch."supply", "demand" = batch."demand"
    FROM unnest(${ids}::text[], ${supplies}::double precision[], ${demands}::double precision[])
      AS batch("id", "supply", "demand")
    WHERE sm."id" = batch."id"`;
}

/**
 * Bulk-update system prosperity and subtract captured trade volume.
 * Uses relative subtraction (not hard-reset to 0) so trades committed
 * between the read and this write aren't silently lost.
 */
async function batchUpdateProsperity(
  tx: TxClient,
  updates: { id: string; prosperity: number; capturedVolume: number }[],
): Promise<void> {
  if (updates.length === 0) return;

  const ids = updates.map((u) => u.id);
  const prosperities = updates.map((u) => isFinite(u.prosperity) ? u.prosperity : 0);
  const volumes = updates.map((u) => u.capturedVolume);

  await tx.$executeRaw`
    UPDATE "StarSystem" AS ss
    SET "prosperity" = batch."prosperity",
        "tradeVolumeAccum" = GREATEST(0, ss."tradeVolumeAccum" - batch."capturedVolume")
    FROM unnest(${ids}::text[], ${prosperities}::double precision[], ${volumes}::integer[])
      AS batch("id", "prosperity", "capturedVolume")
    WHERE ss."id" = batch."id"`;
}

export const economyProcessor: TickProcessor = {
  name: "economy",
  // Runs every tick; round-robin region selection happens inside process()
  frequency: 1,
  dependsOn: ["events"],

  async process(ctx): Promise<TickProcessorResult> {
    // Get all regions to determine round-robin target
    const regions = await ctx.tx.region.findMany({
      select: { id: true, name: true, governmentType: true },
      orderBy: { name: "asc" },
    });

    if (regions.length === 0) {
      return { globalEvents: { economyTick: [{ regionId: "", regionName: "", marketCount: 0 }] } };
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
        station: { include: { system: { include: { traits: true } } } },
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

    // Look up government modifiers for this region
    const govDef = GOVERNMENT_TYPES[toGovernmentType(targetRegion.governmentType)];

    // ── Prosperity: compute per system ──────────────────────────────
    // Fetch prosperity + trade volume for systems in this region
    const systemProsperityData = await ctx.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: { id: true, prosperity: true, tradeVolumeAccum: true },
    });

    const prosperityBySystem = new Map<string, number>();
    const prosperityUpdates: { id: string; prosperity: number; capturedVolume: number }[] = [];

    for (const sys of systemProsperityData) {
      const newProsperity = updateProsperity(
        sys.prosperity,
        sys.tradeVolumeAccum,
        prosperityParams,
      );
      prosperityBySystem.set(sys.id, newProsperity);
      prosperityUpdates.push({ id: sys.id, prosperity: newProsperity, capturedVolume: sys.tradeVolumeAccum });
    }

    // Build tick entries for the simulation engine
    const tickEntries = markets.map((m) => {
      const econ = toEconomyType(m.station.system.economyType);
      const goodKey = GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name;
      const sysMods = modifiersBySystem.get(m.station.system.id) ?? [];
      const agg = sysMods.length > 0
        ? aggregateModifiers(sysMods, goodKey, MODIFIER_CAPS)
        : undefined;

      const goodDef = GOODS[goodKey];

      // Government: scale volatility
      const baseVolatility = goodDef?.volatility ?? 1;
      const volatility = govDef
        ? baseVolatility * govDef.volatilityModifier
        : baseVolatility;

      // Self-sufficiency: adjust consume targets per economy type
      let equilibriumProduces = goodDef?.equilibrium.produces;
      let equilibriumConsumes = goodDef
        ? getConsumeEquilibrium(econ, goodKey, goodDef.equilibrium)
        : undefined;
      if (govDef && govDef.equilibriumSpreadPct !== 0) {
        if (equilibriumProduces) {
          equilibriumProduces = adjustEquilibriumSpread(equilibriumProduces, govDef.equilibriumSpreadPct);
        }
        if (equilibriumConsumes) {
          equilibriumConsumes = adjustEquilibriumSpread(equilibriumConsumes, govDef.equilibriumSpreadPct);
        }
      }

      const entry = buildMarketTickEntry({
        goodId: goodKey,
        supply: m.supply,
        demand: m.demand,
        basePrice: m.good.basePrice,
        economyType: econ,
        produces: getProducedGoods(econ),
        consumes: getConsumedGoods(econ),
        volatility,
        equilibriumProduces,
        equilibriumConsumes,
        baseProductionRate: getProductionRate(econ, goodKey),
        baseConsumptionRate: getConsumptionRate(econ, goodKey),
        govConsumptionBoost: govDef?.consumptionBoosts[goodKey] ?? 0,
        traits: m.station.system.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })),
        prosperity: prosperityBySystem.get(m.station.system.id) ?? 0,
      }, prosperityParams);

      return agg
        ? {
            ...entry,
            supplyTargetMult: agg.supplyTargetMult,
            demandTargetMult: agg.demandTargetMult,
            productionMult: agg.productionMult,
            consumptionMult: agg.consumptionMult,
            reversionMult: agg.reversionMult,
          }
        : entry;
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
    await batchUpdateProsperity(ctx.tx, prosperityUpdates);

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
