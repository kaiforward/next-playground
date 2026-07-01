import { describe, it, expect } from "vitest";
import { systemBuildGeneration, findStructuralDeficits, buildableUnits, buildableOutput, planFactionBuilds, supplyDissatisfaction, fedAndCalm, habitableHousingHeadroom, plannedHousingUnits, type BuildSystemState, type PlannedBuild } from "@/lib/engine/directed-build";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import { OUTPUT_PER_UNIT, BUILDING_TYPES, labourTotal, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE } from "@/lib/constants/industry";
import { labourDemand } from "@/lib/engine/industry";
import type { RouteCost } from "@/lib/engine/directed-logistics";

/** ore's total per-unit head count (labour.unskilled + skill1 + skill2) — shared across fixtures. */
const oreLabour = labourTotal(BUILDING_TYPES.ore!.labour!);

function sysWith(partial: Partial<BuildSystemState>): BuildSystemState {
  return {
    systemId: "X", factionId: "f1", population: 100, unrest: 0, buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0, goods: [],
    ...partial,
  };
}

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
  good: { goodId: string; stock: number; targetStock: number; demand: number; production?: number },
): BuildSystemState {
  return {
    systemId, factionId: "f1", population: 100, unrest: 0, buildings: {},
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

  it("does not flag a self-supplier (production ≥ demand) as a deficit despite low standing stock", () => {
    // Low stock but produces at least its own demand → throughput, not need. Mirrors the
    // logistics matcher's self-supply gate: building more capacity for a good a system already
    // makes piles stock to the ceiling and decays its own producers.
    const selfSupplier = buildSys("A", { goodId: "ore", stock: 1, targetStock: 20, demand: 5, production: 10 });
    expect(findStructuralDeficits([selfSupplier], reachable)).toHaveLength(0);
  });

  it("still flags a net importer (production < demand) with low stock as structural", () => {
    const importer = buildSys("A", { goodId: "ore", stock: 1, targetStock: 20, demand: 5, production: 2 });
    expect(findStructuralDeficits([importer], reachable)).toHaveLength(1);
  });

  it("excludes a deficit when a reachable structural producer (below the 1.4× margin) can supply it", () => {
    // B produces 30 > demand 5 → structural exporter; stock 110 = 1.1× anchor 100, BELOW the 1.4×
    // margin. Directed logistics can now donate from it, so A's deficit is not structural — the build
    // planner must read 'surplus' the same way the matcher does, or it builds redundant capacity for
    // a good logistics already delivers.
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4 });
    const producer = buildSys("B", { goodId: "food", stock: 110, targetStock: 100, demand: 5, production: 30 });
    expect(findStructuralDeficits([deficit, producer], reachable)).toHaveLength(0);
  });
});

// A tier-0 good (food → arable) with deposit slots; sys has space but partial build.
function tier0Sys(builtFood: number, foodSlots: number): BuildSystemState {
  const slotCap = emptyResourceVector();
  // food's resource is arable — set via the building catalog's resource at runtime in the impl;
  // here we set every resource's cap so the test is independent of the food→resource mapping.
  for (const k of RESOURCE_TYPES) slotCap[k] = foodSlots;
  return {
    systemId: "A", factionId: "f1", population: 100, unrest: 0,
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
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    expect(buildableUnits(sys, "metals")).toBeGreaterThan(0);
  });

  it("reduces tier-1+ capacity by space already used by existing buildings", () => {
    const full: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: { metals: 100 },
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    // metals occupies general space; with 100 units already built, ~no room left.
    expect(buildableUnits(full, "metals")).toBeCloseTo(0);
  });

  it("returns zero capacity for an unknown good not in GOOD_TIER_BY_KEY", () => {
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    // "not_a_real_good" is not in GOOD_TIER_BY_KEY; should return 0, not divide by default footprint
    expect(buildableUnits(sys, "not_a_real_good")).toBe(0);
  });
});

function countFor(builds: PlannedBuild[], systemId: string, type: string): number {
  return builds.filter((b) => b.systemId === systemId && b.buildingType === type)
    .reduce((sum, b) => sum + b.count, 0);
}

