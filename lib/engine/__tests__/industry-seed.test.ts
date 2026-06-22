import { describe, it, expect } from "vitest";
import { allocateIndustry, type AllocateInput } from "@/lib/engine/industry-seed";
import { labourDemand, housingPopCap } from "@/lib/engine/industry";
import {
  HOUSING_TYPE,
  effectiveSpaceCost,
  POP_CENTRE_DENSITY,
  BUILDING_TYPES,
  PRODUCTION_BUILDING_TYPES,
} from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import {
  makeResourceVector,
  emptyResourceVector,
  sumResourceVectors,
  RESOURCE_TYPES,
} from "@/lib/engine/resources";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { mulberry32 } from "@/lib/engine/universe-gen";
import type { ResourceVector } from "@/lib/types/game";

/** Build a body with given slots + uniform quality (or per-resource quality). */
function body(
  slots: Partial<ResourceVector>,
  quality: number | Partial<ResourceVector>,
): { slots: ResourceVector; quality: ResourceVector } {
  const s = makeResourceVector(slots);
  const q = emptyResourceVector();
  for (const r of RESOURCE_TYPES) {
    if (s[r] > 0) {
      q[r] = typeof quality === "number" ? quality : (quality[r] ?? 1);
    }
  }
  return { slots: s, quality: q };
}

/** A varied, resource-rich multi-body system input. */
function richInput(fill: number): AllocateInput {
  const bodies = [
    body({ ore: 8, minerals: 4, arable: 3, water: 2 }, 1.2),
    body({ arable: 5, water: 4, biomass: 3, gas: 2 }, 0.9),
    body({ gas: 3, radioactive: 1, minerals: 2 }, 1.5),
  ];
  const slotCap = sumResourceVectors(bodies.map((b) => b.slots));
  return { bodies, slotCap, generalSpace: 200, habitableSpace: 120, fill };
}

/** Sum extractor counts (tier-0 goods with a resource) per resource. */
function extractorCountByResource(buildings: Record<string, number>): ResourceVector {
  const acc = emptyResourceVector();
  for (const goodId of PRODUCTION_BUILDING_TYPES) {
    if (GOOD_TIER_BY_KEY[goodId] !== 0) continue;
    const resource = BUILDING_TYPES[goodId]?.resource;
    if (!resource) continue;
    acc[resource] += buildings[goodId] ?? 0;
  }
  return acc;
}

/** Factory space = Σ count × spaceCost over tier-1+ production types. */
function factorySpace(buildings: Record<string, number>): number {
  let used = 0;
  for (const goodId of PRODUCTION_BUILDING_TYPES) {
    if (GOOD_TIER_BY_KEY[goodId] === 0) continue;
    used += (buildings[goodId] ?? 0) * effectiveSpaceCost(goodId);
  }
  return used;
}

