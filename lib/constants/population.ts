import type { UnrestParams, StrikeParams, PopulationParams } from "@/lib/engine/population";

/**
 * Unrest integration. Rates are per *population-processor run* — i.e. per economy
 * round-robin visit (~every `regionCount` ticks: 24 default, 60 at 10K), not per
 * game tick. Gain=decay means only sustained high-D systems accumulate unrest;
 * moderate supply deficits fade. Calibrated against the simulator.
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
 * Logistic growth/decline rates (per population-processor run). Growth asymptotes
 * toward popCap when satisfied and calm; decline scales with unrest. Calibrated
 * against the simulator.
 */
export const POPULATION_PARAMS: PopulationParams = { growthRate: 0.015, declineRate: 0.03 };