describe("planFactionBuilds", () => {
  it("builds tier-0 production at a site that can serve a reachable structural deficit", () => {
    // A: structural food deficit (no surplus anywhere). B: has arable slots + population budget, reachable from A.
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 10, targetStock: 10, demand: 5 }],
    };
    const builds = planFactionBuilds([deficit, builder], () => 1);
    expect(countFor(builds, "B", "food")).toBeGreaterThan(0);
    // Proactive housing accompanies the build (B is fed and calm with habitable land).
    expect(countFor(builds, "B", "housing")).toBeGreaterThan(0);
  });

  it("does not build where the good's deficit already has a reachable surplus", () => {
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const surplus: BuildSystemState = {
      systemId: "S", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 100, targetStock: 20, demand: 5 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 50, goods: [],
    };
    const builds = planFactionBuilds([deficit, surplus, builder], () => 1);
    expect(countFor(builds, "B", "food")).toBe(0);
  });

  it("gates a tier-1+ build until its inputs are locally produced (the cascade)", () => {
    // A: structural metals deficit. B: general space + budget but NO ore production and no reachable ore surplus.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "metals", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builderNoInput: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50, goods: [],
    };
    expect(countFor(planFactionBuilds([deficit, builderNoInput], () => 1), "B", "metals")).toBe(0);

    // Same, but B locally produces ore → the metals factory becomes eligible.
    const builderWithInput: BuildSystemState = {
      ...builderNoInput, buildings: { ore: 5 },
    };
    expect(countFor(planFactionBuilds([deficit, builderWithInput], () => 1), "B", "metals")).toBeGreaterThan(0);
  });

  it("builds proactive housing (no production) at a fed system with no structural deficits", () => {
    const fed: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 10, targetStock: 10, demand: 5 }],
    };
    const builds = planFactionBuilds([fed], () => 1);
    expect(countFor(builds, "A", "housing")).toBeGreaterThan(0);
    expect(builds.every((b) => b.buildingType === "housing")).toBe(true);
  });

  it("serves two distinct structural deficits across multiple greedy iterations", () => {
    // A: structural food deficit (no food surplus reachable — food not produced at B or C).
    // B: structural water deficit (no water surplus reachable — water not produced at A or C).
    // C: the builder — large population (ample budget), full deposit slots, general + habitable
    //    space, no goods of its own. Reachable from both A and B (cost 1).
    //
    // Iteration 1 of the greedy loop: both (C, food) and (C, water) are candidates.
    //   Both score identically (same shortfall, same cost). Whichever wins is built at C.
    // Iteration 2: the other good still has remaining structural deficit; (C, other-good) is
    //   picked and built. The test FAILS if the loop only runs once — only one good would
    //   appear in builds, and the expect for the other good would be 0.
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;

    const deficitFood: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const deficitWater: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 0, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "water", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builder: BuildSystemState = {
      systemId: "C", factionId: "f1", population: 10000, unrest: 0, buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 50,
      goods: [],
    };

    const builds = planFactionBuilds([deficitFood, deficitWater, builder], () => 1);

    // Both goods must be built at C, requiring at least two greedy iterations.
    expect(countFor(builds, "C", "food")).toBeGreaterThan(0);
    expect(countFor(builds, "C", "water")).toBeGreaterThan(0);
    // Proactive housing also appears (C is fed and calm with habitable headroom).
    expect(countFor(builds, "C", "housing")).toBeGreaterThan(0);
  });
});

