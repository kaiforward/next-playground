import { describe, it, expect } from "vitest";
import { findStructuralDeficits, buildableUnits, buildableOutput, speculativeFloorExtra, planFactionBuilds, planFactionProposals, planFactionColonyProposals, factionGoodDeficits, supplyDissatisfaction, fedAndCalm, habitableHousingHeadroom, plannedHousingUnits, hopRouteCost, sizeColonyEstablish, type BuildSystemState, type BuildGoodState, type PlannedBuild, type Proposal, type ColonyEstablishCandidate, type ColonyEstablishParams } from "@/lib/engine/directed-build";
import { systemDevelopment, type DevelopmentRefs } from "@/lib/engine/development";
import { workCostPerLevel } from "@/lib/constants/construction";
import type { WorldConstructionProject, WorldColonyEstablishProject } from "@/lib/world/types";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { emptyResourceVector, unitResourceVector, makeResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import { OUTPUT_PER_UNIT, BUILDING_TYPES, labourTotal, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, COMPLEX_TYPES, HEAVY_INDUSTRY_COMPLEX, ANCHOR_MIN_THROUGHPUT, ANCHOR_FOOTPRINT, effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { TARGET_COVER } from "@/lib/constants/market-economy";
import { labourDemand } from "@/lib/engine/industry";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import type { ResourceVector } from "@/lib/types/game";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";

/** ore's total per-unit head count (labour.unskilled + skill1 + skill2) — shared across fixtures. */
const oreLabour = labourTotal(BUILDING_TYPES.ore!.labour!);

/**
 * A fixed universe-wide development reference for the planner's unit tests. `systemDevelopment` (which
 * the speculative nudge scales by) reads this instead of deriving it per-galaxy, so these logic tests
 * stay deterministic; the universe-wide derivation itself is covered in development.test.ts.
 */
const DEV_REFS: DevelopmentRefs = { popRef: 150, industryRef: 12 };

function sysWith(partial: Partial<BuildSystemState>): BuildSystemState {
  return {
    systemId: "X", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0, goods: [],
    ...partial,
  };
}

function buildSys(
  systemId: string,
  good: { goodId: string; stock: number; targetStock: number; demand: number; production?: number },
): BuildSystemState {
  return {
    systemId, factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0, goods: [good],
  };
}

const reachable: RouteCost = () => 1;
const unreachable: RouteCost = () => null;

describe("findStructuralDeficits", () => {
  it("flags a good with production below demand as a structural rate deficit", () => {
    // demand 4, production 0 → rateDeficit 4. Stock/targetStock are irrelevant to placement now.
    const deficit = buildSys("A", { goodId: "electronics", stock: 1, targetStock: 10, demand: 4, production: 0 });
    const out = findStructuralDeficits([deficit], reachable);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ systemId: "A", goodId: "electronics", rateDeficit: 4, demand: 4 });
  });

  it("flags a rate deficit even when the stock buffer is full (stock decoupled from placement)", () => {
    // Full stock (>= targetStock) but production 1 < demand 4 → still a structural rate deficit:
    // the buffer is draining. This is the core B behaviour — TARGET_COVER no longer gates builds.
    const drainingButStocked = buildSys("A", { goodId: "food", stock: 500, targetStock: 100, demand: 4, production: 1 });
    const out = findStructuralDeficits([drainingButStocked], reachable);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ goodId: "food", rateDeficit: 3 });
  });

  it("excludes a deficit when a reachable rate exporter (production > demand) of that good exists", () => {
    // B produces 30 > its own demand 4 → a sustainable exporter whose surplus flow logistics carries.
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4, production: 0 });
    const exporter = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 30 });
    expect(findStructuralDeficits([deficit, exporter], reachable)).toHaveLength(0);
  });

  it("does NOT exclude a deficit when the only nearby stock is a draining pile (production < demand)", () => {
    // B holds 100 stock but produces nothing (production 0 < demand 4) → it is itself draining, not a
    // sustainable source. A must still build its own capacity; logistics ships B's transient stock meanwhile.
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4, production: 0 });
    const drainingPile = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 0 });
    // Both A and B are rate deficits (neither produces its own demand); neither excludes the other.
    expect(findStructuralDeficits([deficit, drainingPile], reachable)).toHaveLength(2);
  });

  it("keeps a deficit structural when the only exporter is unreachable", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4, production: 0 });
    const exporter = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 30 });
    // Only A is a deficit (B is an exporter); it stays structural because the exporter can't reach it.
    expect(findStructuralDeficits([deficit, exporter], unreachable)).toHaveLength(1);
  });

  it("does not flag a self-supplier (production ≥ demand) as a deficit despite low standing stock", () => {
    const selfSupplier = buildSys("A", { goodId: "ore", stock: 1, targetStock: 20, demand: 5, production: 10 });
    expect(findStructuralDeficits([selfSupplier], reachable)).toHaveLength(0);
  });

  it("still flags a net importer (production < demand) as structural", () => {
    const importer = buildSys("A", { goodId: "ore", stock: 1, targetStock: 20, demand: 5, production: 2 });
    const out = findStructuralDeficits([importer], reachable);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ rateDeficit: 3 });
  });
});

describe("findStructuralDeficits — flow-aware coverage netting (§3.1)", () => {
  it("leaves a residual structural deficit when a reachable exporter only partly covers demand", () => {
    // A needs 10/tick, produces none. B exports a spare rate of only 3 (prod 7 − demand 4).
    // coveredFraction = min(1, 3/10) = 0.3 → residual = 10 × 0.7 = 7 is still structural (build locally).
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 10, production: 0 });
    const partialExporter = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 7 });
    const out = findStructuralDeficits([deficit, partialExporter], reachable);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ systemId: "A", goodId: "food" });
    expect(out[0].rateDeficit).toBeCloseTo(7, 5);
  });

  it("cancels the deficit entirely when the exporter's spare rate fully covers it", () => {
    // B's spare rate 16 (prod 20 − demand 4) ≥ A's 10 deficit → coveredFraction 1 → no residual.
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 10, production: 0 });
    const ampleExporter = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 20 });
    expect(findStructuralDeficits([deficit, ampleExporter], reachable)).toHaveLength(0);
  });

  it("nets one exporter's spare across competing consumers (no double-coverage)", () => {
    // Two colonies each need 10; one exporter has spare rate 6. The 6 is shared across the 20 of total
    // reachable demand — coveredFraction = 6/20 = 0.3 — so each keeps a 7 residual (not each fully covered).
    const a = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 10, production: 0 });
    const c = buildSys("C", { goodId: "food", stock: 1, targetStock: 10, demand: 10, production: 0 });
    const exporter = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 10 });
    const out = findStructuralDeficits([a, c, exporter], reachable);
    expect(out).toHaveLength(2);
    for (const d of out) expect(d.rateDeficit).toBeCloseTo(7, 5);
  });
});

