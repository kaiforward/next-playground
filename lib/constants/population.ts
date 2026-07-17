import type { UnrestParams, StrikeParams, PopulationParams } from "@/lib/engine/population";
import type { MigrationFlowParams } from "@/lib/engine/migration";
import type { ColonistDeliveryParams } from "@/lib/engine/colonist-delivery";

/**
 * Unrest integration. Rates are per *population-processor run* — i.e. per economy-shard
 * update (every `MONTH_LENGTH` ticks, 24), not per game tick. Gain=decay means
 * only sustained high-D systems accumulate unrest; moderate supply deficits fade.
 * Calibrated against the simulator.
 */
export const UNREST_PARAMS: UnrestParams = { gain: 0.06, decay: 0.06 };

/**
 * Strike production-suppression regime derived from unrest. Threshold triggers
 * the ramp; at full unrest (1.0), production falls to 25% (75% cut). Threshold
 * raised to 0.7 so only genuinely high-unrest systems strike. Calibrated against
 * the simulator.
 */
export const STRIKE_PARAMS: StrikeParams = { threshold: 0.65, floorMultiplier: 0.25 };

/**
 * Logistic growth/decline rates (per population-processor run, one per economy-shard
 * update). Growth asymptotes toward popCap when satisfied and calm; decline scales
 * with unrest. Symmetric rates: in the barren-but-alive galaxy most systems carry a
 * chronic low-grade higher-tier deficit (mining worlds can't source
 * consumer_goods/luxuries/medicine locally and the static economy can't build its way
 * out) — an asymmetric decline turned that unavoidable D≈0.4 into a steady galaxy-wide
 * drain. Equal rates let such systems hold steady while genuinely high-unrest ones still
 * decline. Calibrated against the simulator.
 */
export const POPULATION_PARAMS: PopulationParams = { growthRate: 0.015, declineRate: 0.015, overshootDeathRate: 0.05 };

/**
 * Migration over the de-regioned intra-faction topology — the sole consumer of the
 * open edges + fixed-interval edge shard. Gateways throttle like goods (high fuelCost →
 * strong distance attenuation); a gateway-preferred-migration term is a deliberate future
 * addition, not SP2. Sim-tuned for stable-but-growing (no ping-pong).
 */
export const MIGRATION_PARAMS: MigrationFlowParams = {
  // jobs weight makes open jobs pull and unemployment push; headroom stays 1 so this is a
  // pure addition, not a recalibration (the contentment/headroom/jobs mix is a PR4 rebalance).
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
  // lets colonisation proceed once home worlds saturate (spare labour ≈ 0). Coarse; PR4-calibrated.
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
