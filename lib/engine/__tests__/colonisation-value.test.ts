import { describe, it, expect } from "vitest";
import {
  RESOURCE_CLOSURE,
  factionMissingResources,
  factionSaturation,
  unblockedDemandByResource,
  type FactionSystemState,
} from "@/lib/engine/colonisation-value";
import { emptyResourceVector } from "@/lib/engine/resources";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type { ResourceType } from "@/lib/types/game";

describe("RESOURCE_CLOSURE", () => {
  it("maps a tier-0 good to its own resource", () => {
    expect([...RESOURCE_CLOSURE.ore]).toEqual(["ore"]);
    expect([...RESOURCE_CLOSURE.radioactives]).toEqual(["radioactive"]);
  });

  it("maps a tier-1 good to the union of its inputs' resources", () => {
    // alloys = metals(→ore) + minerals(→minerals)
    expect(new Set(RESOURCE_CLOSURE.alloys)).toEqual(new Set(["ore", "minerals"]));
  });

  it("traces a deep tier-2 chain down to its deposits", () => {
    // reactor_cores = radioactives(→radioactive) + alloys(→ore,minerals) + components(→minerals,ore)
    expect(new Set(RESOURCE_CLOSURE.reactor_cores)).toEqual(
      new Set(["radioactive", "ore", "minerals"]),
    );
  });
});

function sys(over: Partial<FactionSystemState>): FactionSystemState {
  return { buildings: {}, habitableSpace: 0, slotCap: emptyResourceVector(), ...over };
}

describe("factionMissingResources", () => {
  it("returns resources with zero slotCap across developed systems", () => {
    const oreOnly = sys({ slotCap: { ...emptyResourceVector(), ore: 5 } });
    const missing = factionMissingResources([oreOnly]);
    expect(missing.has("ore")).toBe(false);
    expect(missing.has("radioactive")).toBe(true);
    expect(missing.has("gas")).toBe(true);
  });

  it("treats a resource present on ANY developed system as not missing", () => {
    const a = sys({ slotCap: { ...emptyResourceVector(), ore: 5 } });
    const b = sys({ slotCap: { ...emptyResourceVector(), gas: 3 } });
    const missing = factionMissingResources([a, b]);
    expect(missing.has("ore")).toBe(false);
    expect(missing.has("gas")).toBe(false);
    expect(missing.has("radioactive")).toBe(true);
  });
});

describe("factionSaturation", () => {
  it("is ~0 when habitable land is mostly unbuilt", () => {
    // 100 habitable / housing cost 1 → 2000 potential pop-cap; 0 housing built → σ ≈ 0
    expect(factionSaturation([sys({ habitableSpace: 100 })])).toBeCloseTo(0, 5);
  });

  it("is 1 when housing fills the habitable land", () => {
    // 100 housing × POP_CENTRE_DENSITY(20) = 2000 built = 2000 potential → σ = 1
    expect(
      factionSaturation([sys({ habitableSpace: 100, buildings: { [HOUSING_TYPE]: 100 } })]),
    ).toBeCloseTo(1, 5);
  });

  it("treats zero habitable potential as fully saturated", () => {
    expect(factionSaturation([sys({ habitableSpace: 0 })])).toBe(1);
  });
});

describe("unblockedDemandByResource", () => {
  it("attributes a blocked good's deficit to its single missing gating resource", () => {
    // metals needs ore; ore missing → ore gets the full deficit
    const m = unblockedDemandByResource(
      [{ goodId: "metals", rateDeficit: 10 }],
      new Set<ResourceType>(["ore"]),
    );
    expect(m.get("ore")).toBeCloseTo(10, 5);
  });

  it("splits a deficit equally across two missing gating resources", () => {
    // alloys → {ore, minerals}; both missing → 5 each
    const m = unblockedDemandByResource(
      [{ goodId: "alloys", rateDeficit: 10 }],
      new Set<ResourceType>(["ore", "minerals"]),
    );
    expect(m.get("ore")).toBeCloseTo(5, 5);
    expect(m.get("minerals")).toBeCloseTo(5, 5);
  });

  it("ignores a good whose gating resources the faction already has", () => {
    // metals needs ore; nothing missing → no attribution
    const m = unblockedDemandByResource([{ goodId: "metals", rateDeficit: 10 }], new Set());
    expect(m.size).toBe(0);
  });

  it("ignores non-positive deficits", () => {
    const m = unblockedDemandByResource(
      [{ goodId: "metals", rateDeficit: 0 }],
      new Set<ResourceType>(["ore"]),
    );
    expect(m.size).toBe(0);
  });
});