describe("speculativeFloorExtra — development-scaled local-basics nudge (§3.2)", () => {
  // A developed colony with a food deposit and food demand, nothing built yet (low development).
  function foodColony(partial: Partial<BuildSystemState>): BuildSystemState {
    return sysWith({
      control: "developed",
      slotCap: makeResourceVector({ arable: 5 }),
      generalSpace: 20,
      habitableSpace: 50, // small habitable land → low development against the universe reference
      goods: [{ goodId: "food", stock: 1, targetStock: 10, demand: 10, production: 0 }],
      ...partial,
    });
  }

  it("wants a local floor of (1 − development) × SPECULATIVE_FLOOR × demand when imports cover it", () => {
    const site = foodColony({ population: 100 });
    const expected = (1 - systemDevelopment(site, DEV_REFS)) * DIRECTED_BUILD.SPECULATIVE_FLOOR * 10;
    expect(expected).toBeGreaterThan(0);
    expect(speculativeFloorExtra(site, "food", 0, DEV_REFS)).toBeCloseTo(expected, 5);
  });

  it("scales down as the system develops", () => {
    const young = foodColony({ population: 100, buildings: {} });
    // More people (fills housing) + built-and-staffed non-food industry ⇒ higher development.
    const mature = foodColony({
      population: 1000,
      slotCap: makeResourceVector({ arable: 5, ore: 5 }),
      buildings: { ore: 4 },
    });
    expect(systemDevelopment(mature, DEV_REFS)).toBeGreaterThan(systemDevelopment(young, DEV_REFS));
    expect(speculativeFloorExtra(mature, "food", 0, DEV_REFS)).toBeLessThan(speculativeFloorExtra(young, "food", 0, DEV_REFS));
  });

  it("is zero for a basic the system has no local deposit for", () => {
    const noDeposit = foodColony({ population: 100, slotCap: emptyResourceVector() });
    expect(speculativeFloorExtra(noDeposit, "food", 0, DEV_REFS)).toBe(0);
  });

  it("is zero for a non-basic good (specialisation survives)", () => {
    const site = foodColony({
      population: 100,
      slotCap: makeResourceVector({ ore: 5 }),
      goods: [{ goodId: "metals", stock: 1, targetStock: 10, demand: 10, production: 0 }],
    });
    expect(speculativeFloorExtra(site, "metals", 0, DEV_REFS)).toBe(0);
  });

  it("is zero when reactive builds already reach the floor", () => {
    const site = foodColony({ population: 100 });
    // A structural residual larger than the floor already commits enough local food.
    expect(speculativeFloorExtra(site, "food", 10, DEV_REFS)).toBe(0);
  });

  it("builds a local food floor at an undeveloped colony even when a reachable exporter covers demand", () => {
    const colony = sysWith({
      systemId: "A", control: "developed", population: 100,
      slotCap: makeResourceVector({ arable: 5 }), generalSpace: 50, habitableSpace: 50,
      buildings: {}, goods: [{ goodId: "food", stock: 1, targetStock: 10, demand: 10, production: 0 }],
    });
    const exporter = sysWith({
      systemId: "B", control: "developed", population: 100,
      slotCap: emptyResourceVector(), buildings: { food: 10 },
      goods: [{ goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 30 }],
    });
    // Flow-aware cancellation covers A's deficit (B's spare 26 ≥ 10), yet the nudge still stands up local food.
    const builds = planFactionBuilds([colony, exporter], reachable, DEV_REFS);
    expect(countFor(builds, "A", "food")).toBeGreaterThanOrEqual(1);
  });
});

// A tier-0 good (food → arable) with deposit slots; sys has space but partial build.
function tier0Sys(builtFood: number, foodSlots: number): BuildSystemState {
  const slotCap = emptyResourceVector();
  // food's resource is arable — set via the building catalog's resource at runtime in the impl;
  // here we set every resource's cap so the test is independent of the food→resource mapping.
  for (const k of RESOURCE_TYPES) slotCap[k] = foodSlots;
  return {
    systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed",
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
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    expect(buildableUnits(sys, "metals")).toBeGreaterThan(0);
  });

  it("reduces tier-1+ capacity by space already used by existing buildings", () => {
    const full: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: { metals: 100 },
      slotCap: unitResourceVector(), generalSpace: 100, habitableSpace: 50, goods: [],
    };
    // metals occupies general space; with 100 units already built, ~no room left.
    expect(buildableUnits(full, "metals")).toBeCloseTo(0);
  });

  it("returns zero capacity for an unknown good not in GOOD_TIER_BY_KEY", () => {
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
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
  it("sizes a tier-0 build to the demand RATE, not the 40-day stock target (over-extraction regression)", () => {
    // A developed system with an ample arable deposit: demand rate 20/tick, no local production,
    // ample labour. It reaches itself (self-cost) so it self-supplies. The stock model built
    // servedOutput/perUnit where servedOutput = targetStock − stock = 40×20 = 800 → ~228 food units
    // (deposit-capped over-extraction). The rate model builds demand/perUnit ≈ 20/3.5 ≈ 5.
    const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    const sys: BuildSystemState = {
      systemId: "A", factionId: "F", control: "developed", population: 100000, unrest: 0,
      buildings: {}, slotCap: makeResourceVector({ arable: 1000 }), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 0, targetStock: TARGET_COVER * 20, demand: 20, production: 0 }],
    };
    const foodUnits = countFor(planFactionBuilds([sys], rc, DEV_REFS), "A", "food");
    // Capacity meets the flow, within one whole level.
    expect(foodUnits * OUTPUT_PER_UNIT.food).toBeGreaterThanOrEqual(20 - OUTPUT_PER_UNIT.food);
    expect(foodUnits * OUTPUT_PER_UNIT.food).toBeLessThanOrEqual(20 + OUTPUT_PER_UNIT.food);
    // Far below the deposit-cap over-extraction the stock target would have driven.
    expect(foodUnits).toBeLessThan((TARGET_COVER * 20) / OUTPUT_PER_UNIT.food / 4);
  });

  it("builds one whole level for a rate deficit smaller than a single building's output (lumpy overshoot, not zero)", () => {
    // The real-galaxy failure: almost every system needs LESS than one building's output per tick.
    // Flooring rate ÷ output rounds to 0 → the system builds NOTHING and stays starved forever
    // (the bug that left every colony and homeworld with no industry). Capacity is lumpy: a positive
    // rate deficit must commit at least one whole level (the design's accepted overshoot).
    const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    const smallDemand = OUTPUT_PER_UNIT.food * 0.5; // half of one extractor's output — floors to 0
    const sys: BuildSystemState = {
      systemId: "A", factionId: "F", control: "developed", population: 100, unrest: 0,
      buildings: {}, slotCap: makeResourceVector({ arable: 10 }), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 0, targetStock: 1, demand: smallDemand, production: 0 }],
    };
    expect(countFor(planFactionBuilds([sys], rc, DEV_REFS), "A", "food")).toBe(1);
  });

  it("proposes capacity up to the physical ceilings in one pass (no population-budget throttle)", () => {
    // A lone developed builder with a huge local rate deficit, ample deposits, and ample labour.
    // The only bounds are deposits and labour — the planner holds no per-pass build budget. Build
    // reaches the labour ceiling (pop ÷ per-unit ore labour = 100/10 = 10), far above the handful a
    // population-scaled budget would have admitted.
    const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    const sys: BuildSystemState = {
      systemId: "A", factionId: "F", control: "developed", population: 100, unrest: 0,
      buildings: {}, slotCap: makeResourceVector({ ore: 1000 }), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 0, targetStock: 1, demand: 100000, production: 0 }],
    };
    const oreUnits = countFor(planFactionBuilds([sys], rc, DEV_REFS), "A", "ore");
    expect(oreUnits).toBeGreaterThan(5);                          // a pop×0.05 budget would have capped this at 5
    expect(oreUnits).toBeLessThanOrEqual(100 / oreLabour + 1e-9); // labour ceiling: pop ÷ per-unit labour
  });

  it("builds tier-0 production at a site that can serve a reachable structural deficit", () => {
    // A: structural food deficit (no surplus anywhere). B: has arable slots + population budget, reachable from A.
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 10, targetStock: 10, demand: 5 }],
    };
    const builds = planFactionBuilds([deficit, builder], () => 1, DEV_REFS);
    expect(countFor(builds, "B", "food")).toBeGreaterThan(0);
    // Proactive housing accompanies the build (B is fed and calm with habitable land).
    expect(countFor(builds, "B", "housing")).toBeGreaterThan(0);
  });

  it("does not build where the good's deficit already has a reachable surplus", () => {
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const surplus: BuildSystemState = {
      systemId: "S", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      // Rate exporter: produces 30 > its own demand 5 → a sustainable food source logistics can carry.
      goods: [{ goodId: "food", stock: 100, targetStock: 20, demand: 5, production: 30 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 50, goods: [],
    };
    const builds = planFactionBuilds([deficit, surplus, builder], () => 1, DEV_REFS);
    expect(countFor(builds, "B", "food")).toBe(0);
  });

  it("gates a tier-1+ build until its inputs are locally produced (the cascade)", () => {
    // A: structural metals deficit. B: general space + budget but NO ore production and no reachable ore surplus.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "metals", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builderNoInput: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50, goods: [],
    };
    expect(countFor(planFactionBuilds([deficit, builderNoInput], () => 1, DEV_REFS), "B", "metals")).toBe(0);

    // Same, but B locally produces ore → the metals factory becomes eligible.
    const builderWithInput: BuildSystemState = {
      ...builderNoInput, buildings: { ore: 5 },
    };
    expect(countFor(planFactionBuilds([deficit, builderWithInput], () => 1, DEV_REFS), "B", "metals")).toBeGreaterThan(0);
  });

  it("builds proactive housing (no production) at a fed system with no structural deficits", () => {
    const fed: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 10, targetStock: 10, demand: 5 }],
    };
    const builds = planFactionBuilds([fed], () => 1, DEV_REFS);
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
      systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const deficitWater: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 0, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "water", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builder: BuildSystemState = {
      systemId: "C", factionId: "f1", population: 10000, unrest: 0, control: "developed", buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 50,
      goods: [],
    };

    const builds = planFactionBuilds([deficitFood, deficitWater, builder], () => 1, DEV_REFS);

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
        systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "metals", stock: 1, targetStock: 20, demand: 5 }],
      },
      builder: {
        systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
        slotCap, generalSpace: 50, habitableSpace: 0, goods: [],
      },
      oreSurplus: {
        systemId: "S", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "ore", stock: 100, targetStock: 20, demand: 5, production: 0 }],
      },
    };
  }

  it("does not build a tier-1+ factory when its input surplus is unreachable from the site", () => {
    const { deficit, builder, oreSurplus } = scenario();
    // B can reach the deficit A (so it could serve it), but the ore source S is unreachable from B.
    const routeCost: RouteCost = (from, to) => (from === "S" || to === "S" ? null : 1);
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], routeCost, DEV_REFS), "B", "metals")).toBe(0);
  });

  it("builds a tier-1+ factory when its input surplus is reachable from the site (not just locally produced)", () => {
    const { deficit, builder, oreSurplus } = scenario();
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1, DEV_REFS), "B", "metals")).toBeGreaterThan(0);
  });

  it("greenlights the factory when the only input source is a structural producer below the 1.4× margin", () => {
    // S holds ore at stock 22 = 1.1× its anchor 20 (BELOW the 1.4× margin of 28), but produces
    // 30 > demand 5 → a structural exporter. The input gate must read 'surplus' via surplusDrawable
    // exactly as the logistics matcher does, or the planner refuses a factory whose inputs the
    // production-throttled exporter can in fact supply (the regression this branch guards against).
    const { deficit, builder, oreSurplus } = scenario();
    oreSurplus.goods = [{ goodId: "ore", stock: 22, targetStock: 20, demand: 5, production: 30 }];
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1, DEV_REFS), "B", "metals")).toBeGreaterThan(0);
  });

  it("does not greenlight the factory when the in-band input holder is a non-producer (no phantom source)", () => {
    // Same stock 22 in the 1.0–1.4× band, but production 0 → sitting on imported inventory, not a
    // structural exporter. surplusDrawable returns 0, so ore is not a reachable input and no metals
    // factory is built — mirroring the matcher's re-export guard at the build-planner gate.
    const { deficit, builder, oreSurplus } = scenario();
    oreSurplus.goods = [{ goodId: "ore", stock: 22, targetStock: 20, demand: 5, production: 0 }];
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1, DEV_REFS), "B", "metals")).toBe(0);
  });
});

