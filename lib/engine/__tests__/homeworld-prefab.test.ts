import { describe, it, expect } from "vitest";
import {
  HOME_SYSTEM_PREFAB,
  HOME_SYSTEM_POP,
  computeHomeworldBuildings,
  homeworldGardenBody,
} from "../homeworld-prefab";
import { labourDemand, housingPopCap, buildingProduction, type LabourState } from "../industry";
import { GOOD_CONSUMPTION, GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE } from "@/lib/constants/industry";
import { unitResourceVector, RESOURCE_TYPES } from "../resources";

/** Goods the capital consumes but deliberately does NOT manufacture (military tier-2 → war system). */
const UNCOVERED = new Set(["weapons", "weapons_systems", "targeting_arrays", "reactor_cores", "ship_frames"]);

describe("HOME_SYSTEM_PREFAB", () => {
  const b = HOME_SYSTEM_PREFAB.buildings;

  it("uses only whole-integer building counts", () => {
    for (const [type, count] of Object.entries(b)) {
      expect(Number.isInteger(count), type).toBe(true);
      expect(count).toBeGreaterThan(0);
    }
  });

  it("is staffable — labour demand does not exceed housing pop-cap", () => {
    expect(labourDemand(b)).toBeLessThanOrEqual(housingPopCap(b));
  });

  it("houses its residents — popCap equals the resident population", () => {
    expect(housingPopCap(b)).toBe(HOME_SYSTEM_POP);
    expect(HOME_SYSTEM_PREFAB.population).toBe(HOME_SYSTEM_POP);
  });

  it("is self-sufficient — production meets consumption for every good it manufactures", () => {
    // Recipe draw of the base's own factories, added onto civilian consumption.
    const recipeDraw: Record<string, number> = {};
    for (const [g, c] of Object.entries(b)) {
      const out = OUTPUT_PER_UNIT[g];
      if (out === undefined) continue;
      for (const [inp, per] of Object.entries(GOOD_RECIPES[g] ?? {})) {
        recipeDraw[inp] = (recipeDraw[inp] ?? 0) + per * c * out;
      }
    }
    const fullStaff: LabourState = { labourFulfil: 1, skill1Fulfil: 1, skill2Fulfil: 1 };
    const yields = unitResourceVector();
    for (const g of Object.keys(OUTPUT_PER_UNIT)) {
      if (UNCOVERED.has(g)) continue; // military tier-2 is imported, not made here
      const production = buildingProduction(b, g, fullStaff, yields);
      const consumption = (GOOD_CONSUMPTION[g] ?? 0) * HOME_SYSTEM_POP + (recipeDraw[g] ?? 0);
      expect(production, g).toBeGreaterThanOrEqual(consumption - 1e-6);
    }
  });

  it("is deterministic — recomputing yields an identical stamp (same for every faction)", () => {
    expect(computeHomeworldBuildings(HOME_SYSTEM_POP)).toEqual(b);
  });
});

describe("homeworldGardenBody", () => {
  it("guarantees enough deposit slots for every extractor the prefab places", () => {
    const garden = homeworldGardenBody();
    const need = { ...unitResourceVector() };
    for (const r of RESOURCE_TYPES) need[r] = 0;
    for (const [type, count] of Object.entries(HOME_SYSTEM_PREFAB.buildings)) {
      if (GOOD_TIER_BY_KEY[type] !== 0) continue;
      const r = GOOD_PRODUCTION[type]?.resource;
      if (r) need[r] += count;
    }
    for (const r of RESOURCE_TYPES) expect(garden.slots[r], r).toBeGreaterThanOrEqual(need[r]);
  });

  it("guarantees enough habitable space for the prefab's housing", () => {
    const housing = HOME_SYSTEM_PREFAB.buildings[HOUSING_TYPE] ?? 0;
    expect(homeworldGardenBody().habitableSpace).toBeGreaterThanOrEqual(housing * effectiveSpaceCost(HOUSING_TYPE));
  });
});
