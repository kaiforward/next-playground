import type { DecayParams } from "@/lib/engine/infrastructure-decay";

/**
 * Autonomic infrastructure decay (per economy-shard run, every MONTH_LENGTH ticks ≈ one
 * month). Capacity is a whole-level ratchet — decay only sheds levels, and slowly:
 *  - idleBufferMonths: a level must sit idle this many runs before the marginal idle level tears down.
 *    The buffer makes a brief labour/supply dip cost nothing (the countdown resets on refill) — the
 *    hysteresis that keeps infrastructure "stickier" than population.
 *  - unrestThreshold: the catastrophic channel — strictly above θ_decay a whole level tears down even
 *    while in use (the snowball), at a pace set by how far unrest sits above θ across the range left
 *    above it. At the threshold teardown is ~zero and only total unrest costs a level a run, so the
 *    regime has a gradient rather than a cliff. It is scoped to the system, not to each building
 *    type: one level per eligible type per run, least-used first, and housing only above resident
 *    occupancy — so teardown never scales with how many industries a system happens to run, and a
 *    populated system is never stranded at popCap 0. θ_decay sits above the strike threshold (0.65)
 *    so infrastructure teardown is a more extreme regime than striking.
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