describe("planFactionBuilds — proactive housing", () => {
  it("does not build housing at a starved system", () => {
    const starved: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 100 }],
    };
    expect(countFor(planFactionBuilds([starved], () => 1, DEV_REFS), "A", "housing")).toBe(0);
  });

  it("does not build housing at an unsettled (high-unrest) system", () => {
    const unsettled: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0.9, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    };
    expect(countFor(planFactionBuilds([unsettled], () => 1, DEV_REFS), "A", "housing")).toBe(0);
  });

  it("never builds housing past the habitable cap", () => {
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100000, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 1000, habitableSpace: 5,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    };
    const housing = countFor(planFactionBuilds([sys], () => 1, DEV_REFS), "A", "housing");
    expect(housing).toBeGreaterThan(0);
    expect(housing).toBeLessThanOrEqual(5); // habitableSpace 5 ÷ spaceCost 1
  });

  it("commits the full settle-margin-paced housing want, unthrottled by any per-pop budget", () => {
    // The housing pass commits floor(plannedHousingUnits) — the settle-margin-paced want — bounded
    // only by the habitable cap, never by a per-pop budget (that throttle was removed). Headroom is
    // ample here, so the pacing target (pop × (1 + SETTLE_MARGIN) ÷ popProvided) is the binding term
    // and the commit equals that floored want. A reintroduced pop×0.05-style budget (80 at pop 1600)
    // would cap the commit below the paced want — this pins that it does not.
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 1600, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 100000, habitableSpace: 100000,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    };
    const pacedWant = Math.floor(plannedHousingUnits(sys));
    expect(pacedWant).toBeGreaterThan(1); // a genuine multi-level commit, not a trivial one
    expect(countFor(planFactionBuilds([sys], () => 1, DEV_REFS), "A", "housing")).toBe(pacedWant);
  });

  it("does not co-build housing on the industry path (housing comes only from the housing pass)", () => {
    // Builder has NO habitable land: the housing pass cannot fire, so any housing here
    // would be the deleted co-build. Expect production, zero housing.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 0,
      goods: [],
    };
    const builds = planFactionBuilds([deficit, builder], () => 1, DEV_REFS);
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
        control: "developed",
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
    const builds = planFactionBuilds(systems, () => 1, DEV_REFS);
    const ms = performance.now() - t0;
    // It must actually do the work (not early-exit), and do it fast.
    expect(builds.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  }, 120_000);

  it("converges the whole-level fit fast when capacity dwarfs the labour ceiling", () => {
    // A huge deposit + huge rate deficit but labour that admits only a handful of levels: the fit
    // must land the labour-max whole level, and do so without scanning every candidate level from
    // the top (binary search, not an O(capUnits) descent). Correctness: built labour ≤ population.
    const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    const sys: BuildSystemState = {
      systemId: "A", factionId: "F", control: "developed", population: 40 * oreLabour, unrest: 0,
      buildings: {}, slotCap: makeResourceVector({ ore: 100000 }), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 0, targetStock: 1, demand: 1_000_000, production: 0 }],
    };
    const t0 = performance.now();
    const oreUnits = countFor(planFactionBuilds([sys], rc, DEV_REFS), "A", "ore");
    expect(performance.now() - t0).toBeLessThan(50);
    expect(oreUnits).toBeGreaterThan(0);
    expect(oreUnits).toBeLessThanOrEqual(40 + 1e-9); // labour ceiling: 40×oreLabour ÷ oreLabour
  });
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
  it("paces housing a settle-margin ahead of population (rounded up to whole levels)", () => {
    // pop 100, no housing, ample habitable → target popCap = 100 × 1.25 = 125 → 6.25 → ceil 7 levels.
    const units = plannedHousingUnits(sysWith({
      population: 100, buildings: {}, generalSpace: 100, habitableSpace: 100,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }));
    expect(units).toBe(Math.ceil(125 / 20)); // 7
  });

  it("ratchets a small seed colony up by a whole level once occupancy passes the margin", () => {
    // The colony-bootstrap case: pop 20 filling a 1-level seed (popCap 20). Target popCap = 25 > 20, so a
    // fraction of a level is wanted — the OLD floor() returned 0 and welded popCap at the seed forever.
    // It must now round UP to one whole level so popCap can ratchet above the seed.
    const units = plannedHousingUnits(sysWith({
      population: 20, buildings: { housing: 1 }, generalSpace: 100, habitableSpace: 100,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }));
    expect(units).toBe(1);
  });

  it("builds nothing while population is still below the current cap by more than the margin", () => {
    // pop 2 in a 5-level colony (popCap 100): target = 2.5 ≪ 100, so there is ample housing headroom
    // and no premature build.
    const units = plannedHousingUnits(sysWith({
      population: 2, buildings: { housing: 5 }, generalSpace: 100, habitableSpace: 100,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    }));
    expect(units).toBe(0);
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
        systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "unclaimed", buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "ore", stock: 1, targetStock: 50, demand: 50 }],
      },
      {
        systemId: "B", factionId: "f1", population: builderPop, unrest: 0, control: "developed",
        buildings: builderBuildings,
        slotCap, generalSpace: 50, habitableSpace: 0, goods: [],
      },
    ];
  }

  it("builds no industry when the builder has no spare labour", () => {
    // pop fully absorbed by 4 ore extractors (4 × oreLabour) → spareLabour 0.
    const builds = planFactionBuilds(deficitAndBuilder(4 * oreLabour, { ore: 4 }), () => 1, DEV_REFS);
    expect(countFor(builds, "B", "ore")).toBe(0);
  });

  it("caps industry at the spare labour the resident population supports", () => {
    // pop = 2× the 4 extractors' labour demand → spareLabour == demand → ≤ demand/oreLabour = 4 new units.
    const builds = planFactionBuilds(deficitAndBuilder(8 * oreLabour, { ore: 4 }), () => 1, DEV_REFS);
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
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed",
      buildings: { housing: 5, ore: 4 },
      slotCap, generalSpace: 9, habitableSpace: 5,
      goods: [{ goodId: "ore", stock: 50, targetStock: 50, demand: 20 }],
    };
    expect(planFactionBuilds([atPotential], () => 1, DEV_REFS)).toHaveLength(0);
  });

  it("does not work deposit slots on a barren, low-habitable world", () => {
    // 56 ore slots but ~no habitable land → can't house labour → spareLabour 0 → no extraction.
    const slotCap = emptyResourceVector();
    slotCap.ore = 56;
    const barren: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 3, unrest: 0, control: "developed",
      buildings: { ore: 3 / oreLabour }, // ore count × oreLabour == population → spareLabour 0
      slotCap, generalSpace: 60, habitableSpace: 0.001,
      goods: [],
    };
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 1, targetStock: 50, demand: 50 }],
    };
    expect(countFor(planFactionBuilds([barren, deficit], () => 1, DEV_REFS), "B", "ore")).toBe(0);
  });
});

