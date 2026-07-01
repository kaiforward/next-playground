import { describe, it, expect } from "vitest";
import { GOOD_NAMES } from "@/lib/constants/goods";
import {
  BUILDING_TYPES,
  PRODUCTION_BUILDING_TYPES,
  HOUSING_TYPE,
  sizeFactor,
  effectiveSpaceCost,
  labourTotal,
} from "@/lib/constants/industry";

describe("BUILDING_TYPES catalog", () => {
  it("has exactly one production building type per good (id === output good id)", () => {
    for (const goodId of GOOD_NAMES) {
      const def = BUILDING_TYPES[goodId];
      expect(def, `building type: ${goodId}`).toBeDefined();
      expect(def.outputGood).toBe(goodId);
    }
    expect(PRODUCTION_BUILDING_TYPES).toHaveLength(GOOD_NAMES.length);
  });

  it("defines no production building type without a backing good", () => {
    const known = new Set(GOOD_NAMES);
    for (const type of PRODUCTION_BUILDING_TYPES) {
      expect(known.has(type), `stray production type: ${type}`).toBe(true);
    }
  });

  it("has a housing type that provides popCap and produces nothing", () => {
    const housing = BUILDING_TYPES[HOUSING_TYPE];
    expect(housing).toBeDefined();
    expect(housing.outputGood).toBeUndefined();
    expect(housing.popProvided).toBeGreaterThan(0);
  });

  it("gives every production type a positive spaceCost, labour total, outputPerUnit", () => {
    for (const type of PRODUCTION_BUILDING_TYPES) {
      const def = BUILDING_TYPES[type];
      expect(def.spaceCost, type).toBeGreaterThan(0);
      expect(labourTotal(def.labour ?? { unskilled: 0, skill1: 0, skill2: 0 }), type).toBeGreaterThan(0);
      expect(def.outputPerUnit ?? 0, type).toBeGreaterThan(0);
    }
  });

  it("tier-0 extractor types carry their driving resource; tier-1+ types do not", () => {
    // Tier-0 goods (resource-driven) have a `resource`; tier-1+ do not.
    expect(BUILDING_TYPES["ore"].resource).toBe("ore");
    expect(BUILDING_TYPES["food"].resource).toBe("arable");
    expect(BUILDING_TYPES["metals"].resource).toBeUndefined();
  });

  it("tier-1+ production types carry inert recipe inputs not yet applied to production", () => {
    expect(BUILDING_TYPES["metals"].inputs).toEqual({ ore: 1 });
    expect(BUILDING_TYPES["ore"].inputs).toBeUndefined();
  });

  it("exposes build-space factor helpers", () => {
    expect(sizeFactor(2)).toBe(2 * sizeFactor(1));
    expect(sizeFactor(-1)).toBe(0);
    expect(effectiveSpaceCost("ore")).toBe(BUILDING_TYPES["ore"].spaceCost);
    expect(effectiveSpaceCost(HOUSING_TYPE)).toBe(BUILDING_TYPES[HOUSING_TYPE].spaceCost);
  });
});

describe("per-good space", () => {
  it("the most-integrated tier-2 goods occupy more general space than a default factory", () => {
    expect(effectiveSpaceCost("ship_frames")).toBeGreaterThan(effectiveSpaceCost("fuel"));
    expect(effectiveSpaceCost("reactor_cores")).toBeGreaterThan(effectiveSpaceCost("metals"));
  });
});
