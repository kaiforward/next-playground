/**
 * Pure danger engine — deterministic functions for navigation danger and cargo loss.
 * No DB or constant imports. All randomness injected via `rng` parameter.
 *
 * Ship stats and upgrade bonuses are optional — omitting them preserves
 * the original behavior for backward compatibility.
 */

import type { ModifierRow } from "./events";

// ── Constants ────────────────────────────────────────────────────

export const DANGER_CONSTANTS = {
  /** Cap on aggregated danger level (50% max). */
  MAX_DANGER: 0.5,
  /** Minimum cargo loss when loss occurs (20%). */
  MIN_LOSS_FRACTION: 0.2,
  /** Maximum cargo loss when loss occurs (40%). */
  MAX_LOSS_FRACTION: 0.4,
} as const;

export const HAZARD_CONSTANTS = {
  /** Base incident chance for low-hazard goods (3%). */
  LOW_BASE_CHANCE: 0.03,
  /** Base incident chance for high-hazard goods (6%). */
  HIGH_BASE_CHANCE: 0.06,
  /** Danger level scaling: effectiveChance = base + danger × scaling. */
  DANGER_SCALING: 0.5,
  /** Minimum loss fraction for low-hazard incident (10%). */
  LOW_MIN_LOSS: 0.10,
  /** Maximum loss fraction for low-hazard incident (25%). */
  LOW_MAX_LOSS: 0.25,
  /** Minimum loss fraction for high-hazard incident (50%). */
  HIGH_MIN_LOSS: 0.50,
  /** Maximum loss fraction for high-hazard incident (100%). */
  HIGH_MAX_LOSS: 1.0,
} as const;

export const LEGALITY_CONSTANTS = {
  /** Base inspection chance before government modifier (25%). */
  BASE_INSPECTION_CHANCE: 0.25,
} as const;

/** Diminishing-returns K-values for stat reductions per stage. */
export const STAT_K_VALUES = {
  /** Hull stat K for hazard severity reduction. */
  HULL_HAZARD: 100,
  /** Stealth stat K for contraband inspection avoidance. */
  STEALTH_CONTRABAND: 10,
  /** Evasion stat K for cargo loss probability reduction. */
  EVASION_CARGO_LOSS: 10,
} as const;

// ── Types ────────────────────────────────────────────────────────

export interface CargoLossEntry {
  goodId: string;
  lost: number;
  remaining: number;
}

export interface HazardIncidentEntry {
  goodId: string;
  hazard: "low" | "high";
  lost: number;
  remaining: number;
}

export interface ImportDutyEntry {
  goodId: string;
  seized: number;
  remaining: number;
}

export interface ContrabandSeizedEntry {
  goodId: string;
  seized: number;
}

