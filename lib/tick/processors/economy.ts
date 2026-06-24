import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
  EconomySignals,
} from "../types";
import {
  selfLimitingFactor,
  outputUptake,
  type EconomySimParams,
  type MarketTickEntry,
} from "@/lib/engine/tick";
import { simulateCoupledEconomyTick } from "@/lib/engine/supply-chain";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import type { ModifierRow } from "@/lib/engine/events";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { resolveMarketTickEntry } from "@/lib/engine/market-tick-builder";
import { PrismaEconomyWorld } from "@/lib/tick/adapters/prisma/economy";
import type {
  EconomyProcessorParams,
  EconomyWorld,
  MarketUpdate,
} from "@/lib/tick/world/economy-world";
import { dissatisfaction, strikeMultiplier, type GoodSatisfaction } from "@/lib/engine/population";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { shardRange, catchUpFactor } from "@/lib/tick/shard";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

const DEBUG = process.env.DEBUG_ECONOMY === "1";

/**
 * Pure processor body. Same logic runs against the Prisma adapter (live game)
 * or the in-memory adapter (simulator + unit tests). All knobs that differ
 * between live and sim (RNG, sim params) come in via `params`.
 *
 * Fixed-interval system shard: each tick processes `shardRange(systems, tick,
 * interval)` of the stable-sorted system list, so every system refreshes once
 * per `interval` ticks at any universe scale. Per-update production/consumption
 * are scaled by `catchUpFactor(interval)` so the wall-clock rate is constant and
 * the equilibrium stock is interval-invariant.
 */