describe("planFactionBuilds — tier-1+ input reachability", () => {
  // metals (tier-1, recipe { ore }) is a structural deficit at A; builder B has space + budget
  // but no local ore; an ore surplus sits at S. A metals factory may be built at B only if B can
  // actually RECEIVE ore — i.e. S is reachable from B — because logistics delivery (which feeds
  // the factory's inputs) is route-cost bounded. A faction-wide "ore surplus exists somewhere"
  // test would wrongly green-light a factory whose inputs can never arrive.
  function scenario(): { deficit: BuildSystemState; builder: BuildSystemState; oreSurplus: BuildSystemState } {
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    return {
      deficit: {
        systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "metals", stock: 1, targetStock: 20, demand: 5 }],
      },
      builder: {
        systemId: "B", factionId: "f1", population: 200, unrest: 0, buildings: {},
        slotCap, generalSpace: 50, habitableSpace: 0, goods: [],
      },
      oreSurplus: {
        systemId: "S", factionId: "f1", population: 100, unrest: 0, buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "ore", stock: 100, targetStock: 20, demand: 5, production: 0 }],
      },
    };
  }

  it("does not build a tier-1+ factory when its input surplus is unreachable from the site", () => {
    const { deficit, builder, oreSurplus } = scenario();
    // B can reach the deficit A (so it could serve it), but the ore source S is unreachable from B.
    const routeCost: RouteCost = (from, to) => (from === "S" || to === "S" ? null : 1);
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], routeCost), "B", "metals")).toBe(0);
  });

  it("builds a tier-1+ factory when its input surplus is reachable from the site (not just locally produced)", () => {
    const { deficit, builder, oreSurplus } = scenario();
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1), "B", "metals")).toBeGreaterThan(0);
  });

  it("greenlights the factory when the only input source is a structural producer below the 1.4× margin", () => {
    // S holds ore at stock 22 = 1.1× its anchor 20 (BELOW the 1.4× margin of 28), but produces
    // 30 > demand 5 → a structural exporter. The input gate must read 'surplus' via surplusDrawable
    // exactly as the logistics matcher does, or the planner refuses a factory whose inputs the
    // production-throttled exporter can in fact supply (the regression this branch guards against).
    const { deficit, builder, oreSurplus } = scenario();
    oreSurplus.goods = [{ goodId: "ore", stock: 22, targetStock: 20, demand: 5, production: 30 }];
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1), "B", "metals")).toBeGreaterThan(0);
  });

  it("does not greenlight the factory when the in-band input holder is a non-producer (no phantom source)", () => {
    // Same stock 22 in the 1.0–1.4× band, but production 0 → sitting on imported inventory, not a
    // structural exporter. surplusDrawable returns 0, so ore is not a reachable input and no metals
    // factory is built — mirroring the matcher's re-export guard at the build-planner gate.
    const { deficit, builder, oreSurplus } = scenario();
    oreSurplus.goods = [{ goodId: "ore", stock: 22, targetStock: 20, demand: 5, production: 0 }];
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1), "B", "metals")).toBe(0);
  });
});

describe("planFactionBuilds — proactive housing", () => {
  it("does not build housing at a starved system", () => {
    const starved: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 100 }],
    };
    expect(countFor(planFactionBuilds([starved], () => 1), "A", "housing")).toBe(0);
  });

  it("does not build housing at an unsettled (high-unrest) system", () => {
    const unsettled: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0.9, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    };
    expect(countFor(planFactionBuilds([unsettled], () => 1), "A", "housing")).toBe(0);
  });

  it("never builds housing past the habitable cap", () => {
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100000, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 1000, habitableSpace: 5,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    };
    const housing = countFor(planFactionBuilds([sys], () => 1), "A", "housing");
    expect(housing).toBeGreaterThan(0);
    expect(housing).toBeLessThanOrEqual(5); // habitableSpace 5 ÷ spaceCost 1
  });

  it("does not co-build housing on the industry path (housing comes only from the housing pass)", () => {
    // Builder has NO habitable land: the housing pass cannot fire, so any housing here
    // would be the deleted co-build. Expect production, zero housing.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 0,
      goods: [],
    };
    const builds = planFactionBuilds([deficit, builder], () => 1);
    expect(countFor(builds, "B", "food")).toBeGreaterThan(0);
    expect(countFor(builds, "B", "housing")).toBe(0);
  });
});

