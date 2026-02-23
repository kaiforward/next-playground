/**
 * Pure upgrade engine — computes aggregate bonuses from installed modules.
 * No DB dependency. Operates on module lists.
 */

import { MODULES, type ModuleId } from "@/lib/constants/modules";
import type { UpgradeSlotType } from "@/lib/constants/ships";

// ── Types ────────────────────────────────────────────────────────

export interface InstalledModule {
  moduleId: string;
  moduleTier: number;
  slotType: string;
}

/** Flat structure of all computed upgrade bonuses for a ship. */
export interface UpgradeBonuses {
  /** Fractional fuel cost reduction (0-1). */
  fuelCostReduction: number;
  /** Additive speed bonus. */
  speedBonus: number;
  /** Additive evasion bonus. */
  evasionBonus: number;
  /** Additive cargo capacity bonus. */
  cargoBonus: number;
  /** Fractional reduction in cargo loss severity (0-1). */
  lossSeverityReduction: number;
  /** Fraction of cargo hidden from inspections (0-1). */
  hiddenCargoFraction: number;
  /** Additive hull bonus. */
  hullBonus: number;
  /** Additive shield bonus. */
  shieldBonus: number;
  /** Flat probability reduction for cargo loss events (0-1). */
  cargoLossProbReduction: number;
  /** Additive sensors bonus. */
  sensorsBonus: number;
  /** Hull regen rate while docked (points per tick). */
  hullRegenRate: number;
  /** Whether automation module is installed. */
  hasAutomation: boolean;
}

// ── Computation ──────────────────────────────────────────────────

const EMPTY_BONUSES: UpgradeBonuses = {
  fuelCostReduction: 0,
  speedBonus: 0,
  evasionBonus: 0,
  cargoBonus: 0,
  lossSeverityReduction: 0,
  hiddenCargoFraction: 0,
  hullBonus: 0,
  shieldBonus: 0,
  cargoLossProbReduction: 0,
  sensorsBonus: 0,
  hullRegenRate: 0,
  hasAutomation: false,
};

/**
 * Compute aggregate upgrade bonuses from a list of installed modules.
 * Modules with invalid IDs or tiers are silently skipped.
 */
export function computeUpgradeBonuses(modules: InstalledModule[]): UpgradeBonuses {
  if (modules.length === 0) return { ...EMPTY_BONUSES };

  const result = { ...EMPTY_BONUSES };

  for (const installed of modules) {
    const def = MODULES[installed.moduleId as ModuleId];
    if (!def) continue;

    const tierDef = def.tiers.find((t) => t.tier === installed.moduleTier);
    if (!tierDef) continue;

    const bonus = tierDef.bonus;

    switch (def.stat) {
      case "fuelCostReduction":
        // Stack multiplicatively: 1 - (1-a)(1-b)
        result.fuelCostReduction = 1 - (1 - result.fuelCostReduction) * (1 - bonus);
        break;
      case "speedBonus":
        result.speedBonus += bonus;
        break;
      case "evasionBonus":
        result.evasionBonus += bonus;
        break;
      case "cargoBonus":
        result.cargoBonus += bonus;
        break;
      case "lossSeverityReduction":
        // Stack multiplicatively
        result.lossSeverityReduction = 1 - (1 - result.lossSeverityReduction) * (1 - bonus);
        break;
      case "hiddenCargoFraction":
        // Cap at 0.9 (can never hide everything)
        result.hiddenCargoFraction = Math.min(0.9, result.hiddenCargoFraction + bonus);
        break;
      case "hullBonus":
        result.hullBonus += bonus;
        break;
      case "shieldBonus":
        result.shieldBonus += bonus;
        break;
      case "cargoLossProbReduction":
        // Stack multiplicatively
        result.cargoLossProbReduction = 1 - (1 - result.cargoLossProbReduction) * (1 - bonus);
        break;
      case "sensorsBonus":
        result.sensorsBonus += bonus;
        break;
      case "hullRegenRate":
        result.hullRegenRate += bonus;
        break;
      case "automation":
        result.hasAutomation = true;
        break;
    }
  }

  return result;
}

// ── Validation ───────────────────────────────────────────────────

export interface UpgradeValidationParams {
  moduleId: string;
  moduleTier: number;
  slotType: string;
}

export type UpgradeValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate that a module can be installed in a given slot type.
 */
export function validateUpgradeInstallation(
  params: UpgradeValidationParams,
): UpgradeValidationResult {
  const { moduleId, moduleTier, slotType } = params;

  const def = MODULES[moduleId as ModuleId];
  if (!def) {
    return { ok: false, error: `Unknown module: "${moduleId}".` };
  }

  if (def.slotType !== slotType) {
    return {
      ok: false,
      error: `${def.name} requires a ${def.slotType} slot, not ${slotType}.`,
    };
  }

  const tierDef = def.tiers.find((t) => t.tier === moduleTier);
  if (!tierDef) {
    return {
      ok: false,
      error: `${def.name} does not have tier ${moduleTier}.`,
    };
  }

  return { ok: true };
}
