import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
} from "../types";
import {
  simulateEconomyTick,
  updateProsperity,
  type EconomySimParams,
  type MarketTickEntry,
  type ProsperityParams,
} from "@/lib/engine/tick";
import { ECONOMY_CONSTANTS, PROSPERITY_PARAMS } from "@/lib/constants/economy";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import type { ModifierRow } from "@/lib/engine/events";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { resolveMarketTickEntry } from "@/lib/engine/market-tick-builder";
import { PrismaEconomyWorld } from "@/lib/tick/adapters/prisma/economy";
import type {
  EconomyProcessorParams,
  EconomyWorld,
  MarketUpdate,
  ProsperityUpdate,
} from "@/lib/tick/world/economy-world";

const DEBUG = process.env.DEBUG_ECONOMY === "1";

/**
 * Pure processor body. Same logic runs against the Prisma adapter (live game)
 * or the in-memory adapter (simulator + unit tests). All knobs that differ
 * between live and sim (RNG, sim params, prosperity params) come in via
 * `params`.
 *
 * Round-robin: one region per tick, picked from the adapter's region list.
 */
export async function runEconomyProcessor(
  world: EconomyWorld,
  ctx: TickContext,
  params: EconomyProcessorParams,
): Promise<TickProcessorResult> {
  const { rng, simParams, prosperityParams, modifierCaps } = params;

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

  // Prosperity: compute next value per system using current accum volume.
  const prosperityViews = await world.getProsperity(systemIds);
  const prosperityBySystem = new Map<string, number>();
  const prosperityUpdates: ProsperityUpdate[] = [];

  for (const view of prosperityViews) {
    const newProsperity = updateProsperity(
      view.prosperity,
      view.tradeVolumeAccum,
      prosperityParams,
    );
    prosperityBySystem.set(view.systemId, newProsperity);
    prosperityUpdates.push({
      systemId: view.systemId,
      prosperity: newProsperity,
      capturedVolume: view.tradeVolumeAccum,
    });
  }

  // Build tick entries via the shared market-tick builder. Government modifiers
  // are resolved per-market (border regions can contain systems owned by
  // different factions) rather than once per region.
  const resolved = markets.map((m) =>
    resolveMarketTickEntry(
      {
        goodId: m.goodId,
        stock: m.stock,
        baseProductionRate: m.baseProductionRate,
        baseConsumptionRate: m.baseConsumptionRate,
        govDef: GOVERNMENT_TYPES[m.governmentType] ?? undefined,
        traits: m.traits,
        prosperity: prosperityBySystem.get(m.systemId) ?? 0,
        modifiers: modifiersBySystem.get(m.systemId) ?? [],
        modifierCaps,
      },
      prosperityParams,
    ),
  );

  const tickEntries: MarketTickEntry[] = resolved.map((r) => r.entry);
  const simulated = simulateEconomyTick(tickEntries, simParams, rng);

  // anchorMult comes straight off the resolved tick — the builder already
  // aggregated the system's modifiers, so there's no second aggregation pass.
  const marketUpdates: MarketUpdate[] = markets.map((m, i) => ({
    id: m.id,
    stock: simulated[i].stock,
    anchorMult: resolved[i].anchorMult,
  }));

  await world.applyMarketUpdates(marketUpdates);
  await world.applyProsperityUpdates(prosperityUpdates);

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
  };
}

// ── Live-game wiring ──────────────────────────────────────────────

const prosperityParams: ProsperityParams = PROSPERITY_PARAMS;

const simParams: EconomySimParams = {
  noiseAmplitude: ECONOMY_CONSTANTS.NOISE_AMPLITUDE,
  minLevel: ECONOMY_CONSTANTS.MIN_LEVEL,
  maxLevel: ECONOMY_CONSTANTS.MAX_LEVEL,
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
      prosperityParams,
      modifierCaps: MODIFIER_CAPS,
    });
  },
};
