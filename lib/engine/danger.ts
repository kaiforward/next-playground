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

// ── Types ────────────────────────────────────────────────────────

export interface CargoLossEntry {
  goodId: string;
  lost: number;
  remaining: number;
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
