// ── Combat constants ─────────────────────────────────────────────

export const COMBAT_CONSTANTS = {
  /** Ticks between battle rounds. */
  ROUND_INTERVAL: 6,
  /** Morale below this → retreat. */
  MORALE_BREAK_THRESHOLD: 15,
  /** Starting morale base value. */
  MORALE_START_BASE: 85,
  /** ±variance on damage per round. */
  DAMAGE_VARIANCE: 0.20,
  /** Damage per firepower per round. */
  FIREPOWER_TO_DAMAGE: 1.5,
  /** Diminishing returns K for evasion-based damage reduction. */
  EVASION_K: 20,
  /** Cap on evasion damage reduction (40%). */
  MAX_EVASION_REDUCTION: 0.40,
  /** Morale bonus from lopsided round (>2:1 damage ratio). */
  LOPSIDED_MORALE_SWING: 8,
  /** Base morale loss from taking more damage than dealing. */
  BASE_MORALE_LOSS: 3,
  /** Morale gained for dealing more damage. */
  BASE_MORALE_GAIN: 2,
} as const;

// ── Enemy tiers ─────────────────────────────────────────────────

export type EnemyTier = "weak" | "moderate" | "strong";

export interface EnemyTierDef {
  name: string;
  baseStrength: number;
  baseMorale: number;
  baseDamagePerRound: number;
  baseDamageReduction: number;
  /** Danger level thresholds: tier selected when danger >= threshold. */
  dangerThreshold: number;
}

export const ENEMY_TIERS: Record<EnemyTier, EnemyTierDef> = {
  weak: {
    name: "Pirate Scouts",
    baseStrength: 40,
    baseMorale: 60,
    baseDamagePerRound: 5,
    baseDamageReduction: 0.05,
    dangerThreshold: 0,
  },
  moderate: {
    name: "Pirate Raiders",
    baseStrength: 70,
    baseMorale: 70,
    baseDamagePerRound: 10,
    baseDamageReduction: 0.12,
    dangerThreshold: 0.25,
  },
  strong: {
    name: "Pirate Warlord",
    baseStrength: 110,
    baseMorale: 80,
    baseDamagePerRound: 16,
    baseDamageReduction: 0.20,
    dangerThreshold: 0.40,
  },
} as const;

/**
 * Derive enemy tier from system danger level.
 * Higher danger → tougher enemies.
 */
export function getEnemyTier(dangerLevel: number): EnemyTier {
  if (dangerLevel >= ENEMY_TIERS.strong.dangerThreshold) return "strong";
  if (dangerLevel >= ENEMY_TIERS.moderate.dangerThreshold) return "moderate";
  return "weak";
}
