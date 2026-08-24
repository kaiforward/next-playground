import { describe, it, expect, vi } from "vitest";
import { buildableUnits, buildableOutput, speculativeFloorExtra, planFactionBuilds, planFactionProposals, planFactionColonyProposals, assessColonyCandidates, factionGoodDeficits, fed, habitableHousingHeadroom, plannedHousingUnits, hopRouteCost, sizeColonyEstablish, type BuildSystemState, type BuildGoodState, type PlannedBuild, type Proposal, type ColonyEstablishCandidate, type ColonyEstablishParams } from "@/lib/engine/directed-build";
import { systemDevelopment, type DevelopmentRefs } from "@/lib/engine/development";
import { workCostPerLevel } from "@/lib/constants/construction";
import type { WorldConstructionProject, WorldColonyEstablishProject } from "@/lib/world/types";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { emptyResourceVector, unitResourceVector, makeResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import { OUTPUT_PER_UNIT, BUILDING_TYPES, labourTotal, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, COMPLEX_TYPES, HEAVY_INDUSTRY_COMPLEX, ANCHOR_MIN_THROUGHPUT, effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
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
    systemId: "X", factionId: "f1", population: 100, control: "unclaimed", buildings: {},
    depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
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
      systemId, factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 1, demand, production: 0, capacityProduction: 0, proposalCycles: 1 }],
    };
  }

  // A developed exporter whose built capacity already meets its own demand (never a gap of its own),
  // shipping the given spare export RATE (production − demand).
  function exporter(systemId: string, spare: number): BuildSystemState {
    const demand = 4;
    return {
      systemId, factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 100, demand, production: demand + spare, capacityProduction: demand + spare }],
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
      systemId: "B", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 100, demand: 4, production: 0, capacityProduction: 8 }],
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
      systemId: "D", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 1, demand: 10, production: 0, capacityProduction: 0, proposalCycles: 1 }],
    };
    // An UNCLAIMED exporter with ample ore spare — would fully cancel D's gap if it counted.
    const inactiveExporter: BuildSystemState = {
      systemId: "E", factionId: "f1", population: 100, control: "unclaimed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 100, demand: 4, production: 50, capacityProduction: 50 }],
    };
    // An UNCLAIMED sink with its own ore gap and buildable land — would otherwise emit a proposal + persistence write.
    const inactiveSink: BuildSystemState = {
      systemId: "U", factionId: "f1", population: 100, control: "unclaimed", buildings: {},
      depositCounts: makeResourceVector({ ore: 10 }), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 1, demand: 10, production: 0, capacityProduction: 0, proposalCycles: 1 }],
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
      depositCounts: makeResourceVector({ arable: 5 }),
      peopleLand: 50, // small habitable land → low development against the universe reference
      goods: [{ goodId: "food", stock: 1, demand: 10, production: 0, capacityProduction: 0 }],
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
      depositCounts: makeResourceVector({ arable: 5, ore: 5 }),
      buildings: { ore: 4 },
    });
    expect(systemDevelopment(mature, DEV_REFS)).toBeGreaterThan(systemDevelopment(young, DEV_REFS));
    expect(speculativeFloorExtra(mature, "food", 0, DEV_REFS)).toBeLessThan(speculativeFloorExtra(young, "food", 0, DEV_REFS));
  });

  it("is zero for a basic the system has no local deposit for", () => {
    const noDeposit = foodColony({ population: 100, depositCounts: emptyResourceVector() });
    expect(speculativeFloorExtra(noDeposit, "food", 0, DEV_REFS)).toBe(0);
  });

  it("is zero for a non-basic good (specialisation survives)", () => {
    const site = foodColony({
      population: 100,
      depositCounts: makeResourceVector({ ore: 5 }),
      goods: [{ goodId: "metals", stock: 1, demand: 10, production: 0, capacityProduction: 0 }],
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
      depositCounts: makeResourceVector({ arable: 5 }), peopleLand: 50,
      buildings: {}, goods: [{ goodId: "food", stock: 1, demand: 10, production: 0, capacityProduction: 0 }],
    });
    const exporter = sysWith({
      systemId: "B", control: "developed", population: 100,
      depositCounts: emptyResourceVector(), buildings: { food: 10 },
      goods: [{ goodId: "food", stock: 100, demand: 4, production: 30, capacityProduction: 30 }],
    });
    // Flow-aware cancellation covers A's deficit (B's spare 26 ≥ 10), yet the nudge still stands up local food.
    const builds = planFactionBuilds([colony, exporter], reachable, DEV_REFS);
    expect(countFor(builds, "A", "food")).toBeGreaterThanOrEqual(1);
  });
});

// A tier-0 good (food → arable) with deposit slots; sys has space but partial build.
function tier0Sys(builtFood: number, foodSlots: number): BuildSystemState {
  const depositCounts = emptyResourceVector();
  // food's resource is arable — set via the building catalog's resource at runtime in the impl;
  // here we set every resource's cap so the test is independent of the food→resource mapping.
  for (const k of RESOURCE_TYPES) depositCounts[k] = foodSlots;
  return {
    systemId: "A", factionId: "f1", population: 100, control: "unclaimed",
    buildings: { food: builtFood }, depositCounts, peopleLand: 50, goods: [],
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

  it("returns Infinity capacity for a tier-1+ factory with no buildings standing — no land budget bounds it", () => {
    // metals is tier-1 (recipe { ore: 1 }); bills no land at all, so an empty site is already unbounded.
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "unclaimed", buildings: {},
      depositCounts: unitResourceVector(), peopleLand: 50, goods: [],
    };
    expect(buildableUnits(sys, "metals")).toBe(Infinity);
  });

  it("never reduces tier-1+ capacity by space already used by existing buildings — there is no land budget left to exhaust", () => {
    const full: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "unclaimed", buildings: { metals: 100 },
      depositCounts: unitResourceVector(), peopleLand: 50, goods: [],
    };
    // metals bills no land at all — a hundred standing units leave capacity exactly as unbounded as
    // zero units would (Proves 1: the old land gate is deleted, not weakened).
    expect(buildableUnits(full, "metals")).toBe(Infinity);
  });

  it("returns zero capacity for an unknown good not in GOOD_TIER_BY_KEY", () => {
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "unclaimed", buildings: {},
      depositCounts: unitResourceVector(), peopleLand: 50, goods: [],
    };
    // "not_a_real_good" is not in GOOD_TIER_BY_KEY; should return 0, not divide by default footprint
    expect(buildableUnits(sys, "not_a_real_good")).toBe(0);
  });

  // Proves (3): factories never bill people land — a tier-1+ good's buildable capacity is
  // identical whether the system's people-land budget is zero or generous.
  it("is unaffected by people land (peopleLand) — a factory never draws on it", () => {
    const noPeopleLand: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "unclaimed", buildings: {},
      depositCounts: unitResourceVector(), peopleLand: 0, goods: [],
    };
    const generousPeopleLand: BuildSystemState = { ...noPeopleLand, peopleLand: 100000 };
    expect(buildableUnits(noPeopleLand, "metals")).toBeCloseTo(buildableUnits(generousPeopleLand, "metals"), 6);
  });

  // Proves (4): extractors bill neither budget — N tier-0 extractors leave both used-readings
  // unchanged (industry land's remaining capacity for a tier-1+ good is untouched by them).
  it("a tier-0 extractor never eats into a tier-1+ good's industry-land capacity", () => {
    const bare: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "unclaimed", buildings: {},
      depositCounts: makeResourceVector({ ore: 1000 }), peopleLand: 50, goods: [],
    };
    const withExtractors: BuildSystemState = { ...bare, buildings: { food: 30 } }; // 30 tier-0 extractors
    expect(buildableUnits(withExtractors, "metals")).toBeCloseTo(buildableUnits(bare, "metals"), 6);
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
      systemId: "A", factionId: "F", control: "developed", population: 100000,
      buildings: {}, depositCounts: makeResourceVector({ arable: 1000 }), peopleLand: 0,
      goods: [{ goodId: "food", stock: 0, demand: 20, production: 0, capacityProduction: 0 }],
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
      systemId: "A", factionId: "F", control: "developed", population: 100,
      buildings: {}, depositCounts: makeResourceVector({ arable: 10 }), peopleLand: 0,
      goods: [{ goodId: "food", stock: 0, demand: smallDemand, production: 0, capacityProduction: 0 }],
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
      systemId: "A", factionId: "F", control: "developed", population: 100,
      buildings: {}, depositCounts: makeResourceVector({ ore: 1000 }), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: 100000, production: 0, capacityProduction: 0 }],
    };
    const oreUnits = countFor(planFactionBuilds([sys], rc, DEV_REFS), "A", "ore");
    expect(oreUnits).toBeGreaterThan(5);                          // a pop×0.05 budget would have capped this at 5
    expect(oreUnits).toBeLessThanOrEqual(100 / oreLabour + 1e-9); // labour ceiling: pop ÷ per-unit labour
  });

  it("builds tier-0 production at a site that can serve a reachable structural deficit", () => {
    // A: structural food deficit (no surplus anywhere). B: has arable slots + population budget, reachable from A.
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed", buildings: {},
      depositCounts, peopleLand: 50,
      goods: [{ goodId: "food", stock: 10, demand: 5, capacityProduction: 0}],
    };
    const builds = planFactionBuilds([deficit, builder], () => 1, DEV_REFS);
    expect(countFor(builds, "B", "food")).toBeGreaterThan(0);
    // Proactive housing accompanies the build (B is fed and calm with habitable land).
    expect(countFor(builds, "B", "housing")).toBeGreaterThan(0);
  });

  it("does not build where the good's deficit already has a reachable surplus", () => {
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const surplus: BuildSystemState = {
      systemId: "S", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      // Rate exporter: produces 30 > its own demand 5 → a sustainable food source logistics can carry.
      goods: [{ goodId: "food", stock: 100, demand: 5, production: 30, capacityProduction: 30 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed", buildings: {},
      depositCounts, peopleLand: 50, goods: [],
    };
    const builds = planFactionBuilds([deficit, surplus, builder], () => 1, DEV_REFS);
    expect(countFor(builds, "B", "food")).toBe(0);
  });

  it("gates a tier-1+ build until its inputs are locally produced (the cascade)", () => {
    // A: structural metals deficit. B: general space + budget but NO ore production and no reachable ore surplus.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "metals", stock: 1, demand: 5, capacityProduction: 0}],
    };
    const builderNoInput: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 50, goods: [],
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
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 50,
      goods: [{ goodId: "food", stock: 10, demand: 5, capacityProduction: 0}],
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
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;

    const deficitFood: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0}],
    };
    const deficitWater: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "water", stock: 1, demand: 5, capacityProduction: 0}],
    };
    const builder: BuildSystemState = {
      systemId: "C", factionId: "f1", population: 10000, control: "developed", buildings: {},
      depositCounts, peopleLand: 50,
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
  //
  // A's population is pinned to 0 deliberately: a factory now bills no land at all (habitability-
  // seeding, Task 15), so A is otherwise just as eligible a metals SITE as B is — the old fixture
  // (industryLand: 0 at A) was what isolated "does B specifically manage to build" before; zero
  // population is the only ceiling left that can still do that job (labourDemand(0) + lead < 0 +
  // lead is false, so A can never staff even a fractional level).
  function scenario(): { deficit: BuildSystemState; builder: BuildSystemState; oreSurplus: BuildSystemState } {
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    return {
      deficit: {
        systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
        depositCounts: emptyResourceVector(), peopleLand: 0,
        goods: [{ goodId: "metals", stock: 1, demand: 5, capacityProduction: 0}],
      },
      builder: {
        systemId: "B", factionId: "f1", population: 200, control: "developed", buildings: {},
        depositCounts, peopleLand: 0, goods: [],
      },
      oreSurplus: {
        systemId: "S", factionId: "f1", population: 100, control: "unclaimed", buildings: {},
        depositCounts: emptyResourceVector(), peopleLand: 0,
        // The gate reconstructs the donor reserve from demand for a fixture that carries no `donorReserve`.
        goods: [{ goodId: "ore", stock: 100, demand: 0.5, production: 0, capacityProduction: 0 }],
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
    // The exporter's reserve is counted in cycles of its own demand (0.5), and 22 clears it.
    const { deficit, builder, oreSurplus } = scenario();
    oreSurplus.goods = [{ goodId: "ore", stock: 22, demand: 0.5, production: 30, capacityProduction: 30 }];
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1, DEV_REFS), "B", "metals")).toBeGreaterThan(0);
  });

  it("does not greenlight the factory when the in-band input holder is a non-producer (no phantom source)", () => {
    // Same stock 22 in the 1.0–1.4× band above its reserve of 20, but production 0 → sitting on
    // imported inventory, not a structural exporter. surplusDrawable returns 0, so ore is not a
    // reachable input and no metals factory is built — mirroring the matcher's re-export guard at the
    // build-planner gate.
    const { deficit, builder, oreSurplus } = scenario();
    oreSurplus.goods = [{ goodId: "ore", stock: 22, demand: 0.5, production: 0, capacityProduction: 0 }];
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1, DEV_REFS), "B", "metals")).toBe(0);
  });

  it("greenlights the factory from a floored input holder sitting above its own demand reserve", () => {
    // The gate reads the donor rule, not the price anchor. S is a small market: its anchor is pinned
    // at the MIN_DEMAND floor (20), while 40 cycles of the 0.01/cycle it really uses is a reserve of
    // 0.4. Stock 22 is under the anchor and far over the reserve, so the inputs a factory at B would
    // receive are there — and the fixture carries no `donorReserve`, so this is also the gate's
    // reconstruction of it from demand.
    const { deficit, builder, oreSurplus } = scenario();
    oreSurplus.goods = [{ goodId: "ore", stock: 22, demand: 0.01, production: 0, capacityProduction: 0 }];
    expect(countFor(planFactionBuilds([deficit, builder, oreSurplus], () => 1, DEV_REFS), "B", "metals")).toBeGreaterThan(0);
  });
});

