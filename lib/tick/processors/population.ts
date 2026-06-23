import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { accumulateUnrest, populationDelta } from "@/lib/engine/population";
import { UNREST_PARAMS, POPULATION_PARAMS } from "@/lib/constants/population";
import { PrismaPopulationWorld } from "@/lib/tick/adapters/prisma/population";
import type {
  PopulationProcessorParams, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";

/**
 * Pure processor body. Reads the per-system dissatisfaction D the economy
 * processor recorded this tick (via ctx.results), integrates it into unrest,
 * applies logistic growth/decline, and rewrites demandRate for the new
 * population. Scoped to the economy's shard (D's key set), so per-tick
 * work is bounded and the satisfaction signal is fresh.
 */
export async function runPopulationProcessor(
  world: PopulationWorld,
  ctx: TickContext,
  params: PopulationProcessorParams,
): Promise<TickProcessorResult> {
  const signals = ctx.results.get("economy")?.economySignals;
  if (!signals || signals.dissatisfactionBySystem.size === 0) return {};

  const systemIds = [...signals.dissatisfactionBySystem.keys()];
  const states = await world.getPopulationState(systemIds);

  const popUpdates: PopulationUpdate[] = [];
  const demandPops: Array<{ systemId: string; population: number }> = [];
  for (const s of states) {
    const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
    const unrest = accumulateUnrest(s.unrest, d, params.unrest);
    const population = Math.max(0, s.population + populationDelta(s.population, s.popCap, d, unrest, params.population));
    popUpdates.push({ systemId: s.systemId, population, unrest });
    demandPops.push({ systemId: s.systemId, population });
  }

  await world.applyPopulationUpdates(popUpdates);
  await world.rewriteDemandRates(demandPops);
  return {};
}

// ── Live-game wiring ──────────────────────────────────────────────

export const populationProcessor: TickProcessor = {
  name: "population",
  frequency: 1,
  dependsOn: ["economy", "infrastructure-decay"],
  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaPopulationWorld(ctx.tx);
    return runPopulationProcessor(world, ctx, { unrest: UNREST_PARAMS, population: POPULATION_PARAMS });
  },
};
