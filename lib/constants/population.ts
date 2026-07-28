import type { UnrestParams, StrikeParams, PopulationParams } from "@/lib/engine/population";
import type { MigrationFlowParams } from "@/lib/engine/migration";
import type { ColonistDeliveryParams } from "@/lib/engine/colonist-delivery";

/**
 * Unrest integration. Rates are per *population-processor run* — i.e. per economy-shard update
 * (every `MONTH_LENGTH` ticks, 24), not per game tick. Unrest relaxes toward a standing-pressure
 * floor (tax + crowding) and integrates dissatisfaction on top, settling at exactly
 * `floor + ceiling × D`: each ceiling IS the maximum equilibrium unrest its regime can carry, so the
 * numbers state bounds instead of implying them through a blind gain/decay ratio, and the
 * equilibrium is independent of the relaxation rate (and therefore of the catch-up factor). Supplied
 * recovers twice as fast as either regime accumulates, so a relieved system sheds unrest quickly
 * while a chronically short one climbs.
 *
 * Both ceilings are load-bearing and no single number replaces them: sustained Rationing must stay
 * below the collapse threshold at the highest tax, while a total food failure must cross it at zero
 * tax. Those two bounds do not overlap — famine genuinely needs a steeper response than ordinary
 * scarcity, not merely a larger D. Both are asserted from the shared constants in
 * lib/constants/__tests__/band-constants.test.ts. First cuts; the simulator owns the finals.
 */
export const UNREST_PARAMS: UnrestParams = {
  ceilingRationing: 1.8,
  ceilingShortage: 2.5,
  decay: 0.06,
  recoveryDecay: 0.12,
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
 * raised to 0.7 so only genuinely high-unrest systems strike. Calibrated against
 * the simulator.
 */
export const STRIKE_PARAMS: StrikeParams = { threshold: 0.65, floorMultiplier: 0.25 };

/**
 * Growth/decline rates (per population-processor run, one per economy-shard update). Growth runs at
 * full rate until the housing cap, then the crowd brake ramps it to zero by `crowdBrakeEnd`; decline
 * scales with unrest. Symmetric growth/decline rates: growth carries a (1 − D) factor and decline
 * carries unrest, so the two are already asymmetric in what they read — an asymmetric *rate* on top
 * of that would drain systems whose only fault is a low-necessity shortfall. With the fold weighted
 * by necessity the ambient barren-galaxy deficit folds to ≈0.14 rather than ≈0.4, so a chronically
 * import-short mining world grows while a genuinely deprived one declines. The overshoot-death sink
 * fires only in the strike regime (`overshootDeathUnrestGate`), so a calm over-capacity system
 * displaces via migration, not death. Calibrated against the simulator.
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
 * balancing). Each pulse every developed system contributes a capped slice of its drawable spare to a
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
