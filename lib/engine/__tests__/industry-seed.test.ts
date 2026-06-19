import { describe, it, expect } from "vitest";
import { allocateIndustry } from "@/lib/engine/industry-seed";
import { buildSpaceUsed, labourDemand, housingPopCap } from "@/lib/engine/industry";
import { GOOD_PRODUCTION } from "@/lib/constants/physical-economy";
import { makeResourceVector } from "@/lib/engine/resources";
import { mulberry32 } from "@/lib/engine/universe-gen";

const richBody = {
  aggregate: makeResourceVector({ ore: 8, minerals: 6, arable: 4, water: 4, gas: 3, biomass: 3, radioactive: 1 }),
  buildSpace: 120,
  bodyBaselinePopCap: 1200,
};

describe("allocateIndustry", () => {
  it("never exceeds the build-space budget", () => {
    const r = allocateIndustry({ ...richBody, fill: 0.9 }, mulberry32(1));
    expect(buildSpaceUsed(r.buildings)).toBeLessThanOrEqual(r.buildSpace + 1e-6);
  });

  it("caps tier-0 extractor count at the deposit magnitude", () => {
    const r = allocateIndustry({ ...richBody, fill: 0.9 }, mulberry32(2));
    for (const goodId of Object.keys(GOOD_PRODUCTION)) {
      const resource = GOOD_PRODUCTION[goodId]?.resource;
      if (!resource) continue;
      expect(r.buildings[goodId] ?? 0, goodId).toBeLessThanOrEqual(richBody.aggregate[resource] + 1e-6);
    }
  });

  it("seeds labour supply ≈ demand (housing covers production labour within tolerance)", () => {
    const r = allocateIndustry({ ...richBody, fill: 0.8 }, mulberry32(3));
    const demand = labourDemand(r.buildings);
    if (demand > 0) {
      // popCap must be able to staff the built industry (supply ≥ demand at seed).
      expect(r.popCap).toBeGreaterThanOrEqual(demand * 0.9);
    }
  });

  it("recomputes popCap = bodyBaseline + housing contribution", () => {
    const r = allocateIndustry({ ...richBody, fill: 0.8 }, mulberry32(4));
    expect(r.popCap).toBeCloseTo(richBody.bodyBaselinePopCap + housingPopCap(r.buildings), 6);
  });

  it("does not build a manufacturer whose inputs have no local production path", () => {
    // A body with only arable: can produce food/textiles, not metals (needs ore).
    const arableOnly = {
      aggregate: makeResourceVector({ arable: 6, water: 3 }),
      buildSpace: 80,
      bodyBaselinePopCap: 600,
    };
    const r = allocateIndustry({ ...arableOnly, fill: 0.9 }, mulberry32(5));
    expect(r.buildings["metals"] ?? 0).toBe(0); // no ore deposit and no ore building → no metals
  });

  it("seeds a near-empty base at fill 0 and a fuller base at fill 0.9", () => {
    const low = allocateIndustry({ ...richBody, fill: 0.05 }, mulberry32(6));
    const high = allocateIndustry({ ...richBody, fill: 0.9 }, mulberry32(6));
    expect(buildSpaceUsed(high.buildings)).toBeGreaterThan(buildSpaceUsed(low.buildings));
  });

  it("is deterministic for a fixed seed", () => {
    const a = allocateIndustry({ ...richBody, fill: 0.7 }, mulberry32(42));
    const b = allocateIndustry({ ...richBody, fill: 0.7 }, mulberry32(42));
    expect(a.buildings).toEqual(b.buildings);
  });
});