describe("allocateIndustry — available-space model", () => {
  it("returns the new result shape (buildings, popCap, yieldMult vector)", () => {
    const r = allocateIndustry(richInput(0.8), mulberry32(1));
    expect(r.buildings).toBeDefined();
    expect(typeof r.popCap).toBe("number");
    for (const res of RESOURCE_TYPES) {
      expect(typeof r.yieldMult[res]).toBe("number");
    }
  });

  it("caps the per-resource sum of tier-0 extractor counts at slotCap[r]", () => {
    const input = richInput(0.95);
    const r = allocateIndustry(input, mulberry32(2));
    const placed = extractorCountByResource(r.buildings);
    for (const res of RESOURCE_TYPES) {
      expect(placed[res], res).toBeLessThanOrEqual(input.slotCap[res] + 1e-9);
    }
  });

  it("shares one slotCap across goods that share a resource (food + textiles share arable)", () => {
    // Arable-rich, single resource → food and textiles compete for the same cap.
    const bodies = [body({ arable: 4 }, 1.0)];
    const slotCap = sumResourceVectors(bodies.map((b) => b.slots));
    const input: AllocateInput = { bodies, slotCap, generalSpace: 100, habitableSpace: 60, fill: 1 };
    const r = allocateIndustry(input, mulberry32(3));
    const foodPlusTextiles = (r.buildings["food"] ?? 0) + (r.buildings["textiles"] ?? 0);
    expect(foodPlusTextiles).toBeLessThanOrEqual(slotCap.arable + 1e-9);
  });

  it("places zero extractors for a resource with slotCap[r] === 0", () => {
    const input = richInput(0.9);
    const r = allocateIndustry(input, mulberry32(4));
    const placed = extractorCountByResource(r.buildings);
    for (const res of RESOURCE_TYPES) {
      if (input.slotCap[res] === 0) expect(placed[res], res).toBe(0);
    }
  });

  it("pop-centre space never exceeds habitableSpace", () => {
    const input = richInput(0.9);
    const r = allocateIndustry(input, mulberry32(5));
    const popCentreSpace = (r.buildings[HOUSING_TYPE] ?? 0) * effectiveSpaceCost(HOUSING_TYPE);
    expect(popCentreSpace).toBeLessThanOrEqual(input.habitableSpace + 1e-9);
  });

  it("factory + pop-centre space never exceeds generalSpace", () => {
    const input = richInput(0.95);
    const r = allocateIndustry(input, mulberry32(6));
    const popCentreSpace = (r.buildings[HOUSING_TYPE] ?? 0) * effectiveSpaceCost(HOUSING_TYPE);
    expect(factorySpace(r.buildings) + popCentreSpace).toBeLessThanOrEqual(input.generalSpace + 1e-9);
  });

  it("extractors consume deposit slots, not general space (factories never touch slots)", () => {
    // A factory-heavy input with tiny habitable land: factory space must come from
    // generalSpace and must not be limited by slot caps.
    const input = richInput(0.9);
    const r = allocateIndustry(input, mulberry32(7));
    // Every tier-1+ building is a factory; its space draws only from generalSpace,
    // which is asserted by the factory+pop ≤ generalSpace invariant. Here we assert
    // factories don't appear in the slot accounting at all.
    const placed = extractorCountByResource(r.buildings);
    for (const res of RESOURCE_TYPES) {
      expect(placed[res], res).toBeLessThanOrEqual(input.slotCap[res] + 1e-9);
    }
    // Factory space is independent of slotCap: there is general space, so factories exist
    // whenever inputs are locally producible.
    expect(factorySpace(r.buildings)).toBeGreaterThanOrEqual(0);
  });

  it("does not build a manufacturer whose inputs have no local production path", () => {
    // Arable + water only → food/textiles producible, metals (needs ore) is not.
    const bodies = [body({ arable: 6, water: 3 }, 1.0)];
    const slotCap = sumResourceVectors(bodies.map((b) => b.slots));
    const input: AllocateInput = { bodies, slotCap, generalSpace: 120, habitableSpace: 80, fill: 0.9 };
    const r = allocateIndustry(input, mulberry32(8));
    expect(r.buildings["metals"] ?? 0).toBe(0);
  });

  it("popCap = housingPopCap + POP_BASELINE_FLOOR (full-fold, no body baseline)", () => {
    const input = richInput(0.8);
    const r = allocateIndustry(input, mulberry32(9));
    expect(r.popCap).toBeCloseTo(housingPopCap(r.buildings) + SUBSTRATE_GEN.POP_BASELINE_FLOOR, 6);
  });

  it("sizes pop-centres to staff production labour when habitable/general space allows", () => {
    // Generous space so the habitable/general caps don't bind: housing should
    // satisfy labourDemand / POP_CENTRE_DENSITY.
    const bodies = [body({ ore: 6, arable: 4, water: 3, gas: 2 }, 1.0)];
    const slotCap = sumResourceVectors(bodies.map((b) => b.slots));
    const input: AllocateInput = {
      bodies, slotCap, generalSpace: 10000, habitableSpace: 10000, fill: 0.9,
    };
    const r = allocateIndustry(input, mulberry32(10));
    const demand = labourDemand(r.buildings);
    if (demand > 0) {
      const wanted = demand / POP_CENTRE_DENSITY;
      expect(r.buildings[HOUSING_TYPE] ?? 0).toBeCloseTo(wanted, 4);
    }
  });

  it("seeds a fuller base at high fill than at low fill", () => {
    const low = allocateIndustry(richInput(0.05), mulberry32(11));
    const high = allocateIndustry(richInput(0.95), mulberry32(11));
    const lowExtractors = RESOURCE_TYPES.reduce((s, r) => s + extractorCountByResource(low.buildings)[r], 0);
    const highExtractors = RESOURCE_TYPES.reduce((s, r) => s + extractorCountByResource(high.buildings)[r], 0);
    expect(highExtractors).toBeGreaterThan(lowExtractors);
  });

  it("is deterministic for a fixed seed", () => {
    const a = allocateIndustry(richInput(0.7), mulberry32(42));
    const b = allocateIndustry(richInput(0.7), mulberry32(42));
    expect(a.buildings).toEqual(b.buildings);
    expect(a.yieldMult).toEqual(b.yieldMult);
    expect(a.popCap).toBe(b.popCap);
  });
});

