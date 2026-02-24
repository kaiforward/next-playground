/**
 * Pure combat engine — tick-based battle resolution.
 * No DB dependency. All randomness injected via `rng` parameter.
 */

import {
  COMBAT_CONSTANTS,
  ENEMY_TIERS,
  type EnemyTier,
} from "@/lib/constants/combat";
import type { DamageResult } from "./damage";

// ── Types ────────────────────────────────────────────────────────

export interface CombatStats {
  strength: number;
  morale: number;
  damagePerRound: number;
  damageReduction: number;
}

export interface ShipCombatInput {
  hullMax: number;
  hullCurrent: number;
  shieldMax: number;
  shieldCurrent: number;
  firepower: number;
  evasion: number;
}

export interface RoundResult {
  round: number;
  playerDamageDealt: number;
  enemyDamageDealt: number;
  playerStrengthAfter: number;
  enemyStrengthAfter: number;
  playerMoraleAfter: number;
  enemyMoraleAfter: number;
}

export type BattleOutcome =
  | "ongoing"
  | "player_victory"
  | "player_defeat"
  | "player_retreat"
  | "enemy_retreat";

// ── Player combat stats ──────────────────────────────────────────

/**
 * Derive combat stats for a player's ship.
 *
 * - Strength = hullCurrent + shieldCurrent
 * - Damage per round = firepower × FIREPOWER_TO_DAMAGE
 * - Damage reduction = evasion / (evasion + K), capped
 * - Morale = base + health bonus (healthy ships fight better)
 */
export function derivePlayerCombatStats(ship: ShipCombatInput): CombatStats {
  const {
    MORALE_START_BASE,
    FIREPOWER_TO_DAMAGE,
    EVASION_K,
    MAX_EVASION_REDUCTION,
  } = COMBAT_CONSTANTS;

  const strength = ship.hullCurrent + ship.shieldCurrent;
  const damagePerRound = ship.firepower * FIREPOWER_TO_DAMAGE;
  const rawReduction = ship.evasion / (ship.evasion + EVASION_K);
  const damageReduction = Math.min(rawReduction, MAX_EVASION_REDUCTION);

  // Health bonus: 0-15 morale based on hull percentage
  const healthRatio = ship.hullMax > 0 ? ship.hullCurrent / ship.hullMax : 0;
  const morale = MORALE_START_BASE + healthRatio * 15;

  return { strength, morale, damagePerRound, damageReduction };
}

// ── Enemy combat stats ───────────────────────────────────────────

/**
 * Derive combat stats for an enemy (pirate band).
 * Tiered from ENEMY_TIERS, scaled by system danger level.
 */
export function deriveEnemyCombatStats(
  tier: EnemyTier,
  dangerLevel: number,
): CombatStats {
  const def = ENEMY_TIERS[tier];

  // Scale by danger: 0.15 danger → 0.3× scaling, 0.5 → 1.0× scaling
  // Normalized to [0..1] range based on max danger of 0.5
  const dangerScale = 0.6 + dangerLevel * 0.8;

  return {
    strength: Math.round(def.baseStrength * dangerScale),
    morale: def.baseMorale,
    damagePerRound: Math.round(def.baseDamagePerRound * dangerScale * 10) / 10,
    damageReduction: def.baseDamageReduction,
  };
}

// ── Round resolution ────────────────────────────────────────────

/**
 * Resolve a single combat round. Both sides deal damage simultaneously.
 *
 * - Damage variance: ±DAMAGE_VARIANCE per round
 * - Strength reduced by damage taken (after reduction)
 * - Morale shifts based on casualty ratio
 */
