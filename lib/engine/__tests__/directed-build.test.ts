import { describe, it, expect } from "vitest";
import { buildableUnits, buildableOutput, speculativeFloorExtra, planFactionBuilds, planFactionProposals, planFactionColonyProposals, factionGoodDeficits, fed, habitableHousingHeadroom, plannedHousingUnits, hopRouteCost, sizeColonyEstablish, type BuildSystemState, type BuildGoodState, type PlannedBuild, type Proposal, type ColonyEstablishCandidate, type ColonyEstablishParams } from "@/lib/engine/directed-build";
import { systemDevelopment, type DevelopmentRefs } from "@/lib/engine/development";
import { workCostPerLevel } from "@/lib/constants/construction";
import type { WorldConstructionProject, WorldColonyEstablishProject } from "@/lib/world/types";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { emptyResourceVector, unitResourceVector, makeResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import { OUTPUT_PER_UNIT, BUILDING_TYPES, labourTotal, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, COMPLEX_TYPES, HEAVY_INDUSTRY_COMPLEX, ANCHOR_MIN_THROUGHPUT, ANCHOR_FOOTPRINT, effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { TARGET_COVER } from "@/lib/constants/market-economy";
import { labourDemand, housingPopCap } from "@/lib/engine/industry";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import type { ResourceVector } from "@/lib/types/game";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";
import { SHORTAGE_SATISFACTION } from "@/lib/constants/economy";

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

const reachable: RouteCost = () => 1;

describe("planFactionProposals — flow-aware coverage netting (§3.1)", () => {
  // The shared assessor's persistence updates are its observable gap output: a good left with an
  // uncovered residual advances its proposalCycles, a fully-covered good resets to 0. Each sink here
  // carries one prior assessment (proposalCycles 1), so a surviving residual reads as 2 and a
  // cancelled one as 0 — pinning the flow-aware coverage netting the two planners now share.
  const allReachable: RouteCost = () => 1;

  // A developed sink with an uncovered `ore` gap (demand D, no built capacity) and one prior assessment.
  function sink(systemId: string, demand: number): BuildSystemState {
    return {
      systemId, factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 1, targetStock: 20, demand, production: 0, capacityProduction: 0, proposalCycles: 1 }],
    };
  }

  // A developed exporter whose built capacity already meets its own demand (never a gap of its own),
  // shipping the given spare export RATE (production − demand).
  function exporter(systemId: string, spare: number): BuildSystemState {
    const demand = 4;
    return {
      systemId, factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 100, targetStock: 50, demand, production: demand + spare, capacityProduction: demand + spare }],
    };
  }

  function oreCycles(plan: ReturnType<typeof planFactionProposals>, systemId: string): number | undefined {
    return plan.persistenceUpdates.find((u) => u.systemId === systemId && u.goodId === "ore")?.proposalCycles;
  }

  it("leaves a residual (persistence advances) when a reachable exporter only partly covers the gap", () => {
    // Sink gap = 1.10 × 10 = 11; exporter spare 3 → coveredFraction 3/11 → residual ~8 > 0 → advances to 2.
    const plan = planFactionProposals([sink("A", 10), exporter("B", 3)], allReachable, [], DEV_REFS);
    expect(oreCycles(plan, "A")).toBe(2);
  });

  it("cancels the gap (persistence resets) when the exporter's spare fully covers it", () => {
    // Exporter spare 16 ≥ the sink's 11 gap → coveredFraction 1 → residual 0 → resets to 0.
    const plan = planFactionProposals([sink("A", 10), exporter("B", 16)], allReachable, [], DEV_REFS);
    expect(oreCycles(plan, "A")).toBe(0);
  });

  it("nets one exporter's spare across competing sinks (no double-coverage)", () => {
    // Two sinks (gap 11 each, 22 total) share one exporter's spare 14 → coveredFraction 14/22 → each
    // keeps a residual → both advance. Spare exceeds a single sink's gap, so a per-sink (rather than
    // shared) cancellation would fully cover and reset both — the assertion separates the two models.
    const plan = planFactionProposals([sink("A", 10), sink("C", 10), exporter("B", 14)], allReachable, [], DEV_REFS);
    expect(oreCycles(plan, "A")).toBe(2);
    expect(oreCycles(plan, "C")).toBe(2);
  });

  it("keeps the gap structural when the only exporter is unreachable", () => {
    // Ample spare, but no route reaches the sink → the gap stays uncovered → persistence advances.
    const noRouteFromExporter: RouteCost = (from) => (from === "B" ? null : 1);
    const plan = planFactionProposals([sink("A", 10), exporter("B", 50)], noRouteFromExporter, [], DEV_REFS);
    expect(oreCycles(plan, "A")).toBe(2);
  });

  it("does not let a draining pile (production ≤ demand) cancel the gap", () => {
    // The holder carries built capacity and stock but produces nothing (production 0 < demand) → no
    // export rate, so it never cancels; the sink stays structural. Logistics still ships its stock.
    const drainingPile: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 100, targetStock: 50, demand: 4, production: 0, capacityProduction: 8 }],
    };
    const plan = planFactionProposals([sink("A", 10), drainingPile], allReachable, [], DEV_REFS);
    expect(oreCycles(plan, "A")).toBe(2);
  });
});

