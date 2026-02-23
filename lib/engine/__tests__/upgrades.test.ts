import { describe, it, expect } from "vitest";
import {
  computeUpgradeBonuses,
  validateUpgradeInstallation,
  type InstalledModule,
} from "@/lib/engine/upgrades";

describe("computeUpgradeBonuses", () => {
  it("returns zero bonuses for empty module list", () => {
    const bonuses = computeUpgradeBonuses([]);
    expect(bonuses.fuelCostReduction).toBe(0);
    expect(bonuses.speedBonus).toBe(0);
    expect(bonuses.cargoBonus).toBe(0);
    expect(bonuses.hullBonus).toBe(0);
    expect(bonuses.hasAutomation).toBe(false);
  });

  it("computes fuel optimiser Mk I bonus", () => {
    const modules: InstalledModule[] = [
      { moduleId: "fuel_optimiser", moduleTier: 1, slotType: "engine" },
    ];
    const bonuses = computeUpgradeBonuses(modules);
    expect(bonuses.fuelCostReduction).toBeCloseTo(0.10);
  });

  it("stacks fuel optimiser multiplicatively", () => {
    const modules: InstalledModule[] = [
      { moduleId: "fuel_optimiser", moduleTier: 1, slotType: "engine" },
      { moduleId: "fuel_optimiser", moduleTier: 1, slotType: "engine" },
    ];
    const bonuses = computeUpgradeBonuses(modules);
    // 1 - (1-0.10)(1-0.10) = 1 - 0.81 = 0.19
    expect(bonuses.fuelCostReduction).toBeCloseTo(0.19);
  });

  it("computes additive speed bonus from thruster upgrades", () => {
    const modules: InstalledModule[] = [
      { moduleId: "thruster_upgrade", moduleTier: 2, slotType: "engine" },
    ];
    const bonuses = computeUpgradeBonuses(modules);
    expect(bonuses.speedBonus).toBe(2);
  });

  it("computes additive cargo bonus", () => {
    const modules: InstalledModule[] = [
      { moduleId: "expanded_hold", moduleTier: 3, slotType: "cargo" },
    ];
    const bonuses = computeUpgradeBonuses(modules);
    expect(bonuses.cargoBonus).toBe(60);
  });

  it("caps hidden cargo fraction at 0.9", () => {
    const modules: InstalledModule[] = [
      { moduleId: "hidden_compartment", moduleTier: 1, slotType: "cargo" },
      { moduleId: "hidden_compartment", moduleTier: 1, slotType: "cargo" },
      { moduleId: "hidden_compartment", moduleTier: 1, slotType: "cargo" },
      { moduleId: "hidden_compartment", moduleTier: 1, slotType: "cargo" },
    ];
    const bonuses = computeUpgradeBonuses(modules);
    expect(bonuses.hiddenCargoFraction).toBe(0.9);
  });

  it("detects automation module", () => {
    const modules: InstalledModule[] = [
      { moduleId: "automation_module", moduleTier: 1, slotType: "systems" },
    ];
    const bonuses = computeUpgradeBonuses(modules);
    expect(bonuses.hasAutomation).toBe(true);
  });

  it("skips invalid module IDs", () => {
    const modules: InstalledModule[] = [
      { moduleId: "nonexistent", moduleTier: 1, slotType: "engine" },
    ];
    const bonuses = computeUpgradeBonuses(modules);
    expect(bonuses.speedBonus).toBe(0);
  });

  it("skips invalid tiers", () => {
    const modules: InstalledModule[] = [
      { moduleId: "fuel_optimiser", moduleTier: 5, slotType: "engine" },
    ];
    const bonuses = computeUpgradeBonuses(modules);
    expect(bonuses.fuelCostReduction).toBe(0);
  });
});

describe("validateUpgradeInstallation", () => {
  it("accepts valid module + slot combination", () => {
    const result = validateUpgradeInstallation({
      moduleId: "fuel_optimiser",
      moduleTier: 1,
      slotType: "engine",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown module", () => {
    const result = validateUpgradeInstallation({
      moduleId: "nonexistent",
      moduleTier: 1,
      slotType: "engine",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong slot type", () => {
    const result = validateUpgradeInstallation({
      moduleId: "fuel_optimiser",
      moduleTier: 1,
      slotType: "cargo",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("engine");
    }
  });

  it("rejects invalid tier for tiered module", () => {
    const result = validateUpgradeInstallation({
      moduleId: "fuel_optimiser",
      moduleTier: 4,
      slotType: "engine",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts tier 1 for capability module", () => {
    const result = validateUpgradeInstallation({
      moduleId: "manoeuvring_thrusters",
      moduleTier: 1,
      slotType: "engine",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects tier 2 for capability module", () => {
    const result = validateUpgradeInstallation({
      moduleId: "manoeuvring_thrusters",
      moduleTier: 2,
      slotType: "engine",
    });
    expect(result.ok).toBe(false);
  });
});