describe("planFactionBuilds — relief housing", () => {
  it("does not build housing at a starved system", () => {
    const starved: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 50,
      // satisfaction 0 models the starving flow the fed-proxy now reads (low stock alone no longer counts).
      goods: [{ goodId: "food", stock: 1, demand: 100, civilianDemand: 100, capacityProduction: 0, satisfaction: 0 }],
    };
    expect(countFor(planFactionBuilds([starved], () => 1, DEV_REFS), "A", "housing")).toBe(0);
  });

  it("relieves a crowded system sitting right against its housing cap", () => {
    // The case relief housing exists for: pop (98) is past the trigger against a 5-level cap (100),
    // and crowding is exactly what the extra level would relieve. Nothing but supply may hold the
    // valve shut here — see the fed-gate docstring for why a calm term would deadlock it.
    const crowded: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 98, control: "developed",
      buildings: { housing: 5 },
      depositCounts: emptyResourceVector(), peopleLand: 50,
      goods: [{ goodId: "food", stock: 20, demand: 5, capacityProduction: 0}],
    };
    expect(countFor(planFactionBuilds([crowded], () => 1, DEV_REFS), "A", "housing")).toBeGreaterThan(0);
  });

  it("never builds housing past the habitable cap", () => {
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100000, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 5,
      goods: [{ goodId: "food", stock: 20, demand: 5, capacityProduction: 0}],
    };
    const housing = countFor(planFactionBuilds([sys], () => 1, DEV_REFS), "A", "housing");
    expect(housing).toBeGreaterThan(0);
    expect(housing).toBeLessThanOrEqual(5); // peopleLand 5 ÷ spaceCost 1
  });

  it("commits the full relief want, unthrottled by any per-pop budget", () => {
    // The housing pass commits floor(plannedHousingUnits) — the whole relief want — bounded only by
    // the habitable cap, never by a per-pop budget (that throttle was removed). Headroom is ample
    // here, so the relief target is the binding term and the commit equals that floored want. A
    // reintroduced pop×0.05-style budget (80 at pop 1600) would cap the commit below the relief
    // want — this pins that it does not.
    const sys: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 1600, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 100000,
      goods: [{ goodId: "food", stock: 20, demand: 5, capacityProduction: 0}],
    };
    const reliefWant = plannedHousingUnits(sys);
    expect(reliefWant).toBeGreaterThan(1); // a genuine multi-level commit, not a trivial one
    expect(countFor(planFactionBuilds([sys], () => 1, DEV_REFS), "A", "housing")).toBe(reliefWant);
  });

  it("does not co-build housing on the industry path (housing comes only from the housing pass)", () => {
    // Builder has NO habitable land: the housing pass cannot fire, so any housing here
    // would be the deleted co-build. Expect production, zero housing.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed", buildings: {},
      depositCounts, peopleLand: 0,
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
      const depositCounts = emptyResourceVector();
      for (const k of RESOURCE_TYPES) depositCounts[k] = 5;
      systems.push({
        systemId: `S${i}`,
        factionId: "f1",
        control: "developed",
        population: 100,
        buildings: {},
        depositCounts,
        peopleLand: 50,
        // Two distinct structural deficits per system (no surplus anywhere → all structural).
        goods: [
          { goodId: goods[i % goods.length], stock: 1, demand: 5, capacityProduction: 0},
          { goodId: goods[(i + 1) % goods.length], stock: 1, demand: 5, capacityProduction: 0},
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
      systemId: "A", factionId: "F", control: "developed", population: 40 * oreLabour,
      buildings: {}, depositCounts: makeResourceVector({ ore: 100000 }), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: 1_000_000, production: 0, capacityProduction: 0 }],
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
    stock: 20, demand: 10, civilianDemand: 10, capacityProduction: 0, ...partial,
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
      good({ goodId: "ore", stock: 0, demand: 500, civilianDemand: 0, satisfaction: 0 }),
      good({ goodId: "water", civilianDemand: 0, satisfaction: 0 }),
      good({ goodId: "food", satisfaction: 1 }),
    ];
    expect(fed(sysWith({ goods }))).toBe(true);
  });

  it("is true with no markets at all, and reads a missing satisfaction as delivered", () => {
    expect(fed(sysWith({ goods: [] }))).toBe(true);
    expect(fed(sysWith({ goods: [good({ goodId: "food" })] }))).toBe(true);
  });

  it("reads an OMITTED civilianDemand as nobody to feed, not as a starving population", () => {
    // Built without the `good()` helper on purpose: the helper always injects civilianDemand, so it
    // cannot exercise the `?? 0` default the field's docstring promises engine-test fixtures. A
    // survival good at satisfaction 0 with no civilian demand at all must still read as fed.
    const noDemand: BuildGoodState[] = [
      { goodId: "food", stock: 0, demand: 10, capacityProduction: 0, satisfaction: 0 },
      { goodId: "water", stock: 0, demand: 10, capacityProduction: 0, satisfaction: 0 },
    ];
    expect(fed(sysWith({ goods: noDemand }))).toBe(true);
  });

});

describe("habitableHousingHeadroom", () => {
  it("returns the remaining people-land budget alone, in housing units", () => {
    expect(habitableHousingHeadroom(sysWith({ peopleLand: 40 }))).toBeCloseTo(40);
  });

  it("subtracts existing housing from people land", () => {
    const sys = sysWith({ peopleLand: 40, buildings: { housing: 10 } });
    expect(habitableHousingHeadroom(sys)).toBeCloseTo(30); // habitable 40 - 10 = 30
  });

  // Proves (1): a system with industry land exactly full still builds housing given free people land.
  it("is unaffected by industry land being exactly full — housing and industry no longer compete for space", () => {
    const sys = sysWith({ peopleLand: 50, buildings: { metals: 20 } }); // industry land 20/20 used
    expect(habitableHousingHeadroom(sys)).toBeCloseTo(50); // people land 50, untouched by the full industry land
  });

  // Proves (2): people land full blocks housing despite vast free industry land.
  it("reads zero headroom when people land is full, no matter how much industry land is free", () => {
    const sys = sysWith({ peopleLand: 10, buildings: { housing: 10 } }); // people land 10/10 used
    expect(habitableHousingHeadroom(sys)).toBe(0);
  });
});

describe("plannedHousingUnits", () => {
  const fedGoods: BuildGoodState[] = [{ goodId: "food", stock: 20, demand: 5, civilianDemand: 5, capacityProduction: 0, satisfaction: 1 }];

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
      population: 94, buildings: { housing: 5 }, peopleLand: 100, goods: fedGoods,
    }))).toBe(0);
  });

  it("builds once occupancy rises past the relief trigger", () => {
    // The same colony two people later: r = 0.96 > RELIEF_TRIGGER, so the valve opens.
    expect(plannedHousingUnits(sysWith({
      population: 96, buildings: { housing: 5 }, peopleLand: 100, goods: fedGoods,
    }))).toBeGreaterThan(0);
  });

  it("sizes the build to bring occupancy back to the relief target", () => {
    // A colony well past its cap (pop 200 against popCap 100) with ample land: the committed levels
    // must land r at RELIEF_TARGET or below, and one level fewer must not — so the sizing is the
    // target, not merely "back under the trigger" or an unbounded fill.
    const sys = sysWith({
      population: 200, buildings: { housing: 5 }, peopleLand: 1000, goods: fedGoods,
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
      population: 20, buildings: { housing: 1 }, peopleLand: 100, goods: fedGoods,
    }))).toBe(1);
  });

  it("rehouses stranded population when the site has no housing left at all", () => {
    // popCap 0 with fed survivors still resident — the collapse-recovery path. Any positive pop is
    // past the trigger here, and the build is sized to house them at the relief target.
    const sys = sysWith({
      population: 30, buildings: {}, peopleLand: 100, goods: fedGoods,
    });
    const units = plannedHousingUnits(sys);
    expect(units).toBeGreaterThan(0);
    expect(occupancyAfter(sys, units)).toBeLessThanOrEqual(DIRECTED_BUILD.RELIEF_TARGET);
  });

  it("builds nothing when there is nobody to relieve", () => {
    // No population means no occupancy pressure at any cap — including the degenerate popCap 0,
    // where an unguarded ratio would be 0/0. A negative pop (never emitted) floors to the same.
    const empty = { peopleLand: 100, goods: fedGoods };
    expect(plannedHousingUnits(sysWith({ ...empty, population: 0, buildings: {} }))).toBe(0);
    expect(plannedHousingUnits(sysWith({ ...empty, population: 0, buildings: { housing: 3 } }))).toBe(0);
    expect(plannedHousingUnits(sysWith({ ...empty, population: -5, buildings: {} }))).toBe(0);
  });

  it("returns 0 when the system is not fed", () => {
    // Crowded well past the trigger but starving: supply is the one gate relief still waits on.
    const starved = [{ goodId: "food", stock: 1, demand: 100, civilianDemand: 100, capacityProduction: 0, satisfaction: 0 }];
    expect(plannedHousingUnits(sysWith({
      population: 200, buildings: { housing: 5 }, peopleLand: 100, goods: starved,
    }))).toBe(0);
  });

  it("returns 0 at the habitable cap even under relief pressure", () => {
    // pop 1200 against popCap 1000 (r = 1.2) with every habitable unit already housed: the pressure
    // is real, the land is not there, and the valve stays shut rather than overbuilding.
    expect(plannedHousingUnits(sysWith({
      population: 1200, buildings: { housing: 50 }, peopleLand: 50, goods: fedGoods,
    }))).toBe(0);
  });

  it("clamps the relief build to the habitable headroom", () => {
    // Huge pop, 5 units of habitable land: the target wants thousands of levels, the land allows 5.
    expect(plannedHousingUnits(sysWith({
      population: 100000, buildings: {}, peopleLand: 5, goods: fedGoods,
    }))).toBe(5);
  });
});

describe("planFactionBuilds — spare-labour gate", () => {
  // A: ore-starved consumer (pop 0). B: builder with ore slots + general space but NO
  // habitable land (so the housing pass never interferes — this isolates industry).
  function deficitAndBuilder(builderPop: number, builderBuildings: Record<string, number>): BuildSystemState[] {
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    return [
      {
        systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
        depositCounts: emptyResourceVector(), peopleLand: 0,
        goods: [{ goodId: "ore", stock: 1, demand: 50, capacityProduction: 0}],
      },
      {
        systemId: "B", factionId: "f1", population: builderPop, control: "developed",
        buildings: builderBuildings,
        depositCounts, peopleLand: 0, goods: [],
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
    const depositCounts = emptyResourceVector();
    depositCounts.ore = 4;
    const atPotential: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed",
      buildings: { housing: 5, ore: 4 },
      depositCounts, peopleLand: 5,
      goods: [{ goodId: "ore", stock: 50, demand: 20, capacityProduction: 0}],
    };
    expect(planFactionBuilds([atPotential], () => 1, DEV_REFS)).toHaveLength(0);
  });

  it("does not work deposit slots on a barren, low-habitable world", () => {
    // 56 ore slots but ~no habitable land → can't house labour → spareLabour 0 → no extraction.
    const depositCounts = emptyResourceVector();
    depositCounts.ore = 56;
    const barren: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 3, control: "developed",
      buildings: { ore: 3 / oreLabour }, // ore count × oreLabour == population → spareLabour 0
      depositCounts, peopleLand: 0.001,
      goods: [],
    };
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 1, demand: 50, capacityProduction: 0}],
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
    systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
    depositCounts: emptyResourceVector(), peopleLand: 0,
    goods: [{ goodId, stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
  };
}

// Electronics (tier-2, recipe { components, chemicals }) is a structural deficit at neighbour A;
// site B has ample population, general space, and locally produces both recipe inputs
// (so the input-reachability gate passes without needing a third surplus system) — but no
// academies yet, so both skill-1 and skill-2 ceilings must be lifted to serve the deficit.
function makeElectronicsDeficitWithCapableSite(): BuildSystemState[] {
  const capable: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 500, control: "developed",
    buildings: { components: 5, chemicals: 5 },
    depositCounts: emptyResourceVector(), peopleLand: 0,
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
  const depositCounts = emptyResourceVector();
  for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
  const capable: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 300, control: "developed", buildings: {},
    depositCounts, peopleLand: 0, goods: [],
  };
  return [deficitOnly("ore"), capable];
}

// Metals (tier-1, recipe { ore }, skill1-only) is a structural deficit at neighbour A; site B
// locally produces ore (input-reachable) and already has 10 vocational schools built —
// skill1Cap (1500) dwarfs any post-build skill1Demand this budget could possibly add, so the
// existing ceiling already covers the build and no new school should be built.
function makeTier1DeficitWithSchoolsAlready(): BuildSystemState[] {
  const capable: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 300, control: "developed",
    buildings: { ore: 5, [VOCATIONAL_SCHOOL_TYPE]: 10 },
    depositCounts: emptyResourceVector(), peopleLand: 0,
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
    systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
    depositCounts: emptyResourceVector(), peopleLand: 0,
    goods: [{ goodId: "metals", stock: 1, demand: 500, capacityProduction: 0}],
  };
  const producer: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 5000, control: "developed",
    buildings: { ore: 5 },
    depositCounts: emptyResourceVector(), peopleLand: 0,
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
  deficit.goods = [{ goodId: "metals", stock: 0, demand: 5, capacityProduction: 0}];
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
    systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
    depositCounts: emptyResourceVector(), peopleLand: 0,
    goods: [{ goodId: "metals", stock: 1, demand: ANCHOR_MIN_THROUGHPUT * 3, production: 0, capacityProduction: 0 }],
  };
  const deficitFuel: BuildSystemState = {
    systemId: "C", factionId: "f1", population: 0, control: "developed", buildings: {},
    depositCounts: emptyResourceVector(), peopleLand: 0,
    goods: [{ goodId: "fuel", stock: 1, demand: ANCHOR_MIN_THROUGHPUT * 3, production: 0, capacityProduction: 0 }],
  };
  const producer: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 5000, control: "developed",
    buildings: { ore: 5, gas: 5 },
    depositCounts: emptyResourceVector(), peopleLand: 0,
    goods: [],
  };
  return [deficitMetals, deficitFuel, producer];
}

// Two equidistant producers (`reachable` costs every route 1), same population, both able to host
// ore-fed metals: B is a bare greenfield, C already carries the heavy-industry complex. Tier-1+
// capacity is unbounded (buildableUnits — no land ceiling left to bind it), so neither site is
// capacity-limited; what differs is the marginal construction work per delivered unit (the score's
// score) — B must pay the complex's build cost (amortised over the deficit it would serve) to reach
// ANCHOR_MIN_THROUGHPUT, C already carries the complex and pays nothing, so C's lower cost-per-unit
// outranks B at the same proximity.
function anchoredVsGreenfieldScenario(): BuildSystemState[] {
  const capUnits = 20;
  const committedDeficit = capUnits * OUTPUT_PER_UNIT.metals * 1.15;
  const demand = committedDeficit / ((1 + DIRECTED_BUILD.PROVISION_MARGIN) * DIRECTED_BUILD.BUILD_RATE_CAP);
  const deficit: BuildSystemState = {
    systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
    depositCounts: emptyResourceVector(), peopleLand: 0,
    goods: [{ goodId: "metals", stock: 0, demand, production: 0, capacityProduction: 0 }],
  };
  const greenfield: BuildSystemState = {
    systemId: "B", factionId: "f1", population: 5000, control: "developed",
    buildings: { ore: 5 },
    depositCounts: emptyResourceVector(), peopleLand: 0,
    goods: [],
  };
  const anchored: BuildSystemState = {
    systemId: "C", factionId: "f1", population: 5000, control: "developed",
    buildings: { ore: 5, [HEAVY_INDUSTRY_COMPLEX]: 1 },
    depositCounts: emptyResourceVector(), peopleLand: 0,
    goods: [],
  };
  return [deficit, greenfield, anchored];
}