describe("assessStructuralDeficits — isEconomicallyActive gate", () => {
  // Only developed systems contribute gaps or spare. A non-developed (unclaimed/controlled) sink or
  // exporter that WOULD otherwise qualify must be fully excluded: no proposal, no spare that cancels a
  // real gap, and no persistence write. Removing the gate would silently pass every other test in the file.
  const allReachable: RouteCost = () => 1;

  it("excludes non-developed systems from gaps, spare, and persistence writes", () => {
    // A developed sink with an uncovered ore gap (one prior assessment).
    const developedSink: BuildSystemState = {
      systemId: "D", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 1, targetStock: 20, demand: 10, production: 0, capacityProduction: 0, proposalCycles: 1 }],
    };
    // An UNCLAIMED exporter with ample ore spare — would fully cancel D's gap if it counted.
    const inactiveExporter: BuildSystemState = {
      systemId: "E", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 100, targetStock: 50, demand: 4, production: 50, capacityProduction: 50 }],
    };
    // An UNCLAIMED sink with its own ore gap and buildable land — would otherwise emit a proposal + persistence write.
    const inactiveSink: BuildSystemState = {
      systemId: "U", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: makeResourceVector({ ore: 10 }), generalSpace: 50, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 1, targetStock: 20, demand: 10, production: 0, capacityProduction: 0, proposalCycles: 1 }],
    };

    const plan = planFactionProposals([developedSink, inactiveExporter, inactiveSink], allReachable, [], DEV_REFS);

    // The inactive exporter's spare does not count → the developed sink's gap stays uncovered → persistence advances to 2.
    expect(plan.persistenceUpdates.find((u) => u.systemId === "D" && u.goodId === "ore")?.proposalCycles).toBe(2);
    // The inactive sink gets NO persistence write and NO proposal.
    expect(plan.persistenceUpdates.some((u) => u.systemId === "U")).toBe(false);
    expect(plan.proposals.some((p) => p.systemId === "U")).toBe(false);
    // The inactive exporter is neither candidate nor builder.
    expect(plan.persistenceUpdates.some((u) => u.systemId === "E")).toBe(false);
    expect(plan.proposals.some((p) => p.systemId === "E")).toBe(false);
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
      goods: [{ goodId: "food", stock: 1, targetStock: 10, demand: 10, production: 0, capacityProduction: 0 }],
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
      goods: [{ goodId: "metals", stock: 1, targetStock: 10, demand: 10, production: 0, capacityProduction: 0 }],
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
      buildings: {}, goods: [{ goodId: "food", stock: 1, targetStock: 10, demand: 10, production: 0, capacityProduction: 0 }],
    });
    const exporter = sysWith({
      systemId: "B", control: "developed", population: 100,
      slotCap: emptyResourceVector(), buildings: { food: 10 },
      goods: [{ goodId: "food", stock: 100, targetStock: 50, demand: 4, production: 30, capacityProduction: 30 }],
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
  it("sizes a tier-0 build to the demand RATE, not the 40-cycle stock target (over-extraction regression)", () => {
    // A developed system with an ample arable deposit: demand rate 20/tick, no local production,
    // ample labour. It reaches itself (self-cost) so it self-supplies. The stock model built
    // servedOutput/perUnit where servedOutput = targetStock − stock = 40×20 = 800 → ~228 food units
    // (deposit-capped over-extraction). The rate model builds toward the margined, rate-capped flow —
    // (1 + margin) × 20 × cap ≈ 8.8 output — a few whole levels, not the deposit-capped stock target.
    const rc = hopRouteCost(new Map(), DIRECTED_BUILD.MAX_HOPS, DIRECTED_BUILD.HOP_WEIGHT, DIRECTED_BUILD.SELF_COST);
    const sys: BuildSystemState = {
      systemId: "A", factionId: "F", control: "developed", population: 100000, unrest: 0,
      buildings: {}, slotCap: makeResourceVector({ arable: 1000 }), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 0, targetStock: TARGET_COVER * 20, demand: 20, production: 0, capacityProduction: 0 }],
    };
    const foodUnits = countFor(planFactionBuilds([sys], rc, DEV_REFS), "A", "food");
    // One assessment commits the margined, rate-capped share of the flow: (1 + margin) × demand × cap.
    const expectedFlow = (1 + DIRECTED_BUILD.PROVISION_MARGIN) * 20 * DIRECTED_BUILD.BUILD_RATE_CAP;
    // Capacity meets that committed flow, within one whole level (lumpy overshoot).
    expect(foodUnits * OUTPUT_PER_UNIT.food).toBeGreaterThanOrEqual(expectedFlow - OUTPUT_PER_UNIT.food);
    expect(foodUnits * OUTPUT_PER_UNIT.food).toBeLessThanOrEqual(expectedFlow + OUTPUT_PER_UNIT.food);
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
      goods: [{ goodId: "food", stock: 0, targetStock: 1, demand: smallDemand, production: 0, capacityProduction: 0 }],
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
      goods: [{ goodId: "ore", stock: 0, targetStock: 1, demand: 100000, production: 0, capacityProduction: 0 }],
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
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 10, targetStock: 10, demand: 5, capacityProduction: 0}],
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
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const surplus: BuildSystemState = {
      systemId: "S", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      // Rate exporter: produces 30 > its own demand 5 → a sustainable food source logistics can carry.
      goods: [{ goodId: "food", stock: 100, targetStock: 20, demand: 5, production: 30, capacityProduction: 30 }],
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
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "metals", stock: 1, targetStock: 20, demand: 5, capacityProduction: 0}],
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
      goods: [{ goodId: "food", stock: 10, targetStock: 10, demand: 5, capacityProduction: 0}],
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
      systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5, capacityProduction: 0}],
    };
    const deficitWater: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "water", stock: 1, targetStock: 20, demand: 5, capacityProduction: 0}],
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
        systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "metals", stock: 1, targetStock: 20, demand: 5, capacityProduction: 0}],
      },
      builder: {
        systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
        slotCap, generalSpace: 50, habitableSpace: 0, goods: [],
      },
      oreSurplus: {
        systemId: "S", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "ore", stock: 100, targetStock: 20, demand: 5, production: 0, capacityProduction: 0 }],
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
    // 30 > demand 0.5 → a structural exporter. The input gate must read 'surplus' via surplusDrawable
    // exactly as the logistics matcher does, or the planner refuses a factory whose inputs the
    // production-throttled exporter can in fact supply (the regression this branch guards against).
    // Demand is the anchor's own basis (targetStock = TARGET_COVER × demand, so 20 ⇒ 0.5); the
    // exporter's reserve is counted in cycles of that demand, and 22 clears it.
    const { deficit, builder, oreSurplus } = scenario();
    oreSurplus.goods = [{ goodId: "ore", stock: 22, targetStock: 20, demand: 0.5, production: 30, capacityProduction: 30 }];
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1, DEV_REFS), "B", "metals")).toBeGreaterThan(0);
  });

  it("does not greenlight the factory when the in-band input holder is a non-producer (no phantom source)", () => {
    // Same stock 22 in the 1.0–1.4× band, but production 0 → sitting on imported inventory, not a
    // structural exporter. surplusDrawable returns 0, so ore is not a reachable input and no metals
    // factory is built — mirroring the matcher's re-export guard at the build-planner gate.
    const { deficit, builder, oreSurplus } = scenario();
    oreSurplus.goods = [{ goodId: "ore", stock: 22, targetStock: 20, demand: 5, production: 0, capacityProduction: 0 }];
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1, DEV_REFS), "B", "metals")).toBe(0);
  });
});

