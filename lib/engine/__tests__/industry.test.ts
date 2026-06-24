import { describe, it, expect } from "vitest";
import {
  labourDemand,
  labourFulfillment,
  housingPopCap,
  buildingProduction,
  capacityGoodRates,
  inputDemandForGood,
  buildIndustryReadout,
  facilityStorageForGood,
  extractorsByResource,
  summariseDeposits,
  summariseSpace,
  generalSpaceUsed,
  industryHealth,
  buildingHealth,
} from "@/lib/engine/industry";
import type { IndustryHealth } from "@/lib/engine/industry";
import {
  DEFAULT_LABOUR_PER_UNIT,
  DEFAULT_SPACE_COST,
  POP_CENTRE_DENSITY,
  OUTPUT_PER_UNIT,
  HOUSING_TYPE,
  EXTRACTOR_STORAGE_PER_UNIT,
  PRODUCTION_STORAGE_PER_UNIT,
  POP_CENTRE_STORAGE,
  POP_CENTRE_STORAGE_DEFAULT,
} from "@/lib/constants/industry";
import { SUBSTRATE_GEN } from "@/lib/constants/substrate-gen";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { unitResourceVector, makeResourceVector, emptyResourceVector } from "@/lib/engine/resources";

describe("labourDemand", () => {
  it("sums count × labourPerUnit across production types; housing demands none", () => {
    const buildings = { ore: 4, metals: 2, [HOUSING_TYPE]: 10 };
    expect(labourDemand(buildings)).toBeCloseTo(6 * DEFAULT_LABOUR_PER_UNIT, 6);
  });
  it("ignores buildings with a non-positive count", () => {
    expect(labourDemand({ ore: -2, metals: 3 })).toBeCloseTo(3 * DEFAULT_LABOUR_PER_UNIT, 6);
  });
});

describe("labourFulfillment", () => {
  it("is 1 when no labour is demanded", () => {
    expect(labourFulfillment(0, 0)).toBe(1);
  });
  it("is min(1, population / demand)", () => {
    expect(labourFulfillment(100, 50)).toBe(1);
    expect(labourFulfillment(50, 100)).toBeCloseTo(0.5, 6);
  });
});

describe("housingPopCap", () => {
  it("returns housing.count × POP_CENTRE_DENSITY; zero pop-centres → floor is 0", () => {
    expect(housingPopCap({ [HOUSING_TYPE]: 5, ore: 3 })).toBeCloseTo(5 * POP_CENTRE_DENSITY, 6);
    expect(housingPopCap({ [HOUSING_TYPE]: 3 })).toBeCloseTo(3 * POP_CENTRE_DENSITY, 6);
    expect(housingPopCap({ ore: 3 })).toBe(0);
  });
});

describe("buildingProduction", () => {
  it("is count × outputPerUnit × fulfillment for the matching production type (unit yields)", () => {
    const buildings = { ore: 5 };
    const yields = unitResourceVector();
    expect(buildingProduction(buildings, "ore", 1, yields)).toBeCloseTo(5 * OUTPUT_PER_UNIT["ore"], 6);
    expect(buildingProduction(buildings, "ore", 0.5, yields)).toBeCloseTo(5 * OUTPUT_PER_UNIT["ore"] * 0.5, 6);
  });
  it("is 0 for a good with no buildings", () => {
    expect(buildingProduction({ ore: 5 }, "metals", 1, unitResourceVector())).toBe(0);
  });
  it("multiplies tier-0 output by yields[resource] for ore (resource=ore)", () => {
    const buildings = { ore: 4 };
    const yields = makeResourceVector({ ore: 2.0 });
    // ore is tier-0; its resource is "ore"
    const base = buildingProduction(buildings, "ore", 1, unitResourceVector());
    const boosted = buildingProduction(buildings, "ore", 1, yields);
    expect(boosted).toBeCloseTo(base * 2.0, 6);
  });
  it("tier-1 good (metals) is NOT affected by yields regardless of ore yield", () => {
    const buildings = { metals: 3 };
    const yields = makeResourceVector({ ore: 5.0 });
    const base = buildingProduction(buildings, "metals", 1, unitResourceVector());
    const withYield = buildingProduction(buildings, "metals", 1, yields);
    expect(withYield).toBeCloseTo(base, 6);
  });
});

