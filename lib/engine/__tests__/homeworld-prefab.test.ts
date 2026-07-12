import { describe, it, expect } from "vitest";
import {
  HOME_SYSTEM_PREFAB,
  HOME_SYSTEM_POP,
  computeHomeworldBuildings,
  homeworldGardenBody,
  isCovered,
} from "../homeworld-prefab";
import {
  labourDemand,
  housingPopCap,
  buildingProduction,
  labourParts,
  computeLabourAllocation,
  type LabourState,
} from "../industry";
import { consumptionRate } from "../physical-economy";
import { GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { OUTPUT_PER_UNIT, effectiveSpaceCost, HOUSING_TYPE } from "@/lib/constants/industry";
import { unitResourceVector, RESOURCE_TYPES } from "../resources";

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

  it("is self-sufficient — production meets the full tick-model consumption for every good it manufactures", () => {
    // Consumption must match the live per-tick model (consumptionRate): the per-capita baseline PLUS the
    // technician/engineer skilled baskets. A fully-staffed capital works exactly its licensed skilled demand,
    // so its basis is the labour allocation over its own buildings.
    const alloc = computeLabourAllocation(labourParts(b), HOME_SYSTEM_POP);
    const basis = { population: HOME_SYSTEM_POP, technicians: alloc.technicians, engineers: alloc.engineers };

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
      if (!isCovered(g)) continue; // uncovered (military tier-2) is imported, not made here — from source
      const production = buildingProduction(b, g, fullStaff, yields);
      const consumption = consumptionRate(g, basis) + (recipeDraw[g] ?? 0);
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

  it("guarantees enough general space for every factory, academy and housing level", () => {
    // Extractors sit on deposit slots (asserted above); every non-tier-0 building (factories, academies,
    // housing) draws general space. The garden must fit their whole footprint so nothing is floored.
    let generalFootprint = 0;
    for (const [type, count] of Object.entries(HOME_SYSTEM_PREFAB.buildings)) {
      if (GOOD_TIER_BY_KEY[type] === 0 && GOOD_PRODUCTION[type]?.resource) continue; // extractor → slots, not general
      generalFootprint += count * effectiveSpaceCost(type);
    }
    expect(homeworldGardenBody().generalSpace).toBeGreaterThanOrEqual(generalFootprint);
  });
});