describe("complex co-build", () => {
  // The opportunity score prices the marginal construction work per delivered unit
  // directly (lib/engine/directed-build.ts, the tier-1+ branch of the score loop) instead of the
  // deleted capacity channel. C already anchors the family's complex, so it pays no complex
  // surcharge; B (equidistant, same population) would have to build one from scratch, so its
  // marginal work per unit is strictly higher and it ranks below C.
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

describe("construction-cost score — distance and staffing", () => {
  // Distance still matters: a complex-anchored site pays no complex surcharge, but a greenfield site
  // close enough to the demand still wins on route cost alone. Both sites carry local ore (satisfies
  // the input gate) and a population far beyond anything the marginal metals level could need
  // (staffingFactor ≈ 1 at both, so it does not confound the comparison).
  //
  // Crossover arithmetic (metals: OUTPUT_PER_UNIT 5, workCostPerLevel 20; heavy_industry_complex
  // workCostPerLevel 40, buffMult 1.4 — read via the constants, not hand-copied):
  //   demand 100 ⇒ rateDeficit D = (1 + PROVISION_MARGIN) × demand × BUILD_RATE_CAP = 1.1 × 100 × 0.4 = 44
  //   marginalWorkPerUnit(greenfield)  = 20/5 + 40/D = 4 + 40/44 ≈ 4.909  (pays the complex surcharge)
  //   marginalWorkPerUnit(anchored)    = 20/(5×1.4) = 20/7 ≈ 2.857        (already anchored, no surcharge)
  //   score(site) = (D / routeCost) / marginalWorkPerUnit(site)
  // At equal route cost the anchored site wins (2.857 < 4.909 ⇒ higher score) — that's the "snowball"
  // test above. Here the anchored site is pushed twice as far (route cost 2 vs 1): its score more than
  // halves (44/2/2.857 ≈ 7.70) while the greenfield's stays put (44/1/4.909 ≈ 8.97), so the greenfield
  // wins despite paying to build its own complex from scratch.
  it("a greenfield site wins over an anchored one once route cost outweighs the complex surcharge", () => {
    const demand = 100;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "metals", stock: 0, demand, production: 0, capacityProduction: 0 }],
    };
    const greenfield: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 1e9, control: "developed",
      buildings: { ore: 5 },
      depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
    };
    const anchoredButFar: BuildSystemState = {
      systemId: "C", factionId: "f1", population: 1e9, control: "developed",
      buildings: { ore: 5, [HEAVY_INDUSTRY_COMPLEX]: 1 },
      depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
    };
    const farRoute: RouteCost = (from, to) => {
      if (to !== "A") return null;
      if (from === "B") return 1;
      if (from === "C") return 2;
      return null;
    };
    const builds = planFactionBuilds([deficit, greenfield, anchoredButFar], farRoute, DEV_REFS);
    expect(countFor(builds, "B", "metals")).toBeGreaterThan(0);
    expect(countFor(builds, "C", "metals")).toBe(0);
  });

  // A site with LESS spare labour to staff the marginal unit must not outrank an otherwise-equal site
  // with more — and critically, the starved site here can still legally build if picked first (its
  // after-pick labour gate, `fitFor`, passes), so the only thing that can be relied on to route the
  // build to the better-staffed site is the RANKING itself, not the unchanged after-pick gate.
  //
  // Both sites already anchor the heavy-industry complex AND a vocational school sized well past
  // metals' skill-1 draw (so neither needs a fresh academy — `fitFor`'s labour draw is just the
  // production levels themselves) and carry the same local ore, at the same route cost, so
  // `demandProximity` and `marginalWorkPerUnit` are bit-identical between the two candidates; only
  // population differs. Numbers (metals: labour 18 unskilled + 7 skill1 = 25/level; ore: 10/level;
  // heavy_industry_complex: 12 unskilled; vocational_school: 15 unskilled, licenses 150 skill-1 —
  // metals' whole run here draws at most 7×7=49, well under that): base labour demand at
  // 5 ore + 1 complex + 1 school = 5×10 + 12 + 15 = 77; + one marginal metals level = 102. `starved`
  // (population 90) clears the after-pick gate (102 < 90 + 25 = 115) but its projected headroom
  // (90/102 ≈ 0.882) is strictly below `staffed` (population 300, fully covers 102 ⇒ factor 1) — so
  // `staffed` must outrank it.
  it("a site with less spare staffing does not outrank an otherwise-equal, better-staffed site", () => {
    const sharedBuildings = { ore: 5, [HEAVY_INDUSTRY_COMPLEX]: 1, [VOCATIONAL_SCHOOL_TYPE]: 1 };
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "metals", stock: 0, demand: 110, production: 0, capacityProduction: 0 }],
    };
    const starved: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 90, control: "developed",
      buildings: sharedBuildings,
      depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
    };
    const staffed: BuildSystemState = {
      systemId: "C", factionId: "f1", population: 300, control: "developed",
      buildings: sharedBuildings,
      depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
    };
    const builds = planFactionBuilds([deficit, starved, staffed], reachable, DEV_REFS);
    expect(countFor(builds, "C", "metals")).toBeGreaterThan(0);
    expect(countFor(builds, "B", "metals")).toBe(0);
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
      control: "developed", population: 100, peopleLand: 50,
      goods: [{ goodId: "food", stock: 20, demand: 5, capacityProduction: 0}],
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
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed", buildings: {},
      depositCounts, peopleLand: 0, goods: [], // no habitable land → isolate industry
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
      control: "developed", population: 100, peopleLand: 50,
      goods: [{ goodId: "food", stock: 20, demand: 5, capacityProduction: 0}],
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
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "metals", stock: 1, demand: 10, capacityProduction: 0, proposalCycles: 1 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 5000, control: "developed",
      buildings: { ore: 5 }, depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
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

describe("planFactionProposals — Build blocked (blockedBuilds)", () => {
  it("Proves 1 — a fully saturated system reports no-capacity, not absent (the pre-ranking capacity check, droppedRoi 0)", () => {
    // A: a genuine structural food deficit (a candidate opportunity is possible in principle).
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    // B: every deposit slot for food's resource (arable) already built out — capUnits <= 0 for food
    // at the VERY FIRST check, before a BuildOpportunity is ever constructed for this site×good.
    const saturated: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed",
      buildings: { food: 10 },
      depositCounts: makeResourceVector({ arable: 10 }), peopleLand: 0,
      goods: [],
    };
    const plan = planFactionProposals([deficit, saturated], () => 1, [], DEV_REFS);
    const blocked = plan.blockedBuilds.find((b) => b.systemId === "B");
    expect(blocked).toEqual({ systemId: "B", reason: "no-capacity", droppedRoi: 0 });
  });

  it("Proves 2 — a system whose only obstacle is an absent input supplier reports no-input-supplier, distinctly from no-capacity", () => {
    // Mirrors "gates a tier-1+ build until its inputs are locally produced" (planFactionBuilds,
    // above) — B has real space + labour for the tier-1+ metals factory, but no local ore
    // production and no reachable ore surplus, so :738 fires (capacity is real — never :737).
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "metals", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const builderNoInput: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 50, goods: [],
    };
    const plan = planFactionProposals([deficit, builderNoInput], () => 1, [], DEV_REFS);
    const blocked = plan.blockedBuilds.find((b) => b.systemId === "B");
    expect(blocked).toEqual({ systemId: "B", reason: "no-input-supplier", droppedRoi: 0 });
  });

  it("Proves 3 — a system whose opportunity landed this run reports absent, so the row clears without waiting for an abandonment", () => {
    // Reuses "emits an industry proposal with value>0" — B's food build actually lands.
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed", buildings: {},
      depositCounts, peopleLand: 0, goods: [],
    };
    const plan = planFactionProposals([deficit, builder], () => 1, [], DEV_REFS);
    // Sanity: the food build actually landed at B (else this test would pass vacuously).
    expect(plan.proposals.some((p) => p.systemId === "B" && p.items.some((i) => i.buildingType === "food"))).toBe(true);
    expect(plan.blockedBuilds.some((b) => b.systemId === "B")).toBe(false);
  });

  // "no-whole-level" stays
  // UNREACHABLE for any tier-1+ good — the construction-cost score touches only the RANKING loop, not
  // `maxLevels = Math.min(Math.floor(capUnits), Math.ceil(servedOutput / opp.perUnit))` in the
  // post-ranking loop below it, and `capUnits` is still `Infinity` for tier-1+ (buildableUnits — no
  // land ceiling left), so `Math.floor(capUnits)` still swallows the min whenever `servedOutput > 0`.
  // The original tier-1+ fixture is deleted rather than left skipped; the reason is not dead, though —
  // it is still real for TIER-0 goods, whose deposit-slot capacity is finite and untouched by this
  // task (Tier-0 scoring is explicitly out of scope). Revived below against a tier-0 extractor instead.
  it("reports no-whole-level when capacity is real but too small for even one whole level (the post-ranking whole-level check, droppedRoi > 0)", () => {
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    // Half a deposit slot: buildableUnits (tier-0) reads 0.5 — real, positive capacity, but
    // Math.floor(0.5) = 0 whole levels. Tier-0 scoring (capacity-capped, unlike tier-1+) still produces a
    // positive score off that same 0.5 units of capacity, so the drop is a RANKED one (droppedRoi > 0).
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed", buildings: {},
      depositCounts: makeResourceVector({ ore: 0.5 }), peopleLand: 0, goods: [],
    };
    const plan = planFactionProposals([deficit, builder], () => 1, [], DEV_REFS);
    const blocked = plan.blockedBuilds.find((b) => b.systemId === "B");
    expect(blocked?.reason).toBe("no-whole-level");
    expect(blocked?.droppedRoi).toBeGreaterThan(0);
  });

  it("reports no-labour when the space/labour fit search cannot staff even one level (the post-ranking binary search, droppedRoi > 0)", () => {
    // Mirrors "builds no industry when the builder has no spare labour" — pop is fully absorbed
    // by the existing extractors, so the binary search finds no level 1..maxLevels it can staff.
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 1, demand: 50, capacityProduction: 0, proposalCycles: 1 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 4 * oreLabour, control: "developed",
      buildings: { ore: 4 },
      depositCounts, peopleLand: 0, goods: [],
    };
    const plan = planFactionProposals([deficit, builder], () => 1, [], DEV_REFS);
    const blocked = plan.blockedBuilds.find((b) => b.systemId === "B");
    expect(blocked?.reason).toBe("no-labour");
    expect(blocked?.droppedRoi).toBeGreaterThan(0);
  });

  it("reports no-consumer when a higher-ranked opportunity at another site already claimed the whole deficit (post-ranking, droppedRoi > 0)", () => {
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    // Both B and C can each fully serve A's (small) deficit alone; B is nearer (cost 1) and so
    // outscores C (cost 2) — B's opportunity is processed first and claims the whole shortfall.
    const near: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 10_000, control: "developed", buildings: {},
      depositCounts, peopleLand: 0, goods: [],
    };
    const far: BuildSystemState = {
      systemId: "C", factionId: "f1", population: 10_000, control: "developed", buildings: {},
      depositCounts, peopleLand: 0, goods: [],
    };
    const routeCost: RouteCost = (from, to) => {
      if (from === to) return 0;
      if ((from === "B" && to === "A") || (from === "A" && to === "B")) return 1;
      if ((from === "C" && to === "A") || (from === "A" && to === "C")) return 2;
      return null;
    };
    const plan = planFactionProposals([deficit, near, far], routeCost, [], DEV_REFS);
    expect(plan.proposals.some((p) => p.systemId === "B" && p.items.some((i) => i.buildingType === "ore"))).toBe(true);
    const blocked = plan.blockedBuilds.find((b) => b.systemId === "C");
    expect(blocked?.reason).toBe("no-consumer");
    expect(blocked?.droppedRoi).toBeGreaterThan(0);
  });

  it("records no block for a site with no slot cap at all for the deficit good — only for one whose slots are used up", () => {
    // Every site is scanned against every good in deficit, so "capacity is 0" is reached both by a
    // site that filled its deposit slots and by one that never had a deposit. Only the first is a
    // blocked build; the second was never a plausible builder. The two arms are the same fixture
    // apart from B's arable slot cap, so nothing else can explain the difference.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const siteWith = (depositCounts: ResourceVector, buildings: Record<string, number>): BuildSystemState => ({
      systemId: "B", factionId: "f1", population: 200, control: "developed",
      buildings, depositCounts, peopleLand: 0, goods: [],
    });

    // No arable deposit anywhere on B: it could never host a food extractor, so it reports nothing.
    const noDeposit = planFactionProposals(
      [deficit, siteWith(emptyResourceVector(), {})], () => 1, [], DEV_REFS,
    );
    expect(noDeposit.blockedBuilds.some((b) => b.systemId === "B")).toBe(false);
    // The deficit system itself can build nothing either, and equally reports nothing.
    expect(noDeposit.blockedBuilds).toEqual([]);

    // Same site, same everything, except its two arable slots exist and are already built out —
    // now the capacity really is exhausted, and that IS a blocked build.
    const usedUp = planFactionProposals(
      [deficit, siteWith(makeResourceVector({ arable: 2 }), { food: 2 })], () => 1, [], DEV_REFS,
    );
    expect(usedUp.blockedBuilds.find((b) => b.systemId === "B"))
      .toEqual({ systemId: "B", reason: "no-capacity", droppedRoi: 0 });
  });

  it("a system carrying BOTH an unranked and a ranked drop reports the ranked one", () => {
    // The two maps reduce with ranked winning, which no fixture reached while every system had at
    // most one class of drop. C gets both in one run: metals (tier-1, no reachable ore surplus)
    // drops unranked before scoring, and ore drops ranked after B — nearer, so higher-scored —
    // has already claimed A's whole ore shortfall.
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [
        { goodId: "ore", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 },
        { goodId: "metals", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 },
      ],
    };
    const near: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 10_000, control: "developed", buildings: {},
      depositCounts, peopleLand: 0, goods: [],
    };
    const far: BuildSystemState = {
      systemId: "C", factionId: "f1", population: 10_000, control: "developed", buildings: {},
      depositCounts, peopleLand: 0, goods: [],
    };
    const routeCost: RouteCost = (from, to) => {
      if (from === to) return 0;
      if ((from === "B" && to === "A") || (from === "A" && to === "B")) return 1;
      if ((from === "C" && to === "A") || (from === "A" && to === "C")) return 2;
      return null;
    };
    const plan = planFactionProposals([deficit, near, far], routeCost, [], DEV_REFS);
    // Premise: B took the ore build, and metals reached nobody (no ore surplus to feed a factory).
    expect(plan.proposals.some((p) => p.systemId === "B" && p.items.some((i) => i.buildingType === "ore"))).toBe(true);
    expect(plan.proposals.some((p) => p.items.some((i) => i.buildingType === "metals"))).toBe(false);
    // C's unranked metals drop is real — B, which never gets a ranked drop, reports exactly it.
    expect(plan.blockedBuilds.find((b) => b.systemId === "B"))
      .toEqual({ systemId: "B", reason: "no-input-supplier", droppedRoi: 0 });
    // …and at C the ranked ore drop displaces it, carrying the score the sort actually ranked by.
    const blocked = plan.blockedBuilds.find((b) => b.systemId === "C");
    expect(blocked?.reason).toBe("no-consumer");
    expect(blocked?.droppedRoi).toBeGreaterThan(0);
  });

  it("Proves 6 (regression) — the planner's own decisions are unchanged: an unrelated existing scenario still lands exactly the same proposals", () => {
    // Re-runs one of the file's own pre-existing assertions verbatim. If instrumenting the nine
    // drop sites had touched a real conditional instead of only adding side-channel recording,
    // this is the kind of test that would go red.
    //
    // On its own it exercises one path (electronics into a capable site). The real guarantee that
    // the planner's decisions did not move is every other test in this file, unmodified and still
    // passing — this one is a named smoke check standing in front of them, not a substitute.
    const proposals = planFactionProposals(makeElectronicsDeficitWithCapableSite(), selfAndNeighbourRoute, [], DEV_REFS).proposals;
    const bundle = proposals.find((p) => p.items.some((i) => i.buildingType === "electronics"));
    expect(bundle).toBeDefined();
    const types = bundle!.items.map((i) => i.buildingType);
    expect(types).toContain(VOCATIONAL_SCHOOL_TYPE);
    expect(types).toContain(RESEARCH_INSTITUTE_TYPE);
    expect(types.indexOf(VOCATIONAL_SCHOOL_TYPE)).toBeLessThan(types.indexOf("electronics"));
  });
});