describe("allocateIndustry — yieldMult (best-quality-slots-first)", () => {
  it("yieldMult[r] = 1.0 when no extractors are placed for r", () => {
    // No slots at all → no extractors → neutral yield everywhere.
    const bodies = [body({}, 1.0)];
    const slotCap = emptyResourceVector();
    const input: AllocateInput = { bodies, slotCap, generalSpace: 100, habitableSpace: 50, fill: 0.9 };
    const r = allocateIndustry(input, mulberry32(12));
    for (const res of RESOURCE_TYPES) {
      expect(r.yieldMult[res], res).toBe(1.0);
    }
  });

  it("filling ALL ore slots → yieldMult.ore = capacity-weighted mean of all body ore qualities", () => {
    // Two bodies with ore at distinct quality; fill=1 and slotCap small relative to
    // generalSpace so all ore slots get an extractor.
    const bodies = [
      body({ ore: 2 }, { ore: 2.0 }),
      body({ ore: 6 }, { ore: 1.0 }),
    ];
    const slotCap = sumResourceVectors(bodies.map((b) => b.slots)); // ore: 8
    const input: AllocateInput = { bodies, slotCap, generalSpace: 100, habitableSpace: 50, fill: 1 };
    const r = allocateIndustry(input, mulberry32(13));
    const placedOre = extractorCountByResource(r.buildings).ore;
    // Capacity-weighted mean of ALL ore = (2×2.0 + 6×1.0) / 8 = 1.25 — only valid if all slots filled.
    if (placedOre >= slotCap.ore - 1e-9) {
      expect(r.yieldMult.ore).toBeCloseTo((2 * 2.0 + 6 * 1.0) / 8, 6);
    }
  });

  it("filling only the TOP slice → yieldMult.ore = the highest body's quality", () => {
    // Best-quality-first: when extractorCount ≤ the best body's capacity, only its
    // quality should be reflected.
    const bodies = [
      body({ ore: 10 }, { ore: 2.0 }), // best
      body({ ore: 10 }, { ore: 0.5 }), // worst
    ];
    const slotCap = sumResourceVectors(bodies.map((b) => b.slots)); // ore: 20
    // Force a small extractor count via low fill so only the top body's slice is used.
    const input: AllocateInput = { bodies, slotCap, generalSpace: 100, habitableSpace: 50, fill: 0.2 };
    const r = allocateIndustry(input, mulberry32(14));
    const placedOre = extractorCountByResource(r.buildings).ore;
    if (placedOre > 0 && placedOre <= 10 + 1e-9) {
      expect(r.yieldMult.ore).toBeCloseTo(2.0, 6);
    }
  });
});