describe("planFactionBuilds — relief housing", () => {
  it("does not build housing at a starved system", () => {
    const starved: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      // satisfaction 0 models the starving flow the fed-proxy now reads (low stock alone no longer counts).
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 100, civilianDemand: 100, capacityProduction: 0, satisfaction: 0 }],
    };
    expect(countFor(planFactionBuilds([starved], () => 1, DEV_REFS), "A", "housing")).toBe(0);
  });

  it("relieves a crowded system whose unrest sits at the maximum standing floor", () => {
    // The deadlock case: a very-high-tax world (tax floor 0.18) that is also full (crowding 0.05)
    // carries 0.23 standing unrest — more than any calm gate would admit. Its pop (98) is past the
    // trigger against its 5-level cap (100), and crowding is exactly what the housing would relieve,
    // so unrest must not hold the valve shut.
    const crowded: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 98, unrest: 0.23, control: "developed",
      buildings: { housing: 5 },
      slotCap: emptyResourceVector(), generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5, capacityProduction: 0}],
    };
    expect(countFor(planFactionBuilds([crowded], () => 1, DEV_REFS), "A", "housing")).toBeGreaterThan(0);
  });

  it("never builds housing past the habitable cap", () => {
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100000, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 1000, habitableSpace: 5,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5, capacityProduction: 0}],
    };
    const housing = countFor(planFactionBuilds([sys], () => 1, DEV_REFS), "A", "housing");
    expect(housing).toBeGreaterThan(0);
    expect(housing).toBeLessThanOrEqual(5); // habitableSpace 5 ÷ spaceCost 1
  });

  it("commits the full relief want, unthrottled by any per-pop budget", () => {
    // The housing pass commits floor(plannedHousingUnits) — the whole relief want — bounded only by
    // the habitable cap, never by a per-pop budget (that throttle was removed). Headroom is ample
    // here, so the relief target is the binding term and the commit equals that floored want. A
    // reintroduced pop×0.05-style budget (80 at pop 1600) would cap the commit below the relief
    // want — this pins that it does not.
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 1600, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 100000, habitableSpace: 100000,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5, capacityProduction: 0}],
    };
    const reliefWant = plannedHousingUnits(sys);
    expect(reliefWant).toBeGreaterThan(1); // a genuine multi-level commit, not a trivial one
    expect(countFor(planFactionBuilds([sys], () => 1, DEV_REFS), "A", "housing")).toBe(reliefWant);
  });

  it("does not co-build housing on the industry path (housing comes only from the housing pass)", () => {
    // Builder has NO habitable land: the housing pass cannot fire, so any housing here
    // would be the deleted co-build. Expect production, zero housing.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
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
          { goodId: goods[i % goods.length], stock: 1, targetStock: 20, demand: 5, capacityProduction: 0},
          { goodId: goods[(i + 1) % goods.length], stock: 1, targetStock: 20, demand: 5, capacityProduction: 0},
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
      goods: [{ goodId: "ore", stock: 0, targetStock: 1, demand: 1_000_000, production: 0, capacityProduction: 0 }],
    };
    const t0 = performance.now();
    const oreUnits = countFor(planFactionBuilds([sys], rc, DEV_REFS), "A", "ore");
    // Order-of-magnitude guard: an O(capUnits) descent over 100k levels takes seconds; the bound
    // stays far below that while shrugging off scheduler jitter under a loaded parallel run.
    expect(performance.now() - t0).toBeLessThan(250);
    expect(oreUnits).toBeGreaterThan(0);
    expect(oreUnits).toBeLessThanOrEqual(40 + 1e-9); // labour ceiling: 40×oreLabour ÷ oreLabour
  });
});

