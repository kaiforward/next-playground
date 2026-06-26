import { describe, it, expect } from "vitest";
import { systemBuildGeneration, findStructuralDeficits, buildableUnits, buildableOutput, type BuildSystemState } from "@/lib/engine/directed-build";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import { OUTPUT_PER_UNIT } from "@/lib/constants/industry";
import type { RouteCost } from "@/lib/engine/directed-logistics";

describe("systemBuildGeneration", () => {
  it("scales the build budget linearly with population", () => {
    expect(systemBuildGeneration(100)).toBeCloseTo(100 * DIRECTED_BUILD.GENERATION_PER_POP);
  });

  it("never returns a negative budget", () => {
    expect(systemBuildGeneration(-50)).toBe(0);
    expect(systemBuildGeneration(0)).toBe(0);
  });
});

function buildSys(
  systemId: string,
  good: { goodId: string; stock: number; targetStock: number; demand: number },
): BuildSystemState {
  return {
    systemId, factionId: "f1", population: 100, buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0, goods: [good],
  };
}

const reachable: RouteCost = () => 1;
const unreachable: RouteCost = () => null;

describe("findStructuralDeficits", () => {
  it("flags a deficit as structural when no surplus of that good is reachable", () => {
    const deficit = buildSys("A", { goodId: "electronics", stock: 1, targetStock: 10, demand: 4 });
    const out = findStructuralDeficits([deficit], reachable);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ systemId: "A", goodId: "electronics", shortfall: 9, demand: 4 });
  });

  it("excludes a deficit when a reachable surplus of that good exists", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4 });
    const surplus = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4 });
    expect(findStructuralDeficits([deficit, surplus], reachable)).toHaveLength(0);
  });

  it("keeps a deficit structural when the only surplus is unreachable", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4 });
    const surplus = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4 });
    expect(findStructuralDeficits([deficit, surplus], unreachable)).toHaveLength(1);
  });

  it("does not treat a balanced or surplus market as a deficit", () => {
    const balanced = buildSys("A", { goodId: "ore", stock: 10, targetStock: 10, demand: 4 });
    expect(findStructuralDeficits([balanced], reachable)).toHaveLength(0);
  });
});

// A tier-0 good (food → arable) with deposit slots; sys has space but partial build.
function tier0Sys(builtFood: number, foodSlots: number): BuildSystemState {
  const slotCap = emptyResourceVector();
  // food's resource is arable — set via the building catalog's resource at runtime in the impl;
  // here we set every resource's cap so the test is independent of the food→resource mapping.
  for (const k of RESOURCE_TYPES) slotCap[k] = foodSlots;
  return {
    systemId: "A", factionId: "f1", population: 100,
    buildings: { food: builtFood }, slotCap, generalSpace: 100, habitableSpace: 50, goods: [],
  };
}

describe("buildableUnits / buildableOutput", () => {
  it("caps a tier-0 extractor by remaining deposit slots for its resource", () => {
    const sys = tier0Sys(3, 5); // 3 of 5 slots used → 2 remaining
    expect(buildableUnits(sys, "food")).toBeCloseTo(2);
    expect(buildableOutput(sys, "food")).toBeCloseTo(2 * OUTPUT_PER_UNIT.food);
  });

  it("returns zero tier-0 capacity when slots are full", () => {
    const sys = tier0Sys(5, 5);
    expect(buildableUnits(sys, "food")).toBe(0);
  });

  it("caps a tier-1+ factory by remaining general space ÷ footprint", () => {
    // metals is tier-1 (recipe { ore: 1 }); generalSpace 100, no buildings → 100 / spaceCost units.
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    expect(buildableUnits(sys, "metals")).toBeGreaterThan(0);
  });

  it("reduces tier-1+ capacity by space already used by existing buildings", () => {
    const full: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, buildings: { metals: 100 },
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    // metals occupies general space; with 100 units already built, ~no room left.
    expect(buildableUnits(full, "metals")).toBeCloseTo(0);
  });

  it("returns zero capacity for an unknown good not in GOOD_TIER_BY_KEY", () => {
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, buildings: {},
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    // "not_a_real_good" is not in GOOD_TIER_BY_KEY; should return 0, not divide by default footprint
    expect(buildableUnits(sys, "not_a_real_good")).toBe(0);
  });
});