describe("planFactionProposals — Build opportunity (buildOpportunities)", () => {
  it("Proves 2 — a system whose best-scoring opportunity serves a non-survival good, but which also has a survival-serving one, persists the survival one", () => {
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 20;
    const builder = (): BuildSystemState => ({
      systemId: "B", factionId: "f1", population: 100_000, control: "developed", buildings: {},
      depositCounts, peopleLand: 0, goods: [],
    });
    const foodSink: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const oreSink: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 1, demand: 5000, capacityProduction: 0, proposalCycles: 1 }],
    };

    // Sanity: ore's own opportunity genuinely outscores food's alone — read directly off the new
    // `buildOpportunities` interface so the scenario's asymmetry is MEASURED, not assumed. Without
    // this, the combined assertion below could pass vacuously (food winning because it was the only
    // real opportunity, not because the band overrode a higher-scoring rival).
    const foodOnly = planFactionProposals([foodSink, builder()], () => 1, [], DEV_REFS);
    const oreOnly = planFactionProposals([oreSink, builder()], () => 1, [], DEV_REFS);
    const foodScore = foodOnly.buildOpportunities.find((o) => o.systemId === "B")?.score ?? 0;
    const oreScore = oreOnly.buildOpportunities.find((o) => o.systemId === "B")?.score ?? 0;
    expect(oreScore).toBeGreaterThan(foodScore);

    // Combined: B can score BOTH goods this run — the band must still pick food (survival) despite
    // ore's higher score.
    const combined: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [
        { goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 },
        { goodId: "ore", stock: 1, demand: 5000, capacityProduction: 0, proposalCycles: 1 },
      ],
    };
    const plan = planFactionProposals([combined, builder()], () => 1, [], DEV_REFS);
    const opp = plan.buildOpportunities.find((o) => o.systemId === "B");
    expect(opp?.goodId).toBe("food");
    expect(opp?.score).toBe(foodScore);
  });

  it("keeps the HIGHER-scoring of two same-band opportunities — the tiebreak the cross-band case never reaches", () => {
    // Proves 2 above pairs food (survival) against ore (non-survival), so it exercises only the
    // band comparison; the score comparison beside it is never the deciding branch there, and a
    // planner that kept the LOWER-scoring candidate within a band would pass it. Water and food are
    // both survival goods, so this pair lands in the same band and the score alone decides.
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 20;
    const builder = (): BuildSystemState => ({
      systemId: "B", factionId: "f1", population: 100_000, control: "developed", buildings: {},
      depositCounts, peopleLand: 0, goods: [],
    });
    const sinkWith = (goods: BuildGoodState[]): BuildSystemState => ({
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0, goods,
    });
    const waterGoods: BuildGoodState[] = [
      { goodId: "water", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 },
    ];
    const foodGoods: BuildGoodState[] = [
      { goodId: "food", stock: 1, demand: 5000, capacityProduction: 0, proposalCycles: 1 },
    ];

    // Measured, not assumed: the two survival goods really do score differently on their own, so
    // the combined case below cannot pass because they tie.
    const waterOnly = planFactionProposals([sinkWith(waterGoods), builder()], () => 1, [], DEV_REFS);
    const foodOnly = planFactionProposals([sinkWith(foodGoods), builder()], () => 1, [], DEV_REFS);
    const waterScore = waterOnly.buildOpportunities.find((o) => o.systemId === "B")?.score ?? 0;
    const foodScore = foodOnly.buildOpportunities.find((o) => o.systemId === "B")?.score ?? 0;
    expect(waterScore).toBeGreaterThan(0);
    expect(foodScore).toBeGreaterThan(waterScore);

    const combined = planFactionProposals(
      [sinkWith([...waterGoods, ...foodGoods]), builder()], () => 1, [], DEV_REFS,
    );
    const opp = combined.buildOpportunities.find((o) => o.systemId === "B");
    expect(opp?.goodId).toBe("food");
    expect(opp?.score).toBe(foodScore);
  });

  it("is absent for a system that scored nothing this run", () => {
    // Mirrors "Proves 1" above (fully saturated) — B has no free capacity for anything, so it never
    // reaches a BuildOpportunity at all, let alone a best-ranked one.
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "food", stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 }],
    };
    const saturated: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, control: "developed",
      buildings: { food: 10 },
      depositCounts: makeResourceVector({ arable: 10 }), peopleLand: 0,
      goods: [],
    };
    const plan = planFactionProposals([deficit, saturated], () => 1, [], DEV_REFS);
    expect(plan.buildOpportunities.some((o) => o.systemId === "B")).toBe(false);
  });

  it("Proves 5 — the planner's own decisions are unchanged: an unrelated existing scenario still lands exactly the same proposals", () => {
    // Recording the scored-opportunity side channel must not touch a single conditional in the
    // planner's own decision logic — mirrors Build blocked's own regression smoke test for the same
    // reason, re-run here because the opportunity scan edits the SAME function (`planFactionBundles`)
    // a second time.
    const proposals = planFactionProposals(makeElectronicsDeficitWithCapableSite(), selfAndNeighbourRoute, [], DEV_REFS).proposals;
    const bundle = proposals.find((p) => p.items.some((i) => i.buildingType === "electronics"));
    expect(bundle).toBeDefined();
    const types = bundle!.items.map((i) => i.buildingType);
    expect(types).toContain(VOCATIONAL_SCHOOL_TYPE);
    expect(types).toContain(RESEARCH_INSTITUTE_TYPE);
    expect(types.indexOf(VOCATIONAL_SCHOOL_TYPE)).toBeLessThan(types.indexOf("electronics"));
  });
});

function policySystem(
  good: BuildGoodState,
  partial: Partial<BuildSystemState> = {},
): BuildSystemState {
  return {
    systemId: "P", factionId: "f1", control: "developed", population: 10_000,
    buildings: {}, depositCounts: makeResourceVector({ arable: 1_000, ore: 1_000 }), peopleLand: 0,
    goods: [good], ...partial,
  };
}

