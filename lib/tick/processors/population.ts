import type { TickContext, TickProcessorResult } from "../types";
import {
  accumulateUnrest, crowdingPressure, grievanceShortfall, populationDelta, supplyUnrestTerm,
  type UnrestParams,
} from "@/lib/engine/population";
import { ABANDON_POP_FLOOR, CROWDING } from "@/lib/constants/population";
import { systemHabitabilityQuality } from "@/lib/engine/habitability";
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
  // Calibration-only: per-system growth-term amount this cycle — the trajectory instrument reads.
  // Same differential-fold idiom as overshootDeathBySystem above, mirrored for the opposite term:
  // re-run the same pure fold with growthRate zeroed instead of the death rate. Unlike death,
  // growth appears additively and alone in populationDelta's formula (decline/death subtract
  // identically in both runs), so the difference isolates it exactly with no defensive clamp.
  // Absent system ⇒ 0, kept sparse for the same reason.
  const growthBySystem = new Map<string, number>();
  // Abandonment Rule 2 (the death line): systems this cycle found with post-delta population
  // below ABANDON_POP_FLOOR, famine or not. Reported, never applied here — this processor
  // stays pure and leaves the control-flip/reset to the tick body (lib/world/tick.ts), the sole
  // owner of `control` writes.
  const abandonedSystems: string[] = [];
  // Calibration-only: the same finding tagged with its cause, read at the SAME cycle the trigger
  // fires — `supply.survivalShortfall` (already computed above from this cycle's supply state) is
  // Rule 1's own famine flag, so a system abandoning while it holds is a famine-collapse and one
  // abandoning without it declined to empty on non-famine stress alone (Rule 2 has no famine conjunct).
  // Never applied, never gates a `control` write — purely observational, unlike `abandonedSystems`.
  const abandonedSystemsByCause = new Map<string, "famine-collapse" | "decline-to-empty">();
  for (const s of states) {
    const d = signals.dissatisfactionBySystem.get(s.systemId) ?? 0;
    // Unreachable in real play: the economy processor writes dissatisfactionBySystem and
    // supplyStateBySystem for the same system id in lockstep (lib/tick/processors/economy.ts), so
    // a system present in one is always present in the other. When a test constructs a partial
    // signal (dissatisfaction without a matching supply state), this default deliberately reads
    // `emptyBasket: false` rather than mirroring `foldSupplyState([])`'s own `true` for a genuinely
    // empty basket — "not yet classified" and "classified as empty" are different claims, and the
    // newborn-calm guarantee (a never-seeded system's first cycle, see the "adaptive expectation"
    // describe block below) depends on the expectation update actually running rather than
    // freezing on an unclassified system.
    // rawSupply is kept alongside the defaulted `supply` below so the persisted band can tell the
    // two cases apart: `supply` picks a display-safe default to keep the unrest math running,
    // while a persisted `supplyBand` must stay absent rather than record that default's "supplied"
    // label as if the economy had actually classified this system this cycle.
    const rawSupply = signals.supplyStateBySystem.get(s.systemId);
    const supply = rawSupply
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
    // Fill-best-first habitability quality (lib/engine/habitability.ts) multiplies the growth
    // term only, and reads THIS CYCLE'S OPENING cached reading (`s.habitabilityQuality`) — never
    // a fresh per-cycle fold, so growth moves with the fold-site caching policy below (recompute
    // only on a frontier-index crossing), not every tick's raw occupancy. A system the processor
    // has never assessed before (no opening cache — its first fold since colonisation) falls back
    // to a fresh compute over this cycle's OPENING population, mirroring crowdingPressure's
    // cycle-start read just above, rather than a neutral default — a real colony always has at
    // least one positive-people-land body (the colonisability floor), so this reads a real score.
    // With no body summary at all (nothing cached, nothing to fold — real play never produces
    // this, the cache-write below skips the same case) growth runs at the raw rate.
    const opening = s.habitabilityQuality
      ?? (s.habitabilityBodies && s.habitabilityBodies.length > 0
        ? systemHabitabilityQuality(s.habitabilityBodies, s.population)
        : undefined);
    const growthQuality = opening ? opening.quality : 1;
    // The delta reads the unrest this cycle just produced, so unrest resolves forward within the
    // cycle while crowding lags it by one. Growth/decline keep the absolute d — the
    // political/biological split: unrest (political) judges against memory, population change
    // (biological) reads the goods themselves.
    const delta = populationDelta(s.population, s.popCap, d, unrest, params.population, growthQuality);
    const population = Math.max(0, s.population + delta * catchUp);
    // Abandonment Rule 2 (the death line): the post-delta population alone decides — famine is no
    // longer a conjunct. A colony that declines to empty under sustained non-famine stress (a
    // marginal-land world whose quality-scaled growth can't clear unrest, see populationDelta's
    // docstring) abandons exactly the same as a starved one; ABANDON_POP_FLOOR (1, well under
    // COLONY_SEED_POP 2) is the newborn guard now — an unlucky first cycle can't cross it alone.
    if (population < ABANDON_POP_FLOOR) {
      abandonedSystems.push(s.systemId);
      abandonedSystemsByCause.set(s.systemId, supply.survivalShortfall ? "famine-collapse" : "decline-to-empty");
    }
    // Isolates the death component of `delta` by re-running the same pure fold with the death rate
    // zeroed — growth and decline are unaffected by that rate, so the difference is exactly what the
    // gate removed, without re-implementing populationDelta's internal formula here (which would
    // silently drift from the engine if its shape ever changed). Observational only: `delta` itself,
    // and therefore `population` above, is untouched.
    const deltaWithoutDeath = populationDelta(
      s.population, s.popCap, d, unrest, { ...params.population, overshootDeathRate: 0 }, growthQuality,
    );
    const overshootDeath = Math.max(0, deltaWithoutDeath - delta) * catchUp;
    if (overshootDeath > 0) overshootDeathBySystem.set(s.systemId, overshootDeath);
    // Same isolation, for the growth term: re-run with growthRate zeroed. delta - deltaWithoutGrowth
    // cancels decline and death exactly (both subtract identically in each run), leaving the growth
    // product alone.
    const deltaWithoutGrowth = populationDelta(
      s.population, s.popCap, d, unrest, { ...params.population, growthRate: 0 }, growthQuality,
    );
    const growth = (delta - deltaWithoutGrowth) * catchUp;
    if (growth > 0) growthBySystem.set(s.systemId, growth);
    // Fill-best-first habitability quality (lib/engine/habitability.ts): computed fresh every
    // cycle from this cycle's post-delta population, but only APPLIED to the persisted cache when
    // the occupied prefix crosses a body boundary (frontierIndex changing) — population movement
    // within the same body keeps whatever the system opened this cycle with. That is exactly
    // correct (not merely a cheap approximation) for the dominant single-people-land-body case:
    // with one body in the prefix, quality is mathematically the top body's score at every
    // population level, so re-applying a fresh compute there would always be a no-op anyway. A
    // never-before-assessed system (habitabilityQuality absent) always takes the fresh reading.
    // With no body summary there is nothing to fold: the cache stays unwritten (same rule as
    // supplyBand/provision below — an unclassifiable reading is left absent, never fabricated).
    // EXCEPTION: once the frontier sits on the LAST body (index sorted.length - 1), it can never
    // again change — both the mid-body walk that reaches the final body and the all-bodies clamp
    // arm report that same index, so an index-only trigger freezes quality forever from that point
    // on even though population (and therefore the weighted mean over that final body) keeps
    // moving. The fresh reading is always applied while the frontier is on the last body, matching
    // the never-assessed case above rather than adding a second, drift-prone "index changed OR
    // quality changed" comparison.
    const bodies = s.habitabilityBodies ?? [];
    const freshQuality = bodies.length > 0
      ? systemHabitabilityQuality(bodies, population)
      : undefined;
    const onLastBody = freshQuality !== undefined && freshQuality.frontierIndex === bodies.length - 1;
    const habitabilityQuality = freshQuality !== undefined
        && (onLastBody
          || s.habitabilityQuality === undefined
          || s.habitabilityQuality.frontierIndex !== freshQuality.frontierIndex)
      ? freshQuality
      : s.habitabilityQuality;
    // The memory advances only now that this cycle's unrest has already been judged against it.
    // An emptying world's Provision-1 reading is a denominator artifact, not an experience to
    // normalise toward, so the update is skipped and the stored value (post-seed, pre-floor)
    // carries unchanged into next cycle — UNLESS there was no stored value to carry: a
    // never-seeded system reading an empty basket has nothing to hold onto, and `stored` here is
    // only `readExpectation`'s seed from this cycle's own (denominator-artifact) P, never a real
    // memory. Persisting that seed would fabricate a memory the population never had; the field
    // stays absent instead, exactly as it was before this cycle.
    const provisionExpectation = supply.emptyBasket
      ? (s.provisionExpectation === undefined ? undefined : stored)
      : updateExpectation(stored, P, params.expectation, subSteps);
    popUpdates.push({
      systemId: s.systemId,
      population,
      unrest,
      provisionExpectation,
      // This cycle's Provisioned — P computed above, the exact complement of the same d the
      // unrest read just consumed, never a re-derived mean. `supplyBand`/`criticalWeight` both
      // read rawSupply (not the defaulted `supply`), so an unclassified system persists absent
      // rather than "supplied"/0 — 0 is a real, meaningful critical-good weight, not a safe default.
      provision: P,
      supplyBand: rawSupply?.regime,
      criticalWeight: rawSupply?.criticalWeight,
      habitabilityQuality,
    });
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
  const result: TickProcessorResult = {};
  if (overshootDeathBySystem.size > 0) result.overshootDeathBySystem = overshootDeathBySystem;
  if (growthBySystem.size > 0) result.growthBySystem = growthBySystem;
  if (abandonedSystems.length > 0) result.abandonedSystems = abandonedSystems;
  if (abandonedSystemsByCause.size > 0) result.abandonedSystemsByCause = abandonedSystemsByCause;
  return result;
}
