import type { ProsperityParams } from "@/lib/engine/tick";

/** Economy simulation constants — used by seed (initial stock) and the economy tick (noise + bounds). */
export const ECONOMY_CONSTANTS = {
  /** Random noise amplitude (+/- units per tick). */
  NOISE_AMPLITUDE: 3,
  /** Stock floor. */
  MIN_LEVEL: 5,
  /** Stock ceiling. */
  MAX_LEVEL: 200,
} as const;

// ── Prosperity constants ────────────────────────────────────────

/** Prosperity range bounds. */
export const PROSPERITY_MIN = -1;
export const PROSPERITY_MAX = 1;

/**
 * How fast prosperity decays toward 0 per processor run (not per tick).
 * With 24 regions and round-robin, each system is processed every ~24 ticks.
 * At 0.03/run, prosperity goes from 1.0 to ~0 in ~33 runs (~800 ticks).
 */
export const PROSPERITY_DECAY_RATE = 0.03;

/**
 * Maximum prosperity gain per processor run when trade volume meets target.
 * Net gain at full trade = 0.1 - 0.03 decay = +0.07/run → ~14 runs to max.
 */
export const PROSPERITY_MAX_GAIN = 0.1;

/**
 * Trade volume (total quantity bought+sold) per processor run that yields
 * full prosperity gain. Scaled proportionally below this threshold.
 */
export const PROSPERITY_TARGET_VOLUME = 50;

/**
 * Prosperity multiplier table — maps prosperity value to a single multiplier
 * applied equally to both production AND consumption.
 *
 * Prosperity | Multiplier | Label
 * -----------+------------+----------
 * -1.0       | 0.3x       | Crisis (event-driven only)
 * -0.5       | 0.5x       | Disrupted (event-driven only)
 *  0.0       | 0.7x       | Stagnant
 *  0.5       | 1.0x       | Active
 *  1.0       | 1.3x       | Booming
 */
export const PROSPERITY_MULT_AT_MIN = 0.3;   // at prosperity = -1
export const PROSPERITY_MULT_AT_ZERO = 0.7;  // at prosperity = 0
export const PROSPERITY_MULT_AT_MAX = 1.3;   // at prosperity = +1

/** Assembled live-game prosperity params — shared by the economy processor and UI helpers. */
export const PROSPERITY_PARAMS: ProsperityParams = {
  decayRate: PROSPERITY_DECAY_RATE,
  maxGain: PROSPERITY_MAX_GAIN,
  targetVolume: PROSPERITY_TARGET_VOLUME,
  min: PROSPERITY_MIN,
  max: PROSPERITY_MAX,
  multAtMin: PROSPERITY_MULT_AT_MIN,
  multAtZero: PROSPERITY_MULT_AT_ZERO,
  multAtMax: PROSPERITY_MULT_AT_MAX,
};
