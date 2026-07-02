import { describe, it, expect } from "vitest";
import { BUILDING_DESCRIPTIONS, TIER_LABELS, describeBuilding } from "@/lib/constants/building-descriptions";
import { HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, COMPLEX_TYPES } from "@/lib/constants/industry";
import { GOODS } from "@/lib/constants/goods";

describe("building descriptions", () => {
  it("carries bespoke copy for the three non-good buildings", () => {
    for (const t of [HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE]) {
      expect(BUILDING_DESCRIPTIONS[t], t).toBeDefined();
      expect(BUILDING_DESCRIPTIONS[t].length, t).toBeGreaterThan(20);
    }
  });

  it("names what each academy licenses", () => {
    expect(BUILDING_DESCRIPTIONS[VOCATIONAL_SCHOOL_TYPE].toLowerCase()).toContain("technician");
    expect(BUILDING_DESCRIPTIONS[RESEARCH_INSTITUTE_TYPE].toLowerCase()).toContain("engineer");
  });

  it("TIER_LABELS names each manufacturing class exactly", () => {
    expect(TIER_LABELS[0]).toBe("Extraction");
    expect(TIER_LABELS[1]).toBe("Basic manufacturing");
    expect(TIER_LABELS[2]).toBe("Advanced manufacturing");
  });

  it("describeBuilding falls back to the good description for production buildings", () => {
    expect(describeBuilding(VOCATIONAL_SCHOOL_TYPE)).toBe(BUILDING_DESCRIPTIONS[VOCATIONAL_SCHOOL_TYPE]);
    expect(describeBuilding("ore")).toBe(GOODS.ore.description);
    expect(describeBuilding("nonexistent-good")).toBe("");
  });
});

describe("complex descriptions", () => {
  it("gives every complex bespoke non-empty copy", () => {
    for (const t of COMPLEX_TYPES) {
      expect(describeBuilding(t).length, `${t} has copy`).toBeGreaterThan(20);
    }
  });
});