function policyGood(overrides: Partial<BuildGoodState> = {}): BuildGoodState {
  return {
    goodId: "ore", stock: 0, demand: 10, production: 0, capacityProduction: 0,
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

  it("nets only REALISED exporter spare before persistence — a striking exporter cancels nothing", () => {
    const sink = policySystem(policyGood(), { systemId: "sink" });
    const actualExporter = policySystem(policyGood({ demand: 0, production: 20, capacityProduction: 20 }), { systemId: "actual", depositCounts: emptyResourceVector() });
    const actual = planFactionProposals([sink, actualExporter], () => 1, [], DEV_REFS);
    expect(actual.persistenceUpdates.find((update) => update.systemId === "sink")?.proposalCycles).toBe(0);

    // Same capacity, but struck and producing nothing. Counting its latent capacity as spare
    // cancelled the sink's gap against supply that never shipped; only realised output counts, so
    // the sink's deficit now survives to persistence.
    const latentExporter = policySystem(policyGood({ demand: 0, production: 0, capacityProduction: 20, productionSuppressed: true }), { systemId: "latent", depositCounts: emptyResourceVector() });
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

describe("planFactionProposals: strikeSuppressedProposals — per-eligible-pair suppression count", () => {
  it("a striking good with capacity increments both counters", () => {
    const plan = planFactionProposals(
      [policySystem(policyGood({ demand: 10, production: 0, capacityProduction: 12, squeezeCycles: 2, satisfaction: 0, productionSuppressed: true }))],
      () => 1, [], DEV_REFS,
    );
    expect(plan.strikeSuppressedProposals).toEqual({ suppressed: 1, eligible: 1 });
  });

  // The lock this pins: with no capacity, `strikeExplains` can never fire (`:319`), so the pair can
  // never have been a candidate for suppression in the first place. The capacity-gap term is
  // unconditional (`:314-318`) — this pair's deficit is proposed regardless of the strike — so
  // counting it as suppressed, or even as eligible for suppression, would invert the reading.
  it("a striking good with NO capacity is excluded from both counters, even though its capacity-gap deficit is still proposed", () => {
    const plan = planFactionProposals(
      [policySystem(policyGood({ demand: 10, production: 0, capacityProduction: 0, squeezeCycles: 2, satisfaction: 0, productionSuppressed: true }))],
      () => 1, [], DEV_REFS,
    );
    // Sanity, matching the pre-existing "still finds a structural deficit" test above: the deficit
    // fires despite the strike.
    const ore = plan.proposals.find((proposal) => proposal.items.some((item) => item.buildingType === "ore"));
    expect(ore).toBeDefined();
    expect(plan.strikeSuppressedProposals).toEqual({ suppressed: 0, eligible: 0 });
  });

  it("a calm (non-striking) good with capacity increments eligible only, so the rate is 0 rather than undefined", () => {
    const plan = planFactionProposals(
      [policySystem(policyGood({ demand: 10, production: 10, capacityProduction: 12 }))],
      () => 1, [], DEV_REFS,
    );
    expect(plan.strikeSuppressedProposals).toEqual({ suppressed: 0, eligible: 1 });
  });

  it("counts pairs, not systems — one striking system short in five goods contributes five", () => {
    const goodIds = ["water", "food", "ore", "textiles", "gas"];
    const plan = planFactionProposals(
      [policySystem(policyGood(), {
        goods: goodIds.map((goodId) =>
          policyGood({ goodId, demand: 10, production: 0, capacityProduction: 12, productionSuppressed: true }),
        ),
      })],
      () => 1, [], DEV_REFS,
    );
    expect(plan.strikeSuppressedProposals).toEqual({ suppressed: 5, eligible: 5 });
  });
});

describe("planFactionBuilds: develop gate", () => {
  const buildable = { population: 100, peopleLand: 50, goods: [] };

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
      systemId: "A", factionId: "F", control: "developed", population: 2,
      buildings: {}, depositCounts: makeResourceVector({ arable: 10 }), peopleLand: 100,
      goods: [{ goodId: "food", stock: 0, demand: 50, production: 0, capacityProduction: 0 }],
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
      systemId: "A", factionId: "F", control: "developed", population: 0,
      buildings: {}, depositCounts: makeResourceVector({ arable: 10 }), peopleLand: 100,
      goods: [{ goodId: "food", stock: 0, demand: 50, production: 0, capacityProduction: 0 }],
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
      systemId: "A", factionId: "F", control: "developed", population: 1000,
      buildings: {}, depositCounts: makeResourceVector({ arable: 10 }), peopleLand: 100,
      goods: [{ goodId: "food", stock: 0, demand: 50, production: 0, capacityProduction: 0 }],
    };
    const builds = planFactionBuilds([sys], rc, DEV_REFS);
    expect(builds.some((b) => b.systemId === "A" && b.buildingType === "food")).toBe(true);
  });
});

const COLONY_PARAMS: ColonyEstablishParams = {
  landPremium: COLONISATION.LAND_PREMIUM,
  landDepositWeight: COLONISATION.LAND_DEPOSIT_WEIGHT,
  sigmaFloor: COLONISATION.SIGMA_FLOOR,
  establishWork: COLONISATION.COLONY_ESTABLISH_WORK,
  seedPop: EXPANSION.COLONY_SEED_POP,
  habitableFloor: effectiveSpaceCost(HOUSING_TYPE),
  popCostWeight: COLONISATION.SEED_POP_COST_WEIGHT,
  minSettlerSupply: 0, // gate disabled by default — the valuation cases below isolate scoring, not founding pace
  employedLeakFraction: 0,
  charterMult: COLONISATION.CHARTER_FEE_SPEND_MULT,
  charterMin: COLONISATION.CHARTER_FEE_MIN,
  gateHeadroom: COLONISATION.FOUNDING_GATE_HEADROOM,
  foundingStockCover: COLONISATION.FOUNDING_STOCK_COVER,
  economyScale: 1,
};

/** A developed home system for the σ/missing/deficit aggregates. `housing` sets built pop-cap; `habitable`
 *  the potential — equal ⇒ σ = 1 (saturated). `goods` seed the faction rate deficits. */
function homeState(opts: {
  systemId?: string;
  housing?: number;
  peopleLand?: number;
  depositCounts?: ResourceVector;
  goods?: BuildGoodState[];
}): BuildSystemState {
  return {
    systemId: opts.systemId ?? "home", factionId: "f1", control: "developed", population: 1000,
    buildings: opts.housing ? { [HOUSING_TYPE]: opts.housing } : {},
    depositCounts: opts.depositCounts ?? emptyResourceVector(),
 peopleLand: opts.peopleLand ?? 0, goods: opts.goods ?? [],
  };
}

/** A controlled colony candidate with a seed source. */
function candidate(opts: {
  systemId?: string; peopleLand?: number; depositCounts?: ResourceVector;
}): ColonyEstablishCandidate {
  return {
    systemId: opts.systemId ?? "c1",
    peopleLand: opts.peopleLand ?? 100,
    depositCounts: opts.depositCounts ?? emptyResourceVector(),
    sourceSystemId: "home",
  };
}

describe("factionGoodDeficits", () => {
  it("sums each good's positive (demand − production) across developed systems", () => {
    const developed = [
      homeState({ systemId: "a", goods: [{ goodId: "food", stock: 0, demand: 30, production: 10, capacityProduction: 10 }] }),
      homeState({ systemId: "b", goods: [
        { goodId: "food", stock: 0, demand: 20, production: 5, capacityProduction: 5 },
        { goodId: "ore", stock: 0, demand: 5, production: 50, capacityProduction: 50 }, // surplus → no deficit
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
    const c = candidate({ peopleLand: 100 });
    // Unsaturated home: lots of unbuilt habitable land (σ ≈ 0) → land premium mostly dormant.
    const loose = planFactionColonyProposals("f1", [homeState({ housing: 1, peopleLand: 1000 })], [c], [], COLONY_PARAMS);
    // Saturated home: housing fills all habitable land (σ = 1) → full land premium live.
    const tight = planFactionColonyProposals("f1", [homeState({ housing: 5, peopleLand: 5 })], [c], [], COLONY_PARAMS);
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
      housing: 1, peopleLand: 1000, // σ ≈ 0 → land term nearly dormant
      depositCounts: emptyResourceVector(),   // zero ore slots → ore is a missing resource
      goods: [{ goodId: "metals", stock: 0, demand: 40, production: 0, capacityProduction: 0 }],
    });
    const keystone = candidate({ systemId: "ore-world", peopleLand: 5, depositCounts: oreVec });
    const barren = candidate({ systemId: "rock", peopleLand: 5, depositCounts: emptyResourceVector() });
    const [k] = planFactionColonyProposals("f1", [home], [keystone], [], COLONY_PARAMS);
    const [b] = planFactionColonyProposals("f1", [home], [barren], [], COLONY_PARAMS);
    // Same land (habitable 5); the keystone's ore deposit adds the metals deficit's demand as U.
    expect(k.value - b.value).toBeGreaterThan(0);
  });

  it("sizes the seed + bundled housing to the land, and prices establishWork = base + housing work", () => {
    const developed = [homeState({ housing: 1, peopleLand: 1000 })];
    // Land-rich: whole-level habitable cap ≫ seedPop → full seed.
    const [rich] = planFactionColonyProposals("f1", developed, [candidate({ systemId: "big", peopleLand: 100 })], [], COLONY_PARAMS);
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
    const [poor] = planFactionColonyProposals("f1", developed, [candidate({ systemId: "small", peopleLand: poorHabitable })], [], bigSeed);
    expect(poor.seedPop).toBe(Math.min(bigSeed.seedPop, 2 * POP_CENTRE_DENSITY));
    expect(poor.seedPop).toBeLessThan(bigSeed.seedPop);
    expect(poor.housingLevels).toBe(2); // exactly the clamped seed's own need — no spare level
    expect(poor.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(poor.seedPop);
  });

  it("skips a candidate below the habitable floor", () => {
    const developed = [homeState({ housing: 1, peopleLand: 1000 })];
    const belowFloor = candidate({ systemId: "dead", peopleLand: 0 });
    expect(planFactionColonyProposals("f1", developed, [belowFloor], [], COLONY_PARAMS)).toHaveLength(0);
  });

  // The colonisability floor gate (`peopleLand < habitableFloor`, directed-build.ts) sits UPSTREAM
  // of valuation — a below-floor candidate never reaches `colonyValue` at all, not merely one that
  // returns a proposal-suppressing result. Proposal-count assertions alone can't distinguish "gated
  // before scoring" from "scored and happened to net out non-positive"; spying on the real
  // `colonyValue` export makes the ordering itself the assertion.
  it("never calls colonyValue for a below-floor candidate, but does for an above-floor one", async () => {
    const colonisationValue = await import("@/lib/engine/colonisation-value");
    const spy = vi.spyOn(colonisationValue, "colonyValue");
    const developed = [homeState({ housing: 1, peopleLand: 1000 })];
    const belowFloor = candidate({ systemId: "dead", peopleLand: 0 });
    const aboveFloor = candidate({ systemId: "alive", peopleLand: 100 });

    planFactionColonyProposals("f1", developed, [belowFloor], [], COLONY_PARAMS);
    expect(spy).not.toHaveBeenCalled();

    planFactionColonyProposals("f1", developed, [aboveFloor], [], COLONY_PARAMS);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it("skips a candidate that clears the floor but lacks one whole housing level of land", () => {
    const developed = [homeState({ housing: 1, peopleLand: 1000 })];
    // Above the habitable floor (lowered here) yet under one housing level of land → maxHousingLevels 0,
    // so seedPop caps to 0 and the second gate drops it — no zero-housing colony is ever proposed.
    const sliver = candidate({ systemId: "sliver", peopleLand: effectiveSpaceCost(HOUSING_TYPE) * 0.5 });
    expect(
      planFactionColonyProposals("f1", developed, [sliver], [], { ...COLONY_PARAMS, habitableFloor: 0 }),
    ).toHaveLength(0);
  });

  it("does not re-propose a colony already in flight for that system", () => {
    const developed = [homeState({ housing: 1, peopleLand: 1000 })];
    const c = candidate({ systemId: "c1", peopleLand: 100 });
    const open: WorldColonyEstablishProject[] = [
      { kind: "colony_establish", id: "e", origin: "auto", factionId: "f1", systemId: "c1", sourceSystemId: "home", seedPop: 50, housingLevels: 3, workTotal: 84, workDone: 20, stagedManifest: [], charterPaid: true, stalledCycles: 0 },
    ];
    expect(planFactionColonyProposals("f1", developed, [c], [], COLONY_PARAMS)).toHaveLength(1);
    expect(planFactionColonyProposals("f1", developed, [c], open, COLONY_PARAMS)).toHaveLength(0);
  });

  it("carries kind, faction, system, and the fixed seed source through to the proposal", () => {
    const developed = [homeState({ housing: 1, peopleLand: 1000 })];
    const [p] = planFactionColonyProposals("f1", developed, [candidate({ systemId: "c1" })], [], COLONY_PARAMS);
    expect(p.kind).toBe("colony_establish");
    expect(p.factionId).toBe("f1");
    expect(p.systemId).toBe("c1");
    expect(p.sourceSystemId).toBe("home");
  });
});

describe("planFactionColonyProposals: affordability gate", () => {
  // Ten candidates of increasing land, so their values are distinct and strictly increasing in the
  // index — which pins that the gate keeps the BEST-valued prefix, not just the right number.
  const candidates = Array.from({ length: 10 }, (_, i) =>
    candidate({ systemId: `c${i}`, peopleLand: (i + 1) * 100 }),
  );

  it("spends a running balance down the value order, so one colony's worth of money commits one", () => {
    // charterMult 0 + charterMin 100 + headroom 0 ⇒ every candidate costs exactly 100 to commit to,
    // stated here rather than recomputed through the pricing functions the code under test uses.
    const flatFee = { ...COLONY_PARAMS, charterMult: 0, charterMin: 100, gateHeadroom: 0 };
    const developed = [homeState({ housing: 1, peopleLand: 1000 })];
    const propose = (balance: number) =>
      planFactionColonyProposals("f1", developed, candidates, [], flatFee, { balance, maintenanceBill: 0 });

    expect(propose(99)).toHaveLength(0);   // cannot afford even the best one
    expect(propose(100)).toHaveLength(1);  // exactly one colony's worth of money commits exactly one
    const three = propose(350);
    expect(three).toHaveLength(3);         // 3 × 100 spent, 50 left — not enough for a fourth
    expect(new Set(three.map((p) => p.systemId))).toEqual(new Set(["c9", "c8", "c7"]));

    // A later cycle with a recovered balance re-proposes what the poor cycle dropped: nothing is
    // remembered, the candidate simply became affordable again.
    const rich = propose(1000);
    expect(rich).toHaveLength(10);
    expect(rich.some((p) => p.systemId === "c0")).toBe(true);
  });

  it("quotes the charter off the faction's maintenance bill and reserves headroom for the materials", () => {
    // The source holds market rows the seed consumes, so the candidate carries a real material
    // projection on top of its charter. Both calls see the same faction, the same candidates and the
    // same balance — only whether the material headroom is reserved differs.
    const developed = [homeState({
      systemId: "home", housing: 1, peopleLand: 1000,
      goods: [
        { goodId: "food", stock: 500, demand: 10, production: 10, capacityProduction: 10 },
        { goodId: "water", stock: 500, demand: 10, production: 10, capacityProduction: 10 },
      ],
    })];
    // charterMult 2 × maintenanceBill 50 = 100, above the 0 floor.
    const priced = { ...COLONY_PARAMS, charterMult: 2, charterMin: 0 };
    const purse = { balance: 100, maintenanceBill: 50 };

    const charterOnly = planFactionColonyProposals(
      "f1", developed, candidates, [], { ...priced, gateHeadroom: 0 }, purse,
    );
    const withMaterials = planFactionColonyProposals(
      "f1", developed, candidates, [], { ...priced, gateHeadroom: 2 }, purse,
    );
    expect(charterOnly).toHaveLength(1);    // the charter alone is exactly affordable
    expect(withMaterials).toHaveLength(0);  // the goods it will have to buy are not
  });

  it("prices nothing when no budget is supplied (independents and the build-only path)", () => {
    const developed = [homeState({ housing: 1, peopleLand: 1000 })];
    expect(planFactionColonyProposals("f1", developed, candidates, [], COLONY_PARAMS)).toHaveLength(10);
  });

  it("quotes a candidate whose seed source is outside the developed set on its charter alone", () => {
    // The material projection is read off the SOURCE's market rows, and the source of a candidate
    // handed in by a caller need not be in the developed states this call was given — a system the
    // faction just lost, or a hop provider running ahead of the build rows. There is nothing to
    // project for it, so the charter is the whole quote rather than a crash on the way to it.
    const developed = [homeState({
      systemId: "home", housing: 1, peopleLand: 1000,
      goods: [{ goodId: "food", stock: 500, demand: 10, production: 10, capacityProduction: 10 }],
    })];
    const orphaned = candidates.map((c) => ({ ...c, sourceSystemId: "not-in-the-build-rows" }));
    const priced = { ...COLONY_PARAMS, charterMult: 0, charterMin: 100, gateHeadroom: 5000 };
    const purse = { balance: 250, maintenanceBill: 0 };

    // 100 a charter and nothing to reserve for materials ⇒ 250 buys two.
    expect(planFactionColonyProposals("f1", developed, orphaned, [], priced, purse)).toHaveLength(2);
    // Non-vacuous: the same candidates against a source that DOES have rows carry a material
    // projection, and at this headroom it prices every one of them out.
    expect(planFactionColonyProposals("f1", developed, candidates, [], priced, purse)).toHaveLength(0);
  });
});

describe("assessColonyCandidates — the pre-gate assessment the alert bar persists", () => {
  const developed = [homeState({ housing: 1, peopleLand: 1000 })];

  it("keeps a viable site the money gate cuts: two same-cost sites, money for one, both assessed", () => {
    // charterMult 0 + charterMin 100 + headroom 0 ⇒ each site costs exactly 100 to commit to, and a
    // balance of 100 funds exactly one — the assessment must still carry both.
    const flatFee = { ...COLONY_PARAMS, charterMult: 0, charterMin: 100, gateHeadroom: 0 };
    const twins = [
      candidate({ systemId: "a", peopleLand: 300 }),
      candidate({ systemId: "b", peopleLand: 300 }),
    ];
    const funded = planFactionColonyProposals(
      "f1", developed, twins, [], flatFee, { balance: 100, maintenanceBill: 0 },
    );
    expect(funded).toHaveLength(1);
    const assessed = assessColonyCandidates("f1", developed, twins, [], flatFee);
    expect(new Set(assessed.map((p) => p.systemId))).toEqual(new Set(["a", "b"]));
  });

  it("ignores the settler-supply cap — supply gates founding pace, not worth", () => {
    // Same fixture as the settler-gate cases: 100 spare pops ÷ minSettlerSupply 20 funds 5 of the 10.
    const supplyCore: BuildSystemState = {
      systemId: "core", factionId: "f1", control: "developed", population: 100,
      buildings: { [HOUSING_TYPE]: 100 / POP_CENTRE_DENSITY }, depositCounts: emptyResourceVector(),
 peopleLand: 0, goods: [],
    };
    const candidates = Array.from({ length: 10 }, (_, i) =>
      candidate({ systemId: `c${i}`, peopleLand: (i + 1) * 100 }),
    );
    const gated = { ...COLONY_PARAMS, minSettlerSupply: 20, employedLeakFraction: 0 };
    expect(planFactionColonyProposals("f1", [supplyCore], candidates, [], gated)).toHaveLength(5);
    expect(assessColonyCandidates("f1", [supplyCore], candidates, [], gated)).toHaveLength(10);
  });

  it("still drops what is not an opportunity at all: in flight, or below the habitable floor", () => {
    const inFlight: WorldColonyEstablishProject[] = [{
      kind: "colony_establish", id: "e1", origin: "auto", factionId: "f1",
      systemId: "a", sourceSystemId: "home", seedPop: 2, housingLevels: 1,
      workTotal: 68, workDone: 10, stagedManifest: [], charterPaid: true, stalledCycles: 0,
    }];
    const mixed = [
      candidate({ systemId: "a", peopleLand: 300 }), // already being established
      candidate({ systemId: "b", peopleLand: 0 }),   // below the habitable floor
      candidate({ systemId: "c", peopleLand: 300 }), // the one real opportunity
    ];
    const assessed = assessColonyCandidates("f1", developed, mixed, inFlight, COLONY_PARAMS);
    expect(assessed.map((p) => p.systemId)).toEqual(["c"]);
  });
});

describe("planFactionColonyProposals: seed-pop opportunity cost", () => {
  // A source whose entire workforce runs `oreLevels` extractors (spare labour = 0), producing
  // `output` ore/tick — so seeding off it must poach STAFFED workers, incurring the forgone-output cost.
  function staffedSource(systemId: string, oreLevels: number, output: number): BuildSystemState {
    return {
      systemId, factionId: "f1", control: "developed",
      population: oreLevels * oreLabour,
      buildings: { ore: oreLevels },
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: 0, production: output, capacityProduction: output }],
    };
  }

  it("charges no seed-pop cost when the source has spare (idle) labour ≥ the seed", () => {
    // homeState: population 1000, only housing → labourDemand 0 → 1000 idle ≫ the tiny seed. With no
    // employed seed to charge, the pop-cost weight is inert: the priced value equals the un-priced one.
    const developed = [homeState({ systemId: "home", housing: 1, peopleLand: 1000 })];
    const c = candidate({ peopleLand: 100 });
    const [priced] = planFactionColonyProposals("f1", developed, [c], [], COLONY_PARAMS);
    const [free] = planFactionColonyProposals("f1", developed, [c], [], { ...COLONY_PARAMS, popCostWeight: 0 });
    expect(priced.value).toBeCloseTo(free.value, 6);
    expect(priced.value).toBeGreaterThan(0);
  });

  it("ranks a colony seeded from a fully-staffed source below an identical one from a job-short source", () => {
    // Identical land at both candidates and one shared developed set ⇒ same σ and U; the ONLY
    // difference is the source's forgone output. A gentle weight keeps the busy colony positive so the
    // test isolates the DIRECTION of the bias, not a magnitude.
    const idle = homeState({ systemId: "idle", housing: 1, peopleLand: 1000 }); // spare labour
    const busy = staffedSource("busy", 10, 200);                                     // fully staffed
    const developed = [idle, busy];
    const fromIdle: ColonyEstablishCandidate = { ...candidate({ systemId: "c-idle", peopleLand: 100 }), sourceSystemId: "idle" };
    const fromBusy: ColonyEstablishCandidate = { ...candidate({ systemId: "c-busy", peopleLand: 100 }), sourceSystemId: "busy" };
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
    const tiny: ColonyEstablishCandidate = { ...candidate({ systemId: "c-tiny", peopleLand: housingCost }), sourceSystemId: "busy" };
    expect(planFactionColonyProposals("f1", [busy], [tiny], [], COLONY_PARAMS)).toHaveLength(0);
  });

  // ── Settler-supply founding gate (anti-sprawl) ──
  // A full core (pop == popCap ⇒ not hungry) with 100 idle spare pops and no industry (labourDemand 0).
  const supplyCore: BuildSystemState = {
    systemId: "core", factionId: "f1", control: "developed", population: 100,
    buildings: { [HOUSING_TYPE]: 100 / POP_CENTRE_DENSITY }, depositCounts: emptyResourceVector(),
 peopleLand: 0, goods: [],
  };

  it("caps new colony foundings to the settler-supply budget, keeping the best-valued", () => {
    // releasable = 100 spare; minSettlerSupply 20 ⇒ affordable floor(100/20) = 5; no hungry colonies ⇒
    // budget 5. Candidates differ in habitable land (⇒ distinct colony value, since value ∝ peopleLand),
    // so this also pins the descending value-sort: the gate must keep the 5 LARGEST (c5–c9), not just any
    // 5 — with identical candidates a reversed comparator would pass the count assertion alone.
    const candidates = Array.from({ length: 10 }, (_, i) => candidate({ systemId: `c${i}`, peopleLand: (i + 1) * 100 }));
    const gated = { ...COLONY_PARAMS, minSettlerSupply: 20, employedLeakFraction: 0 };
    const proposals = planFactionColonyProposals("f1", [supplyCore], candidates, [], gated);
    expect(proposals).toHaveLength(5);
    expect(new Set(proposals.map((p) => p.systemId))).toEqual(new Set(["c5", "c6", "c7", "c8", "c9"]));
  });

  it("stops founding once hungry colonies already consume the settler supply", () => {
    // Five hungry colonies (developed, pop 2 below their popCap 20) already soak the budget:
    // releasable 100 + 5×2 = 110 ⇒ affordable 5, minus 5 hungry ⇒ budget 0, so nothing new is founded.
    const hungry: BuildSystemState[] = Array.from({ length: 5 }, (_, i) => ({
      systemId: `h${i}`, factionId: "f1", control: "developed", population: 2,
      buildings: { [HOUSING_TYPE]: 1 }, depositCounts: emptyResourceVector(), peopleLand: 100, goods: [],
    }));
    const gated = { ...COLONY_PARAMS, minSettlerSupply: 20, employedLeakFraction: 0 };
    const proposals = planFactionColonyProposals("f1", [supplyCore, ...hungry], [candidate({ peopleLand: 100 })], [], gated);
    expect(proposals).toHaveLength(0);
  });

  it("holds total concurrent establish commitment invariant to how many are already forming", () => {
    // The settler supply, the candidates and the developed set are identical across all three calls;
    // the ONLY difference is how many establishes are already in flight — which is exactly what a
    // longer establish produces. Forming colonies are `controlled`, so the developed-systems loop
    // cannot see them, and each one is a mouth the faction has already promised settlers to.
    // releasable 100 ÷ minSettlerSupply 20 ⇒ 5 settler slots for the whole faction.
    const candidates = Array.from({ length: 10 }, (_, i) => candidate({ systemId: `c${i}`, peopleLand: (i + 1) * 100 }));
    const gated = { ...COLONY_PARAMS, minSettlerSupply: 20, employedLeakFraction: 0 };
    // Targets none of the candidates, so the already-in-flight skip is not what is being measured.
    const forming = (n: number): WorldColonyEstablishProject[] =>
      Array.from({ length: n }, (_, i) => ({
        kind: "colony_establish", id: `e${i}`, origin: "auto", factionId: "f1",
        systemId: `forming${i}`, sourceSystemId: "core", seedPop: 2, housingLevels: 1,
        workTotal: 68, workDone: 10, stagedManifest: [], charterPaid: true, stalledCycles: 0,
      }));
    const none = planFactionColonyProposals("f1", [supplyCore], candidates, [], gated);
    const three = planFactionColonyProposals("f1", [supplyCore], candidates, forming(3), gated);
    const five = planFactionColonyProposals("f1", [supplyCore], candidates, forming(5), gated);
    expect(none).toHaveLength(5);
    expect(three.length + 3).toBe(5);  // 2 new — the supply is shared with what is already forming
    expect(five).toHaveLength(0);      // fully committed: nothing new until one of them lands
  });

  it("does not gate when minSettlerSupply is 0 (disabled)", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => candidate({ systemId: `c${i}`, peopleLand: 100 }));
    expect(planFactionColonyProposals("f1", [supplyCore], candidates, [], COLONY_PARAMS)).toHaveLength(8);
  });
});

describe("sizeColonyEstablish", () => {
  const params = { seedPop: 500, establishWork: 100 };

  it("land-tight: the seed clamp caps an oversized seed to what the site can house", () => {
    const s = sizeColonyEstablish(3, params); // habitable 3 → 3 whole housing levels possible
    expect(s).not.toBeNull();
    if (s === null) return;
    // peopleLand 3 / housingCost 1 → maxHousingLevels 3 → habitableCap 60; seedPop min(500, 60) = 60,
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

// ── Boundaries, arithmetic and orderings the cases above leave unpinned ──

describe("hopRouteCost — weight scaling and the inclusive hop cap", () => {
  it("prices a route at hops × weight and still reaches a system sitting exactly on maxHops", () => {
    const hops = new Map([["A", new Map([["B", 3], ["C", 4]])]]);
    const rc = hopRouteCost(hops, 3, 2, 0.5);
    expect(rc("A", "B")).toBe(6);    // 3 hops at weight 2 — a reciprocal would price it 1.5
    expect(rc("A", "C")).toBeNull(); // one hop past the cap
  });
});

describe("relief housing and land accounting — boundaries", () => {
  const fedFood: BuildGoodState[] = [
    { goodId: "food", stock: 20, demand: 5, civilianDemand: 5, capacityProduction: 0, satisfaction: 1 },
  ];

  it("holds shut exactly AT the relief trigger and opens one head past it", () => {
    // popCap 100 (5 levels); pop 95 is RELIEF_TRIGGER × popCap exactly. The valve opens on a rise
    // PAST the trigger, so the boundary itself is still calm.
    const atTrigger = sysWith({
      population: DIRECTED_BUILD.RELIEF_TRIGGER * 100, buildings: { housing: 5 },
 peopleLand: 100, goods: fedFood,
    });
    expect(plannedHousingUnits(atTrigger)).toBe(0);
    expect(plannedHousingUnits({ ...atTrigger, population: atTrigger.population + 1 })).toBeGreaterThan(0);
  });

  it("commits the single level a site with exactly one unit of headroom can still hold", () => {
    // habitable 1 against a housing footprint of 1 ⇒ headroom exactly 1: the last whole level is
    // buildable, so the "no room for even one whole level" cut must sit strictly below it.
    expect(habitableHousingHeadroom(sysWith({ peopleLand: 1 }))).toBeCloseTo(1);
    expect(plannedHousingUnits(sysWith({
      population: 1000, buildings: {}, peopleLand: 1, goods: fedFood,
    }))).toBe(1);
  });

  it("charges standing housing against people land alone — industry land never binds it (build rule separation)", () => {
    // habitable 100 − 10 housing = 90; industryLand's value is irrelevant to this bound now.
    expect(habitableHousingHeadroom(sysWith({
 peopleLand: 100, buildings: { housing: 10 },
    }))).toBeCloseTo(90);
  });

  it("never charges a factory against housing headroom — the two budgets are disjoint, and a factory bills no land of its own", () => {
    // The industry-land budget is deleted entirely: buildableUnits for a factory-type good is
    // unbounded whatever is already built, and habitableHousingHeadroom (a people-land-only read)
    // never moves for it either way.
    expect(effectiveSpaceCost("machinery")).toBeGreaterThan(1);
    const sys = sysWith({ peopleLand: 100, buildings: { machinery: 4 } });
    expect(buildableUnits(sys, "machinery")).toBe(Infinity);
    expect(habitableHousingHeadroom(sys)).toBeCloseTo(100);
  });

  it("reads a tier-1+ build's capacity as unbounded — the old land gate is deleted, not weakened (Proves 1)", () => {
    expect(buildableUnits(sysWith({}), "machinery")).toBe(Infinity);
  });

  it("shares a deposit cap only with extractors sitting on the SAME resource", () => {
    const depositCounts = makeResourceVector({ arable: 5, ore: 5 });
    // textiles draws the same arable deposit as food, so it eats food's slots …
    expect(buildableUnits(sysWith({ depositCounts, buildings: { textiles: 3 } }), "food")).toBeCloseTo(2);
    // … while ore sits on its own resource and leaves food's cap whole.
    expect(buildableUnits(sysWith({ depositCounts, buildings: { ore: 3 } }), "food")).toBeCloseTo(5);
  });

  it("stands up a speculative floor on a site with exactly ONE buildable deposit slot", () => {
    const site = sysWith({
      control: "developed", population: 100, depositCounts: makeResourceVector({ arable: 1 }),
 peopleLand: 50,
      goods: [{ goodId: "food", stock: 1, demand: 10, production: 0, capacityProduction: 0 }],
    });
    expect(buildableUnits(site, "food")).toBe(1); // the boundary the nudge's deposit gate reads
    expect(speculativeFloorExtra(site, "food", 0, DEV_REFS)).toBeGreaterThan(0);
  });
});

describe("assessStructuralDeficits — the squeeze-feedback gap", () => {
  /** A self-serving developed site whose built capacity already clears the provisioning margin, so
   *  the capacity gap is 0 and every level it builds is priced by the feedback term alone. */
  function squeezedSite(opts: { satisfaction: number; squeezeCycles: number }): BuildSystemState {
    const demand = 10 * OUTPUT_PER_UNIT.ore;
    return {
      systemId: "S", factionId: "f1", population: 1000 * oreLabour, control: "developed", buildings: {},
      depositCounts: makeResourceVector({ ore: 50 }), peopleLand: 0,
      goods: [{
        goodId: "ore", stock: 0, demand, production: 0,
        capacityProduction: (1 + DIRECTED_BUILD.PROVISION_MARGIN) * demand,
        satisfaction: opts.satisfaction, squeezeCycles: opts.squeezeCycles,
      }],
    };
  }

  it("sizes the feedback gap at demand × (1 − satisfaction), rate-capped", () => {
    // demand 10·OUT at satisfaction 0.5 ⇒ gap 5·OUT ⇒ BUILD_RATE_CAP 0.40 ⇒ 2·OUT ⇒ exactly two
    // whole ore levels. The magnitude is the assertion: any other fold of demand and satisfaction
    // lands on a different level count.
    const builds = planFactionBuilds(
      [squeezedSite({ satisfaction: 0.5, squeezeCycles: DIRECTED_BUILD.PERSISTENCE_CYCLES })],
      reachable, DEV_REFS,
    );
    expect(countFor(builds, "S", "ore")).toBe(2);
  });

  it("ignores a squeeze that has not yet persisted for PERSISTENCE_CYCLES", () => {
    const builds = planFactionBuilds(
      [squeezedSite({ satisfaction: 0.5, squeezeCycles: DIRECTED_BUILD.PERSISTENCE_CYCLES - 1 })],
      reachable, DEV_REFS,
    );
    expect(countFor(builds, "S", "ore")).toBe(0);
  });
});

describe("assessStructuralDeficits — what counts as a reachable exporter", () => {
  // Each sink carries one prior assessment, so a surviving residual reads 2 and a cancelled one 0.
  const GAP_DEMAND = 10;
  const gross = (1 + DIRECTED_BUILD.PROVISION_MARGIN) * GAP_DEMAND;

  function gapSink(systemId: string): BuildSystemState {
    return {
      systemId, factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: GAP_DEMAND, production: 0, capacityProduction: 0, proposalCycles: 1 }],
    };
  }

  /** A developed system producing `demand + spare`; its own capacity clears the margin, so it never
   *  carries a gap of its own. `spare === 0` makes it a break-even producer, not an exporter. */
  function producer(systemId: string, demand: number, spare: number): BuildSystemState {
    const production = demand + spare;
    return {
      systemId, factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand, production, capacityProduction: Math.max(production, 1.1 * demand) }],
    };
  }

  /** Routes only the listed (from → to) pairs; everything else is unreachable. */
  function routesOnly(pairs: Record<string, string[]>): RouteCost {
    return (from, to) => (pairs[from]?.includes(to) ? 1 : null);
  }

  function oreCycles(plan: ReturnType<typeof planFactionProposals>, systemId: string): number | undefined {
    return plan.persistenceUpdates.find((u) => u.systemId === systemId && u.goodId === "ore")?.proposalCycles;
  }

  it("counts only gaps an exporter can actually reach in the shared coverage denominator", () => {
    // E's spare exactly covers A's gap and nothing reaches U. Pooling U's gap into the denominator
    // would leave A partly uncovered (and U spuriously part-covered), so A's reset to 0 is the pin.
    const plan = planFactionProposals(
      [gapSink("A"), gapSink("U"), producer("E", 4, gross)],
      routesOnly({ E: ["A"] }), [], DEV_REFS,
    );
    expect(oreCycles(plan, "A")).toBe(0); // fully covered
    expect(oreCycles(plan, "U")).toBe(2); // no exporter reaches it — still structural
  });

  it("counts only the spare of exporters that reach something", () => {
    // W is rich but stranded. Summing its spare would cancel A's residual outright.
    const plan = planFactionProposals(
      [gapSink("A"), producer("E", 4, gross / 2), producer("W", 4, gross * 20)],
      routesOnly({ E: ["A"] }), [], DEV_REFS,
    );
    expect(oreCycles(plan, "A")).toBe(2); // half-covered, so a residual survives
  });

  it("does not let a break-even producer act as an exporter that makes a gap coverable", () => {
    // Z produces exactly its own demand. If a zero-spare system counted, B would join the shared
    // coverage pool and be cancelled by E's spare, which E cannot ship to it.
    const plan = planFactionProposals(
      [gapSink("A"), gapSink("B"), producer("E", 4, gross * 2), producer("Z", 4, 0)],
      routesOnly({ E: ["A"], Z: ["B"] }), [], DEV_REFS,
    );
    expect(oreCycles(plan, "A")).toBe(0);
    expect(oreCycles(plan, "B")).toBe(2);
  });

  it("does not let a system with no gap launder a distant exporter's spare into the pool", () => {
    // B's capacity already clears the margin, so it is not a candidate at all. Admitting it would
    // pull its (unreachable-to-A) supplier E2 into the shared spare and cancel A's residual.
    const plan = planFactionProposals(
      [gapSink("A"), producer("B", GAP_DEMAND, 0), producer("E", 4, gross / 2), producer("E2", 4, gross * 20)],
      routesOnly({ E: ["A"], E2: ["B"] }), [], DEV_REFS,
    );
    expect(oreCycles(plan, "A")).toBe(2);
  });
});

describe("planFactionProposals — folding open work into the effective state", () => {
  const OUT = OUTPUT_PER_UNIT.ore;

  function buildProject(systemId: string, buildingType: string, levels: number): WorldConstructionProject {
    return {
      kind: "build", id: `p-${systemId}-${buildingType}`, origin: "auto", factionId: "f1",
      systemId, buildingType, levels, workTotal: 100, workDone: 0,
    };
  }

  it("counts a queued build's capacity as export spare that cancels a neighbour's gap", () => {
    const sink: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: OUT, production: 0, capacityProduction: 0, proposalCycles: 1 }],
    };
    const queuedProducer: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: 0, production: 0, capacityProduction: 0 }],
    };
    const cycles = (open: WorldConstructionProject[]) =>
      planFactionProposals([sink, queuedProducer], reachable, open, DEV_REFS)
        .persistenceUpdates.find((u) => u.systemId === "A" && u.goodId === "ore")?.proposalCycles;

    // Nothing in flight: A's gap is structural and its clock advances.
    expect(cycles([])).toBe(2);
    // Five ore levels in flight at B contribute 5 × OUT of standing production — spare enough to
    // cover A's 1.1 × OUT gap, so the clock resets.
    expect(cycles([buildProject("B", "ore", 5)])).toBe(0);
  });

  it("ignores a non-build open project when folding queued levels", () => {
    // A colony_establish carries no buildingType/levels; folding it would put NaN into the site's
    // building counts and thence into the housing want.
    const crowded: BuildSystemState = {
      systemId: "H", factionId: "f1", population: 100, control: "developed",
      buildings: { [HOUSING_TYPE]: 1 }, depositCounts: emptyResourceVector(),
 peopleLand: 100,
      goods: [{ goodId: "food", stock: 20, demand: 5, civilianDemand: 5, capacityProduction: 0, satisfaction: 1 }],
    };
    const establish: WorldColonyEstablishProject = {
      kind: "colony_establish", id: "e1", origin: "auto", factionId: "f1", systemId: "H",
      sourceSystemId: "H", seedPop: 2, housingLevels: 1, workTotal: 60, workDone: 0,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    const expected = plannedHousingUnits(crowded);
    expect(expected).toBeGreaterThan(0);
    const housing = planFactionProposals([crowded], reachable, [establish], DEV_REFS)
      .proposals.find((p) => p.role === "housing");
    expect(housing?.items).toEqual([{ buildingType: HOUSING_TYPE, levels: expected }]);
  });
});