export function resolveRound(
  player: CombatStats,
  enemy: CombatStats,
  roundNumber: number,
  rng: () => number,
): RoundResult {
  const { DAMAGE_VARIANCE, LOPSIDED_MORALE_SWING, BASE_MORALE_LOSS, BASE_MORALE_GAIN } =
    COMBAT_CONSTANTS;

  // Roll damage with variance
  const playerRawDmg =
    player.damagePerRound * (1 + (rng() * 2 - 1) * DAMAGE_VARIANCE);
  const enemyRawDmg =
    enemy.damagePerRound * (1 + (rng() * 2 - 1) * DAMAGE_VARIANCE);

  // Apply damage reduction
  const playerDamageDealt = Math.max(1, Math.round(playerRawDmg * (1 - enemy.damageReduction)));
  const enemyDamageDealt = Math.max(1, Math.round(enemyRawDmg * (1 - player.damageReduction)));

  // Apply damage to strength
  const playerStrengthAfter = Math.max(0, player.strength - enemyDamageDealt);
  const enemyStrengthAfter = Math.max(0, enemy.strength - playerDamageDealt);

  // Morale shifts
  let playerMoraleAfter = player.morale;
  let enemyMoraleAfter = enemy.morale;

  if (playerDamageDealt > 0 || enemyDamageDealt > 0) {
    const damageRatio =
      enemyDamageDealt > 0 ? playerDamageDealt / enemyDamageDealt : 10;
    const inverseDamageRatio =
      playerDamageDealt > 0 ? enemyDamageDealt / playerDamageDealt : 10;

    // Side that dealt less damage loses morale
    if (damageRatio > 2) {
      // Lopsided in player's favor
      playerMoraleAfter += BASE_MORALE_GAIN + LOPSIDED_MORALE_SWING * 0.5;
      enemyMoraleAfter -= BASE_MORALE_LOSS + LOPSIDED_MORALE_SWING;
    } else if (inverseDamageRatio > 2) {
      // Lopsided in enemy's favor
      enemyMoraleAfter += BASE_MORALE_GAIN + LOPSIDED_MORALE_SWING * 0.5;
      playerMoraleAfter -= BASE_MORALE_LOSS + LOPSIDED_MORALE_SWING;
    } else {
      // Roughly even — small morale adjustments
      if (playerDamageDealt >= enemyDamageDealt) {
        playerMoraleAfter += BASE_MORALE_GAIN;
        enemyMoraleAfter -= BASE_MORALE_LOSS;
      } else {
        enemyMoraleAfter += BASE_MORALE_GAIN;
        playerMoraleAfter -= BASE_MORALE_LOSS;
      }
    }
  }

  // Clamp morale to [0, 100]
  playerMoraleAfter = Math.max(0, Math.min(100, playerMoraleAfter));
  enemyMoraleAfter = Math.max(0, Math.min(100, enemyMoraleAfter));

  return {
    round: roundNumber,
    playerDamageDealt,
    enemyDamageDealt,
    playerStrengthAfter,
    enemyStrengthAfter,
    playerMoraleAfter,
    enemyMoraleAfter,
  };
}

// ── Battle end check ────────────────────────────────────────────

/**
 * Check if the battle has ended and determine the outcome.
 */
export function checkBattleEnd(
  player: CombatStats,
  enemy: CombatStats,
): BattleOutcome {
  const { MORALE_BREAK_THRESHOLD } = COMBAT_CONSTANTS;

  // Destruction checks first (strength ≤ 0)
  if (player.strength <= 0 && enemy.strength <= 0) return "player_defeat";
  if (player.strength <= 0) return "player_defeat";
  if (enemy.strength <= 0) return "player_victory";

  // Morale break checks
  if (player.morale <= MORALE_BREAK_THRESHOLD && enemy.morale <= MORALE_BREAK_THRESHOLD) {
    // Both sides break — side with higher morale stays
    return player.morale >= enemy.morale ? "enemy_retreat" : "player_retreat";
  }
  if (player.morale <= MORALE_BREAK_THRESHOLD) return "player_retreat";
  if (enemy.morale <= MORALE_BREAK_THRESHOLD) return "enemy_retreat";

  return "ongoing";
}

// ── Damage translation ──────────────────────────────────────────

/**
 * Translate remaining battle strength back to hull/shield damage on the ship.
 *
 * The strength loss during battle represents combined hull+shield damage.
 * Shields absorb first, remainder hits hull.
 */
export function calculateBattleDamage(
  initialStrength: number,
  finalStrength: number,
  ship: ShipCombatInput,
): DamageResult {
  const strengthLost = Math.max(0, initialStrength - finalStrength);

  if (strengthLost <= 0) {
    return { shieldDamage: 0, hullDamage: 0, disabled: false };
  }

  // Shields absorb first
  const shieldDamage = Math.min(strengthLost, ship.shieldCurrent);
  const remainingDamage = strengthLost - shieldDamage;

  // Hull takes the rest
  const hullDamage = Math.min(remainingDamage, ship.hullCurrent);
  const newHull = ship.hullCurrent - hullDamage;
  const disabled = newHull <= 0;

  return { shieldDamage, hullDamage, disabled };
}