describe("capacityGoodRates", () => {
  it("returns one entry per good with capacity production and population consumption", () => {
    const rates = capacityGoodRates({ ore: 4 }, 1000, unitResourceVector());
    const ore = rates.find((r) => r.goodId === "ore")!;
    const food = rates.find((r) => r.goodId === "food")!;
    expect(ore.production).toBeGreaterThan(0);
    expect(ore.consumption).toBeGreaterThan(0); // everyone consumes ore a little
    expect(food.production).toBe(0); // no food buildings
    expect(food.consumption).toBeGreaterThan(0);
  });
  it("applies the tier-0 yield multiplier to ore production", () => {
    const base = capacityGoodRates({ ore: 4 }, 1000, unitResourceVector());
    const boosted = capacityGoodRates({ ore: 4 }, 1000, makeResourceVector({ ore: 3.0 }));
    const oreBase = base.find((r) => r.goodId === "ore")!.production;
    const oreBoosted = boosted.find((r) => r.goodId === "ore")!.production;
    expect(oreBoosted).toBeCloseTo(oreBase * 3.0, 6);
  });
});

describe("inputDemandForGood", () => {
  it("computes ore demand from a smelter (metals) building", () => {
    // metals recipe = { ore: 1 }. One metals building, fully staffed.
    const buildings = { metals: 4 };
    const pop = labourDemand(buildings); // exactly staffs them ⇒ fulfillment 1
    const f = labourFulfillment(pop, labourDemand(buildings));
    const yields = unitResourceVector();
    const metalsCapacity = 4 * OUTPUT_PER_UNIT["metals"] * f;
    const expectedOreDemand = metalsCapacity * GOOD_RECIPES["metals"]["ore"];
    expect(inputDemandForGood(buildings, "ore", f, yields)).toBeCloseTo(expectedOreDemand, 6);
  });

  it("returns 0 for a good nothing consumes as an input", () => {
    expect(inputDemandForGood({ metals: 4 }, "luxuries", 1, unitResourceVector())).toBe(0);
  });

  it("sums across multiple consumers of the same input", () => {
    // minerals feeds chemicals, alloys, components.
    const buildings = { chemicals: 2, alloys: 2, components: 2 };
    const f = 1;
    const yields = unitResourceVector();
    const direct =
      inputDemandForGood({ chemicals: 2 }, "minerals", f, yields) +
      inputDemandForGood({ alloys: 2 }, "minerals", f, yields) +
      inputDemandForGood({ components: 2 }, "minerals", f, yields);
    expect(inputDemandForGood(buildings, "minerals", f, yields)).toBeCloseTo(direct, 6);
  });
});

describe("generalSpaceUsed", () => {
  it("sums factory + housing footprint; excludes tier-0 extractors (deposit land)", () => {
    // ore is a tier-0 extractor (sits on a deposit slot); metals + housing sit on general space.
    expect(generalSpaceUsed({ ore: 4, metals: 2, [HOUSING_TYPE]: 5 }))
      .toBeCloseTo((2 + 5) * DEFAULT_SPACE_COST, 6);
  });
  it("ignores non-positive counts", () => {
    expect(generalSpaceUsed({ metals: -3, fuel: 2 })).toBeCloseTo(2 * DEFAULT_SPACE_COST, 6);
  });
});