// A route function with a real self-cost distinction: 0 for a system reaching itself (never
// counted as "reachable" by the opportunity loop, which requires cost > 0), 1 between systems.
const selfAndNeighbourRoute: RouteCost = (from, to) => (from === to ? 0 : 1);

// Neighbour "A" carries a structural deficit of `goodId` with no reachable surplus anywhere
// (mirrors the file's existing deficit fixtures: stock 1, target 20, demand 5 → shortfall 19).
function deficitOnly(goodId: string): BuildSystemState {
  return {
    systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "unclaimed", buildings: {},
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
    systemId: "B", factionId: "f1", population: 500, unrest: 0, control: "developed",
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
    systemId: "B", factionId: "f1", population: 300, unrest: 0, control: "developed", buildings: {},
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
    systemId: "B", factionId: "f1", population: 300, unrest: 0, control: "developed",
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
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute, DEV_REFS);
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
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute, DEV_REFS);
    expect(countFor(builds, "B", "ore")).toBeGreaterThan(0); // the build actually happens
    expect(builds.some((b) => b.buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);
    expect(builds.some((b) => b.buildingType === RESEARCH_INSTITUTE_TYPE)).toBe(false);
  });

  it("builds no academy when the existing skill ceiling already covers the build", () => {
    const systems = makeTier1DeficitWithSchoolsAlready(); // skill1Cap already ≥ post-build skill1Demand
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute, DEV_REFS);
    expect(countFor(builds, "B", "metals")).toBeGreaterThan(0); // the build actually happens
    expect(builds.some((b) => b.buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);

    // Same over-commit guard as the tier-2 case: metals draws a full labourTotal per unit
    // (unskilled + skill1), not just its unskilled slice.
    const site = systems.find((s) => s.systemId === "B")!;
    const finalBuildings = applyBuilds(site.buildings, builds, "B");
    expect(labourDemand(finalBuildings)).toBeLessThanOrEqual(site.population + 1e-9);
  });
});

// Metals (tier-1, recipe { ore }, heavy-industry family) is a structural deficit at neighbour A;
// site B has ample population and general space, and locally produces ore (its recipe input).
function heavyDeficitScenario(): BuildSystemState[] {
  const deficit: BuildSystemState = {
    systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "unclaimed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "metals", stock: 1, targetStock: 1000, demand: 500 }],
  };
  const producer: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 5000, unrest: 0, control: "developed",
    buildings: { ore: 5 },
    slotCap: emptyResourceVector(), generalSpace: 500, habitableSpace: 0,
    goods: [],
  };
  return [deficit, producer];
}

// Same shape, but a shortfall that funds exactly ONE whole metals level (output 5), whose family
// throughput (5) stays below the throughput floor (ANCHOR_MIN_THROUGHPUT 10) — production builds,
// but no complex co-builds. (Two levels would reach the floor; whole-level granularity means the
// deficit must clear one level's output to build anything at all.)
function tinyHeavyDeficitScenario(): BuildSystemState[] {
  const systems = heavyDeficitScenario();
  const deficit = systems.find((s) => s.systemId === "A")!;
  deficit.goods = [{ goodId: "metals", stock: 0, targetStock: 7, demand: 5 }];
  return systems;
}

// A single producer site (B) that locally produces both ore and gas, making it capable of
// serving TWO structural deficits in DIFFERENT specialisation families: metals (heavy industry)
// and fuel (chemicals). Each deficit is sized so its own committed production clears
// ANCHOR_MIN_THROUGHPUT (and saturates ANCHOR_RATED_COVERAGE) on its own — i.e. without the
// cross-family anchor cap, the planner would want to co-build a complex for BOTH families here.
function crossFamilyDeficitScenario(): BuildSystemState[] {
  // Each deficit's RATE (demand − production) is sized to clear ANCHOR_MIN_THROUGHPUT on its own, so
  // both families independently qualify for a complex — proving the cap (not the floor) suppresses the second.
  const deficitMetals: BuildSystemState = {
    systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "unclaimed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "metals", stock: 1, targetStock: 30, demand: ANCHOR_MIN_THROUGHPUT * 3, production: 0 }],
  };
  const deficitFuel: BuildSystemState = {
    systemId: "C", factionId: "f1", population: 0, unrest: 0, control: "unclaimed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "fuel", stock: 1, targetStock: 30, demand: ANCHOR_MIN_THROUGHPUT * 3, production: 0 }],
  };
  const producer: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 5000, unrest: 0, control: "developed",
    buildings: { ore: 5, gas: 5 },
    slotCap: emptyResourceVector(), generalSpace: 500, habitableSpace: 0,
    goods: [],
  };
  return [deficitMetals, deficitFuel, producer];
}

