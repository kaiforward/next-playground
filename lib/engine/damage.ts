/**
 * Pure damage engine — hull/shield damage model for ship arrivals.
 * No DB dependency. All randomness injected via `rng` parameter.
 */

// ── Constants ────────────────────────────────────────────────────

export const DAMAGE_CONSTANTS = {
  /** Base damage chance at danger level 1.0 (100%). Scales linearly with danger. */
  DAMAGE_CHANCE_PER_DANGER: 0.6,
  /** Minimum damage fraction when damage occurs (10% of hullMax + shieldMax). */
  MIN_DAMAGE_FRACTION: 0.10,
  /** Maximum damage fraction when damage occurs (35% of hullMax + shieldMax). */
  MAX_DAMAGE_FRACTION: 0.35,
  /** Credits per hull point for repair. */
  REPAIR_COST_PER_HULL: 10,
  /** Credits per shield point for repair (shields regen free on dock, but manual repair costs less). */
  REPAIR_COST_PER_SHIELD: 3,
  /** Escort protection K-value for diminishing returns (sum of firepower). */
  ESCORT_K: 30,
  /** Maximum damage reduction from escorts (70%). */
  MAX_ESCORT_REDUCTION: 0.70,
} as const;

// ── Types ────────────────────────────────────────────────────────

export interface DamageResult {
  shieldDamage: number;
  hullDamage: number;
  /** True if hull reached 0 — ship is disabled. */
  disabled: boolean;
}

export interface RepairCostResult {
  hullCost: number;
  totalCost: number;
}

export interface EscortProtection {
  /** Fraction reduction in damage chance (0-1). */
  damageChanceReduction: number;
  /** Fraction reduction in damage severity (0-1). */
  damageSeverityReduction: number;
}

export interface EscortShipInfo {
  firepower: number;
  role: string;
}

// ── Functions ────────────────────────────────────────────────────

/**
 * Roll for hull/shield damage when a ship arrives at a system.
 *
 * - Damage chance scales with danger level
 * - Total damage is a random fraction of (hullMax + shieldMax)
 * - Shields absorb first, remainder hits hull
 * - Hull at 0 → ship disabled
 *
 * Returns { shieldDamage: 0, hullDamage: 0, disabled: false } if no damage.
 */
export function rollDamageOnArrival(
  dangerLevel: number,
  shieldMax: number,
  shieldCurrent: number,
  hullMax: number,
  hullCurrent: number,
  rng: () => number,
  escort?: EscortProtection,
): DamageResult {
  if (dangerLevel <= 0 || (hullMax <= 0 && shieldMax <= 0)) {
    return { shieldDamage: 0, hullDamage: 0, disabled: false };
  }

  // Damage chance
  let damageChance = dangerLevel * DAMAGE_CONSTANTS.DAMAGE_CHANCE_PER_DANGER;
  if (escort) {
    damageChance *= (1 - escort.damageChanceReduction);
  }
  damageChance = Math.min(damageChance, 1);

  if (rng() >= damageChance) {
    return { shieldDamage: 0, hullDamage: 0, disabled: false };
  }

  // Damage amount
  const totalPool = hullMax + shieldMax;
  const { MIN_DAMAGE_FRACTION, MAX_DAMAGE_FRACTION } = DAMAGE_CONSTANTS;
  let damageFraction = MIN_DAMAGE_FRACTION + rng() * (MAX_DAMAGE_FRACTION - MIN_DAMAGE_FRACTION);

  if (escort) {
    damageFraction *= (1 - escort.damageSeverityReduction);
  }

  let totalDamage = Math.ceil(totalPool * damageFraction);
  totalDamage = Math.max(1, totalDamage); // at least 1 damage

  // Shields absorb first
  const shieldDamage = Math.min(totalDamage, shieldCurrent);
  const remainingDamage = totalDamage - shieldDamage;

  // Hull takes the rest
  const hullDamage = Math.min(remainingDamage, hullCurrent);
  const newHull = hullCurrent - hullDamage;
  const disabled = newHull <= 0;

  return { shieldDamage, hullDamage, disabled };
}

/**
 * Calculate the credit cost to repair a ship to full hull.
 * Shields regenerate for free on dock.
 */
export function calculateRepairCost(
  hullMax: number,
  hullCurrent: number,
): RepairCostResult {
  const hullDamage = Math.max(0, hullMax - hullCurrent);
  const hullCost = hullDamage * DAMAGE_CONSTANTS.REPAIR_COST_PER_HULL;

  return {
    hullCost,
    totalCost: hullCost,
  };
}

/**
 * Compute escort protection from combat ships in a convoy.
 *
 * - Sum firepower of all combat-role ships
 * - Diminishing returns: reduction = sumFP / (sumFP + K)
 * - Capped at MAX_ESCORT_REDUCTION
 *
 * Non-combat ships contribute nothing.
 */
export function computeEscortProtection(
  escortShips: EscortShipInfo[],
): EscortProtection {
  const combatFP = escortShips
    .filter((s) => s.role === "combat")
    .reduce((sum, s) => sum + s.firepower, 0);

  if (combatFP <= 0) {
    return { damageChanceReduction: 0, damageSeverityReduction: 0 };
  }

  const rawReduction = combatFP / (combatFP + DAMAGE_CONSTANTS.ESCORT_K);
  const reduction = Math.min(rawReduction, DAMAGE_CONSTANTS.MAX_ESCORT_REDUCTION);

  return {
    damageChanceReduction: reduction,
    // Severity reduction is half the chance reduction (escorts prevent more than they mitigate)
    damageSeverityReduction: reduction * 0.5,
  };
}