describe("planFactionBuilds performance", () => {
  // A major faction at 10k scale owns hundreds of fully-populated systems, each
  // with structural deficits AND build capacity, all mutually reachable. That is
  // the worst case the live processor faces; an 837-system faction took 93s under
  // the naive per-iteration re-scan. This guards the planner against re-introducing
  // a super-linear (builds × sites × deficits) blowup.
  function makeLargeFaction(n: number): BuildSystemState[] {
    const goods = ["food", "water", "ore", "gas", "minerals", "biomass"];
    const systems: BuildSystemState[] = [];
    for (let i = 0; i < n; i++) {
      const slotCap = emptyResourceVector();
      for (const k of RESOURCE_TYPES) slotCap[k] = 5;
      systems.push({
        systemId: `S${i}`,
        factionId: "f1",
        population: 100,
        unrest: 0,
        buildings: {},
        slotCap,
        generalSpace: 50,
        habitableSpace: 50,
        // Two distinct structural deficits per system (no surplus anywhere → all structural).
        goods: [
          { goodId: goods[i % goods.length], stock: 1, targetStock: 20, demand: 5 },
          { goodId: goods[(i + 1) % goods.length], stock: 1, targetStock: 20, demand: 5 },
        ],
      });
    }
    return systems;
  }

  it("plans a 500-system faction well within the tick budget", () => {
    const systems = makeLargeFaction(500);
    const t0 = performance.now();
    const builds = planFactionBuilds(systems, () => 1);
    const ms = performance.now() - t0;
    // It must actually do the work (not early-exit), and do it fast.
    expect(builds.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  }, 120_000);
});

describe("supplyDissatisfaction", () => {
  it("is ~0 when every demanded good sits at or above target", () => {
    const d = supplyDissatisfaction([
      { goodId: "food", stock: 20, targetStock: 20, demand: 10 },
      { goodId: "water", stock: 30, targetStock: 20, demand: 8 },
    ]);
    expect(d).toBeCloseTo(0);
  });

  it("is high when a heavily-demanded good is far below target", () => {
    const d = supplyDissatisfaction([
      { goodId: "food", stock: 1, targetStock: 20, demand: 100 },
      { goodId: "luxuries", stock: 10, targetStock: 10, demand: 1 },
    ]);
    expect(d).toBeGreaterThan(0.5);
  });

  it("returns 0 when nothing is demanded", () => {
    expect(supplyDissatisfaction([])).toBe(0);
    expect(supplyDissatisfaction([{ goodId: "ore", stock: 0, targetStock: 0, demand: 0 }])).toBe(0);
  });
});

describe("fedAndCalm", () => {
  const fedGoods = [{ goodId: "food", stock: 20, targetStock: 20, demand: 10 }];

  it("is true for a well-supplied, calm system", () => {
    expect(fedAndCalm(sysWith({ goods: fedGoods, unrest: 0 }))).toBe(true);
  });

  it("is false when stored unrest exceeds the calm threshold", () => {
    expect(fedAndCalm(sysWith({ goods: fedGoods, unrest: DIRECTED_BUILD.UNREST_SETTLE + 0.1 }))).toBe(false);
  });

  it("is false when the system is starved (high supply dissatisfaction)", () => {
    const starved = [{ goodId: "food", stock: 1, targetStock: 20, demand: 100 }];
    expect(fedAndCalm(sysWith({ goods: starved, unrest: 0 }))).toBe(false);
  });
});

describe("habitableHousingHeadroom", () => {
  it("returns the min of remaining habitable and remaining general, in housing units", () => {
    expect(habitableHousingHeadroom(sysWith({ generalSpace: 100, habitableSpace: 40 }))).toBeCloseTo(40);
  });

  it("subtracts existing housing from both habitable and general", () => {
    const sys = sysWith({ generalSpace: 100, habitableSpace: 40, buildings: { housing: 10 } });
    expect(habitableHousingHeadroom(sys)).toBeCloseTo(30); // habitable 40 - 10 = 30 binds
  });

  it("is bounded by remaining general space when factories crowd it", () => {
    const sys = sysWith({ generalSpace: 20, habitableSpace: 50, buildings: { metals: 15 } });
    expect(habitableHousingHeadroom(sys)).toBeCloseTo(5); // general 20 - 15 = 5 binds
  });
});

describe("plannedHousingUnits", () => {
  it("paces housing a settle-margin ahead of population", () => {
    // pop 100, no housing, ample habitable → target popCap = 100 × 1.25 = 125 → 6.25 housing.
    const units = plannedHousingUnits(sysWith({
      population: 100, buildings: {}, generalSpace: 100, habitableSpace: 100,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }));
    expect(units).toBeCloseTo(125 / 20 - 0); // 6.25
  });

  it("returns 0 when the system is not fed and calm", () => {
    expect(plannedHousingUnits(sysWith({
      population: 100, generalSpace: 100, habitableSpace: 100, unrest: 0.9,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }))).toBe(0);
  });

  it("returns 0 at the habitable cap (no headroom)", () => {
    expect(plannedHousingUnits(sysWith({
      population: 100, buildings: { housing: 50 }, generalSpace: 100, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }))).toBe(0);
  });

  it("never targets more housing than the habitable land allows", () => {
    // Huge pop, tiny habitable: housing is bounded by habitable (5 units), not population.
    const units = plannedHousingUnits(sysWith({
      population: 100000, buildings: {}, generalSpace: 1000, habitableSpace: 5,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }));
    expect(units).toBeCloseTo(5);
  });
});

describe("planFactionBuilds — spare-labour gate", () => {
  // A: ore-starved consumer (pop 0). B: builder with ore slots + general space but NO
  // habitable land (so the housing pass never interferes — this isolates industry).
  function deficitAndBuilder(builderPop: number, builderBuildings: Record<string, number>): BuildSystemState[] {
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    return [
      {
        systemId: "A", factionId: "f1", population: 0, unrest: 0, buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "ore", stock: 1, targetStock: 50, demand: 50 }],
      },
      {
        systemId: "B", factionId: "f1", population: builderPop, unrest: 0, buildings: builderBuildings,
        slotCap, generalSpace: 50, habitableSpace: 0, goods: [],
      },
    ];
  }

  it("builds no industry when the builder has no spare labour", () => {
    // pop fully absorbed by 4 ore extractors (4 × oreLabour) → spareLabour 0.
    const builds = planFactionBuilds(deficitAndBuilder(4 * oreLabour, { ore: 4 }), () => 1);
    expect(countFor(builds, "B", "ore")).toBe(0);
  });

  it("caps industry at the spare labour the resident population supports", () => {
    // pop = 2× the 4 extractors' labour demand → spareLabour == demand → ≤ demand/oreLabour = 4 new units.
    const builds = planFactionBuilds(deficitAndBuilder(8 * oreLabour, { ore: 4 }), () => 1);
    const built = countFor(builds, "B", "ore");
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThanOrEqual(4 + 1e-9);
  });
});

