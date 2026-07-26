import type { TickContext, TickProcessorResult } from "../types";
import {
  accumulateUnrest, crowdingPressure, populationDelta, type UnrestParams,
} from "@/lib/engine/population";
import { CROWDING } from "@/lib/constants/population";
import { catchUpFactor } from "@/lib/tick/shard";
import { clamp } from "@/lib/utils/math";
import type {
  PopulationProcessorParams, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";

/**
 * Pure processor body. Reads the per-system dissatisfaction D and supply regime the
 * economy processor recorded this tick (via ctx.results), relaxes unrest toward its
 * standing-pressure floor while integrating D at the regime's rate, applies crowd-braked
 * growth/decline, and rewrites demandRate for the new population. Scoped to the
 * economy's shard (D's key set), so per-tick work is bounded and the satisfaction
 * signal is fresh.
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
  // reference-months of change. Unrest is a linear filter, so every gain and
  // relaxation rate pre-scales (rescaling the time step) — accumulateUnrest clamps the
  // scaled relaxation itself; the population delta scales directly.
  const catchUp = catchUpFactor(params.interval);
  const scaledUnrest: UnrestParams = {
    gainRationing: params.unrest.gainRationing * catchUp,
    gainShortage: params.unrest.gainShortage * catchUp,
    decay: params.unrest.decay * catchUp,
    recoveryDecay: params.unrest.recoveryDecay * catchUp,
  };

  const popUpdates: PopulationUpdate[] = [];
  const demandPops: Array<{ systemId: string; population: number }> = [];
  for (const s of states) {
    const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
    const regime = signals.supplyRegimeBySystem.get(s.systemId) ?? "supplied";
    // Standing pressure: what a system settles at with nothing going wrong. Tax raises
    // unrest, not hunger, and overcrowding adds a bounded share on top — so both hold
    // unrest up rather than being shed like a supply shock, while the growth/decline
    // delta keeps raw d.
    const taxPressure = params.taxPressureBySystem?.get(s.systemId) ?? 0;
    const crowd = crowdingPressure(s.population, s.popCap, params.population.crowdBrakeEnd, CROWDING.PRESSURE_MAX);
    const floor = clamp(taxPressure + crowd, 0, 1);
    const unrest = accumulateUnrest(s.unrest, d, floor, regime, scaledUnrest);
    const population = Math.max(0, s.population + populationDelta(s.population, s.popCap, d, unrest, params.population) * catchUp);
    popUpdates.push({ systemId: s.systemId, population, unrest });
    demandPops.push({ systemId: s.systemId, population });
  }

  await world.applyPopulationUpdates(popUpdates);
  await world.rewriteDemandRates(demandPops);
  return {};
}
