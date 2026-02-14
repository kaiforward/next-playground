/**
 * Pure danger engine — deterministic functions for navigation danger and cargo loss.
 * No DB or constant imports. All randomness injected via `rng` parameter.
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
 * - If danger <= 0 or no cargo, returns [].
 * - Rolls rng() — if >= danger, no loss (returns []).
 * - On loss: each cargo item loses 20-40% (Math.ceil), clamped to quantity.
 */
export function rollCargoLoss(
  danger: number,
  cargo: { goodId: string; quantity: number }[],
  rng: () => number,
): CargoLossEntry[] {
  if (danger <= 0 || cargo.length === 0) return [];

  // Roll for whether loss occurs
  if (rng() >= danger) return [];

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
 * Each hazardous cargo stack rolls independently. Non-hazardous goods (hazard: "none")
 * are never affected. Danger level compounds with the base chance.
 */
export function rollHazardIncidents(
  cargo: { goodId: string; quantity: number; hazard: "none" | "low" | "high" }[],
  dangerLevel: number,
  rng: () => number,
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
    const minLoss = item.hazard === "high"
      ? HAZARD_CONSTANTS.HIGH_MIN_LOSS
      : HAZARD_CONSTANTS.LOW_MIN_LOSS;
    const maxLoss = item.hazard === "high"
      ? HAZARD_CONSTANTS.HIGH_MAX_LOSS
      : HAZARD_CONSTANTS.LOW_MAX_LOSS;
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
 * inspectionChance = BASE_INSPECTION_CHANCE × inspectionModifier.
 * If modifier is 0, returns [] immediately (no inspections).
 */
export function rollContrabandInspection(
  cargo: { goodId: string; quantity: number }[],
  contrabandGoods: string[],
  inspectionModifier: number,
  rng: () => number,
): ContrabandSeizedEntry[] {
  if (inspectionModifier <= 0 || contrabandGoods.length === 0) return [];

  const contrabandSet = new Set(contrabandGoods);
  const inspectionChance = LEGALITY_CONSTANTS.BASE_INSPECTION_CHANCE * inspectionModifier;
  const entries: ContrabandSeizedEntry[] = [];

  for (const item of cargo) {
    if (!contrabandSet.has(item.goodId) || item.quantity <= 0) continue;

    if (rng() < inspectionChance) {
      entries.push({
        goodId: item.goodId,
        seized: item.quantity,
      });
    }
  }

  return entries;
}