describe("planFactionBuilds — the bundle never outruns the site's physical ceilings", () => {
  /** A capable site next to a bottomless electronics deficit. Electronics is tier-2 (both skill
   *  pools) and carries a family, so a bundle here can pull in schools, an institute and a complex —
   *  every term of the space and labour fits. */
  function bottomlessElectronicsDeficit(site: { population: number }): BuildSystemState[] {
    const consumer: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "electronics", stock: 0, demand: 1e6, production: 0, capacityProduction: 0, proposalCycles: 1 }],
    };
    const capable: BuildSystemState = {
      systemId: "B", factionId: "f1", population: site.population, control: "developed",
      buildings: { components: 5, chemicals: 5 },
      depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
    };
    return [consumer, capable];
  }

  it("Proves (1): lands the WHOLE bundle — production, academies and complex — with zero people land and no deposit slots (the old land gate deleted, not weakened)", () => {
    // Ample population, zero everything else land-shaped: no habitable land (system fixtures above
    // all carry peopleLand: 0), no deposit slots either. Factories/academies/complexes bill no land
    // at all, so labour alone must still be enough to land the whole bundle.
    const systems = bottomlessElectronicsDeficit({ population: 1e9 });
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute, DEV_REFS);
    expect(countFor(builds, "B", "electronics")).toBeGreaterThan(0);
    expect(builds.some((b) => COMPLEX_TYPES.includes(b.buildingType))).toBe(true); // the complex term is live
    expect(builds.some((b) => b.buildingType === RESEARCH_INSTITUTE_TYPE)).toBe(true); // and the academy terms
  });

  it("keeps the WHOLE bundle's labour draw inside the population plus its one-unit lead", () => {
    // Space is effectively unbounded, so labour is the only ceiling: the site may run at most one
    // production unit ahead of the heads it actually has, counting the academies and complex too.
    const systems = bottomlessElectronicsDeficit({ population: 900 });
    const site = systems.find((s) => s.systemId === "B")!;
    const lead = labourTotal(BUILDING_TYPES.electronics!.labour!);
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute, DEV_REFS);
    expect(countFor(builds, "B", "electronics")).toBeGreaterThan(0);
    expect(builds.some((b) => COMPLEX_TYPES.includes(b.buildingType))).toBe(true);
    expect(builds.some((b) => b.buildingType === RESEARCH_INSTITUTE_TYPE)).toBe(true);
    expect(labourDemand(applyBuilds(site.buildings, builds, "B"))).toBeLessThan(site.population + lead + 1e-9);
  });

  it("holds that labour ceiling at every population, including the tightest fits", () => {
    // A single population leaves slack: an academy or complex head miscounted by a dozen only buys a
    // level where the fit is already within a dozen heads of the ceiling. Sweeping the population
    // walks over every such step, so no term of the labour fit can be silently dropped or halved.
    const lead = labourTotal(BUILDING_TYPES.electronics!.labour!);
    let steps = 0;
    let previous = -1;
    for (let population = 300; population <= 900; population += 1) {
      const systems = bottomlessElectronicsDeficit({ population });
      const site = systems.find((s) => s.systemId === "B")!;
      const builds = planFactionBuilds(systems, selfAndNeighbourRoute, DEV_REFS);
      expect(labourDemand(applyBuilds(site.buildings, builds, "B")), `population ${population}`)
        .toBeLessThan(population + lead + 1e-9);
      const levels = countFor(builds, "B", "electronics");
      if (previous >= 0 && levels > previous) steps++;
      previous = levels;
    }
    expect(steps).toBeGreaterThan(0); // the sweep really does cross level boundaries
  });

  it("emits only real building types, at whole levels of at least one", () => {
    // Ore carries no family, so the complex step must contribute nothing at all here — an
    // unconditional complex step would push a nameless zero-level item into the bundle.
    for (const systems of [
      makeOreDeficitWithCapableSite(),
      bottomlessElectronicsDeficit({ population: 1e9 }),
    ]) {
      const builds = planFactionBuilds(systems, selfAndNeighbourRoute, DEV_REFS);
      expect(builds.length).toBeGreaterThan(0);
      for (const b of builds) {
        expect(BUILDING_TYPES[b.buildingType], b.buildingType).toBeDefined();
        expect(b.count).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("prices every bundle's work as Σ over its items of levels × workCostPerLevel", () => {
    const plan = planFactionProposals(
      bottomlessElectronicsDeficit({ population: 1e9 }), selfAndNeighbourRoute, [], DEV_REFS,
    );
    expect(plan.proposals.some((p) => p.items.length > 2)).toBe(true); // gates + production, so every term counts
    for (const p of plan.proposals) {
      expect(p.work).toBeCloseTo(
        p.items.reduce((sum, i) => sum + i.levels * workCostPerLevel(i.buildingType), 0), 6,
      );
      expect(p.work).toBeGreaterThan(0);
    }
  });
});

describe("planFactionBuilds — placement ordering and deficit bookkeeping", () => {
  const ORE = OUTPUT_PER_UNIT.ore;
  /** Demand whose committed rate deficit is exactly one ore level's output. */
  const ONE_LEVEL_DEMAND = ORE / ((1 + DIRECTED_BUILD.PROVISION_MARGIN) * DIRECTED_BUILD.BUILD_RATE_CAP);

  function oreConsumer(systemId: string): BuildSystemState {
    return {
      systemId, factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: ONE_LEVEL_DEMAND, production: 0, capacityProduction: 0 }],
    };
  }

  /** A miner with exactly `slots` ore levels of deposit capacity and labour to spare. */
  function miner(systemId: string, slots: number): BuildSystemState {
    return {
      systemId, factionId: "f1", population: 1000 * oreLabour, control: "developed", buildings: {},
      depositCounts: makeResourceVector({ ore: slots }), peopleLand: 0, goods: [],
    };
  }

  it("never scores a deficit reachable at zero route cost", () => {
    // Self-supply arrives through a positive SELF_COST; a zero-cost route would divide by zero and
    // give the site an infinite placement score.
    const zeroCost: RouteCost = () => 0;
    const self: BuildSystemState = { ...miner("S", 10), goods: oreConsumer("S").goods };
    expect(planFactionBuilds([self], zeroCost, DEV_REFS)).toEqual([]);
  });

  it("ranks the nearer of two equally-capable sites first", () => {
    // Both sites can cover the whole deficit; the near one must take it and the far one get nothing.
    const routes: RouteCost = (from, to) => (to === "D" ? (from === "NEAR" ? 1 : 4) : null);
    const builds = planFactionBuilds([oreConsumer("D"), miner("NEAR", 4), miner("FAR", 4)], routes, DEV_REFS);
    expect(countFor(builds, "NEAR", "ore")).toBe(1);
    expect(countFor(builds, "FAR", "ore")).toBe(0);
  });

  it("draws a served deficit DOWN, so a second site does not re-target the same demand", () => {
    const routes: RouteCost = (_from, to) => (to === "D" ? 1 : null);
    const builds = planFactionBuilds([oreConsumer("D"), miner("B", 4), miner("C", 4)], routes, DEV_REFS);
    // One level covers the whole committed rate; the second miner must find nothing left.
    expect(countFor(builds, "B", "ore") + countFor(builds, "C", "ore")).toBe(1);
  });

  it("stops drawing down deficits once the committed output is spent", () => {
    // B can build exactly one level — enough for ONE of the two consumers. The other must still be
    // open for C; crediting B's single level against both would leave C with nothing to serve.
    const routes: RouteCost = (_from, to) => (to === "D1" || to === "D2" ? 1 : null);
    const builds = planFactionBuilds(
      [oreConsumer("D1"), oreConsumer("D2"), miner("B", 1), miner("C", 1)], routes, DEV_REFS,
    );
    expect(countFor(builds, "B", "ore")).toBe(1);
    expect(countFor(builds, "C", "ore")).toBe(1);
  });
});