describe("buildIndustryReadout", () => {
  const MIN = 5;
  // 3 metals buildings (recipe: { ore: 1 }), 5 housing.
  const buildings = { metals: 3, [HOUSING_TYPE]: 5 };
  // Population exactly staffs the metals buildings.
  const pop = labourDemand(buildings);

  it("labourFulfillment matches the helper formula", () => {
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());
    const demand = labourDemand(buildings);
    const expected = labourFulfillment(pop, demand);
    expect(readout.labourFulfillment).toBeCloseTo(expected, 6);
  });

  it("housing appears with tier -1 and no outputGood", () => {
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing).toBeDefined();
    expect(housing.tier).toBe(-1);
    expect(housing.outputGood).toBeUndefined();
    expect(housing.count).toBe(5);
  });

  it("production buildings have outputGood and correct tier", () => {
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals).toBeDefined();
    expect(metals.outputGood).toBe("metals");
    expect(metals.tier).toBe(1); // metals is tier-1
    expect(metals.count).toBe(3);
  });

  it("supplyChain entry is throttled (inputGate < 1) when ore stock is at floor", () => {
    // ore stock = MIN (nothing drawable above floor)
    const marketStock = { ore: MIN };
    const readout = buildIndustryReadout(buildings, pop, marketStock, () => MIN, unitResourceVector());
    const entry = readout.supplyChain.find((e) => e.goodId === "metals")!;
    expect(entry).toBeDefined();
    expect(entry.inputGate).toBeLessThan(1);
    expect(entry.throttledBy).toContain("ore");
  });

  it("supplyChain entry is unthrottled (inputGate === 1) when ore stock is ample", () => {
    // ore stock far above what 3 metals buildings can draw in one tick
    const fullyStaffedProduction = buildingProduction(buildings, "metals", 1, unitResourceVector());
    const oreNeeded = fullyStaffedProduction * GOOD_RECIPES["metals"]["ore"];
    const marketStock = { ore: MIN + oreNeeded * 10 };
    const readout = buildIndustryReadout(buildings, pop, marketStock, () => MIN, unitResourceVector());
    const entry = readout.supplyChain.find((e) => e.goodId === "metals")!;
    expect(entry).toBeDefined();
    expect(entry.inputGate).toBeCloseTo(1, 6);
    expect(entry.throttledBy).toHaveLength(0);
  });

  it("tier-0 goods (no recipe) are absent from supplyChain", () => {
    const readout = buildIndustryReadout({ ore: 5 }, 1000, {}, () => MIN, unitResourceVector());
    expect(readout.supplyChain.find((e) => e.goodId === "ore")).toBeUndefined();
  });

  it("supplyChain is sorted by inputGate ascending (most-throttled first)", () => {
    // Two producers: metals (ore recipe, stock at floor) and fuel (gas recipe, ample gas).
    const gasFuelProduction = buildingProduction({ fuel: 2 }, "fuel", 1, unitResourceVector());
    const gasNeeded = gasFuelProduction * GOOD_RECIPES["fuel"]["gas"];
    const stock = { ore: MIN, gas: MIN + gasNeeded * 10 };
    const readout = buildIndustryReadout(
      { metals: 3, fuel: 2, [HOUSING_TYPE]: 1 },
      pop + 2 * DEFAULT_LABOUR_PER_UNIT,
      stock,
      () => MIN,
      unitResourceVector(),
    );
    const gates = readout.supplyChain.map((e) => e.inputGate);
    for (let i = 1; i < gates.length; i++) {
      expect(gates[i]).toBeGreaterThanOrEqual(gates[i - 1]);
    }
  });

});