describe("planFactionBuilds — idle at potential & barren worlds", () => {
  it("builds nothing at a system already at its potential", () => {
    // Housing fills the habitable cap (5 units → popCap 100); ore market already balanced
    // (stock 50 == target) → no structural deficit regardless of spare labour.
    const slotCap = emptyResourceVector();
    slotCap.ore = 4;
    const atPotential: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0,
      buildings: { housing: 5, ore: 4 },
      slotCap, generalSpace: 9, habitableSpace: 5,
      goods: [{ goodId: "ore", stock: 50, targetStock: 50, demand: 20 }],
    };
    expect(planFactionBuilds([atPotential], () => 1)).toHaveLength(0);
  });

  it("does not work deposit slots on a barren, low-habitable world", () => {
    // 56 ore slots but ~no habitable land → can't house labour → spareLabour 0 → no extraction.
    const slotCap = emptyResourceVector();
    slotCap.ore = 56;
    const barren: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 3, unrest: 0,
      buildings: { ore: 3 / oreLabour }, // ore count × oreLabour == population → spareLabour 0
      slotCap, generalSpace: 60, habitableSpace: 0.001,
      goods: [],
    };
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, unrest: 0, buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 1, targetStock: 50, demand: 50 }],
    };
    expect(countFor(planFactionBuilds([barren, deficit], () => 1), "B", "ore")).toBe(0);
  });
});

// A route function with a real self-cost distinction: 0 for a system reaching itself (never
// counted as "reachable" by the opportunity loop, which requires cost > 0), 1 between systems.
const selfAndNeighbourRoute: RouteCost = (from, to) => (from === to ? 0 : 1);

// Neighbour "A" carries a structural deficit of `goodId` with no reachable surplus anywhere
// (mirrors the file's existing deficit fixtures: stock 1, target 20, demand 5 → shortfall 19).
function deficitOnly(goodId: string): BuildSystemState {
  return {
    systemId: "A", factionId: "f1", population: 0, unrest: 0, buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId, stock: 1, targetStock: 20, demand: 5 }],
  };
}

// Electronics (tier-2, recipe { components, chemicals }) is a structural deficit at neighbour A;
// site B has ample population, general space, unrest 0, and locally produces both recipe inputs
// (so the input-reachability gate passes without needing a third surplus system) — but no
// academies yet, so both skill-1 and skill-2 ceilings must be lifted to serve the deficit.
function makeElectronicsDeficitWithCapableSite(): BuildSystemState[] {
  const capable: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 500, unrest: 0,
    buildings: { components: 5, chemicals: 5 },
    slotCap: emptyResourceVector(), generalSpace: 200, habitableSpace: 0,
    goods: [],
  };
  return [deficitOnly("electronics"), capable];
}