describe("planFactionProposals — the ROI numerator counts BUFFED output", () => {
  it("values a family bundle at the output its anchored levels actually ship", () => {
    // The site already carries the heavy-industry complex, so each metals level ships 1.4× its base
    // output — and `value` is served demand, not level count. Tier-1+ capacity is unbounded (no
    // industry-land budget left to cap it, habitability-seeding Task 15), so `demand` is sized to
    // land EXACTLY on a whole-level boundary of the buffed rate — the old fixture pinned this via a
    // tight `industryLand`, which no longer exists to do that job.
    const buffedPerUnit = OUTPUT_PER_UNIT.metals * 1.4;
    const targetLevels = 10;
    const demand = (targetLevels * buffedPerUnit) / ((1 + DIRECTED_BUILD.PROVISION_MARGIN) * DIRECTED_BUILD.BUILD_RATE_CAP);
    const consumer: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "metals", stock: 0, demand, production: 0, capacityProduction: 0, proposalCycles: 1 }],
    };
    const anchored: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 1e9, control: "developed",
      buildings: { ore: 5, [HEAVY_INDUSTRY_COMPLEX]: 1 },
      depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
    };
    const plan = planFactionProposals([consumer, anchored], selfAndNeighbourRoute, [], DEV_REFS);
    const bundle = plan.proposals.find((p) => p.systemId === "B" && p.role === "industry")!;
    const levels = bundle.items.find((i) => i.buildingType === "metals")!.levels;
    expect(levels).toBe(targetLevels);
    expect(bundle.value).toBeCloseTo(levels * buffedPerUnit, 6);
  });
});

describe("academyLift — what the skill ceiling is measured against", () => {
  /** A site whose standing tier-1 factories already outrun its skill-1 ceiling (no school built). */
  function skillShortSite(buildings: Record<string, number>, extra: Partial<BuildSystemState> = {}): BuildSystemState {
    const depositCounts = emptyResourceVector();
    for (const k of RESOURCE_TYPES) depositCounts[k] = 20;
    return {
      systemId: "B", factionId: "f1", population: 1e9, control: "developed", buildings,
      depositCounts, peopleLand: 0, goods: [], ...extra,
    };
  }

  it("builds no academy for a tier-0 good, even where the site's standing skill demand is unmet", () => {
    // metals draws skill-1 and the site has no school, so its skill-1 demand already exceeds its
    // ceiling — but an ore extractor licenses nobody, so the gap is not this build's to close.
    const systems = [deficitOnly("ore"), skillShortSite({ metals: 5 })];
    const builds = planFactionBuilds(systems, selfAndNeighbourRoute, DEV_REFS);
    expect(countFor(builds, "B", "ore")).toBeGreaterThan(0);
    expect(builds.some((b) => b.buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);
    expect(builds.some((b) => b.buildingType === RESEARCH_INSTITUTE_TYPE)).toBe(false);
  });

  it("scales the school count with the levels it licenses, and credits the ceiling already standing", () => {
    // One bottomless metals deficit, one site. Adding schools up front must strictly REDUCE the
    // schools this build has to add (the standing ceiling is credited), and the count must grow with
    // the production levels it licenses (so the per-level skill draw multiplies, never divides).
    const consumer: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "metals", stock: 0, demand: 1e6, production: 0, capacityProduction: 0 }],
    };
    const bare = planFactionBuilds([consumer, skillShortSite({ ore: 5 })], selfAndNeighbourRoute, DEV_REFS);
    const schooled = planFactionBuilds(
      [consumer, skillShortSite({ ore: 5, [VOCATIONAL_SCHOOL_TYPE]: 4 })],
      selfAndNeighbourRoute, DEV_REFS,
    );
    const bareSchools = countFor(bare, "B", VOCATIONAL_SCHOOL_TYPE);
    expect(bareSchools).toBeGreaterThan(1); // several levels' worth of licensing, not a fixed one
    expect(countFor(schooled, "B", VOCATIONAL_SCHOOL_TYPE)).toBeLessThan(bareSchools);
  });
});

describe("complexLift — the amortisation floor is reached, not passed", () => {
  it("co-builds the complex at exactly ANCHOR_MIN_THROUGHPUT and declines one level below it", () => {
    // The floor is the throughput at which a complex starts paying for itself, so landing exactly ON
    // it already qualifies. One standing metals level short of it does not.
    function scenario(standingMetals: number): BuildSystemState[] {
      const oneLevel = OUTPUT_PER_UNIT.metals; // the committed rate deficit — exactly one level
      const consumer: BuildSystemState = {
        systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
        depositCounts: emptyResourceVector(), peopleLand: 0,
        goods: [{
          goodId: "metals", stock: 0, production: 0, capacityProduction: 0,
          demand: oneLevel / ((1 + DIRECTED_BUILD.PROVISION_MARGIN) * DIRECTED_BUILD.BUILD_RATE_CAP),
        }],
      };
      const site: BuildSystemState = {
        systemId: "B", factionId: "f1", population: 1e9, control: "developed",
        buildings: { ore: 5, metals: standingMetals },
        depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
      };
      return [consumer, site];
    }
    // standing × base + one new level's base output = the floor exactly.
    const atFloor = ANCHOR_MIN_THROUGHPUT / OUTPUT_PER_UNIT.metals - 1;
    expect(Number.isInteger(atFloor)).toBe(true); // the fixture only makes sense on a whole standing base
    const at = planFactionBuilds(scenario(atFloor), selfAndNeighbourRoute, DEV_REFS);
    const below = planFactionBuilds(scenario(atFloor - 1), selfAndNeighbourRoute, DEV_REFS);
    expect(countFor(at, "B", "metals")).toBe(1);
    expect(countFor(below, "B", "metals")).toBe(1);
    expect(at.some((b) => b.buildingType === HEAVY_INDUSTRY_COMPLEX)).toBe(true);
    expect(below.some((b) => b.buildingType === HEAVY_INDUSTRY_COMPLEX)).toBe(false);
  });
});

describe("factionGoodDeficits — the zero boundary", () => {
  it("omits a good whose production exactly meets demand", () => {
    const developed = [homeState({
      goods: [{ goodId: "ore", stock: 0, demand: 20, production: 20, capacityProduction: 20 }],
    })];
    expect(factionGoodDeficits(developed)).toEqual([]);
  });
});