export async function runEconomyProcessor(
  world: EconomyWorld,
  ctx: TickContext,
  params: EconomyProcessorParams,
): Promise<TickProcessorResult> {
  const { rng, interval, simParams, modifierCaps, strikeParams } = params;

  const allSystemIds = await world.getSystemIds();
  const { start, end } = shardRange(allSystemIds.length, ctx.tick, interval);
  const shardIndex = ((ctx.tick % interval) + interval) % interval;
  const emptyPayload = {
    economyTick: [{ systemCount: 0, shardIndex, shardCount: interval }],
  };
  if (start >= end) {
    return { globalEvents: emptyPayload };
  }

  const shardSystemIds = allSystemIds.slice(start, end);
  const markets = await world.getMarketsForSystems(shardSystemIds);
  if (markets.length === 0) {
    return { globalEvents: emptyPayload };
  }

  // The shard spans regions, so a region-targeted modifier applies only to the
  // systems in THAT region (not the whole slice). Map each system's region, then
  // attach region-targeted mods by region and system-targeted mods by system.
  const systemIds = [...new Set(markets.map((m) => m.systemId))];
  const regionBySystem = new Map<string, string>();
  for (const m of markets) regionBySystem.set(m.systemId, m.regionId);

  const rawModifiers = await world.getModifiers(systemIds);
  const regionModsByRegion = new Map<string, ModifierRow[]>();
  for (const mod of rawModifiers) {
    if (mod.targetType === "region" && mod.targetId) {
      const arr = regionModsByRegion.get(mod.targetId) ?? [];
      arr.push(mod);
      regionModsByRegion.set(mod.targetId, arr);
    }
  }
  const modifiersBySystem = new Map<string, ModifierRow[]>();
  for (const sysId of systemIds) {
    const regionId = regionBySystem.get(sysId);
    const regionMods = regionId ? regionModsByRegion.get(regionId) ?? [] : [];
    modifiersBySystem.set(sysId, [...regionMods]);
  }
  for (const mod of rawModifiers) {
    if (mod.targetType === "system" && mod.targetId) {
      modifiersBySystem.get(mod.targetId)?.push(mod);
    }
  }

  // Read stored unrest from the previous tick to derive per-system strike multipliers.
  const unrestBySystem = await world.getUnrest(systemIds);

  // Build tick entries via the shared market-tick builder. Government modifiers
  // are resolved per-market (a shard slice contains systems owned by different
  // factions) rather than once per region. Strike suppression is production-only
  // — consumption is unaffected by labor action. The catch-up factor scales the
  // per-update production AND consumption symmetrically (band geometry — demand
  // anchor + storage — is rate-independent and stays untouched).
  const catchUp = catchUpFactor(interval);
  const resolved = markets.map((m) =>
    resolveMarketTickEntry({
      goodId: m.goodId,
      stock: m.stock,
      demandRate: m.demandRate,
      storageCapacity: m.storageCapacity,
      baseProductionRate: m.baseProductionRate != null ? m.baseProductionRate * catchUp : undefined,
      baseConsumptionRate: m.baseConsumptionRate != null ? m.baseConsumptionRate * catchUp : undefined,
      govDef: GOVERNMENT_TYPES[m.governmentType] ?? undefined,
      traits: m.traits,
      productionSuppress: strikeMultiplier(unrestBySystem.get(m.systemId) ?? 0, strikeParams),
      modifiers: modifiersBySystem.get(m.systemId) ?? [],
      modifierCaps,
    }),
  );

  const tickEntries: MarketTickEntry[] = resolved.map((r) => r.entry);
  const entrySystemIds = markets.map((m) => m.systemId);
  const simulated = simulateCoupledEconomyTick(tickEntries, entrySystemIds, simParams, rng);

  // anchorMult comes straight off the resolved tick — the builder already
  // aggregated the system's modifiers, so there's no second aggregation pass.
  const marketUpdates: MarketUpdate[] = markets.map((m, i) => ({
    id: m.id,
    stock: simulated[i].stock,
    anchorMult: resolved[i].anchorMult,
  }));

  await world.applyMarketUpdates(marketUpdates);

  // Measure per-system convex demand-weighted dissatisfaction D (consume side) and
  // per-produced-good output uptake (produce side) from post-tick stock.
  const goodsBySystem = new Map<string, GoodSatisfaction[]>();
  const uptakeBySystem = new Map<string, Map<string, number>>();
  markets.forEach((m, i) => {
    const consumptionRate = tickEntries[i].consumptionRate;
    if (consumptionRate != null && consumptionRate > 0) {
      const demanded = consumptionRate * (tickEntries[i].consumptionMult ?? 1);
      const satisfaction = selfLimitingFactor(simulated[i].stock, tickEntries[i].minStock, tickEntries[i].maxStock, "consume");
      const arr = goodsBySystem.get(m.systemId) ?? [];
      arr.push({ satisfaction, demanded });
      goodsBySystem.set(m.systemId, arr);
    }
    const productionRate = tickEntries[i].productionRate;
    if (productionRate != null && productionRate > 0) {
      const uptake = outputUptake(simulated[i].stock, tickEntries[i].minStock, tickEntries[i].maxStock);
      const map = uptakeBySystem.get(m.systemId) ?? new Map<string, number>();
      map.set(m.goodId, uptake);
      uptakeBySystem.set(m.systemId, map);
    }
  });
  const dissatisfactionBySystem = new Map<string, number>();
  for (const sysId of systemIds) {
    dissatisfactionBySystem.set(sysId, dissatisfaction(goodsBySystem.get(sysId) ?? []));
  }
  const economySignals: EconomySignals = { dissatisfactionBySystem, outputUptakeBySystem: uptakeBySystem };

  const modCount = rawModifiers.length;
  if (DEBUG) {
    console.log(
      `[economy] Shard ${shardIndex + 1}/${interval}: ${systemIds.length} systems / ${markets.length} markets` +
        (modCount > 0 ? `, ${modCount} active modifier(s)` : ""),
    );
  }

  return {
    globalEvents: {
      economyTick: [
        {
          systemCount: systemIds.length,
          shardIndex,
          shardCount: interval,
        },
      ],
    },
    economySignals,
  };
}

// ── Live-game wiring ──────────────────────────────────────────────

const simParams: EconomySimParams = {
  noiseFraction: ECONOMY_CONSTANTS.NOISE_FRACTION,
};

export const economyProcessor: TickProcessor = {
  name: "economy",
  // Runs every tick; the fixed-interval system shard happens inside runEconomyProcessor.
  frequency: 1,
  dependsOn: ["events"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaEconomyWorld(ctx.tx);
    return runEconomyProcessor(world, ctx, {
      rng: Math.random,
      interval: ECONOMY_UPDATE_INTERVAL,
      simParams,
      modifierCaps: MODIFIER_CAPS,
      strikeParams: STRIKE_PARAMS,
    });
  },
};
