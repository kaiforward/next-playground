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

  // Rates are reference-denominated; one run applies catchUpFactor(interval) reference-cycles of
  // change. Only the relaxation rates rescale the time step — the slopes are dimensionless exchange rates
  // on the equilibrium, and the gain is derived from the (scaled, clamped) rate inside
  // accumulateUnrest, so equilibrium is catch-up invariant by construction.
  const catchUp = catchUpFactor(params.interval);
  const scaledUnrest: UnrestParams = {
    ...params.unrest,
    decay: params.unrest.decay * catchUp,
    recoveryDecay: params.unrest.recoveryDecay * catchUp,
  };

  const popUpdates: PopulationUpdate[] = [];
  const demandPops: Array<{ systemId: string; population: number; productionSuppress: number }> = [];
  for (const s of states) {
    const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
    const supply = signals.supplyStateBySystem.get(s.systemId)
      ?? { regime: "supplied", survivalShortfall: false };
    // Standing pressure: what a system settles at with nothing going wrong. Tax raises
    // unrest, not hunger, and overcrowding adds a bounded share on top — so both hold
    // unrest up rather than being shed like a supply shock, while the growth/decline
    // delta keeps raw d.
    const taxPressure = params.taxPressureBySystem?.get(s.systemId) ?? 0;
    // Crowding reads the population as this cycle STARTED — the floor is a level, so it is measured
    // at cycle start. A system that crosses r = 1 during this cycle therefore carries no crowding
    // pressure until the next one.
    // The ramp end (crowdBrakeEnd) threads through params because it's a boundary shared with the
    // growth brake; the ramp height (PRESSURE_MAX) has no other consumer, so it stays a module-scope
    // constant instead — the mixed shape is deliberate, not an inconsistency.
    const crowd = crowdingPressure(s.population, s.popCap, params.population.crowdBrakeEnd, CROWDING.PRESSURE_MAX);
    const floor = clamp(taxPressure + crowd, 0, 1);
    const unrest = accumulateUnrest(s.unrest, d, floor, supply, scaledUnrest);
    // The delta reads the unrest this cycle just produced, so unrest resolves forward within the
    // cycle while crowding lags it by one.
    const population = Math.max(0, s.population + populationDelta(s.population, s.popCap, d, unrest, params.population) * catchUp);
    popUpdates.push({ systemId: s.systemId, population, unrest });
    // The scalar the economy actually applied this cycle, not a recompute: the strike params and
    // the treasury-fed maintenance malus never reach this processor, and the unrest just written
    // above is the wrong half of the input anyway. A system the signal omits was unsuppressed.
    demandPops.push({
      systemId: s.systemId,
      population,
      productionSuppress: signals.productionSuppressBySystem.get(s.systemId) ?? 1,
    });
  }

  await world.applyPopulationUpdates(popUpdates);
  await world.rewriteDemandRates(demandPops);
  return {};
}
