import { describe, it, expect } from "vitest";
import { GOVERNMENT_TYPES, type GovernmentDefinition } from "../government";
import { ALL_GOVERNMENT_TYPES } from "@/lib/types/guards";

describe("GOVERNMENT_TYPES", () => {
  it("defines an entry for every GovernmentType", () => {
    for (const type of ALL_GOVERNMENT_TYPES) {
      expect(GOVERNMENT_TYPES[type]).toBeDefined();
    }
  });

  it("includes all 8 government types after Layer 2 expansion", () => {
    expect(ALL_GOVERNMENT_TYPES).toHaveLength(8);
    expect(ALL_GOVERNMENT_TYPES).toEqual(
      expect.arrayContaining([
        "federation", "corporate", "authoritarian", "frontier",
        "cooperative", "technocratic", "militarist", "theocratic",
      ]),
    );
  });

  it("all entries match the GovernmentDefinition shape", () => {
    const requiredKeys: ReadonlyArray<keyof GovernmentDefinition> = [
      "name", "description", "taxed", "contraband",
      "taxRate", "inspectionModifier", "volatilityModifier",
      "dangerBaseline", "equilibriumSpreadPct",
      "eventWeights", "consumptionBoosts",
    ];

    for (const type of ALL_GOVERNMENT_TYPES) {
      const def = GOVERNMENT_TYPES[type];
      for (const key of requiredKeys) {
        expect(def[key], `${type}.${String(key)} should be defined`).not.toBeUndefined();
      }
      expect(typeof def.name).toBe("string");
      expect(typeof def.description).toBe("string");
      expect(Array.isArray(def.taxed)).toBe(true);
      expect(Array.isArray(def.contraband)).toBe(true);
      expect(typeof def.taxRate).toBe("number");
      expect(typeof def.inspectionModifier).toBe("number");
      expect(typeof def.volatilityModifier).toBe("number");
      expect(typeof def.dangerBaseline).toBe("number");
      expect(typeof def.equilibriumSpreadPct).toBe("number");
    }
  });

  it("does not reference the removed `war` event in any eventWeights", () => {
    for (const type of ALL_GOVERNMENT_TYPES) {
      const weights = GOVERNMENT_TYPES[type].eventWeights;
      expect(weights["war"], `${type} must not weight the removed 'war' event`).toBeUndefined();
    }
  });
});
