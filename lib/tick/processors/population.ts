import type { TickContext, TickProcessorResult } from "../types";
import { accumulateUnrest, populationDelta, type UnrestParams } from "@/lib/engine/population";
import { catchUpFactor } from "@/lib/tick/shard";
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

  // Rates are reference-denominated; one run applies catchUpFactor(interval)
  // reference-months of change. Unrest is a linear filter, so both its gain and
  // decay pre-scale (rescaling the time step); the population delta scales directly.
  const catchUp = catchUpFactor(params.interval);
  const scaledUnrest: UnrestParams = {
    gain: params.unrest.gain * catchUp,
    decay: params.unrest.decay * catchUp,
  };

  const popUpdates: PopulationUpdate[] = [];
  const demandPops: Array<{ systemId: string; population: number }> = [];
  for (const s of states) {
    const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
    // Tax pressure raises unrest, not hunger: it feeds the integrator's d term
    // (clamped inside accumulateUnrest) while the growth/decline delta keeps raw d.
    const taxPressure = params.taxPressureBySystem?.get(s.systemId) ?? 0;
    const unrest = accumulateUnrest(s.unrest, d + taxPressure, scaledUnrest);
    const population = Math.max(0, s.population + populationDelta(s.population, s.popCap, d, unrest, params.population) * catchUp);
    popUpdates.push({ systemId: s.systemId, population, unrest });
    demandPops.push({ systemId: s.systemId, population });
  }

  await world.applyPopulationUpdates(popUpdates);
  await world.rewriteDemandRates(demandPops);
  return {};
}
