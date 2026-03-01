/**
 * Upgrade module definitions — 12 standard modules across 4 slot types.
 * Each slot type has 3 modules. Tiered modules have Mk I/II/III variants.
 */

import type { UpgradeSlotType } from "./ships";

// ── Types ────────────────────────────────────────────────────────

export type ModuleId =
  // Engine
  | "fuel_optimiser"
  | "thruster_upgrade"
  | "manoeuvring_thrusters"
  // Cargo
  | "expanded_hold"
  | "reinforced_containers"
  | "hidden_compartment"
  // Defence
  | "armour_plating"
  | "shield_booster"
  | "point_defence_array"
  // Systems
  | "scanner_array"
  | "automation_module"
  | "repair_bay";

export type ModuleCategory = "tiered" | "capability";

export interface TierBonus {
  tier: 1 | 2 | 3;
  label: string;
  bonus: number;
  cost: number;
}

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  description: string;
  slotType: UpgradeSlotType;
  category: ModuleCategory;
  /** Which stat this module modifies (for display and computation). */
  stat: string;
  /** Tier variants for tiered modules; single entry for capability modules. */
  tiers: TierBonus[];
}

// ── Module definitions ───────────────────────────────────────────

export const MODULES: Record<ModuleId, ModuleDefinition> = {
  // ── Engine slot ──────────────────────────────────────────────

  fuel_optimiser: {
    id: "fuel_optimiser",
    name: "Fuel Optimiser",
    description: "Reduces fuel consumption per hop.",
    slotType: "engine",
    category: "tiered",
    stat: "fuelCostReduction",
    tiers: [
      { tier: 1, label: "Mk I", bonus: 0.10, cost: 1000 },
      { tier: 2, label: "Mk II", bonus: 0.18, cost: 3000 },
      { tier: 3, label: "Mk III", bonus: 0.25, cost: 7000 },
    ],
  },

  thruster_upgrade: {
    id: "thruster_upgrade",
    name: "Thruster Upgrade",
    description: "Increases ship speed, reducing travel time.",
    slotType: "engine",
    category: "tiered",
    stat: "speedBonus",
    tiers: [
      { tier: 1, label: "Mk I", bonus: 1, cost: 1500 },
      { tier: 2, label: "Mk II", bonus: 2, cost: 4000 },
      { tier: 3, label: "Mk III", bonus: 3, cost: 9000 },
    ],
  },

  manoeuvring_thrusters: {
    id: "manoeuvring_thrusters",
    name: "Manoeuvring Thrusters",
    description: "Improves evasion during dangerous encounters.",
    slotType: "engine",
    category: "capability",
    stat: "evasionBonus",
    tiers: [
      { tier: 1, label: "", bonus: 3, cost: 2000 },
    ],
  },

  // ── Cargo slot ───────────────────────────────────────────────

  expanded_hold: {
    id: "expanded_hold",
    name: "Expanded Hold",
    description: "Increases maximum cargo capacity.",
    slotType: "cargo",
    category: "tiered",
    stat: "cargoBonus",
    tiers: [
      { tier: 1, label: "Mk I", bonus: 20, cost: 800 },
      { tier: 2, label: "Mk II", bonus: 40, cost: 2500 },
      { tier: 3, label: "Mk III", bonus: 60, cost: 6000 },
    ],
  },

  reinforced_containers: {
    id: "reinforced_containers",
    name: "Reinforced Containers",
    description: "Reduces cargo loss severity from hazards and piracy.",
    slotType: "cargo",
    category: "tiered",
    stat: "lossSeverityReduction",
    tiers: [
      { tier: 1, label: "Mk I", bonus: 0.15, cost: 1000 },
      { tier: 2, label: "Mk II", bonus: 0.25, cost: 3000 },
      { tier: 3, label: "Mk III", bonus: 0.35, cost: 7000 },
    ],
  },

  hidden_compartment: {
    id: "hidden_compartment",
    name: "Hidden Compartment",
    description: "Conceals a fraction of cargo from contraband inspections.",
    slotType: "cargo",
    category: "capability",
    stat: "hiddenCargoFraction",
    tiers: [
      { tier: 1, label: "", bonus: 0.30, cost: 3000 },
    ],
  },

  // ── Defence slot ─────────────────────────────────────────────

  armour_plating: {
    id: "armour_plating",
    name: "Armour Plating",
    description: "Increases maximum hull integrity.",
    slotType: "defence",
    category: "tiered",
    stat: "hullBonus",
    tiers: [
      { tier: 1, label: "Mk I", bonus: 15, cost: 1200 },
      { tier: 2, label: "Mk II", bonus: 30, cost: 3500 },
      { tier: 3, label: "Mk III", bonus: 50, cost: 8000 },
    ],
  },

  shield_booster: {
    id: "shield_booster",
    name: "Shield Booster",
    description: "Increases maximum shield capacity.",
    slotType: "defence",
    category: "tiered",
    stat: "shieldBonus",
    tiers: [
      { tier: 1, label: "Mk I", bonus: 10, cost: 1000 },
      { tier: 2, label: "Mk II", bonus: 20, cost: 3000 },
      { tier: 3, label: "Mk III", bonus: 35, cost: 7000 },
    ],
  },

  point_defence_array: {
    id: "point_defence_array",
    name: "Point Defence Array",
    description: "Reduces the probability of cargo loss during encounters.",
    slotType: "defence",
    category: "capability",
    stat: "cargoLossProbReduction",
    tiers: [
      { tier: 1, label: "", bonus: 0.20, cost: 2500 },
    ],
  },

  // ── Systems slot ─────────────────────────────────────────────

  scanner_array: {
    id: "scanner_array",
    name: "Scanner Array",
    description: "Increases sensor range for improved detection.",
    slotType: "systems",
    category: "tiered",
    stat: "sensorsBonus",
    tiers: [
      { tier: 1, label: "Mk I", bonus: 3, cost: 800 },
      { tier: 2, label: "Mk II", bonus: 6, cost: 2500 },
      { tier: 3, label: "Mk III", bonus: 10, cost: 6000 },
    ],
  },

  automation_module: {
    id: "automation_module",
    name: "Automation Module",
    description: "Placeholder for automated trade route execution. No behavior yet.",
    slotType: "systems",
    category: "capability",
    stat: "automation",
    tiers: [
      { tier: 1, label: "", bonus: 1, cost: 5000 },
    ],
  },

  repair_bay: {
    id: "repair_bay",
    name: "Repair Bay",
    description: "Hull repair module. No passive behavior yet — manual repair only.",
    slotType: "systems",
    category: "capability",
    stat: "hullRegenRate",
    tiers: [
      { tier: 1, label: "", bonus: 5, cost: 4000 },
    ],
  },
};

/** All module IDs as an array. */
export const ALL_MODULE_IDS: ModuleId[] = Object.keys(MODULES).filter(
  (k): k is ModuleId => k in MODULES,
);

/** Get modules available for a specific slot type. */
export function getModulesForSlot(slotType: UpgradeSlotType): ModuleDefinition[] {
  return ALL_MODULE_IDS
    .map((id) => MODULES[id])
    .filter((m) => m.slotType === slotType);
}

/** Validate a module ID string. */
export function isModuleId(value: string): value is ModuleId {
  return value in MODULES;
}

/** Get the bonus value for a module at a specific tier. Returns 0 if invalid. */
export function getModuleBonus(moduleId: ModuleId, tier: number): number {
  const mod = MODULES[moduleId];
  if (!mod) return 0;
  const tierDef = mod.tiers.find((t) => t.tier === tier);
  return tierDef?.bonus ?? 0;
}

/** Get the cost for a module at a specific tier. Returns 0 if invalid. */
export function getModuleCost(moduleId: ModuleId, tier: number): number {
  const mod = MODULES[moduleId];
  if (!mod) return 0;
  const tierDef = mod.tiers.find((t) => t.tier === tier);
  return tierDef?.cost ?? 0;
}