describe("fed", () => {
  // civilianDemand tells the gate whether anyone here wants the good, so it must be present for
  // these to exercise the genuine branches — omitting it reads as "nobody to feed", which is fed.
  const good = (partial: Partial<BuildGoodState> & { goodId: string }): BuildGoodState => ({
    stock: 20, targetStock: 20, demand: 10, civilianDemand: 10, capacityProduction: 0, ...partial,
  });
  const fedGoods = [good({ goodId: "food", satisfaction: 1 }), good({ goodId: "water", satisfaction: 1 })];

  it("is true when every survival good is delivered", () => {
    expect(fed(sysWith({ goods: fedGoods }))).toBe(true);
  });

  it("is false when a demanded survival good falls below the shortage line", () => {
    for (const goodId of ["food", "water"]) {
      const starved = [...fedGoods.filter((g) => g.goodId !== goodId), good({ goodId, satisfaction: SHORTAGE_SATISFACTION - 0.01 })];
      expect(fed(sysWith({ goods: starved })), goodId).toBe(false);
    }
  });

  it("is true exactly at the shortage line — the boundary is still rationing, not famine", () => {
    const rationed = [good({ goodId: "food", satisfaction: SHORTAGE_SATISFACTION }), good({ goodId: "water", satisfaction: 1 })];
    expect(fed(sysWith({ goods: rationed }))).toBe(true);
  });

  it("is true when the shortage is in a non-survival good — a medicine gap is not a reason to refuse shelter", () => {
    // The ambient barren-galaxy basket: staples arrive, the unmakeable tier-1 goods never do. A
    // basket-wide gate refused housing here, which is what locked a fed colony at its seed size.
    const ambient = [
      ...fedGoods,
      good({ goodId: "medicine", satisfaction: 0 }),
      good({ goodId: "consumer_goods", satisfaction: 0 }),
      good({ goodId: "textiles", satisfaction: 0 }),
    ];
    expect(fed(sysWith({ goods: ambient }))).toBe(true);
  });

  it("ignores industrial input starvation — the gate asks whether the PEOPLE are fed", () => {
    // A refinery world whose ore feed is dry but whose residents eat. Housing must not be blocked:
    // industry is a route out of a famine, not a reason to refuse shelter. Water carries no civilian
    // demand here, so the survival check has nobody to feed on it.
    const goods = [
      good({ goodId: "ore", stock: 0, targetStock: 100, demand: 500, civilianDemand: 0, satisfaction: 0 }),
      good({ goodId: "water", civilianDemand: 0, satisfaction: 0 }),
      good({ goodId: "food", satisfaction: 1 }),
    ];
    expect(fed(sysWith({ goods }))).toBe(true);
  });

  it("is true with no markets at all, and reads a missing satisfaction as delivered", () => {
    expect(fed(sysWith({ goods: [] }))).toBe(true);
    expect(fed(sysWith({ goods: [good({ goodId: "food" })] }))).toBe(true);
  });

  it("is true at maximum unrest — supply is the only gate on housing", () => {
    // Reinstating any calm term here would deadlock relief: a fully restive world is precisely the
    // one whose crowding the housing exists to relieve.
    expect(fed(sysWith({ goods: fedGoods, unrest: 1 }))).toBe(true);
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
  const fedGoods: BuildGoodState[] = [{ goodId: "food", stock: 20, targetStock: 20, demand: 5, civilianDemand: 5, capacityProduction: 0, satisfaction: 1 }];

  /** Occupancy r = pop ÷ popCap the site would sit at after committing `units` housing levels.
   *  popCap comes from the engine's own housingPopCap so the helper can never model a different
   *  cap than the code under test. */
  function occupancyAfter(sys: BuildSystemState, units: number): number {
    const built = { ...sys.buildings, [HOUSING_TYPE]: (sys.buildings[HOUSING_TYPE] ?? 0) + units };
    return sys.population / housingPopCap(built);
  }

  it("builds nothing while occupancy is still below the relief trigger", () => {
    // pop 94 in a 5-level colony (popCap 100) → r = 0.94 ≤ RELIEF_TRIGGER: there is no pressure to
    // relieve yet, and housing no longer runs ahead of population on a margin.
    expect(plannedHousingUnits(sysWith({
      population: 94, buildings: { housing: 5 }, generalSpace: 100, habitableSpace: 100, goods: fedGoods,
    }))).toBe(0);
  });

  it("builds once occupancy rises past the relief trigger", () => {
    // The same colony two people later: r = 0.96 > RELIEF_TRIGGER, so the valve opens.
    expect(plannedHousingUnits(sysWith({
      population: 96, buildings: { housing: 5 }, generalSpace: 100, habitableSpace: 100, goods: fedGoods,
    }))).toBeGreaterThan(0);
  });

  it("sizes the build to bring occupancy back to the relief target", () => {
    // A colony well past its cap (pop 200 against popCap 100) with ample land: the committed levels
    // must land r at RELIEF_TARGET or below, and one level fewer must not — so the sizing is the
    // target, not merely "back under the trigger" or an unbounded fill.
    const sys = sysWith({
      population: 200, buildings: { housing: 5 }, generalSpace: 1000, habitableSpace: 1000, goods: fedGoods,
    });
    const units = plannedHousingUnits(sys);
    expect(units).toBeGreaterThan(1); // genuine multi-level relief, not the one-level floor
    expect(occupancyAfter(sys, units)).toBeLessThanOrEqual(DIRECTED_BUILD.RELIEF_TARGET);
    expect(occupancyAfter(sys, units - 1)).toBeGreaterThan(DIRECTED_BUILD.RELIEF_TARGET);
  });

  it("commits one whole level when the relief want is a fraction of one", () => {
    // A 1-level seed colony exactly at its cap (pop 20, popCap 20) wants 0.09 of a level. Flooring
    // that would leave the valve shut forever while occupancy kept climbing, so it rounds up.
    expect(plannedHousingUnits(sysWith({
      population: 20, buildings: { housing: 1 }, generalSpace: 100, habitableSpace: 100, goods: fedGoods,
    }))).toBe(1);
  });

  it("rehouses stranded population when the site has no housing left at all", () => {
    // popCap 0 with fed survivors still resident — the collapse-recovery path. Any positive pop is
    // past the trigger here, and the build is sized to house them at the relief target.
    const sys = sysWith({
      population: 30, buildings: {}, generalSpace: 100, habitableSpace: 100, goods: fedGoods,
    });
    const units = plannedHousingUnits(sys);
    expect(units).toBeGreaterThan(0);
    expect(occupancyAfter(sys, units)).toBeLessThanOrEqual(DIRECTED_BUILD.RELIEF_TARGET);
  });

  it("builds nothing when there is nobody to relieve", () => {
    // No population means no occupancy pressure at any cap — including the degenerate popCap 0,
    // where an unguarded ratio would be 0/0. A negative pop (never emitted) floors to the same.
    const empty = { generalSpace: 100, habitableSpace: 100, goods: fedGoods };
    expect(plannedHousingUnits(sysWith({ ...empty, population: 0, buildings: {} }))).toBe(0);
    expect(plannedHousingUnits(sysWith({ ...empty, population: 0, buildings: { housing: 3 } }))).toBe(0);
    expect(plannedHousingUnits(sysWith({ ...empty, population: -5, buildings: {} }))).toBe(0);
  });

  it("returns 0 when the system is not fed", () => {
    // Crowded well past the trigger but starving: supply is the one gate relief still waits on.
    const starved = [{ goodId: "food", stock: 1, targetStock: 20, demand: 100, civilianDemand: 100, capacityProduction: 0, satisfaction: 0 }];
    expect(plannedHousingUnits(sysWith({
      population: 200, buildings: { housing: 5 }, generalSpace: 100, habitableSpace: 100, goods: starved,
    }))).toBe(0);
  });

  it("returns 0 at the habitable cap even under relief pressure", () => {
    // pop 1200 against popCap 1000 (r = 1.2) with every habitable unit already housed: the pressure
    // is real, the land is not there, and the valve stays shut rather than overbuilding.
    expect(plannedHousingUnits(sysWith({
      population: 1200, buildings: { housing: 50 }, generalSpace: 100, habitableSpace: 50, goods: fedGoods,
    }))).toBe(0);
  });

  it("clamps the relief build to the habitable headroom", () => {
    // Huge pop, 5 units of habitable land: the target wants thousands of levels, the land allows 5.
    expect(plannedHousingUnits(sysWith({
      population: 100000, buildings: {}, generalSpace: 1000, habitableSpace: 5, goods: fedGoods,
    }))).toBe(5);
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
        systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
        goods: [{ goodId: "ore", stock: 1, targetStock: 50, demand: 50, capacityProduction: 0}],
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
      goods: [{ goodId: "ore", stock: 50, targetStock: 50, demand: 20, capacityProduction: 0}],
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
      systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "ore", stock: 1, targetStock: 50, demand: 50, capacityProduction: 0}],
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
    systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId, stock: 1, targetStock: 20, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
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
    systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "metals", stock: 1, targetStock: 1000, demand: 500, capacityProduction: 0}],
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
  deficit.goods = [{ goodId: "metals", stock: 0, targetStock: 7, demand: 5, capacityProduction: 0}];
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
    systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "metals", stock: 1, targetStock: 30, demand: ANCHOR_MIN_THROUGHPUT * 3, production: 0, capacityProduction: 0 }],
  };
  const deficitFuel: BuildSystemState = {
    systemId: "C", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "fuel", stock: 1, targetStock: 30, demand: ANCHOR_MIN_THROUGHPUT * 3, production: 0, capacityProduction: 0 }],
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
  // The assessment commits (1 + margin) × demand × cap of the flow. Size that committed deficit to sit
  // between one site's unbuffed capacity output (capUnits × 1.0×) and the anchored site's buffed output
  // (× 1.4×), so both sites are capacity-limited at score time and C's buffed per-unit ranks it first.
  const committedDeficit = capUnits * OUTPUT_PER_UNIT.metals * 1.15;
  const demand = committedDeficit / ((1 + DIRECTED_BUILD.PROVISION_MARGIN) * DIRECTED_BUILD.BUILD_RATE_CAP);
  const deficit: BuildSystemState = {
    systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    goods: [{ goodId: "metals", stock: 0, targetStock: 1, demand, production: 0, capacityProduction: 0 }],
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
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5, capacityProduction: 0}],
    });
    const proposals = planFactionProposals([site], () => 1, [], DEV_REFS).proposals;
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
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 0, goods: [], // no habitable land → isolate industry
    };
    const proposals = planFactionProposals([deficit, builder], () => 1, [], DEV_REFS).proposals;
    const food = proposals.find((p) => p.role === "industry" && p.items.some((i) => i.buildingType === "food"));
    expect(food).toBeDefined();
    expect(food!.value).toBeGreaterThan(0);                     // it serves real demand
    expect(food!.value).toBeLessThanOrEqual(5 + 1e-9);          // never more than the deficit it serves
    const expectedWork = food!.items.reduce((s, i) => s + i.levels * workCostPerLevel(i.buildingType), 0);
    expect(food!.work).toBeCloseTo(expectedWork, 6);
  });

  it("bundles a co-built academy INTO the production's proposal, gate-first (not as a separate proposal)", () => {
    const proposals = planFactionProposals(makeElectronicsDeficitWithCapableSite(), selfAndNeighbourRoute, [], DEV_REFS).proposals;
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
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5, capacityProduction: 0}],
    });
    // Ten housing levels already under construction cover the whole pace-ahead target → no new housing.
    const open: WorldConstructionProject[] = [
      { kind: "build", id: "h", origin: "auto", factionId: "f1", systemId: "X", buildingType: HOUSING_TYPE, levels: 10, workTotal: 80, workDone: 0 },
    ];
    expect(planFactionProposals([site], () => 1, [], DEV_REFS).proposals.some((p) => p.role === "housing")).toBe(true);
    expect(planFactionProposals([site], () => 1, open, DEV_REFS).proposals.some((p) => p.role === "housing")).toBe(false);
  });

  it("folds a queued gate (academy) into effective buildings so it is not re-proposed", () => {
    // The fold spreads ALL in-flight building types into effective buildings, gates included — not just
    // production. A: a persistent metals deficit (tier-1, draws skill1). B: an input-reachable builder
    // with no academy of its own, so serving the deficit normally co-builds a licensing academy.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, unrest: 0, control: "developed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "metals", stock: 1, targetStock: 20, demand: 10, capacityProduction: 0, proposalCycles: 1 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 5000, unrest: 0, control: "developed",
      buildings: { ore: 5 }, slotCap: emptyResourceVector(), generalSpace: 200, habitableSpace: 0, goods: [],
    };
    const metalsBundle = (open: WorldConstructionProject[]) =>
      planFactionProposals([deficit, builder], selfAndNeighbourRoute, open, DEV_REFS).proposals
        .find((p) => p.systemId === "B" && p.items.some((i) => i.buildingType === "metals"));

    // Without the queued gate, the metals bundle co-builds the vocational school that licenses it.
    const ungated = metalsBundle([]);
    expect(ungated?.items.some((i) => i.buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(true);

    // A queued vocational school at B folds into effective buildings, lifting the skill-1 ceiling — so
    // the same metals build no longer re-proposes the academy already in flight.
    const queuedGate: WorldConstructionProject[] = [
      { kind: "build", id: "g", origin: "auto", factionId: "f1", systemId: "B", buildingType: VOCATIONAL_SCHOOL_TYPE, levels: 1, workTotal: 50, workDone: 0 },
    ];
    const gated = metalsBundle(queuedGate);
    expect(gated).toBeDefined();                                                         // metals still builds
    expect(gated?.items.some((i) => i.buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);
  });

  it("flattening a proposal keeps its academy before the production it gates", () => {
    const flat = flatItems(planFactionProposals(makeElectronicsDeficitWithCapableSite(), selfAndNeighbourRoute, [], DEV_REFS).proposals);
    const schoolIdx = flat.findIndex((i) => i.buildingType === VOCATIONAL_SCHOOL_TYPE);
    const prodIdx = flat.findIndex((i) => i.buildingType === "electronics");
    expect(schoolIdx).toBeGreaterThanOrEqual(0);
    expect(prodIdx).toBeGreaterThanOrEqual(0);
    expect(schoolIdx).toBeLessThan(prodIdx);
  });
});