// Two producers with identical space-bound metals capacity; C already carries the heavy-industry
// complex (its footprint pre-paid in extra general space so remaining capacity matches B's). The
// shortfall sits between B's unbuffed reach (1.0×) and C's buffed reach (1.4×), so both sites are
// capacity-limited at score time and C's buffed per-unit must rank it first.
function anchoredVsGreenfieldScenario(): BuildSystemState[] {
  const capUnits = 20;
  const space = capUnits * effectiveSpaceCost("metals");
  // Rate deficit sized between one site's unbuffed capacity output (capUnits × 1.0×) and the anchored
  // site's buffed output (× 1.4×): both sites are capacity-limited at score time, so C's buffed
  // per-unit must rank it first (the snowball).
  const rateDeficit = capUnits * OUTPUT_PER_UNIT.metals * 1.15;
  const deficit: BuildSystemState = {
    systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "unclaimed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "metals", stock: 0, targetStock: 1, demand: rateDeficit, production: 0 }],
  };
  const greenfield: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 5000, unrest: 0, control: "developed",
    buildings: { ore: 5 },
    slotCap: emptyResourceVector(), generalSpace: space, habitableSpace: 0,
    goods: [],
  };
  const anchored: BuildSystemState = {
    systemId: "C", factionId: "f1", population: 5000, unrest: 0, control: "developed",
    buildings: { ore: 5, [HEAVY_INDUSTRY_COMPLEX]: 1 },
    slotCap: emptyResourceVector(), generalSpace: space + ANCHOR_FOOTPRINT, habitableSpace: 0,
    goods: [],
  };
  return [deficit, greenfield, anchored];
}

describe("complex co-build", () => {
  it("routes family production to the site already carrying the complex (the snowball)", () => {
    const builds = planFactionBuilds(anchoredVsGreenfieldScenario(), reachable, DEV_REFS);
    const atAnchored = countFor(builds, "C", "metals");
    const atGreenfield = countFor(builds, "B", "metals");
    expect(atAnchored).toBeGreaterThan(0);
    expect(atAnchored).toBeGreaterThan(atGreenfield);
  });

  it("co-builds a family complex at a site serving a large family deficit", () => {
    const builds = planFactionBuilds(heavyDeficitScenario(), reachable, DEV_REFS);
    const complex = builds.find((b) => COMPLEX_TYPES.includes(b.buildingType));
    expect(complex?.buildingType).toBe(HEAVY_INDUSTRY_COMPLEX);
    // never more than the cap
    const total = builds.filter((b) => COMPLEX_TYPES.includes(b.buildingType)).reduce((s, b) => s + b.count, 0);
    expect(total).toBeLessThanOrEqual(1);
  });

  it("does not co-build a complex for a tiny family deficit (below the throughput floor)", () => {
    const builds = planFactionBuilds(tinyHeavyDeficitScenario(), reachable, DEV_REFS);
    expect(builds.some((b) => COMPLEX_TYPES.includes(b.buildingType))).toBe(false);
    // The floor (not a lack of production) is what suppressed the complex — metals still builds.
    expect(builds.some((b) => b.buildingType === "metals" && b.count > 0)).toBe(true);
  });

  it("caps the complex across families — a second family's opportunity at the same site gets zero lift", () => {
    const builds = planFactionBuilds(crossFamilyDeficitScenario(), reachable, DEV_REFS);

    // Both goods independently clear the throughput floor — proving the CAP, not the floor, is
    // what suppresses the second complex.
    const metalsUnits = countFor(builds, "B", "metals");
    const fuelUnits = countFor(builds, "B", "fuel");
    expect(metalsUnits * OUTPUT_PER_UNIT.metals).toBeGreaterThanOrEqual(ANCHOR_MIN_THROUGHPUT);
    expect(fuelUnits * OUTPUT_PER_UNIT.fuel).toBeGreaterThanOrEqual(ANCHOR_MIN_THROUGHPUT);

    // Yet the anchor cap (1, accumulated across ALL complex types at the site) holds across both
    // families' opportunities, and only one distinct complex type is ever built.
    const complexBuilds = builds.filter((b) => COMPLEX_TYPES.includes(b.buildingType));
    const total = complexBuilds.reduce((s, b) => s + b.count, 0);
    expect(total).toBeLessThanOrEqual(1);
    expect(new Set(complexBuilds.map((b) => b.buildingType)).size).toBeLessThanOrEqual(1);
  });
});

/** Flatten a proposal list to its ordered building items — the funding-queue expansion. */
function flatItems(proposals: Proposal[]): Array<{ systemId: string; buildingType: string; levels: number }> {
  return proposals.flatMap((p) =>
    p.kind === "build" ? p.items.map((i) => ({ systemId: p.systemId, buildingType: i.buildingType, levels: i.levels })) : [],
  );
}

describe("planFactionProposals", () => {
  it("emits a housing proposal (role 'housing', value 0, work = levels × housing cost) at a fed-and-calm developed system", () => {
    const site = sysWith({
      control: "developed", population: 100, generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    });
    const proposals = planFactionProposals([site], () => 1, [], DEV_REFS);
    const housing = proposals.find((p) => p.role === "housing");
    expect(housing).toBeDefined();
    expect(housing!.kind).toBe("build");
    expect(housing!.factionId).toBe("f1");
    expect(housing!.value).toBe(0);                              // housing has no served-demand ROI
    expect(housing!.items).toHaveLength(1);
    const lvls = housing!.items[0].levels;
    expect(housing!.items[0].buildingType).toBe(HOUSING_TYPE);
    expect(Number.isInteger(lvls)).toBe(true);
    expect(lvls).toBeGreaterThanOrEqual(1);
    expect(housing!.work).toBeCloseTo(lvls * workCostPerLevel(HOUSING_TYPE), 6);
  });

  it("emits an industry proposal with value>0 (served demand) and work = Σ item level-work", () => {
    // A: structural food deficit; B: builder with arable slots + population, reachable from A.
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 0, goods: [], // no habitable land → isolate industry
    };
    const proposals = planFactionProposals([deficit, builder], () => 1, [], DEV_REFS);
    const food = proposals.find((p) => p.role === "industry" && p.items.some((i) => i.buildingType === "food"));
    expect(food).toBeDefined();
    expect(food!.value).toBeGreaterThan(0);                     // it serves real demand
    expect(food!.value).toBeLessThanOrEqual(5 + 1e-9);          // never more than the deficit it serves
    const expectedWork = food!.items.reduce((s, i) => s + i.levels * workCostPerLevel(i.buildingType), 0);
    expect(food!.work).toBeCloseTo(expectedWork, 6);
  });

  it("bundles a co-built academy INTO the production's proposal, gate-first (not as a separate proposal)", () => {
    const proposals = planFactionProposals(makeElectronicsDeficitWithCapableSite(), selfAndNeighbourRoute, [], DEV_REFS);
    const bundle = proposals.find((p) => p.items.some((i) => i.buildingType === "electronics"));
    expect(bundle).toBeDefined();
    const types = bundle!.items.map((i) => i.buildingType);
    expect(types).toContain(VOCATIONAL_SCHOOL_TYPE);
    expect(types).toContain(RESEARCH_INSTITUTE_TYPE);
    // Gate-first WITHIN the bundle: the academies precede the electronics they license.
    expect(types.indexOf(VOCATIONAL_SCHOOL_TYPE)).toBeLessThan(types.indexOf("electronics"));
    expect(types.indexOf(RESEARCH_INSTITUTE_TYPE)).toBeLessThan(types.indexOf("electronics"));
    // The academy is NOT a standalone proposal — it lives in the production's bundle (this is what
    // lets it inherit the production's ROI instead of sorting last at value ≈ 0).
    expect(proposals.some((p) => p.items.length === 1 && p.items[0].buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);
  });

  it("does not re-propose a level already in flight (subtracts open projects)", () => {
    const site = sysWith({
      control: "developed", population: 100, generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    });
    // Ten housing levels already under construction cover the whole pace-ahead target → no new housing.
    const open: WorldConstructionProject[] = [
      { kind: "build", id: "h", origin: "auto", factionId: "f1", systemId: "X", buildingType: HOUSING_TYPE, levels: 10, workTotal: 80, workDone: 0 },
    ];
    expect(planFactionProposals([site], () => 1, [], DEV_REFS).some((p) => p.role === "housing")).toBe(true);
    expect(planFactionProposals([site], () => 1, open, DEV_REFS).some((p) => p.role === "housing")).toBe(false);
  });

  it("flattening a proposal keeps its academy before the production it gates", () => {
    const flat = flatItems(planFactionProposals(makeElectronicsDeficitWithCapableSite(), selfAndNeighbourRoute, [], DEV_REFS));
    const schoolIdx = flat.findIndex((i) => i.buildingType === VOCATIONAL_SCHOOL_TYPE);
    const prodIdx = flat.findIndex((i) => i.buildingType === "electronics");
    expect(schoolIdx).toBeGreaterThanOrEqual(0);
    expect(prodIdx).toBeGreaterThanOrEqual(0);
    expect(schoolIdx).toBeLessThan(prodIdx);
  });
});

