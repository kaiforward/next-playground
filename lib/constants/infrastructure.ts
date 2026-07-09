import type { DecayParams } from "@/lib/engine/infrastructure-decay";

/**
 * Autonomic infrastructure decay (per economy-shard run, every ECONOMY_UPDATE_INTERVAL ticks ≈ one
 * month). Capacity is a whole-level ratchet — decay only sheds levels, and slowly:
 *  - idleBufferMonths: a level must sit idle this many runs before the marginal idle level tears down.
 *    The buffer makes a brief labour/supply dip cost nothing (the countdown resets on refill) — the
 *    hysteresis that keeps infrastructure "stickier" than population.
 *  - unrestThreshold: the catastrophic channel — strictly above θ_decay, a whole level tears down
 *    immediately even while in use (the snowball). θ_decay sits above the strike threshold (0.65) so
 *    infrastructure teardown is a more extreme regime than striking.
 * Coarse first-cut; PR4 calibrates the buffer length against the simulator.
 */
export const INFRASTRUCTURE_DECAY_PARAMS: DecayParams = {
  idleBufferMonths: 6,
  unrestThreshold: 0.75,
};
