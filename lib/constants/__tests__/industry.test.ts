import { describe, it, expect } from "vitest";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
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
  SPECIALISATION_FAMILIES,
  FAMILY_BY_GOOD,
  COMPLEX_BY_TYPE,
  COMPLEX_TYPES,
  ANCHOR_FOOTPRINT,
  ANCHOR_UNSKILLED_LABOUR,
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
  it("every good with a per-good space override occupies more general space than a default factory", () => {
    // fuel has no SPACE_OVERRIDES entry → default footprint; each overridden good exceeds it.
    for (const good of ["ship_frames", "reactor_cores", "machinery", "weapons_systems"]) {
      expect(effectiveSpaceCost(good), good).toBeGreaterThan(effectiveSpaceCost("fuel"));
    }
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

describe("typed building output", () => {
  it("gives every catalog entry a typed output", () => {
    for (const [type, def] of Object.entries(BUILDING_TYPES)) {
      expect(def.output, type).toBeDefined();
    }
  });

  it("marks production types as market_good outputs matching their good id", () => {
    for (const goodId of GOOD_NAMES) {
      expect(BUILDING_TYPES[goodId].output, goodId).toEqual({ kind: "market_good", goodId });
      // The union stays consistent with the legacy outputGood field it will eventually supplant.
      expect(BUILDING_TYPES[goodId].outputGood).toBe(goodId);
    }
  });

  it("marks housing + academies as capacity outputs of the right kind", () => {
    expect(BUILDING_TYPES[HOUSING_TYPE].output).toEqual({ kind: "capacity", capacity: "pop_cap" });
    expect(BUILDING_TYPES[VOCATIONAL_SCHOOL_TYPE].output).toEqual({ kind: "capacity", capacity: "skill1_licence" });
    expect(BUILDING_TYPES[RESEARCH_INSTITUTE_TYPE].output).toEqual({ kind: "capacity", capacity: "skill2_licence" });
  });

  it("marks each specialisation complex as a modifier output keyed on its complex type", () => {
    for (const f of SPECIALISATION_FAMILIES) {
      expect(BUILDING_TYPES[f.complexType].output).toEqual({ kind: "modifier", family: f.complexType });
    }
  });
});

describe("specialisation families", () => {
  it("partition every tier-1+ good into exactly one family", () => {
    const tier1plus = GOOD_NAMES.filter((g) => (GOOD_TIER_BY_KEY[g] ?? 0) >= 1);
    // every tier-1+ good has a family
    for (const g of tier1plus) expect(FAMILY_BY_GOOD[g], `${g} has a family`).toBeDefined();
    // no tier-0 good has a family
    for (const g of GOOD_NAMES.filter((g) => GOOD_TIER_BY_KEY[g] === 0)) {
      expect(FAMILY_BY_GOOD[g], `${g} is un-familied`).toBeUndefined();
    }
    // families are disjoint and cover all 18 tier-1+ goods exactly once
    const all = SPECIALISATION_FAMILIES.flatMap((f) => f.goods);
    expect(new Set(all).size).toBe(all.length); // no dupes
    expect(all.length).toBe(tier1plus.length);
  });

  it("register five complex building types with the anchor footprint + unskilled staffing", () => {
    expect(COMPLEX_TYPES.length).toBe(5);
    for (const f of SPECIALISATION_FAMILIES) {
      expect(COMPLEX_BY_TYPE[f.complexType]).toBe(f);
      const def = BUILDING_TYPES[f.complexType];
      expect(def?.spaceCost).toBe(ANCHOR_FOOTPRINT);
      expect(def?.labour).toEqual({ unskilled: ANCHOR_UNSKILLED_LABOUR, skill1: 0, skill2: 0 });
      expect(def?.outputGood).toBeUndefined(); // produces no good
      expect(def?.resource).toBeUndefined();   // not an extractor → bills to general space
    }
  });
});