describe("planFactionBuilds: develop gate", () => {
  const buildable = { population: 100, generalSpace: 50, habitableSpace: 50, goods: [] };

  it("builds nothing at a fed-and-calm system that is controlled but not developed", () => {
    const site = sysWith({ ...buildable, control: "controlled", buildings: {} });
    expect(fedAndCalm(site)).toBe(true); // sanity: absent the gate it WOULD build housing
    expect(planFactionBuilds([site], () => 1, DEV_REFS)).toEqual([]);
  });

  it("builds housing at the same system once it is developed", () => {
    const site = sysWith({ ...buildable, control: "developed", buildings: {} });
    const plans = planFactionBuilds([site], () => 1, DEV_REFS);
    expect(plans.some((b) => b.buildingType === HOUSING_TYPE)).toBe(true);
  });

  it("builds a first extractor ONE unit ahead of full staffing (the colony-bootstrap unlock)", () => {
    // pop 2 cannot FULLY staff a 10-labour food extractor, but decay only sheds a WHOLE idle unit, so
    // the planner may still commit the first level — creating the jobs that then pull migration. Without
    // this a tiny colony deadlocks (no pop to staff → no build → no jobs → no inflow).
    const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    const site: BuildSystemState = {
      systemId: "A", factionId: "F", control: "developed", population: 2, unrest: 0,
      buildings: {}, slotCap: makeResourceVector({ arable: 10 }), generalSpace: 100, habitableSpace: 100,
      goods: [{ goodId: "food", stock: 0, targetStock: 500, demand: 50, production: 0 }],
    };
    const builds = planFactionBuilds([site], rc, DEV_REFS);
    const food = builds.find((b) => b.systemId === "A" && b.buildingType === "food");
    expect(food?.count).toBe(1); // exactly one level ahead — level 2 would exceed pop + one unit
  });

  it("refuses to build the first extractor on a pop-0 world (the strict `<` boundary)", () => {
    // The one-unit lead is a STRICT bound: total demand must stay < pop + one unit. On a pop-0 world
    // that is `0 + 10 < 0 + 10` → false, so nothing is built — a whole idle unit is never committed
    // (it would decay). This pins the strict `<`: with a non-strict `<=` the gate would pass (10 <= 10)
    // and the planner would stand up industry on an unpopulated world. Same fixture as above, pop 0.
    const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    const site: BuildSystemState = {
      systemId: "A", factionId: "F", control: "developed", population: 0, unrest: 0,
      buildings: {}, slotCap: makeResourceVector({ arable: 10 }), generalSpace: 100, habitableSpace: 100,
      goods: [{ goodId: "food", stock: 0, targetStock: 500, demand: 50, production: 0 }],
    };
    const builds = planFactionBuilds([site], rc, DEV_REFS);
    expect(builds.find((b) => b.systemId === "A" && b.buildingType === "food")).toBeUndefined();
  });
});

