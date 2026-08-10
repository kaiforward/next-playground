import type { TickContext, TickProcessorResult } from "../types";
import {
  accumulateUnrest, crowdingPressure, grievanceShortfall, populationDelta, supplyUnrestTerm,
  type UnrestParams,
} from "@/lib/engine/population";
import { CROWDING } from "@/lib/constants/population";
import { readExpectation, updateExpectation } from "@/lib/engine/expectation";
import { catchUpFactor } from "@/lib/tick/shard";
import { clamp } from "@/lib/utils/math";
import type {
  PopulationProcessorParams, PopulationUpdate, PopulationWorld,
} from "@/lib/tick/world/population-world";

/**
 * Pure processor body. Reads the per-system dissatisfaction D and supply state the
 * economy processor recorded this tick (via ctx.results), relaxes unrest toward its
 * standing-pressure floor at the single relaxation rate while integrating the supply term —
 * grievance against the persisted expectation memory, or the absolute crisis reading where that
 * fires (see supplyUnrestTerm) — applies crowd-braked growth/decline (still reading absolute D),
 * advances the expectation memory, and rewrites demandRate for the new population. Scoped to the
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
  // change. Only the relaxation rate rescales the time step — the slopes are dimensionless exchange
  // rates on the equilibrium, and the gain is derived from the (scaled, clamped) rate inside
  // accumulateUnrest, so equilibrium is catch-up invariant by construction.
  const catchUp = catchUpFactor(params.interval);
  const scaledUnrest: UnrestParams = {
    ...params.unrest,
    decay: params.unrest.decay * catchUp,
  };
  // The expectation update is NOT catch-up invariant the way the relaxation rate above is: it is a
  // nonlinear, branch-switching filter, so it applies as sub-steps of the UNSCALED rise/resign rates
  // rather than one step at a scaled rate (lib/engine/expectation.ts). catchUpFactor can return a
  // non-integer factor (a non-reference interval); round to the nearest whole sub-step, floored at 1
  // so every run advances the memory at least once.
  const subSteps = Math.max(1, Math.round(catchUp));

  const popUpdates: PopulationUpdate[] = [];
  const demandPops: Array<{ systemId: string; population: number; productionSuppress: number }> = [];
  // Calibration-only: per-system overshoot-death amount this cycle — the harness's
  // episode-cost instrument reads. Absent system ⇒ 0 (kept sparse: the gate fires on few
  // systems most cycles). Populated below, observational only — it changes nothing about `population`.
  const overshootDeathBySystem = new Map<string, number>();
  for (const s of states) {
    const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
    const supply = signals.supplyStateBySystem.get(s.systemId)
      ?? { regime: "supplied", survivalShortfall: false, criticalWeight: 0, emptyBasket: false };
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
    // P is this cycle's Provision, the complement of the absolute shortfall d. The read resolves
    // the CYCLE-START memory — stored, seeded from P on first use — into the floored effective
    // value the grievance term consumes; the store is not advanced until after the unrest read
    // below, so this cycle's response is judged against what the population expected walking in.
    const P = 1 - d;
    const { stored, effective } = readExpectation(s.provisionExpectation, P, params.expectation);
    const grievance = grievanceShortfall(effective, P);
    const supplyTerm = supplyUnrestTerm(grievance, d, supply, scaledUnrest);
    const unrest = accumulateUnrest(s.unrest, supplyTerm, floor, scaledUnrest);
    // The delta reads the unrest this cycle just produced, so unrest resolves forward within the
    // cycle while crowding lags it by one. Growth/decline keep the absolute d — the
    // political/biological split: unrest (political) judges against memory, population change
    // (biological) reads the goods themselves.
    const delta = populationDelta(s.population, s.popCap, d, unrest, params.population);
    const population = Math.max(0, s.population + delta * catchUp);
    // Isolates the death component of `delta` by re-running the same pure fold with the death rate
    // zeroed — growth and decline are unaffected by that rate, so the difference is exactly what the
    // gate removed, without re-implementing populationDelta's internal formula here (which would
    // silently drift from the engine if its shape ever changed). Observational only: `delta` itself,
    // and therefore `population` above, is untouched.
    const deltaWithoutDeath = populationDelta(
      s.population, s.popCap, d, unrest, { ...params.population, overshootDeathRate: 0 },
    );
    const overshootDeath = Math.max(0, deltaWithoutDeath - delta) * catchUp;
    if (overshootDeath > 0) overshootDeathBySystem.set(s.systemId, overshootDeath);
    // The memory advances only now that this cycle's unrest has already been judged against it.
    // An emptying world's Provision-1 reading is a denominator artifact, not an experience to
    // normalise toward, so the update is skipped and the stored value (post-seed, pre-floor)
    // carries unchanged into next cycle.
    const provisionExpectation = supply.emptyBasket
      ? stored
      : updateExpectation(stored, P, params.expectation, subSteps);
    popUpdates.push({ systemId: s.systemId, population, unrest, provisionExpectation });
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
  return overshootDeathBySystem.size > 0 ? { overshootDeathBySystem } : {};
}
