import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
  EconomySignals,
} from "../types";
import {
  selfLimitingFactor,
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

const DEBUG = process.env.DEBUG_ECONOMY === "1";

/**
 * Pure processor body. Same logic runs against the Prisma adapter (live game)
 * or the in-memory adapter (simulator + unit tests). All knobs that differ
 * between live and sim (RNG, sim params) come in via `params`.
 *
 * Round-robin: one region per tick, picked from the adapter's region list.
 */
export async function runEconomyProcessor(
  world: EconomyWorld,
  ctx: TickContext,
  params: EconomyProcessorParams,
): Promise<TickProcessorResult> {
  const { rng, simParams, modifierCaps, strikeParams } = params;

  const regions = await world.getRegions();
  if (regions.length === 0) {
    return {
      globalEvents: {
        economyTick: [{ regionId: "", regionName: "", marketCount: 0 }],
      },
    };
  }

  const regionIndex = ctx.tick % regions.length;
  const targetRegion = regions[regionIndex];

  const markets = await world.getMarketsForRegion(targetRegion.id);
  if (markets.length === 0) {
    return {
      globalEvents: {
        economyTick: [
          {
            regionId: targetRegion.id,
            regionName: targetRegion.name,
            marketCount: 0,
          },
        ],
      },
    };
  }

  // Index modifiers: region-scoped apply to all systems; system-scoped target one.
  const systemIds = [...new Set(markets.map((m) => m.systemId))];
  const rawModifiers = await world.getModifiers(systemIds, targetRegion.id);
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

  // Read stored unrest from the previous tick to derive per-system strike multipliers.
  const unrestBySystem = await world.getUnrest(systemIds);

  // Build tick entries via the shared market-tick builder. Government modifiers
  // are resolved per-market (border regions can contain systems owned by
  // different factions) rather than once per region. Strike suppression is
  // production-only — consumption is unaffected by labor action.
  const resolved = markets.map((m) =>
    resolveMarketTickEntry({
      goodId: m.goodId,
      stock: m.stock,
      demandRate: m.demandRate,
      storageCapacity: m.storageCapacity,
      baseProductionRate: m.baseProductionRate,
      baseConsumptionRate: m.baseConsumptionRate,
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

  // Measure per-system convex demand-weighted dissatisfaction D from post-tick stock.
  // satisfaction_g = consume self-limiting factor = sqrt((stock−min)/range).
  const goodsBySystem = new Map<string, GoodSatisfaction[]>();
  markets.forEach((m, i) => {
    const consumptionRate = tickEntries[i].consumptionRate;
    if (consumptionRate == null || consumptionRate <= 0) return;
    const demanded = consumptionRate * (tickEntries[i].consumptionMult ?? 1);
    const satisfaction = selfLimitingFactor(simulated[i].stock, tickEntries[i].minStock, tickEntries[i].maxStock, "consume");
    const arr = goodsBySystem.get(m.systemId) ?? [];
    arr.push({ satisfaction, demanded });
    goodsBySystem.set(m.systemId, arr);
  });
  const dissatisfactionBySystem = new Map<string, number>();
  for (const sysId of systemIds) {
    dissatisfactionBySystem.set(sysId, dissatisfaction(goodsBySystem.get(sysId) ?? []));
  }
  const economySignals: EconomySignals = { dissatisfactionBySystem };

  const modCount = rawModifiers.length;
  if (DEBUG) {
    console.log(
      `[economy] Region "${targetRegion.name}" (${regionIndex + 1}/${regions.length}): ${markets.length} markets` +
        (modCount > 0 ? `, ${modCount} active modifier(s)` : ""),
    );
  }

  return {
    globalEvents: {
      economyTick: [
        {
          regionId: targetRegion.id,
          regionName: targetRegion.name,
          marketCount: markets.length,
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
  // Runs every tick; round-robin region selection happens inside runEconomyProcessor.
  frequency: 1,
  dependsOn: ["events"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaEconomyWorld(ctx.tx);
    return runEconomyProcessor(world, ctx, {
      rng: Math.random,
      simParams,
      modifierCaps: MODIFIER_CAPS,
      strikeParams: STRIKE_PARAMS,
    });
  },
};
