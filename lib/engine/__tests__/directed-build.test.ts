import { describe, it, expect } from "vitest";
import { systemBuildGeneration, findStructuralDeficits, buildableUnits, buildableOutput, planFactionBuilds, supplyDissatisfaction, fedAndCalm, habitableHousingHeadroom, plannedHousingUnits, type BuildSystemState, type PlannedBuild } from "@/lib/engine/directed-build";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import { OUTPUT_PER_UNIT } from "@/lib/constants/industry";
import type { RouteCost } from "@/lib/engine/directed-logistics";

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
  good: { goodId: string; stock: number; targetStock: number; demand: number },
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
    // pop 100 fully absorbed by 4 ore extractors (4 × 25 = 100 labour) → spareLabour 0.
    const builds = planFactionBuilds(deficitAndBuilder(100, { ore: 4 }), () => 1);
    expect(countFor(builds, "B", "ore")).toBe(0);
  });

  it("caps industry at the spare labour the resident population supports", () => {
    // pop 200, 4 ore extractors demand 100 → spareLabour 100 → ≤ 100/25 = 4 new units.
    const builds = planFactionBuilds(deficitAndBuilder(200, { ore: 4 }), () => 1);
    const built = countFor(builds, "B", "ore");
    expect(built).toBeGreaterThan(0);
    expect(built).toBeLessThanOrEqual(4 + 1e-9);
  });
});

describe("planFactionBuilds — idle at potential & barren worlds", () => {
  it("builds nothing at a system already at its potential", () => {
    // Housing fills the habitable cap (5 units → popCap 100); population 100 == popCap and
    // == labourDemand (4 ore × 25), so spareLabour 0; ore market balanced → no deficit.
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
      buildings: { ore: 0.12 }, // 0.12 × 25 = 3 labour == population → spareLabour 0
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
