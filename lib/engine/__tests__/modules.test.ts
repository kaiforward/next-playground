import { describe, it, expect } from "vitest";
import {
  MODULES,
  ALL_MODULE_IDS,
  getModulesForSlot,
  isModuleId,
  getModuleBonus,
  getModuleCost,
  type ModuleId,
} from "@/lib/constants/modules";
import type { UpgradeSlotType } from "@/lib/constants/ships";

describe("Module constants", () => {
  it("defines exactly 12 modules", () => {
    expect(ALL_MODULE_IDS).toHaveLength(12);
  });

  it("each module has a matching id key", () => {
    for (const [key, def] of Object.entries(MODULES)) {
      expect(def.id).toBe(key);
    }
  });

  it("each slot type has exactly 3 modules", () => {
    const slotTypes: UpgradeSlotType[] = ["engine", "cargo", "defence", "systems"];
    for (const slot of slotTypes) {
      const mods = getModulesForSlot(slot);
      expect(mods).toHaveLength(3);
    }
  });

  it("tiered modules have 3 tiers, capability modules have 1", () => {
    for (const def of Object.values(MODULES)) {
      if (def.category === "tiered") {
        expect(def.tiers).toHaveLength(3);
        expect(def.tiers.map((t) => t.tier)).toEqual([1, 2, 3]);
      } else {
        expect(def.tiers).toHaveLength(1);
        expect(def.tiers[0].tier).toBe(1);
      }
    }
  });

  it("tier bonuses increase with tier level", () => {
    for (const def of Object.values(MODULES)) {
      if (def.category !== "tiered") continue;
      for (let i = 1; i < def.tiers.length; i++) {
        expect(def.tiers[i].bonus).toBeGreaterThan(def.tiers[i - 1].bonus);
      }
    }
  });

  it("tier costs increase with tier level", () => {
    for (const def of Object.values(MODULES)) {
      if (def.category !== "tiered") continue;
      for (let i = 1; i < def.tiers.length; i++) {
        expect(def.tiers[i].cost).toBeGreaterThan(def.tiers[i - 1].cost);
      }
    }
  });

  it("all costs are positive", () => {
    for (const def of Object.values(MODULES)) {
      for (const tier of def.tiers) {
        expect(tier.cost).toBeGreaterThan(0);
      }
    }
  });

  it("isModuleId validates correctly", () => {
    for (const id of ALL_MODULE_IDS) {
      expect(isModuleId(id)).toBe(true);
    }
    expect(isModuleId("invalid")).toBe(false);
    expect(isModuleId("")).toBe(false);
  });

  it("getModuleBonus returns correct values", () => {
    expect(getModuleBonus("fuel_optimiser", 1)).toBe(0.10);
    expect(getModuleBonus("fuel_optimiser", 3)).toBe(0.25);
    expect(getModuleBonus("fuel_optimiser", 4)).toBe(0); // invalid tier
  });

  it("getModuleCost returns correct values", () => {
    expect(getModuleCost("armour_plating", 1)).toBe(1200);
    expect(getModuleCost("armour_plating", 3)).toBe(8000);
    expect(getModuleCost("armour_plating", 4)).toBe(0); // invalid tier
  });
});