describe("buildIndustryReadout — per-building used + idleReason", () => {
  const MIN = 5;
  const MAX = 100;
  const MAXBAND = () => MAX;

  it("housing used = occupancy (population / POP_CENTRE_DENSITY); 'occupancy' when under-filled", () => {
    const readout = buildIndustryReadout({ [HOUSING_TYPE]: 10 }, 6 * POP_CENTRE_DENSITY, {}, () => MIN, unitResourceVector(), MAXBAND);
    const housing = readout.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
    expect(housing.used).toBeCloseTo(6, 6);
    expect(housing.idleReason).toBe("occupancy");
  });

  it("producer used = count × min(labourFulfillment, outputUptake); 'labour' when labour binds", () => {
    const buildings = { metals: 4 };
    const demand = labourDemand(buildings);
    const pop = demand * 0.5; // labour fulfillment 0.5
    // stock at the floor → output sells freely (uptake ≈ 1), so labour is the binding constraint.
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4 * 0.5, 6);
    expect(metals.idleReason).toBe("labour");
  });

  it("'selling' when output uptake binds (stock pinned at the ceiling)", () => {
    const buildings = { metals: 4 };
    const pop = labourDemand(buildings); // fully staffed
    // stock at the ceiling → output piling up (uptake ≈ 0), so selling is the binding constraint.
    const readout = buildIndustryReadout(buildings, pop, { metals: MAX }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeLessThan(4 * 0.2);
    expect(metals.idleReason).toBe("selling");
  });

  it("no idleReason when fully staffed and selling", () => {
    const buildings = { metals: 4 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, { metals: MIN }, () => MIN, unitResourceVector(), MAXBAND);
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4, 6);
    expect(metals.idleReason).toBeUndefined();
  });

  it("defaults output uptake to 1 when no maxStock band is supplied (sells freely)", () => {
    const buildings = { metals: 4 };
    const pop = labourDemand(buildings);
    const readout = buildIndustryReadout(buildings, pop, {}, () => MIN, unitResourceVector());
    const metals = readout.buildings.find((b) => b.buildingType === "metals")!;
    expect(metals.used).toBeCloseTo(4, 6); // uptake 1 → labour-only
  });
});

