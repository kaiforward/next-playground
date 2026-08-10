import type { UnrestParams, StrikeParams, PopulationParams } from "@/lib/engine/population";
import type { ExpectationParams } from "@/lib/engine/expectation";
import type { MigrationFlowParams } from "@/lib/engine/migration";
import type { ColonistDeliveryParams } from "@/lib/engine/colonist-delivery";

/**
 * Unrest integration. Rates are per *population-processor run* — i.e. per economy-shard update
 * (every `CYCLE_LENGTH` ticks, 24), not per game tick. Unrest relaxes toward a standing-pressure
 * floor (tax + crowding) and integrates the supply term on top, settling at
 * `min(1, floor + term)`, independent of the relaxation rate (and therefore of the catch-up
 * factor). The term is whichever reads larger of the memory-relative grievance reading and the
 * absolute crisis reading (see `supplyUnrestTerm`) — famine and critical-good collapse stay
 * absolute; everything else is judged against what a population has grown accustomed to.
 *
 * `decay` is the single relaxation rate for every supply label — the label used to pick a faster
 * rate while Supplied; that branch is gone, so a Supplied world now sheds unrest at the same rate a
 * Rationing one does. 0.06 is decided on tick tempo, not recovery time: closing half the gap takes
 * ~270 ticks either way at fast-mode wall clock, which is "watchable" whichever candidate is picked,
 * so the choice is not worth heavily calibrating.
 *
 * Each slope is an EXCHANGE RATE, not a cap: how much settled unrest one unit of grievance (or, for
 * the crisis term, of absolute shortfall) buys.
 *
 * `slopeBase` settles unrest above the floor per unit of
 * *grievance* — one flat exchange rate, no escalation ramp. It sits in the window the guarantees
 * derive: ≥ 1.3 (a fully-accustomed world losing half of what it is used to must reach strike at
 * any tax) and < 2.08 (a quarter-dip must never collapse or tear down, even at the max standing
 * floor). It is no longer bounded by founding: the interim scaffolding this constant used to carry
 * — cut to [0.84, 1.07] so a newborn colony's opening state stayed below the strike threshold —
 * dissolves under the memory bar, because a newborn's grievance is ~0 by construction (its memory
 * seeds from its own opening state) whatever the slope is set to. 1.6 is the authored starting
 * point inside the derived window; the calibration sweep owns the final cut.
 *
 * `slopeShortage` is the durable rule: a total failure of EITHER survival good must be able to
 * collapse a world (unrest ≥ the 0.75 threshold) even at zero tax — not just the heavier of the two.
 * Food is the weaker basket weight (necessity × demand share, ~0.32, scale-invariant — a property of
 * the consumption tables, not of any one run) so it is the binding constraint: `slope × 0.32 ≥ 0.75`.
 * 2.4 is the smallest 0.1-step value that clears it with real margin (food ≈ 0.77, water ≈ 0.90);
 * 2.35 was rejected as a 0.0008 knife edge on food's own arithmetic, not a value anyone could stand
 * behind. It also caps the critical-good override (see `supplyUnrestTerm`) and is also the cap and
 * span of that override. Down from the shipped 2.5, which was authored against the squared fold;
 * keeping it on the linear scale would have stated a harsher claim than anyone authored, but not so
 * far down that it stops covering the weaker of the two survival goods, which the first linear cut
 * (2.1, sized to water's ~0.37 alone) did not. Both slopes reach settled unrest only at D or
 * grievance = 1, which does not occur, and the state itself is [0,1] and saturates there.
 *
 * Both slopes are load-bearing and no single number replaces them: collapse is contained to a
 * deep-enough grievance dip (promises 4 and 5), while a total failure of either survival good
 * crosses it at zero tax (promise 2) — famine genuinely needs a steeper response than ordinary
 * scarcity, not merely a larger shortfall. Both are asserted from the shared constants in
 * lib/constants/__tests__/band-constants.test.ts. First cuts; the simulator owns the finals.
 */
export const UNREST_PARAMS: UnrestParams = {
  slopeBase: 1.6,
  slopeShortage: 2.4,
  decay: 0.06,
};

/**
 * Overcrowding shape shared by the growth brake and the standing crowding-pressure ramp.
 * BRAKE_END is r = population/popCap at which growth reaches zero and crowding pressure
 * reaches its max; PRESSURE_MAX caps the standing unrest a fully overcrowded system adds,
 * kept far below the strike threshold so overcrowding alone can never strike-spiral.
 */
export const CROWDING = { BRAKE_END: 1.15, PRESSURE_MAX: 0.05 } as const;

/**
 * Strike production-suppression regime derived from unrest. Threshold triggers
 * the ramp; at full unrest (1.0), production falls to 25% (75% cut). Threshold
 * raised to 0.65 so only genuinely high-unrest systems strike — every guarantee in
 * lib/engine/population.ts and lib/constants/__tests__/band-constants.test.ts derives against this
 * value. Calibrated against the simulator.
 */
export const STRIKE_PARAMS: StrikeParams = { threshold: 0.65, floorMultiplier: 0.25 };

