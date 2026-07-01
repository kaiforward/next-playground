import { describe, it, expect } from "vitest";
import { GOOD_NAMES } from "@/lib/constants/goods";
import {
  BUILDING_TYPES,
  PRODUCTION_BUILDING_TYPES,
  HOUSING_TYPE,
  sizeFactor,
  effectiveSpaceCost,
  labourTotal,
  ACADEMY_TYPES,
  VOCATIONAL_SCHOOL_TYPE,
  RESEARCH_INSTITUTE_TYPE,
  SKILL1_PER_SCHOOL,
  SKILL2_PER_INSTITUTE,
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

describe("academies", () => {
  it("are non-producing, unskilled-staffed, space-eating, skill-licensing buildings", () => {
    for (const type of ACADEMY_TYPES) {
      const def = BUILDING_TYPES[type];
      expect(def, type).toBeDefined();
      expect(def.outputGood, type).toBeUndefined();          // produce no good
      expect(def.spaceCost, type).toBeGreaterThan(0);         // eat general space
      const v = def.labour!;
      expect(labourTotal(v), type).toBeGreaterThan(0);        // need staffing
      expect(v.skill1, type).toBe(0);                         // staffed by unskilled only…
      expect(v.skill2, type).toBe(0);                         // …no academy to staff an academy
    }
  });
  it("each academy licenses exactly its own grade", () => {
    expect(BUILDING_TYPES[VOCATIONAL_SCHOOL_TYPE].skill1Licensed).toBe(SKILL1_PER_SCHOOL);
    expect(BUILDING_TYPES[VOCATIONAL_SCHOOL_TYPE].skill2Licensed ?? 0).toBe(0);
    expect(BUILDING_TYPES[RESEARCH_INSTITUTE_TYPE].skill2Licensed).toBe(SKILL2_PER_INSTITUTE);
    expect(BUILDING_TYPES[RESEARCH_INSTITUTE_TYPE].skill1Licensed ?? 0).toBe(0);
  });
});