function policySystem(
  good: BuildGoodState,
  partial: Partial<BuildSystemState> = {},
): BuildSystemState {
  return {
    systemId: "P", factionId: "f1", control: "developed", population: 10_000, unrest: 0,
    buildings: {}, slotCap: makeResourceVector({ arable: 1_000, ore: 1_000 }), generalSpace: 1_000, habitableSpace: 0,
    goods: [good], ...partial,
  };
}

function policyGood(overrides: Partial<BuildGoodState> = {}): BuildGoodState {
  return {
    goodId: "ore", stock: 0, targetStock: 100, demand: 10, production: 0, capacityProduction: 0,
    proposalCycles: 1, ...overrides,
  };
}

describe("planFactionProposals: persistent structural policy", () => {
  it("keeps a 10% capacity margin, then caps the persistent residual before placement", () => {
    const plan = planFactionProposals([policySystem(policyGood({ demand: 100, production: 100, capacityProduction: 100 }))], () => 1, [], DEV_REFS);
    const ore = plan.proposals.find((proposal) => proposal.items.some((item) => item.buildingType === "ore"));
    expect(ore?.value).toBeCloseTo(4, 6); // 10 residual x 40%, before whole-level placement
    expect(plan.persistenceUpdates).toEqual([{ systemId: "P", goodId: "ore", proposalCycles: 2 }]);
  });

  it("does not grow at 110% capacity and resets recovered persistence", () => {
    const plan = planFactionProposals([policySystem(policyGood({ production: 10, capacityProduction: 11 }))], () => 1, [], DEV_REFS);
    expect(plan.proposals.filter((proposal) => proposal.role === "industry")).toEqual([]);
    expect(plan.persistenceUpdates).toEqual([{ systemId: "P", goodId: "ore", proposalCycles: 0 }]);
  });

  it("uses the larger of capacity and squeeze feedback gaps, excluding funding-bound feedback", () => {
    const active = planFactionProposals([policySystem(policyGood({ demand: 10, production: 10, capacityProduction: 11, squeezeCycles: 2, satisfaction: 0 }))], () => 1, [], DEV_REFS);
    const ore = active.proposals.find((proposal) => proposal.items.some((item) => item.buildingType === "ore"));
    expect(ore?.value).toBeCloseTo(4, 6); // max(0, 10), not 10 + 0

    const fundingBound = planFactionProposals([policySystem(policyGood({ production: 10, capacityProduction: 11, squeezeCycles: 2, satisfaction: 0, logisticsFundingBound: true }))], () => 1, [], DEV_REFS);
    expect(fundingBound.persistenceUpdates[0]?.proposalCycles).toBe(0);
  });

  it("still finds a structural deficit at a striking system with no capacity in the good", () => {
    // The lock this replaces: a strike anywhere at the system zeroed the need for EVERY good there,
    // including ones it has never produced — so a struck world could never be given the industry that
    // would end the shortage. With no capacity, output would be zero at any staffing level, so the
    // gap is structural and a strike explains none of it.
    const plan = planFactionProposals(
      [policySystem(policyGood({ demand: 10, production: 0, capacityProduction: 0, squeezeCycles: 2, satisfaction: 0, productionSuppressed: true }))],
      () => 1, [], DEV_REFS,
    );
    // capacityGap = 1.1 × 10 − 0 = 11, rate-capped to 11 × 0.4.
    const ore = plan.proposals.find((proposal) => proposal.items.some((item) => item.buildingType === "ore"));
    expect(ore?.value).toBeCloseTo(4.4, 6);
    expect(plan.persistenceUpdates[0]?.proposalCycles).toBe(2);
  });

  it("proposes only the shortfall a striking system's own capacity does not already cover", () => {
    // Capacity at 60% of demand: the strike explains the 60% that is not being produced right now,
    // but not the 40% the system could never have made — that part is still proposed.
    const short = planFactionProposals(
      [policySystem(policyGood({ demand: 10, production: 0, capacityProduction: 6, squeezeCycles: 2, satisfaction: 0, productionSuppressed: true }))],
      () => 1, [], DEV_REFS,
    );
    const ore = short.proposals.find((proposal) => proposal.items.some((item) => item.buildingType === "ore"));
    expect(ore?.value).toBeCloseTo((1.1 * 10 - 6) * 0.4, 6); // the missing capacity only

    // Capacity already past the provisioning margin: nothing structural is missing, and the squeeze
    // feedback IS explained by the strike — so this system proposes nothing at all. Without the
    // feedback exclusion its satisfaction-0 markets would read as a 10-unit gap.
    const covered = planFactionProposals(
      [policySystem(policyGood({ demand: 10, production: 0, capacityProduction: 12, squeezeCycles: 2, satisfaction: 0, productionSuppressed: true }))],
      () => 1, [], DEV_REFS,
    );
    expect(covered.proposals.filter((proposal) => proposal.role === "industry")).toEqual([]);
    expect(covered.persistenceUpdates[0]?.proposalCycles).toBe(0);
  });

  it("nets only REALIZED exporter spare before persistence — a striking exporter cancels nothing", () => {
    const sink = policySystem(policyGood(), { systemId: "sink" });
    const actualExporter = policySystem(policyGood({ demand: 0, production: 20, capacityProduction: 20 }), { systemId: "actual", slotCap: emptyResourceVector() });
    const actual = planFactionProposals([sink, actualExporter], () => 1, [], DEV_REFS);
    expect(actual.persistenceUpdates.find((update) => update.systemId === "sink")?.proposalCycles).toBe(0);

    // Same capacity, but struck and producing nothing. Counting its latent capacity as spare
    // cancelled the sink's gap against supply that never shipped; only realized output counts, so
    // the sink's deficit now survives to persistence.
    const latentExporter = policySystem(policyGood({ demand: 0, production: 0, capacityProduction: 20, productionSuppressed: true }), { systemId: "latent", slotCap: emptyResourceVector() });
    const latent = planFactionProposals([sink, latentExporter], () => 1, [], DEV_REFS);
    expect(latent.persistenceUpdates.find((update) => update.systemId === "sink")?.proposalCycles).toBe(2);
  });

  it("requires two residual assessments, saturates at two, and resets on recovery", () => {
    const first = planFactionProposals([policySystem(policyGood({ proposalCycles: 0 }))], () => 1, [], DEV_REFS);
    expect(first.proposals.filter((proposal) => proposal.role === "industry")).toEqual([]);
    expect(first.persistenceUpdates[0]?.proposalCycles).toBe(1);

    const second = planFactionProposals([policySystem(policyGood({ proposalCycles: 1 }))], () => 1, [], DEV_REFS);
    expect(second.proposals.some((proposal) => proposal.role === "industry")).toBe(true);
    expect(second.persistenceUpdates[0]?.proposalCycles).toBe(2);

    const saturated = planFactionProposals([policySystem(policyGood({ proposalCycles: 2 }))], () => 1, [], DEV_REFS);
    expect(saturated.persistenceUpdates[0]?.proposalCycles).toBe(2);

    const recovered = planFactionProposals([policySystem(policyGood({ proposalCycles: 2, production: 10, capacityProduction: 11 }))], () => 1, [], DEV_REFS);
    expect(recovered.persistenceUpdates[0]?.proposalCycles).toBe(0);
  });

  it("advances the proposal clock by the per-assessment reference-time (fractional cadences)", () => {
    // A finer-than-reference cadence (advance 0.5): four persistent assessments to reach the
    // two-reference-cycle threshold, and no proposal emits until the counter actually reaches it.
    let cycles = 0;
    for (const expected of [0.5, 1.0, 1.5, 2.0]) {
      const plan = planFactionProposals([policySystem(policyGood({ proposalCycles: cycles }))], () => 1, [], DEV_REFS, 0.5);
      expect(plan.persistenceUpdates[0]?.proposalCycles).toBeCloseTo(expected, 6);
      expect(plan.proposals.some((proposal) => proposal.role === "industry")).toBe(expected >= 2);
      cycles = plan.persistenceUpdates[0]?.proposalCycles ?? 0;
    }

    // A coarser-than-reference cadence (advance 2): one assessment saturates and is immediately eligible.
    const coarse = planFactionProposals([policySystem(policyGood({ proposalCycles: 0 }))], () => 1, [], DEV_REFS, 2);
    expect(coarse.persistenceUpdates[0]?.proposalCycles).toBe(2);
    expect(coarse.proposals.some((proposal) => proposal.role === "industry")).toBe(true);
  });

  it("caps each residual and preserves the combined 40% cap across systems", () => {
    const sixty = planFactionProposals([policySystem(policyGood({ demand: 600, production: 600, capacityProduction: 600 }))], () => 1, [], DEV_REFS);
    expect(sixty.proposals.find((proposal) => proposal.role === "industry")?.value).toBeCloseTo(24, 6);

    const a = policySystem(policyGood({ demand: 100, production: 100, capacityProduction: 100 }), { systemId: "a" });
    const b = policySystem(policyGood({ demand: 100, production: 100, capacityProduction: 100 }), { systemId: "b" });
    const combined = planFactionProposals([a, b], (from, to) => from === to ? 1 : null, [], DEV_REFS);
    const value = combined.proposals.filter((proposal) => proposal.role === "industry").reduce((sum, proposal) => sum + proposal.value, 0);
    expect(value).toBeCloseTo(8, 6);
  });

  it("counts every in-flight origin before placement, including its capacity and input demand", () => {
    const queuedFood: WorldConstructionProject[] = [
      { kind: "build", id: "manual-food", origin: "player", factionId: "f1", systemId: "P", buildingType: "ore", levels: 4, workTotal: 100, workDone: 1 },
    ];
    const settled = planFactionProposals([policySystem(policyGood())], () => 1, queuedFood, DEV_REFS);
    expect(settled.proposals.filter((proposal) => proposal.role === "industry")).toEqual([]);
    const queuedAuto: WorldConstructionProject[] = [{ ...queuedFood[0], id: "auto-ore", origin: "auto" }];
    const auto = planFactionProposals([policySystem(policyGood())], () => 1, queuedAuto, DEV_REFS);
    expect(auto.proposals.filter((proposal) => proposal.role === "industry")).toEqual([]);

    const queuedMetals: WorldConstructionProject[] = [
      { kind: "build", id: "auto-metals", origin: "auto", factionId: "f1", systemId: "P", buildingType: "metals", levels: 1, workTotal: 100, workDone: 1 },
    ];
    const inputPlan = planFactionProposals([
      policySystem(policyGood({ goodId: "ore", demand: 0, production: 0, capacityProduction: 0, proposalCycles: 0 }), {
        goods: [
          policyGood({ goodId: "ore", demand: 0, production: 0, capacityProduction: 0, proposalCycles: 0 }),
          policyGood({ goodId: "metals", demand: 0, production: 0, capacityProduction: 0, proposalCycles: 0 }),
        ],
      }),
    ], () => 1, queuedMetals, DEV_REFS);
    expect(inputPlan.persistenceUpdates.find((update) => update.goodId === "ore")?.proposalCycles).toBe(1);
  });
});
describe("planFactionBuilds: develop gate", () => {
  const buildable = { population: 100, generalSpace: 50, habitableSpace: 50, goods: [] };

  it("builds nothing at a fed system that is controlled but not developed", () => {
    const site = sysWith({ ...buildable, control: "controlled", buildings: {} });
    expect(fed(site)).toBe(true); // sanity: absent the gate it WOULD build housing
    expect(plannedHousingUnits(site)).toBeGreaterThan(0); // …and it genuinely wants some
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
      goods: [{ goodId: "food", stock: 0, targetStock: 500, demand: 50, production: 0, capacityProduction: 0 }],
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
      goods: [{ goodId: "food", stock: 0, targetStock: 500, demand: 50, production: 0, capacityProduction: 0 }],
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
      goods: [{ goodId: "food", stock: 0, targetStock: 500, demand: 50, production: 0, capacityProduction: 0 }],
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
      homeState({ systemId: "a", goods: [{ goodId: "food", stock: 0, targetStock: 0, demand: 30, production: 10, capacityProduction: 10 }] }),
      homeState({ systemId: "b", goods: [
        { goodId: "food", stock: 0, targetStock: 0, demand: 20, production: 5, capacityProduction: 5 },
        { goodId: "ore", stock: 0, targetStock: 0, demand: 5, production: 50, capacityProduction: 50 }, // surplus → no deficit
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
      goods: [{ goodId: "metals", stock: 0, targetStock: 0, demand: 40, production: 0, capacityProduction: 0 }],
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
    // Land-rich, so the whole-level habitable cap never clamps: housing is exactly the seed's own
    // need (ceil(2/20) = 1 level), with no spare level bundled on top.
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
    expect(poor.housingLevels).toBe(2); // exactly the clamped seed's own need — no spare level
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
      goods: [{ goodId: "ore", stock: 0, targetStock: 0, demand: 0, production: output, capacityProduction: output }],
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

  it("land-tight: the seed clamp caps an oversized seed to what the site can house", () => {
    const s = sizeColonyEstablish(3, params); // habitable 3 → 3 whole housing levels possible
    expect(s).not.toBeNull();
    if (s === null) return;
    // habitableSpace 3 / housingCost 1 → maxHousingLevels 3 → habitableCap 60; seedPop min(500, 60) = 60,
    // whose own need is ceil(60/20) = 3 levels — exactly what the site fits. The SEED clamp is what
    // binds; the maxHousingLevels clamp downstream of it can no longer bind at all now the headroom
    // level is gone, and is kept only so the two cannot drift apart. Opens fully occupied (r = 1.0).
    expect(s.seedPop).toBe(60);
    expect(s.housingLevels).toBe(3);
    expect(s.seedPop).toBe(s.housingLevels * POP_CENTRE_DENSITY); // r = 1.0 exactly
    expect(s.work).toBe(params.establishWork + s.housingLevels * workCostPerLevel(HOUSING_TYPE));
  });

  it("land-rich: sizes to the seed's own need alone, bundling no spare level", () => {
    const richParams = { seedPop: 30, establishWork: 100 };
    const s = sizeColonyEstablish(10, richParams); // habitable 10 → 10 whole housing levels possible, plenty of room
    expect(s).not.toBeNull();
    if (s === null) return;
    // seedPop 30 is well under the 200-pop habitable cap (10 levels × 20), so land is not the binding
    // constraint — the seed alone sizes it, at ceil(30/20) = 2 levels. A bundled headroom level would
    // put popCap at 60 against 30 residents, a whole empty level that reads idle the moment it lands.
    expect(s.seedPop).toBe(30);
    expect(s.housingLevels).toBe(2);
    const popCap = s.housingLevels * POP_CENTRE_DENSITY;
    expect(popCap).toBeGreaterThanOrEqual(s.seedPop);          // viable by construction
    expect(popCap).toBeLessThan(s.seedPop + POP_CENTRE_DENSITY); // …and no whole level of slack
    // `work` scales with housingLevels, so the dropped level shows up here with no second change site.
    expect(s.work).toBe(richParams.establishWork + 2 * workCostPerLevel(HOUSING_TYPE));
  });

  it("returns null when the site cannot hold one whole housing level", () => {
    expect(sizeColonyEstablish(0.4, params)).toBeNull();
  });

  it("returns null rather than NaN sizing for a non-finite site", () => {
    // Every comparison against NaN is false, so a bare `housingLevels < 1` guard would pass a NaN
    // straight through into a construction project and thence into a save.
    expect(sizeColonyEstablish(Number.NaN, params)).toBeNull();
    expect(sizeColonyEstablish(10, { seedPop: Number.NaN, establishWork: 0 })).toBeNull();
  });

  it("keeps popCap ≥ seedPop at every seed size, including whole-level boundaries", () => {
    // The verb the player drives and the planner's own proposals both come through here, so the
    // viability guarantee has to hold across the boundary cases, not just the round ones.
    for (const seedPop of [1, 19, 20, 21, 39, 40, 41]) {
      const s = sizeColonyEstablish(1e6, { seedPop, establishWork: 0 });
      expect(s).not.toBeNull();
      if (s === null) continue;
      expect(s.housingLevels).toBe(Math.ceil(seedPop / POP_CENTRE_DENSITY));
      expect(s.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(seedPop);
    }
  });
});