// Ore (tier-0, no recipe, no skill draw) is a structural deficit at neighbour A; site B has
// deposit slots + population to extract it, but ZERO general space — a barren mining outpost.
// Tier-0 extraction sits on dedicated deposit slots, not general space, so it must still build
// here; without the tier-0 general-space exemption this fixture would build nothing. No academy
// should ever be built for a tier-0 good.
function makeOreDeficitWithCapableSite(): BuildSystemState[] {
  const slotCap = emptyResourceVector();
  for (const k of RESOURCE_TYPES) slotCap[k] = 10;
  const capable: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 300, unrest: 0, buildings: {},
    slotCap, generalSpace: 0, habitableSpace: 0, goods: [],
  };
  return [deficitOnly("ore"), capable];
}

// Metals (tier-1, recipe { ore }, skill1-only) is a structural deficit at neighbour A; site B
// locally produces ore (input-reachable) and already has 10 vocational schools built —
// skill1Cap (1500) dwarfs any post-build skill1Demand this budget could possibly add, so the
// existing ceiling already covers the build and no new school should be built.
function makeTier1DeficitWithSchoolsAlready(): BuildSystemState[] {
  const capable: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 300, unrest: 0,
    buildings: { ore: 5, [VOCATIONAL_SCHOOL_TYPE]: 10 },
    slotCap: emptyResourceVector(), generalSpace: 100, habitableSpace: 0,
    goods: [],
  };
  return [deficitOnly("metals"), capable];
}

// Reconstructs one system's final building counts by applying the builds the planner emitted
// for it onto its initial buildings — for asserting post-hoc physical limits (e.g. labour) the
// planner must never violate, without duplicating its internal working-copy bookkeeping.
function applyBuilds(initial: Record<string, number>, builds: PlannedBuild[], systemId: string): Record<string, number> {
  const result = { ...initial };
  for (const b of builds) {
    if (b.systemId !== systemId) continue;
    result[b.buildingType] = (result[b.buildingType] ?? 0) + b.count;
  }
  return result;
}

describe("academy co-build", () => {
  it("builds the institute needed to run a tier-2 good that serves a reachable deficit", () => {
    // One site with population + space + tier-2 inputs available, but no academies, and a
    // reachable electronics deficit. Planner must emit vocational_school + research_institute
    // builds (electronics draws both skill1 and skill2) alongside the electronics build.
    const systems = makeElectronicsDeficitWithCapableSite();
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute);
    const byType = new Map<string, number>();
    for (const b of builds) byType.set(b.buildingType, (byType.get(b.buildingType) ?? 0) + b.count);
    expect(byType.get("electronics") ?? 0).toBeGreaterThan(0);
    expect(byType.get(VOCATIONAL_SCHOOL_TYPE) ?? 0).toBeGreaterThan(0);   // electronics needs skill1 too
    expect(byType.get(RESEARCH_INSTITUTE_TYPE) ?? 0).toBeGreaterThan(0);  // and skill2

    // Population is a single pool that staffs ALL labour (unskilled + skill1 + skill2 heads) —
    // the planner must never commit more total labour demand than the site's population supplies.
    const site = systems.find((s) => s.systemId === "B")!;
    const finalBuildings = applyBuilds(site.buildings, builds, "B");
    expect(labourDemand(finalBuildings)).toBeLessThanOrEqual(site.population + 1e-9);
  });

  it("does not build academies when the deficit good is tier-0 (no skill draw)", () => {
    const systems = makeOreDeficitWithCapableSite();
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute);
    expect(countFor(builds, "B", "ore")).toBeGreaterThan(0); // the build actually happens
    expect(builds.some((b) => b.buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);
    expect(builds.some((b) => b.buildingType === RESEARCH_INSTITUTE_TYPE)).toBe(false);
  });

  it("builds no academy when the existing skill ceiling already covers the build", () => {
    const systems = makeTier1DeficitWithSchoolsAlready(); // skill1Cap already ≥ post-build skill1Demand
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute);
    expect(countFor(builds, "B", "metals")).toBeGreaterThan(0); // the build actually happens
    expect(builds.some((b) => b.buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);

    // Same over-commit guard as the tier-2 case: metals draws a full labourTotal per unit
    // (unskilled + skill1), not just its unskilled slice.
    const site = systems.find((s) => s.systemId === "B")!;
    const finalBuildings = applyBuilds(site.buildings, builds, "B");
    expect(labourDemand(finalBuildings)).toBeLessThanOrEqual(site.population + 1e-9);
  });
});