/**
 * The persisted per-system memory of the Provision a population is accustomed to (see
 * lib/engine/expectation.ts, `readExpectation`/`updateExpectation`).
 *
 * `floor` (0.5): "No population normalises living on half of what it needs." Applied at read as
 * `max(stored, floor)` — the stored value itself is never floored. Independent of
 * `SHORTAGE_SATISFACTION` despite the equal value: that constant is the famine line on ONE good's
 * satisfaction; this is a floor on remembered WHOLE-BASKET Provision. Do not couple them.
 *
 * `riseRate` (0.25/cycle): standards rise fast (half-life ~2-3 cycles). Sweep-decided; stated per
 * reference cycle, applied as `subSteps` iterations of the unscaled rate — NEVER rate-scaled,
 * because the asymmetric update is nonlinear (branch-switching) and a scaled rate silently clamps
 * away the rise:resign ratio once catch-up reaches 4.
 *
 * `resignRate` (0.02/cycle): resignation comes slowly (half-life ~34 cycles). Same denomination
 * and sub-step rule as `riseRate`. Setting both rates to 1 reproduces the old change term (memory
 * = last cycle) — that arm exists for calibration comparison, not for shipping.
 */
export const EXPECTATION_PARAMS: ExpectationParams = { floor: 0.5, riseRate: 0.25, resignRate: 0.02 };

/**
 * Growth/decline rates (per population-processor run, one per economy-shard update). Growth runs at
 * full rate until the housing cap, then the crowd brake ramps it to zero by `crowdBrakeEnd`; decline
 * scales with unrest. Symmetric growth/decline rates: growth carries a `(1 − D)` factor (D a linear
 * Provision shortfall, not its square) and decline carries unrest, so the two are already asymmetric
 * in what they read — an asymmetric *rate* on top of that would drain systems whose only fault is a
 * low-necessity shortfall.
 *
 * Un-squaring D raises its typical magnitude, which is exactly the change that could have forced
 * these rates to move — measured on the live galaxy rather than assumed from the Jensen worst case
 * (uniform gaps, growth factor falling from `1 − 0.033 = 0.967` toward `1 − 0.18 = 0.82`). The live
 * galaxy's per-good distribution is a cliff (goods delivered in full or not at all), where the squared and
 * linear folds nearly coincide: mean shortfall 0.034 against the old mean D 0.033, growth factor
 * 0.967 → 0.966. The feared re-scale is disconfirmed, so the values deliberately did not move; the
 * slope re-cut (`UNREST_PARAMS`, 1.8 → 0.95) actually eases decline pressure on top of that. The
 * overshoot-death sink fires only in the strike regime (`overshootDeathUnrestGate`), so a calm
 * over-capacity system displaces via migration, not death. Calibrated against the simulator.
 */
export const POPULATION_PARAMS: PopulationParams = {
  growthRate: 0.015,
  declineRate: 0.015,
  overshootDeathRate: 0.05,
  crowdBrakeEnd: CROWDING.BRAKE_END,
  overshootDeathUnrestGate: STRIKE_PARAMS.threshold,
};

/**
 * Migration over the de-regioned intra-faction topology — the sole consumer of the
 * open edges + fixed-interval edge shard. Gateways throttle like goods (high fuelCost →
 * strong distance attenuation); a gateway-preferred-migration term is a deliberate future
 * addition, not SP2. Sim-tuned for stable-but-growing (no ping-pong).
 */
export const MIGRATION_PARAMS: MigrationFlowParams = {
  // jobs weight makes open jobs pull and unemployment push; headroom stays 1 alongside it so the
  // contentment/headroom/jobs mix pulls jointly rather than any one term dominating the gradient.
  weights: { contentment: 1, headroom: 1, jobs: 1 },
  // Local balancing only — colony population is supplied by the targeted colonist-delivery pass, not by
  // diffusion. Kept BELOW the natural growth rate (0.015) so edge diffusion can't drain a system faster
  // than it regrows; a stronger rate bled the cores dry feeding the nearest colonies.
  maxOutflowFraction: 0.01,
  gradientThreshold: 0.02,
  distanceDecay: 0.1, // per-hop gradient attenuation over the open-edge topology
  // Above any achievable |gradient| (with these weights the appeal gap tops out ~5), so the full
  // staffed pool stays home; the future player speed-dial lowers this per chosen system, at a cost.
  employedGradientThreshold: 100,
  // Small always-on leak of staffed workers toward strongly-attractive colonies — the pop pump that
  // lets colonisation proceed once home worlds saturate (spare labour ≈ 0). Coarse first cut,
  // calibrated against the simulator.
  employedLeakFraction: 0.02,
};

/**
 * Targeted colonist delivery — the primary colony population supply (diffusion above is only local
 * balancing). Each cycle every developed system contributes a capped slice of its drawable spare to a
 * faction pool that is water-filled across the faction's developed systems, raising the emptiest
 * colonies first. `sourceOutflowCap` sits well above the diffusion rate (colony delivery IS the flow),
 * `minSourcePopulation` keeps freshly-seeded stubs from being drained as donors. Coarse first cut —
 * tuned against the simulator toward an even spread (colony mean within ~50% of max).
 */
export const COLONY_DELIVERY_PARAMS: ColonistDeliveryParams = {
  // Well above the diffusion rate — colony delivery is the primary flow. A source donates only its idle
  // spare (pop above jobs), so it keeps its workers and cores stabilise at their own size while shedding
  // surplus to the frontier; growth re-donates, keeping reinforcement sustained.
  sourceOutflowCap: 0.05,
  minSourcePopulation: 50,
};
