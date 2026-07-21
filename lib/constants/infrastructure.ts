import type { DecayParams } from "@/lib/engine/infrastructure-decay";

/**
 * Autonomic infrastructure decay (per economy-shard run, every MONTH_LENGTH ticks ≈ one
 * month). Capacity is a whole-level ratchet — decay only sheds levels, and slowly:
 *  - idleBufferMonths: a level must sit idle this many runs before the marginal idle level tears down.
 *    The buffer makes a brief labour/supply dip cost nothing (the countdown resets on refill) — the
 *    hysteresis that keeps infrastructure "stickier" than population.
 *  - unrestThreshold: the catastrophic channel — strictly above θ_decay, a whole level tears down
 *    immediately even while in use (the snowball). θ_decay sits above the strike threshold (0.65) so
 *    infrastructure teardown is a more extreme regime than striking.
 * The buffer is deliberately long enough to absorb temporary labour and market shocks.
 */
export const INFRASTRUCTURE_DECAY_PARAMS: DecayParams = {
  idleBufferMonths: 12,
  unrestThreshold: 0.75,
};

/** Slack on the isolated selling factor before a whole producer level can read idle. */
export const USED_SLACK = 0.15;

/** Healthy housing vacancy allowance used only by utilization and decay. */
export const VACANCY_SLACK = 0.10;
