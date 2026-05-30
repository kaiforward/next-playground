import type { EconomyType } from "@/lib/types/game";
import type { GoodEquilibrium } from "@/lib/constants/goods";
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

// ── Self-sufficiency factors ──────────────────────────────────

/**
 * Per-economy-type self-sufficiency for consumed goods.
 * 0.0 = fully dependent on imports (current consumer baseline).
 * 1.0 = meets own needs (target matches producer levels).
 *
 * Only consumed goods need entries — produced goods already use
 * the producer equilibrium, and neutral goods use the neutral target.
 *
 * These factors create price variety: an Agricultural system consuming
 * water (s=0.5, has irrigation) pays less than a Tech system (s=0.05,
 * imports everything).
 */
export const SELF_SUFFICIENCY: Record<EconomyType, Record<string, number>> = {
  agricultural: { water: 0.5, machinery: 0.0, chemicals: 0.1, medicine: 0.0 },
  extraction:   { food: 0.3, fuel: 0.1, machinery: 0.0, textiles: 0.15 },
  refinery:     { ore: 0.1, water: 0.2, food: 0.25 },
  industrial:   { metals: 0.1, electronics: 0.0, chemicals: 0.1, fuel: 0.1, water: 0.15, food: 0.2, ore: 0.15, textiles: 0.05 },
  tech:         { metals: 0.0, chemicals: 0.05, luxuries: 0.0, water: 0.1, food: 0.15 },
  core:         { food: 0.35, textiles: 0.25, electronics: 0.1, medicine: 0.1, weapons: 0.0, water: 0.3 },
};

/**
 * Compute a consumer's seed stock for a good at a specific economy type. Blends
 * from the base consumer level toward the producer level by the self-sufficiency
 * factor, so a self-sufficient consumer seeds higher (reads cheaper).
 *
 *   stock = baseConsume + s * (produce - baseConsume)
 */
export function getConsumeEquilibrium(
  economyType: EconomyType,
  goodId: string,
  goodEquilibrium: GoodEquilibrium,
): number {
  const s = SELF_SUFFICIENCY[economyType]?.[goodId] ?? 0;
  if (s === 0) return goodEquilibrium.consumes;

  const { produces, consumes } = goodEquilibrium;
  return Math.round(consumes + s * (produces - consumes));
}