describe("industryHealth", () => {
  const T = 0.75; // unrestDecayThreshold
  it("is 'declining' when unrest is at/above the decay threshold (snowball)", () => {
    expect(industryHealth({ labourFulfillment: 1, unrest: 0.8, idleFraction: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("declining");
  });
  it("is 'coasting' when idle capacity is meaningful but unrest is calm", () => {
    expect(industryHealth({ labourFulfillment: 0.5, unrest: 0.1, idleFraction: 0.4, unrestDecayThreshold: T })).toBe<IndustryHealth>("coasting");
  });
  it("is 'thriving' when built ≈ used and unrest is calm", () => {
    expect(industryHealth({ labourFulfillment: 1, unrest: 0.1, idleFraction: 0.02, unrestDecayThreshold: T })).toBe<IndustryHealth>("thriving");
  });
});

describe("buildingHealth (per-building)", () => {
  const T = 0.75; // unrestDecayThreshold

  it("is 'declining' when used exceeds built (housing overshoot)", () => {
    expect(buildingHealth({ used: 12, built: 10, unrest: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("declining");
  });
  it("is 'declining' when unrest is at/above the decay threshold (teardown)", () => {
    expect(buildingHealth({ used: 10, built: 10, unrest: 0.8, unrestDecayThreshold: T })).toBe<IndustryHealth>("declining");
  });
  it("is 'declining' when idle capacity is severe (≥ IDLE_COLLAPSING_FRACTION)", () => {
    expect(buildingHealth({ used: 3, built: 10, unrest: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("declining"); // idle 0.7
  });
  it("is 'coasting' when idle is past the deadband but not severe", () => {
    expect(buildingHealth({ used: 8, built: 10, unrest: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("coasting"); // idle 0.2
  });
  it("is 'thriving' when in use within the slack deadband and calm", () => {
    expect(buildingHealth({ used: 9.5, built: 10, unrest: 0, unrestDecayThreshold: T })).toBe<IndustryHealth>("thriving"); // idle 0.05
  });
  it("is 'thriving' when nothing is built (no base to decay)", () => {
    expect(buildingHealth({ used: 0, built: 0, unrest: 1, unrestDecayThreshold: T })).toBe<IndustryHealth>("thriving");
  });
});

describe("facilityStorageForGood", () => {
  it("extractor stores its own resource good; factory stores its output", () => {
    expect(facilityStorageForGood({ ore: 3 }, "ore")).toBe(3 * EXTRACTOR_STORAGE_PER_UNIT);
    expect(facilityStorageForGood({ metals: 2 }, "metals")).toBe(2 * PRODUCTION_STORAGE_PER_UNIT);
    expect(facilityStorageForGood({ ore: 3 }, "metals")).toBe(0); // ore extractor doesn't store metals
  });
  it("population centres hold nominal-broad storage, generous on consumer goods", () => {
    expect(facilityStorageForGood({ [HOUSING_TYPE]: 5 }, "consumer_goods")).toBe(5 * POP_CENTRE_STORAGE.consumer_goods);
    expect(facilityStorageForGood({ [HOUSING_TYPE]: 5 }, "ore")).toBe(5 * POP_CENTRE_STORAGE_DEFAULT); // consumed staple, default
  });
  it("a population centre stores nothing for a good no one consumes", () => {
    // Every real good has a GOOD_CONSUMPTION entry, so this guards the defensive
    // zero-branch: an unknown / non-consumed good gets no pop-centre storage.
    expect(facilityStorageForGood({ [HOUSING_TYPE]: 5 }, "unobtainium")).toBe(0);
  });
  it("sums across a mixed build-out", () => {
    expect(facilityStorageForGood({ ore: 2, [HOUSING_TYPE]: 4 }, "ore"))
      .toBe(2 * EXTRACTOR_STORAGE_PER_UNIT + 4 * POP_CENTRE_STORAGE_DEFAULT);
  });
});

describe("extractorsByResource", () => {
  it("sums tier-0 extractor counts by their deposit resource; ignores factories and housing", () => {
    // ore → ore; food + textiles both → arable (shared deposit); metals is tier-1; housing has no resource.
    const v = extractorsByResource({ ore: 3, food: 1, textiles: 2, metals: 5, [HOUSING_TYPE]: 9 });
    expect(v.ore).toBe(3);
    expect(v.arable).toBe(3);
    expect(v.gas).toBe(0);
  });
  it("ignores non-positive counts", () => {
    expect(extractorsByResource({ ore: -2, gas: 4 }).ore).toBe(0);
    expect(extractorsByResource({ ore: -2, gas: 4 }).gas).toBe(4);
  });
});

describe("summariseSpace", () => {
  it("partitions available into deposit/general/habitable and tracks built land per partition", () => {
    // available 100, general 40 → deposit 60; habitable 10.
    // ore×4 extractors sit on deposit land; metals×2 factories + housing×5 sit on general; housing also on habitable.
    const space = summariseSpace(100, 40, 10, { ore: 4, metals: 2, [HOUSING_TYPE]: 5 });
    expect(space.available).toBe(100);
    expect(space.general).toBe(40);
    expect(space.habitable).toBe(10);
    expect(space.deposit).toBe(60);
    expect(space.depositWorked).toBeCloseTo(4 * SUBSTRATE_GEN.DEPOSIT_SLOT_FOOTPRINT, 6);
    expect(space.generalUsed).toBeCloseTo((2 + 5) * DEFAULT_SPACE_COST, 6);
    expect(space.habitableUsed).toBeCloseTo(5 * DEFAULT_SPACE_COST, 6);
  });
  it("clamps deposit to zero when general exceeds available (degenerate input)", () => {
    expect(summariseSpace(10, 40, 5, {}).deposit).toBe(0);
  });
});

describe("summariseDeposits", () => {
  it("summarises present deposits: slot cap, worked slots, effective yield + its band", () => {
    const slotCap = makeResourceVector({ ore: 12, gas: 2 });
    const worked = makeResourceVector({ ore: 5, gas: 0 });
    const yields = makeResourceVector({ ore: 1.55, gas: 1 }); // ore 1.55 → "good"; gas unworked 1.0 → "average"
    const deposits = summariseDeposits(slotCap, worked, yields);
    // Only ore + gas have slots; sorted by slotCap descending → ore first.
    expect(deposits.map((d) => d.resource)).toEqual(["ore", "gas"]);
    const ore = deposits[0];
    expect(ore.slotCap).toBe(12);
    expect(ore.worked).toBe(5);
    expect(ore.yieldMult).toBeCloseTo(1.55, 6);
    expect(ore.band).toBe("good"); // 1.55 ≤ 1.8
    // Gas: unworked, neutral yield 1.0 → "average".
    expect(deposits[1].worked).toBe(0);
    expect(deposits[1].band).toBe("average");
  });
  it("excludes resources with no deposit slots", () => {
    expect(summariseDeposits(emptyResourceVector(), emptyResourceVector(), unitResourceVector())).toEqual([]);
  });
});