describe("hopRouteCost", () => {
  it("returns SELF_COST for a system reaching itself, and hop×weight otherwise", () => {
    const hops = new Map([["A", new Map([["A", 0], ["B", 2]])]]);
    const rc = hopRouteCost(hops, DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    expect(rc("A", "A")).toBe(DIRECTED_BUILD.SELF_COST);
    expect(rc("A", "B")).toBe(2 * DIRECTED_BUILD.HOP_WEIGHT);
  });

  it("returns null beyond MAX_HOPS or when unreachable", () => {
    const hops = new Map([["A", new Map([["A", 0], ["B", 99]])]]);
    const rc = hopRouteCost(hops, DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    expect(rc("A", "B")).toBeNull();      // 99 > MAX_HOPS
    expect(rc("A", "Z")).toBeNull();      // no entry
    expect(rc("Q", "A")).toBeNull();      // no source row
  });

  it("makes the planner build a system's OWN local deficit (self-supply)", () => {
    const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    const sys: BuildSystemState = {
      systemId: "A", factionId: "F", control: "developed", population: 1000, unrest: 0,
      buildings: {}, slotCap: makeResourceVector({ arable: 10 }), generalSpace: 100, habitableSpace: 100,
      goods: [{ goodId: "food", stock: 0, targetStock: 500, demand: 50, production: 0 }],
    };
    const builds = planFactionBuilds([sys], rc, DEV_REFS);
    expect(builds.some((b) => b.systemId === "A" && b.buildingType === "food")).toBe(true);
  });
});

const COLONY_PARAMS: ColonyEstablishParams = {
  landPremium: COLONISATION.LAND_PREMIUM,
  landGeneralWeight: COLONISATION.LAND_GENERAL_WEIGHT,
  landDepositWeight: COLONISATION.LAND_DEPOSIT_WEIGHT,
  sigmaFloor: COLONISATION.SIGMA_FLOOR,
  establishWork: COLONISATION.COLONY_ESTABLISH_WORK,
  seedPop: EXPANSION.COLONY_SEED_POP,
  habitableFloor: EXPANSION.DEVELOP_HABITABLE_FLOOR,
  popCostWeight: COLONISATION.SEED_POP_COST_WEIGHT,
  minSettlerSupply: 0, // gate disabled by default — the valuation cases below isolate scoring, not founding pace
  employedLeakFraction: 0,
};

/** A developed home system for the σ/missing/deficit aggregates. `housing` sets built pop-cap; `habitable`
 *  the potential — equal ⇒ σ = 1 (saturated). `goods` seed the faction rate deficits. */
function homeState(opts: {
  systemId?: string;
  housing?: number;
  habitableSpace?: number;
  slotCap?: ResourceVector;
  goods?: BuildGoodState[];
}): BuildSystemState {
  return {
    systemId: opts.systemId ?? "home", factionId: "f1", control: "developed", population: 1000, unrest: 0,
    buildings: opts.housing ? { [HOUSING_TYPE]: opts.housing } : {},
    slotCap: opts.slotCap ?? emptyResourceVector(),
    generalSpace: 0, habitableSpace: opts.habitableSpace ?? 0, goods: opts.goods ?? [],
  };
}

/** A controlled colony candidate with a seed source. */
function candidate(opts: {
  systemId?: string; habitableSpace?: number; generalSpace?: number; slotCap?: ResourceVector;
}): ColonyEstablishCandidate {
  return {
    systemId: opts.systemId ?? "c1",
    habitableSpace: opts.habitableSpace ?? 100,
    generalSpace: opts.generalSpace ?? 0,
    slotCap: opts.slotCap ?? emptyResourceVector(),
    sourceSystemId: "home",
  };
}

describe("factionGoodDeficits", () => {
  it("sums each good's positive (demand − production) across developed systems", () => {
    const developed = [
      homeState({ systemId: "a", goods: [{ goodId: "food", stock: 0, targetStock: 0, demand: 30, production: 10 }] }),
      homeState({ systemId: "b", goods: [
        { goodId: "food", stock: 0, targetStock: 0, demand: 20, production: 5 },
        { goodId: "ore", stock: 0, targetStock: 0, demand: 5, production: 50 }, // surplus → no deficit
      ] }),
    ];
    const deficits = factionGoodDeficits(developed);
    const food = deficits.find((d) => d.goodId === "food");
    expect(food?.rateDeficit).toBeCloseTo((30 - 10) + (20 - 5), 6);
    expect(deficits.some((d) => d.goodId === "ore")).toBe(false); // ore is a surplus everywhere
  });
});

describe("planFactionColonyProposals", () => {
  it("scores a candidate's land value and rises with faction saturation σ (the crossover driver)", () => {
    const c = candidate({ habitableSpace: 100, generalSpace: 40 });
    // Unsaturated home: lots of unbuilt habitable land (σ ≈ 0) → land premium mostly dormant.
    const loose = planFactionColonyProposals("f1", [homeState({ housing: 1, habitableSpace: 1000 })], [c], [], COLONY_PARAMS);
    // Saturated home: housing fills all habitable land (σ = 1) → full land premium live.
    const tight = planFactionColonyProposals("f1", [homeState({ housing: 5, habitableSpace: 5 })], [c], [], COLONY_PARAMS);
    expect(loose).toHaveLength(1);
    expect(tight).toHaveLength(1);
    expect(loose[0].value).toBeGreaterThan(0);                 // σ_floor keeps some land value live
    expect(tight[0].value).toBeGreaterThan(loose[0].value);    // saturation activates the rest
  });

  it("credits U (unblocking value) for a keystone deposit even at σ = 0", () => {
    // Home has no `ore` deposit anywhere (missing) and a structural `metals` deficit (metals needs ore).
    // A candidate WITH an ore deposit unblocks that deficit up the recipe chain → U > 0 even unsaturated.
    const oreVec = makeResourceVector({ ore: 5 });
    const home = homeState({
      housing: 1, habitableSpace: 1000, // σ ≈ 0 → land term nearly dormant
      slotCap: emptyResourceVector(),   // zero ore slots → ore is a missing resource
      goods: [{ goodId: "metals", stock: 0, targetStock: 0, demand: 40, production: 0 }],
    });
    const keystone = candidate({ systemId: "ore-world", habitableSpace: 5, slotCap: oreVec });
    const barren = candidate({ systemId: "rock", habitableSpace: 5, slotCap: emptyResourceVector() });
    const [k] = planFactionColonyProposals("f1", [home], [keystone], [], COLONY_PARAMS);
    const [b] = planFactionColonyProposals("f1", [home], [barren], [], COLONY_PARAMS);
    // Same land (habitable 5); the keystone's ore deposit adds the metals deficit's demand as U.
    expect(k.value - b.value).toBeGreaterThan(0);
  });

  it("sizes the seed + bundled housing to the land, and prices establishWork = base + housing work", () => {
    const developed = [homeState({ housing: 1, habitableSpace: 1000 })];
    // Land-rich: whole-level habitable cap ≫ seedPop → full seed.
    const [rich] = planFactionColonyProposals("f1", developed, [candidate({ systemId: "big", habitableSpace: 100 })], [], COLONY_PARAMS);
    expect(rich.seedPop).toBe(EXPANSION.COLONY_SEED_POP);
    expect(rich.housingLevels).toBe(Math.ceil(EXPANSION.COLONY_SEED_POP / POP_CENTRE_DENSITY));
    expect(rich.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(rich.seedPop); // viable by construction
    expect(rich.work).toBeCloseTo(COLONISATION.COLONY_ESTABLISH_WORK + rich.housingLevels * workCostPerLevel(HOUSING_TYPE), 6);
    expect(rich.work).toBeGreaterThan(COLONISATION.COLONY_ESTABLISH_WORK); // housing is paid for, not free

    // Land-poor: two whole housing levels of habitable land cap the seed below what was asked for.
    // The shipped seed (model C) is smaller than one housing level's capacity, so it can never be
    // land-capped in practice; drive this sub-case with an explicit oversized seed so the whole-level
    // capping logic stays covered independent of the calibrated constant.
    const bigSeed = { ...COLONY_PARAMS, seedPop: 50 };
    const housingCost = effectiveSpaceCost(HOUSING_TYPE);
    const poorHabitable = 2 * housingCost; // exactly 2 whole levels → habitable cap 2 × POP_CENTRE_DENSITY
    const [poor] = planFactionColonyProposals("f1", developed, [candidate({ systemId: "small", habitableSpace: poorHabitable })], [], bigSeed);
    expect(poor.seedPop).toBe(Math.min(bigSeed.seedPop, 2 * POP_CENTRE_DENSITY));
    expect(poor.seedPop).toBeLessThan(bigSeed.seedPop);
    expect(poor.housingLevels).toBeLessThanOrEqual(2);
    expect(poor.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(poor.seedPop);
  });

  it("skips a candidate below the habitable floor", () => {
    const developed = [homeState({ housing: 1, habitableSpace: 1000 })];
    const belowFloor = candidate({ systemId: "dead", habitableSpace: 0 });
    expect(planFactionColonyProposals("f1", developed, [belowFloor], [], COLONY_PARAMS)).toHaveLength(0);
  });

  it("skips a candidate that clears the floor but lacks one whole housing level of land", () => {
    const developed = [homeState({ housing: 1, habitableSpace: 1000 })];
    // Above the habitable floor (lowered here) yet under one housing level of land → maxHousingLevels 0,
    // so seedPop caps to 0 and the second gate drops it — no zero-housing colony is ever proposed.
    const sliver = candidate({ systemId: "sliver", habitableSpace: effectiveSpaceCost(HOUSING_TYPE) * 0.5 });
    expect(
      planFactionColonyProposals("f1", developed, [sliver], [], { ...COLONY_PARAMS, habitableFloor: 0 }),
    ).toHaveLength(0);
  });

  it("does not re-propose a colony already in flight for that system", () => {
    const developed = [homeState({ housing: 1, habitableSpace: 1000 })];
    const c = candidate({ systemId: "c1", habitableSpace: 100 });
    const open: WorldColonyEstablishProject[] = [
      { kind: "colony_establish", id: "e", origin: "auto", factionId: "f1", systemId: "c1", sourceSystemId: "home", seedPop: 50, housingLevels: 3, workTotal: 84, workDone: 20 },
    ];
    expect(planFactionColonyProposals("f1", developed, [c], [], COLONY_PARAMS)).toHaveLength(1);
    expect(planFactionColonyProposals("f1", developed, [c], open, COLONY_PARAMS)).toHaveLength(0);
  });

  it("carries kind, faction, system, and the fixed seed source through to the proposal", () => {
    const developed = [homeState({ housing: 1, habitableSpace: 1000 })];
    const [p] = planFactionColonyProposals("f1", developed, [candidate({ systemId: "c1" })], [], COLONY_PARAMS);
    expect(p.kind).toBe("colony_establish");
    expect(p.factionId).toBe("f1");
    expect(p.systemId).toBe("c1");
    expect(p.sourceSystemId).toBe("home");
  });
});

describe("planFactionColonyProposals: seed-pop opportunity cost", () => {
  // A source whose entire workforce runs `oreLevels` extractors (spare labour = 0), producing
  // `output` ore/tick — so seeding off it must poach STAFFED workers, incurring the forgone-output cost.
  function staffedSource(systemId: string, oreLevels: number, output: number): BuildSystemState {
    return {
      systemId, factionId: "f1", control: "developed",
      population: oreLevels * oreLabour, unrest: 0,
      buildings: { ore: oreLevels },
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 0, targetStock: 0, demand: 0, production: output }],
    };
  }

  it("charges no seed-pop cost when the source has spare (idle) labour ≥ the seed", () => {
    // homeState: population 1000, only housing → labourDemand 0 → 1000 idle ≫ the tiny seed. With no
    // employed seed to charge, the pop-cost weight is inert: the priced value equals the un-priced one.
    const developed = [homeState({ systemId: "home", housing: 1, habitableSpace: 1000 })];
    const c = candidate({ habitableSpace: 100 });
    const [priced] = planFactionColonyProposals("f1", developed, [c], [], COLONY_PARAMS);
    const [free] = planFactionColonyProposals("f1", developed, [c], [], { ...COLONY_PARAMS, popCostWeight: 0 });
    expect(priced.value).toBeCloseTo(free.value, 6);
    expect(priced.value).toBeGreaterThan(0);
  });

  it("ranks a colony seeded from a fully-staffed source below an identical one from a job-short source", () => {
    // Identical land at both candidates and one shared developed set ⇒ same σ and U; the ONLY
    // difference is the source's forgone output. A gentle weight keeps the busy colony positive so the
    // test isolates the DIRECTION of the bias, not a magnitude.
    const idle = homeState({ systemId: "idle", housing: 1, habitableSpace: 1000 }); // spare labour
    const busy = staffedSource("busy", 10, 200);                                     // fully staffed
    const developed = [idle, busy];
    const fromIdle: ColonyEstablishCandidate = { ...candidate({ systemId: "c-idle", habitableSpace: 100 }), sourceSystemId: "idle" };
    const fromBusy: ColonyEstablishCandidate = { ...candidate({ systemId: "c-busy", habitableSpace: 100 }), sourceSystemId: "busy" };
    const gentle = { ...COLONY_PARAMS, popCostWeight: 0.01 };
    const proposals = planFactionColonyProposals("f1", developed, [fromIdle, fromBusy], [], gentle);
    const pIdle = proposals.find((p) => p.systemId === "c-idle")!;
    const pBusy = proposals.find((p) => p.systemId === "c-busy")!;
    expect(pBusy.value).toBeGreaterThan(0);            // still worth founding, just dearer
    expect(pIdle.value).toBeGreaterThan(pBusy.value);  // the busy core's forgone output is charged
  });

  it("does not propose a colony whose value goes non-positive after the seed-pop cost", () => {
    // Low-value candidate (one housing level of land) seeded off a fully-staffed, very-high-output
    // source: the forgone-output cost swamps its worth, so the AI declines to drain the core for it.
    const busy = staffedSource("busy", 10, 100000);
    const housingCost = effectiveSpaceCost(HOUSING_TYPE);
    const tiny: ColonyEstablishCandidate = { ...candidate({ systemId: "c-tiny", habitableSpace: housingCost }), sourceSystemId: "busy" };
    expect(planFactionColonyProposals("f1", [busy], [tiny], [], COLONY_PARAMS)).toHaveLength(0);
  });

  // ── Settler-supply founding gate (anti-sprawl) ──
  // A full core (pop == popCap ⇒ not hungry) with 100 idle spare pops and no industry (labourDemand 0).
  const supplyCore: BuildSystemState = {
    systemId: "core", factionId: "f1", control: "developed", population: 100, unrest: 0,
    buildings: { [HOUSING_TYPE]: 100 / POP_CENTRE_DENSITY }, slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, goods: [],
  };

  it("caps new colony foundings to the settler-supply budget, keeping the best-valued", () => {
    // releasable = 100 spare; minSettlerSupply 20 ⇒ affordable floor(100/20) = 5; no hungry colonies ⇒
    // budget 5. Candidates differ in habitable land (⇒ distinct colony value, since value ∝ habitableSpace),
    // so this also pins the descending value-sort: the gate must keep the 5 LARGEST (c5–c9), not just any
    // 5 — with identical candidates a reversed comparator would pass the count assertion alone.
    const candidates = Array.from({ length: 10 }, (_, i) => candidate({ systemId: `c${i}`, habitableSpace: (i + 1) * 100 }));
    const gated = { ...COLONY_PARAMS, minSettlerSupply: 20, employedLeakFraction: 0 };
    const proposals = planFactionColonyProposals("f1", [supplyCore], candidates, [], gated);
    expect(proposals).toHaveLength(5);
    expect(new Set(proposals.map((p) => p.systemId))).toEqual(new Set(["c5", "c6", "c7", "c8", "c9"]));
  });

  it("stops founding once hungry colonies already consume the settler supply", () => {
    // Five hungry colonies (developed, pop 2 below their popCap 20) already soak the budget:
    // releasable 100 + 5×2 = 110 ⇒ affordable 5, minus 5 hungry ⇒ budget 0, so nothing new is founded.
    const hungry: BuildSystemState[] = Array.from({ length: 5 }, (_, i) => ({
      systemId: `h${i}`, factionId: "f1", control: "developed", population: 2, unrest: 0,
      buildings: { [HOUSING_TYPE]: 1 }, slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 100, goods: [],
    }));
    const gated = { ...COLONY_PARAMS, minSettlerSupply: 20, employedLeakFraction: 0 };
    const proposals = planFactionColonyProposals("f1", [supplyCore, ...hungry], [candidate({ habitableSpace: 100 })], [], gated);
    expect(proposals).toHaveLength(0);
  });

  it("does not gate when minSettlerSupply is 0 (disabled)", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => candidate({ systemId: `c${i}`, habitableSpace: 100 }));
    expect(planFactionColonyProposals("f1", [supplyCore], candidates, [], COLONY_PARAMS)).toHaveLength(8);
  });
});

describe("sizeColonyEstablish", () => {
  const params = { seedPop: 500, establishWork: 100 };

  it("sizes seed to the whole-level habitable cap with housing to house it", () => {
    const s = sizeColonyEstablish(3, params); // habitable 3 → 3 whole housing levels possible
    expect(s).not.toBeNull();
    if (s === null) return;
    // habitableSpace 3 / housingCost 1 → maxHousingLevels 3 → habitableCap 60; seedPop
    // min(500, 60) = 60; housingLevels min(3, ceil(60/20)=3) = 3 exactly.
    expect(s.housingLevels).toBe(3);
    expect(s.seedPop).toBeLessThanOrEqual(params.seedPop);
    expect(s.work).toBe(params.establishWork + s.housingLevels * workCostPerLevel(HOUSING_TYPE));
  });

  it("returns null when the site cannot hold one whole housing level", () => {
    expect(sizeColonyEstablish(0.4, params)).toBeNull();
  });
});