/** Optional ship stat + upgrade bonus parameters for danger pipeline stages. */
export interface ShipDangerModifiers {
  // Stage 1 (hazard): hull reduces severity
  hullStat?: number;
  armourBonus?: number;
  reinforcedContainersBonus?: number;
  // Stage 3 (contraband): stealth reduces inspection
  stealthStat?: number;
  hiddenCargoFraction?: number;
  // Stage 4 (cargo loss): evasion reduces probability
  evasionStat?: number;
  manoeuvringBonus?: number;
  pointDefenceReduction?: number;
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Diminishing returns: reduction = stat / (stat + K).
 * Returns 0 for stat <= 0.
 */
export function diminishingReturn(stat: number, k: number): number {
  if (stat <= 0) return 0;
  return stat / (stat + k);
}

// ── Functions ────────────────────────────────────────────────────

/**
 * Sum all danger_level modifier values, capped at maxDanger.
 *
 * Filters to `parameter === "danger_level"`, sums values, caps result.
 */
export function aggregateDangerLevel(
  modifiers: ModifierRow[],
  maxDanger: number = DANGER_CONSTANTS.MAX_DANGER,
): number {
  let total = 0;
  for (const mod of modifiers) {
    if (mod.parameter === "danger_level") {
      total += mod.value;
    }
  }
  return Math.min(total, maxDanger);
}

/**
 * Given danger level and cargo, roll for cargo loss.
 *
 * Ship stat modifiers:
 * - evasionStat: diminishing reduction to loss probability
 * - manoeuvringBonus: additive evasion for the reduction calc
 * - pointDefenceReduction: flat reduction to loss probability
 *
 * Without modifiers: identical to original behavior.
 */
export function rollCargoLoss(
  danger: number,
  cargo: { goodId: string; quantity: number }[],
  rng: () => number,
  mods?: ShipDangerModifiers,
): CargoLossEntry[] {
  if (danger <= 0 || cargo.length === 0) return [];

  // Apply evasion stat reduction to danger (probability of loss)
  let effectiveDanger = danger;
  if (mods) {
    const totalEvasion = (mods.evasionStat ?? 0) + (mods.manoeuvringBonus ?? 0);
    const evasionReduction = diminishingReturn(totalEvasion, STAT_K_VALUES.EVASION_CARGO_LOSS);
    effectiveDanger *= (1 - evasionReduction);

    // Point defence: flat probability reduction
    if (mods.pointDefenceReduction && mods.pointDefenceReduction > 0) {
      effectiveDanger *= (1 - mods.pointDefenceReduction);
    }
  }

  if (effectiveDanger <= 0) return [];

  // Roll for whether loss occurs
  if (rng() >= effectiveDanger) return [];

  // Loss occurs — determine fraction
  const { MIN_LOSS_FRACTION, MAX_LOSS_FRACTION } = DANGER_CONSTANTS;
  const lossFraction = MIN_LOSS_FRACTION + rng() * (MAX_LOSS_FRACTION - MIN_LOSS_FRACTION);

  const entries: CargoLossEntry[] = [];
  for (const item of cargo) {
    const lost = Math.min(Math.ceil(item.quantity * lossFraction), item.quantity);
    if (lost > 0) {
      entries.push({
        goodId: item.goodId,
        lost,
        remaining: item.quantity - lost,
      });
    }
  }

  return entries;
}

/**
 * Roll for hazard incidents on cargo at arrival.
 *
 * Ship stat modifiers:
 * - hullStat + armourBonus: diminishing reduction to loss severity
 * - reinforcedContainersBonus: fractional reduction to loss severity
 *
 * Without modifiers: identical to original behavior.
 */
export function rollHazardIncidents(
  cargo: { goodId: string; quantity: number; hazard: "none" | "low" | "high" }[],
  dangerLevel: number,
  rng: () => number,
  mods?: ShipDangerModifiers,
): HazardIncidentEntry[] {
  const entries: HazardIncidentEntry[] = [];

  for (const item of cargo) {
    if (item.hazard === "none" || item.quantity <= 0) continue;

    const baseChance = item.hazard === "high"
      ? HAZARD_CONSTANTS.HIGH_BASE_CHANCE
      : HAZARD_CONSTANTS.LOW_BASE_CHANCE;
    const effectiveChance = baseChance + dangerLevel * HAZARD_CONSTANTS.DANGER_SCALING;

    if (rng() >= effectiveChance) continue;

    // Incident — determine loss fraction
    let minLoss = item.hazard === "high"
      ? HAZARD_CONSTANTS.HIGH_MIN_LOSS
      : HAZARD_CONSTANTS.LOW_MIN_LOSS;
    let maxLoss = item.hazard === "high"
      ? HAZARD_CONSTANTS.HIGH_MAX_LOSS
      : HAZARD_CONSTANTS.LOW_MAX_LOSS;

    // Apply hull stat severity reduction (diminishing returns)
    if (mods) {
      const totalHull = (mods.hullStat ?? 0) + (mods.armourBonus ?? 0);
      const hullReduction = diminishingReturn(totalHull, STAT_K_VALUES.HULL_HAZARD);
      minLoss *= (1 - hullReduction);
      maxLoss *= (1 - hullReduction);

      // Reinforced containers: additional severity reduction
      if (mods.reinforcedContainersBonus && mods.reinforcedContainersBonus > 0) {
        minLoss *= (1 - mods.reinforcedContainersBonus);
        maxLoss *= (1 - mods.reinforcedContainersBonus);
      }
    }

    const lossFraction = minLoss + rng() * (maxLoss - minLoss);
    const lost = Math.min(Math.ceil(item.quantity * lossFraction), item.quantity);

    if (lost > 0) {
      entries.push({
        goodId: item.goodId,
        hazard: item.hazard,
        lost,
        remaining: item.quantity - lost,
      });
    }
  }

  return entries;
}

/**
 * Apply import duty to taxed goods. Deterministic — no RNG.
 *
 * seized = Math.ceil(quantity × taxRate), capped at quantity.
 */
export function applyImportDuty(
  cargo: { goodId: string; quantity: number }[],
  taxedGoods: string[],
  taxRate: number,
): ImportDutyEntry[] {
  if (taxRate <= 0 || taxedGoods.length === 0) return [];

  const taxedSet = new Set(taxedGoods);
  const entries: ImportDutyEntry[] = [];

  for (const item of cargo) {
    if (!taxedSet.has(item.goodId) || item.quantity <= 0) continue;

    const seized = Math.min(Math.ceil(item.quantity * taxRate), item.quantity);
    if (seized > 0) {
      entries.push({
        goodId: item.goodId,
        seized,
        remaining: item.quantity - seized,
      });
    }
  }

  return entries;
}

/**
 * Roll for contraband inspection at arrival. Full confiscation on detection.
 *
 * Ship stat modifiers:
 * - stealthStat: diminishing reduction to inspection chance
 * - hiddenCargoFraction: fraction of cargo hidden from inspection
 *
 * Without modifiers: identical to original behavior.
 */
export function rollContrabandInspection(
  cargo: { goodId: string; quantity: number }[],
  contrabandGoods: string[],
  inspectionModifier: number,
  rng: () => number,
  mods?: ShipDangerModifiers,
): ContrabandSeizedEntry[] {
  if (inspectionModifier <= 0 || contrabandGoods.length === 0) return [];

  const contrabandSet = new Set(contrabandGoods);

  // Apply stealth reduction to inspection chance
  let effectiveInspectionChance = LEGALITY_CONSTANTS.BASE_INSPECTION_CHANCE * inspectionModifier;
  if (mods) {
    const stealthReduction = diminishingReturn(
      mods.stealthStat ?? 0,
      STAT_K_VALUES.STEALTH_CONTRABAND,
    );
    effectiveInspectionChance *= (1 - stealthReduction);
  }

  const entries: ContrabandSeizedEntry[] = [];

  for (const item of cargo) {
    if (!contrabandSet.has(item.goodId) || item.quantity <= 0) continue;

    if (rng() < effectiveInspectionChance) {
      // Determine how much is visible (not hidden)
      const hiddenFrac = mods?.hiddenCargoFraction ?? 0;
      const visibleQty = Math.ceil(item.quantity * (1 - hiddenFrac));

      if (visibleQty > 0) {
        entries.push({
          goodId: item.goodId,
          seized: visibleQty,
        });
      }
    }
  }

  return entries;
}
