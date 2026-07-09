import type { UnrestParams, StrikeParams, PopulationParams } from "@/lib/engine/population";
import type { MigrationFlowParams } from "@/lib/engine/migration";

/**
 * Unrest integration. Rates are per *population-processor run* — i.e. per economy-shard
 * update (every `ECONOMY_UPDATE_INTERVAL` ticks, 24), not per game tick. Gain=decay means
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
  weights: { contentment: 1, headroom: 1 },
  maxOutflowFraction: 0.05,
  gradientThreshold: 0.02,
  distanceDecay: 0.1, // per-hop gradient attenuation over the open-edge topology
};
