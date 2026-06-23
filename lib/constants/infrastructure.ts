import type { DecayParams } from "@/lib/engine/infrastructure-decay";

/**
 * Autonomic infrastructure decay (per economy-shard run, every ECONOMY_UPDATE_INTERVAL
 * ticks). Calibrated against the simulator (see the SP3.5 calibration task). Decay is
 * deliberately slower than the population rates (growthRate/declineRate = 0.015) so
 * infrastructure is "stickier" than population — a brief labour dip never strands a base.
 *  - disuseRate: fraction of idle capacity (built − used) that rots each run.
 *  - unrestRate + unrestThreshold: the catastrophic channel — above θ_decay, working
 *    capacity is torn down (the snowball). θ_decay sits just above the strike threshold
 *    (0.65) so infrastructure teardown is a more extreme regime than striking.
 */
export const INFRASTRUCTURE_DECAY_PARAMS: DecayParams = {
  disuseRate: 0.005,
  unrestRate: 0.02,
  unrestThreshold: 0.75,
};