describe("planFactionColonyProposals — floors, seed cost and settler supply", () => {
  it("accepts a candidate sitting exactly ON the habitable floor", () => {
    const home = homeState({ housing: 1, peopleLand: 1000 });
    const atFloor = candidate({ systemId: "at-floor", peopleLand: effectiveSpaceCost(HOUSING_TYPE) });
    expect(planFactionColonyProposals("f1", [home], [atFloor], [], COLONY_PARAMS)).toHaveLength(1);
  });

  it("rejects a candidate just UNDER one whole housing level of land", () => {
    // Strictly less than a whole housing level, not merely nonzero — the boundary that distinguishes
    // "one housing level of people land" from "any positive peopleLand".
    const home = homeState({ housing: 1, peopleLand: 1000 });
    const justUnder = candidate({ systemId: "just-under", peopleLand: effectiveSpaceCost(HOUSING_TYPE) - 0.01 });
    expect(planFactionColonyProposals("f1", [home], [justUnder], [], COLONY_PARAMS)).toHaveLength(0);
  });

  it("charges nothing for a seed drawn from IDLE labour, however productive the source is", () => {
    // The source has no industry at all (labourDemand 0), so every head is spare: poaching the seed
    // forgoes no output, no matter how much the system ships.
    const idle: BuildSystemState = {
      systemId: "home", factionId: "f1", control: "developed", population: 1000,
      buildings: { [HOUSING_TYPE]: 50 }, depositCounts: emptyResourceVector(),
 peopleLand: 1000,
      goods: [{ goodId: "ore", stock: 0, demand: 0, production: 5000, capacityProduction: 5000 }],
    };
    const c = candidate({ peopleLand: 100 });
    const [priced] = planFactionColonyProposals("f1", [idle], [c], [], COLONY_PARAMS);
    const [free] = planFactionColonyProposals("f1", [idle], [c], [], { ...COLONY_PARAMS, popCostWeight: 0 });
    expect(priced).toBeDefined();
    expect(priced.value).toBeCloseTo(free.value, 6);
  });

  it("prices the seed at the source's forgone output PER STAFFED WORKER", () => {
    // The source is short of the heads its industry wants (pop 5·L against 10 levels' demand), so
    // every head is staffed and the whole seed is poached from work. Output density = output ÷ the
    // heads actually working, so the charge is weight × seed × output/pop.
    const levels = 10;
    const population = 5 * oreLabour;
    const output = 200;
    const busy: BuildSystemState = {
      systemId: "busy", factionId: "f1", control: "developed", population,
      buildings: { ore: levels }, depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: 0, production: output, capacityProduction: output }],
    };
    const c: ColonyEstablishCandidate = { ...candidate({ systemId: "c1", peopleLand: 100 }), sourceSystemId: "busy" };
    const weight = 0.001;
    const [priced] = planFactionColonyProposals("f1", [busy], [c], [], { ...COLONY_PARAMS, popCostWeight: weight });
    const [free] = planFactionColonyProposals("f1", [busy], [c], [], { ...COLONY_PARAMS, popCostWeight: 0 });
    expect(priced).toBeDefined();
    expect(labourDemand(busy.buildings)).toBeGreaterThan(population); // no idle spare to draw on
    expect(free.value - priced.value).toBeCloseTo(weight * free.seedPop * (output / population), 6);
  });

  it("releases idle spare PLUS the employed leak, measured on the heads actually staffed", () => {
    // 8·L people running 4 levels (4·L of demand): 4·L idle spare, 4·L staffed. At a 0.625 leak the
    // faction can release 6.5·L, which is 6 whole settler drafts of L each.
    const L = oreLabour;
    const core: BuildSystemState = {
      systemId: "core", factionId: "f1", control: "developed", population: 8 * L,
      buildings: { ore: 4 }, depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
    };
    const candidates = Array.from({ length: 12 }, (_, i) => candidate({ systemId: `c${i}`, peopleLand: (i + 1) * 100 }));
    const gated = { ...COLONY_PARAMS, minSettlerSupply: L, employedLeakFraction: 0.625 };
    expect(planFactionColonyProposals("f1", [core], candidates, [], gated)).toHaveLength(6);
  });
});

describe("planFactionBuilds — nearest-first allocation and buffed ranking", () => {
  const ORE = OUTPUT_PER_UNIT.ore;
  /** Demand whose committed rate deficit is exactly `levels` ore levels' output. */
  const demandFor = (levels: number) =>
    (levels * ORE) / ((1 + DIRECTED_BUILD.PROVISION_MARGIN) * DIRECTED_BUILD.BUILD_RATE_CAP);

  function consumer(systemId: string, levels: number): BuildSystemState {
    return {
      systemId, factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: demandFor(levels), production: 0, capacityProduction: 0 }],
    };
  }

  function miner(systemId: string, slots: number): BuildSystemState {
    return {
      systemId, factionId: "f1", population: 1e6 * oreLabour, control: "developed", buildings: {},
      depositCounts: makeResourceVector({ ore: slots }), peopleLand: 0, goods: [],
    };
  }

  it("allocates a site's capacity to its NEAREST reachable deficit, whatever order the deficits arrive in", () => {
    // S can build one level and reaches both a distant deficit (cost 20) and a near one (cost 1); T
    // reaches only the near one, at cost 2. Allocating S's single level to the near deficit is what
    // ranks S above T, so S takes the near deficit and T is left with nothing. Allocating it to the
    // far deficit instead drops S below T and hands the near deficit to T.
    const routes: RouteCost = (from, to) => {
      if (from === "S") return to === "FAR" ? 20 : to === "NEAR" ? 1 : null;
      if (from === "T") return to === "NEAR" ? 2 : null;
      return null;
    };
    for (const order of [["FAR", "NEAR"], ["NEAR", "FAR"]]) {
      const deficits = order.map((id) => consumer(id, 1));
      const builds = planFactionBuilds([...deficits, miner("S", 1), miner("T", 1)], routes, DEV_REFS);
      expect(countFor(builds, "S", "ore"), order.join(">")).toBe(1);
      expect(countFor(builds, "T", "ore"), order.join(">")).toBe(0);
    }
  });

  it("scores a site on the capacity it actually has, not the sum of every deficit it can see", () => {
    // S sees three deficits but can only build one level; T sees one, nearer. Scoring S on all three
    // would rank it first, let it take the deficit T was going to serve, and leave T with nothing.
    const routes: RouteCost = (from, to) => {
      if (from === "S") return to === "D" || to === "E1" || to === "E2" ? 10 : null;
      if (from === "T") return to === "D" ? 5 : null;
      return null;
    };
    const builds = planFactionBuilds(
      [consumer("D", 1), consumer("E1", 1), consumer("E2", 1), miner("S", 1), miner("T", 1)],
      routes, DEV_REFS,
    );
    expect(countFor(builds, "T", "ore")).toBe(1);
    expect(countFor(builds, "S", "ore")).toBe(1);
  });

  // Deleted: duplicated `anchoredVsGreenfieldScenario` above under a "capacity-bound"
  // framing that no longer applies — tier-1+ `buildableUnits` is unbounded, so there is no capacity
  // ceiling left for two sites to be "bound" by. The revived "snowball" test right above already
  // covers the surviving claim (an equidistant complex-anchored site outranks a bare greenfield one)
  // against the new cost-to-create-output signal; nothing here would exercise a different code path.

  // Mechanism check, re-anchored off the old numeric pin (MAJOR 3, PR #261): tier-0's real physics —
  // the capacity cap — still binds, and ordering among extractors still follows a capacity+proximity
  // blend. What's no longer true is that the blend is `min(capOutput, short) / routeCost` verbatim:
  // tier-0 now shares the tier-1+ score UNIT (demand served ÷ marginal-construction-work-per-unit,
  // staffing-scaled), so the raw numbers below (score 12/2=6 vs 4/1=4 pre-unification) don't hold —
  // only the ORDERING they produced does, because S and T here are identically staffed, same-good
  // miners, so the shared marginalWorkPerUnit/staffingFactor terms are the SAME constant multiplier
  // on both sides and cannot flip which one wins. S carries 3x T's deposit slots but sits twice as
  // far; against a deficit exactly large enough for S's full capacity (3 levels' output), S's
  // capacity edge still beats T's proximity edge — S takes the WHOLE deficit and T is left with
  // nothing.
  it("tier-0 (deposit-slot) ranking still follows the capacity+proximity blend under the unified score unit", () => {
    const routes: RouteCost = (from, to) => {
      if (from === "S") return to === "A" ? 2 : null;
      if (from === "T") return to === "A" ? 1 : null;
      return null;
    };
    const builds = planFactionBuilds([consumer("A", 3), miner("S", 3), miner("T", 1)], routes, DEV_REFS);
    expect(countFor(builds, "S", "ore")).toBe(3);
    expect(countFor(builds, "T", "ore")).toBe(0);
  });

  // The unification's actual behavioural change: tier-0 scoring used to ignore staffing entirely
  // (capacity+proximity only). Under the shared score unit it now folds the same staffing factor
  // tier-1+ always has — two otherwise-identical tier-0 sites (same capacity, same proximity) must
  // score differently once their staffing headroom differs, which the old capacity+proximity-only
  // formula could never produce (it would score them identically).
  it("folds staffing into tier-0 scoring too: an otherwise-identical miner with less staffing headroom scores lower", () => {
    const site = (population: number): BuildSystemState => ({
      systemId: "B", factionId: "f1", population, control: "developed", buildings: {},
      depositCounts: makeResourceVector({ ore: 3 }), peopleLand: 0, goods: [],
    });
    const sink: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "ore", stock: 0, demand: 5000, capacityProduction: 0, proposalCycles: 1 }],
    };
    const wellStaffed = planFactionProposals([sink, site(1e6 * oreLabour)], () => 1, [], DEV_REFS);
    const barelyStaffed = planFactionProposals([sink, site(oreLabour / 100)], () => 1, [], DEV_REFS);
    const wellScore = wellStaffed.buildOpportunities.find((o) => o.systemId === "B")?.score ?? 0;
    const barelyScore = barelyStaffed.buildOpportunities.find((o) => o.systemId === "B")?.score ?? 0;
    expect(wellScore).toBeGreaterThan(0);
    expect(barelyScore).toBeGreaterThan(0);
    expect(barelyScore).toBeLessThan(wellScore);
  });
});

describe("planFactionBuilds — the working copy tracks what it has already committed", () => {
  it("commits both opportunities from one site — no land ceiling to charge one against the other any more", () => {
    // One site serves two families' deficits. Neither tier-1+ good bills land at all any more, so
    // this no longer proves a shared ceiling gets charged across opportunities (that mechanism is
    // deleted) — it proves the working copy still lets both land at all from the same site.
    const site: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 1e9, control: "developed",
      buildings: { ore: 5, gas: 5 }, depositCounts: emptyResourceVector(),
 peopleLand: 0, goods: [],
    };
    const levelsWorth = (goodId: string, levels: number) =>
      (levels * OUTPUT_PER_UNIT[goodId]!) / ((1 + DIRECTED_BUILD.PROVISION_MARGIN) * DIRECTED_BUILD.BUILD_RATE_CAP);
    const wants = (goodId: string, systemId: string, levels: number): BuildSystemState => ({
      systemId, factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId, stock: 0, demand: levelsWorth(goodId, levels), production: 0, capacityProduction: 0 }],
    });
    const routes: RouteCost = (from, to) => (from === to ? 0 : to === "C" ? 10 : 1);
    const builds = planFactionBuilds(
      [wants("metals", "A", 20), wants("fuel", "C", 1e5), site], routes, DEV_REFS,
    );
    expect(countFor(builds, "B", "metals")).toBeGreaterThan(0);
    expect(countFor(builds, "B", "fuel")).toBeGreaterThan(0);
  });

  it("credits the skill-2 ceiling a site already owns against the institutes it orders", () => {
    // A standing institute licenses skill-2 work the build no longer has to license for itself, so
    // the same electronics build must order strictly FEWER institutes than a site with none.
    const consumer: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "electronics", stock: 0, demand: 1e6, production: 0, capacityProduction: 0 }],
    };
    const siteWith = (standingInstitutes: number): BuildSystemState => ({
      systemId: "B", factionId: "f1", population: 1e9, control: "developed",
      buildings: { components: 5, chemicals: 5, [RESEARCH_INSTITUTE_TYPE]: standingInstitutes },
      depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
    });
    const bare = planFactionBuilds([consumer, siteWith(0)], selfAndNeighbourRoute, DEV_REFS);
    const stocked = planFactionBuilds([consumer, siteWith(2)], selfAndNeighbourRoute, DEV_REFS);
    expect(countFor(bare, "B", RESEARCH_INSTITUTE_TYPE)).toBeGreaterThan(0);
    expect(countFor(stocked, "B", RESEARCH_INSTITUTE_TYPE))
      .toBeLessThan(countFor(bare, "B", RESEARCH_INSTITUTE_TYPE));
  });
});

describe("planFactionBuilds — the tier-1+ input gate reads EVERY input", () => {
  /** A surplus holder of `goodId`: stock well over its own reserve, producing above its own draw. */
  function holder(systemId: string, goodId: string): BuildSystemState {
    return {
      systemId, factionId: "f1", population: 0, control: "developed", buildings: { [goodId]: 5 },
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId, stock: 1e4, demand: 1, production: 100, capacityProduction: 100 }],
    };
  }

  /** A site that can host electronics (recipe: components + chemicals) but produces neither locally. */
  function electronicsSite(): BuildSystemState {
    return {
      systemId: "B", factionId: "f1", population: 1e9, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0, goods: [],
    };
  }

  it("refuses the build while ANY one recipe input has no reachable surplus", () => {
    const routes: RouteCost = (from, to) => (from === to ? 0 : 1);
    // Only components is on offer; chemicals is nowhere — so electronics stays ungated-out.
    const partial = planFactionBuilds(
      [deficitOnly("electronics"), electronicsSite(), holder("P", "components")], routes, DEV_REFS,
    );
    expect(countFor(partial, "B", "electronics")).toBe(0);
    // Add the missing input and the same site builds, so it is the gate and not the fixture refusing.
    const complete = planFactionBuilds(
      [deficitOnly("electronics"), electronicsSite(), holder("P", "components"), holder("Q", "chemicals")],
      routes, DEV_REFS,
    );
    expect(countFor(complete, "B", "electronics")).toBeGreaterThan(0);
  });

  it("accepts an input as available when ANY ONE of its holders is reachable", () => {
    // Two chemicals holders; only the second is routable to the site. One reachable source is enough.
    const routes: RouteCost = (from, to) => {
      if (from === to) return 0;
      if (from === "FAR") return null; // stranded holder
      return 1;
    };
    const builds = planFactionBuilds(
      [deficitOnly("electronics"), electronicsSite(), holder("P", "components"),
       holder("FAR", "chemicals"), holder("NEAR", "chemicals")],
      routes, DEV_REFS,
    );
    expect(countFor(builds, "B", "electronics")).toBeGreaterThan(0);
  });
});

describe("planFactionBuilds — relief housing and the industry pass draw from disjoint budgets", () => {
  it("commits housing without blocking the industry pass — there is no shared land pool left to compete over", () => {
    // Historically the housing pass's committed levels ate into the same general-space pool the
    // industry pass then planned into. Housing still bills people land alone; industry now bills NO
    // land at all (the budget is deleted, not merely disjoint), so standing housing — however much —
    // can never crowd out an industry build.
    const standingHousing = 100;
    const site: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 2500, control: "developed",
      buildings: { ore: 5, [HOUSING_TYPE]: standingHousing },
      depositCounts: emptyResourceVector(), peopleLand: 110,
      goods: [{ goodId: "food", stock: 20, demand: 1, civilianDemand: 1, capacityProduction: 0, satisfaction: 1 }],
    };
    const consumer: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 0, control: "developed", buildings: {},
      depositCounts: emptyResourceVector(), peopleLand: 0,
      goods: [{ goodId: "metals", stock: 0, demand: 1e6, production: 0, capacityProduction: 0 }],
    };
    const builds = planFactionBuilds([consumer, site], selfAndNeighbourRoute, DEV_REFS);
    expect(countFor(builds, "B", HOUSING_TYPE)).toBeGreaterThan(0);
    expect(countFor(builds, "B", "metals")).toBeGreaterThan(0);
  });
});
