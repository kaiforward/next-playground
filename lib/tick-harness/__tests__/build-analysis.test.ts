import { describe, it, expect } from "vitest";
import {
  summariseColonisation, summariseConstructionPool, summariseBuildBursts,
  trackFoundedColonies, sampleFoundedColonies, hasColonyAwaitingSample, summariseFoundingStock,
  recordFoundingManifest, newFoundingStallTotals, recordFoundingStall, newInFlightEstablishTotals,
  sampleOpenColonies, summariseFoundingLifecycle, summariseFounderCohort, summariseTierZeroIdle,
  foundingCadenceMarkTick, FOUNDING_CADENCE_MARK_SHARE, CONSTRUCTION_WARMUP_TICKS,
  newFoundingTrajectoryTotals, sampleFoundingTrajectory, summariseFoundingTrajectory,
  hasColonyInTrajectoryWindow, FOUNDING_TRAJECTORY_BUCKET_CYCLES, FOUNDING_TRAJECTORY_BUCKET_COUNT,
} from "../build-analysis";
import { CONSTRUCTION_INTERVAL } from "@/lib/constants/tick-cadence";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import type {
  BuildCommitmentRecord, FoundedColonyRecord, FoundedColonySystem, FoundingStagingTotals,
  FoundingTrajectorySystem,
} from "../build-analysis";
import type { FoundingStallEvent } from "@/lib/tick/types";
import { EXPANSION } from "@/lib/constants/expansion";
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, HEAVY_INDUSTRY_COMPLEX,
  CONSTRUCTION_CENTRE_TYPE, BUILDING_TYPES, labourTotal,
} from "@/lib/constants/industry";
import { CONSTRUCTION, workCostPerLevel } from "@/lib/constants/construction";
import { unitResourceVector, emptyResourceVector, makeResourceVector } from "@/lib/engine/resources";
import { computeSystemDecay } from "@/lib/engine/infrastructure-decay";
import type { TickSystem } from "@/lib/tick/rows";
import type { SystemControl, WorldConstructionProject } from "@/lib/world/types";
import type { ResourceVector } from "@/lib/types/game";

const ORE_LABOUR = labourTotal(BUILDING_TYPES.ore!.labour!);

/**
 * Characterization tests for the colonisation / build-loop health summary. This is the
 * calibration instrument that surfaces a broken build loop (colonies developed but never
 * built out) which aggregate market health hides — so its own tier classification, stranded
 * flags, class split, and queue math must be pinned. If any of these fail the implementation
 * no longer matches the documented behaviour — report, don't adjust.
 */

function devSys(
  id: string,
  opts: {
    control?: SystemControl;
    population?: number;
    popCap?: number;
    buildings?: Record<string, number>;
    depositCounts?: ResourceVector;
  } = {},
): TickSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1",
    governmentType: "federation",
    control: opts.control ?? "developed",
    population: opts.population ?? 0,
    popCap: opts.popCap ?? 1000,
    unrest: 0,
    buildings: opts.buildings ?? {},
    buildingIdleCycles: {},
    collapseDebt: 0,
    yields: unitResourceVector(),
    extractionEff: unitResourceVector(),
    depositCounts: opts.depositCounts ?? emptyResourceVector(),
 peopleLand: 0,
  };
}

function project(
  systemId: string, buildingType: string,
  { levels = 1, workTotal = 100, workDone = 0 }: { levels?: number; workTotal?: number; workDone?: number } = {},
): WorldConstructionProject {
  return { kind: "build", id: `${systemId}:${buildingType}`, origin: "auto", factionId: "f1", systemId, buildingType, levels, workTotal, workDone };
}

describe("summariseColonisation — per-class build-out", () => {
  it("splits developed systems into homeworld vs colony and classifies their built base", () => {
    // A fully built-out homeworld: extraction (tier0), a factory (tier1), an advanced factory
    // (tier2), housing, both academy kinds, a complex, plus an unknown building type (ignored)
    // and a zero-level entry (skipped). Deposits present but tier0 built → not idle.
    const homeworld = devSys("hw", {
      population: 1000, popCap: 2000,
      buildings: {
        ore: 3, metals: 2, electronics: 1,
        [HOUSING_TYPE]: 5, [VOCATIONAL_SCHOOL_TYPE]: 1, [RESEARCH_INSTITUTE_TYPE]: 1,
        [HEAVY_INDUSTRY_COMPLEX]: 1,
        mystery: 4, // unknown key → classified into no tier/role
        food: 0,    // zero level → skipped entirely
      },
      depositCounts: makeResourceVector({ ore: 10 }),
    });

    // Stranded colony: seed population landed but nothing built, on idle deposits, popCap never raised.
    const stranded = devSys("c1", {
      population: 500, popCap: 0,
      buildings: {},
      depositCounts: makeResourceVector({ ore: 10 }),
    });

    // Housing-only colony: has homes but zero industry; no deposits.
    const housingOnly = devSys("c2", {
      population: 200, popCap: 400,
      buildings: { [HOUSING_TYPE]: 3 },
    });

    // Boundary colony: population exactly 1 (not > 1) → neither stranded-symptom flag fires.
    const tiny = devSys("c3", { population: 1, popCap: 10, buildings: {} });

    // Non-developed system → excluded from both classes entirely.
    const outpost = devSys("cc", { control: "controlled", population: 999, buildings: { ore: 5 } });

    const summary = summariseColonisation(
      [homeworld, stranded, housingOnly, tiny, outpost],
      new Set(["hw"]),
      [],
    );

    // Class membership + aggregates (outpost excluded; tiny counted).
    expect(summary.homeworld.count).toBe(1);
    expect(summary.homeworld.totalPopulation).toBe(1000);
    expect(summary.colony.count).toBe(3);
    expect(summary.colony.totalPopulation).toBe(500 + 200 + 1);

    // Homeworld built-out: has tier0, has tier1+ (tier1 or tier2), has housing; nothing stranded.
    expect(summary.homeworld.withTier0).toBe(1);
    expect(summary.homeworld.withTier1Plus).toBe(1);
    expect(summary.homeworld.withHousing).toBe(1);
    expect(summary.homeworld.populatedButNoIndustry).toBe(0);
    expect(summary.homeworld.popCapStarved).toBe(0);
    expect(summary.homeworld.depositsIdle).toBe(0);

    // Colony stranded symptoms: c1 (no industry, popCap 0, idle deposits) + c2 (housing but no industry).
    // c3 has population 1, so its >1-gated flags stay off despite having no industry.
    expect(summary.colony.withTier0).toBe(0);
    expect(summary.colony.withHousing).toBe(1); // c2 only
    expect(summary.colony.populatedButNoIndustry).toBe(2); // c1, c2 (not c3: pop == 1)
    expect(summary.colony.popCapStarved).toBe(1); // c1 only (c2 popCap 400, c3 popCap 10)
    expect(summary.colony.depositsIdle).toBe(1); // c1 only (c2/c3 have no deposits)
  });

  it("does not count zero- or negative-level buildings toward any role, and treats them as no-industry", () => {
    // Every entry is <= 0 → breakdown skips them all, so despite naming tier0/tier1 keys the
    // system reads as populated-but-no-industry with no built roles.
    const ghostBuilt = devSys("c1", {
      population: 300,
      buildings: { ore: 0, metals: -2, [HOUSING_TYPE]: 0 },
      depositCounts: makeResourceVector({ ore: 5 }),
    });
    const summary = summariseColonisation([ghostBuilt], new Set(), []);

    expect(summary.colony.withTier0).toBe(0);
    expect(summary.colony.withHousing).toBe(0);
    expect(summary.colony.populatedButNoIndustry).toBe(1);
    expect(summary.colony.depositsIdle).toBe(1); // depositCounts > 0 but no positive tier0
  });
});

describe("summariseColonisation — the tier fold", () => {
  it("adds every tier into one industry total, and counts tier1-or-better as present", () => {
    // tier1 and tier2 are equal-sized so any fold that subtracts one from the other reads exactly
    // zero industry — a fully built colony reported as populated-but-no-industry.
    const built = devSys("c1", {
      population: 300,
      buildings: { metals: 2, electronics: 2 },
    });
    const summary = summariseColonisation([built], new Set(), []);

    expect(summary.colony.populatedButNoIndustry).toBe(0);
    expect(summary.colony.withTier1Plus).toBe(1);
    expect(summary.colony.withTier0).toBe(0);
  });

  it("does not credit tier1-or-better to a system that has neither", () => {
    // The guard is exclusive at zero: an extraction-only colony has industry but nothing above
    // tier 0, and a bare rock of a colony has none at all.
    const tier0Only = devSys("c1", { population: 300, buildings: { ore: 4 } });
    const nothing = devSys("c2", { population: 300, buildings: {} });
    const summary = summariseColonisation([tier0Only, nothing], new Set(), []);

    expect(summary.colony.withTier1Plus).toBe(0);
    expect(summary.colony.withTier0).toBe(1);
    expect(summary.colony.populatedButNoIndustry).toBe(1); // c2 only
  });

  it("routes each level to its own tier, and an untiered building type to none", () => {
    // Each system holds exactly one tier, so a routing rule that swallows the wrong one shows up
    // as a colony with no industry at all rather than as a reshuffled total. Two tier2 systems
    // against one untiered one: with one of each, a rule that swapped the two buckets would read
    // exactly the same counts.
    const t1 = devSys("t1", { population: 300, buildings: { metals: 3 } });
    const t2a = devSys("t2a", { population: 300, buildings: { electronics: 3 } });
    const t2b = devSys("t2b", { population: 300, buildings: { electronics: 1 } });
    // A building type the tier table does not know is not industry: counting it as a tier would
    // report an idle colony as producing.
    const unknown = devSys("u1", { population: 300, buildings: { mystery: 9 } });

    const summary = summariseColonisation([t1, t2a, t2b, unknown], new Set(), []);
    expect(summary.colony.withTier1Plus).toBe(3);
    expect(summary.colony.populatedButNoIndustry).toBe(1); // the unknown type only
  });

  it("skips a non-positive level rather than subtracting it from the tier beside it", () => {
    // A negative roster entry must be dropped, not folded: netted against a real tier it cancels
    // it out and a producing colony reads as having no industry above extraction.
    const mixed = devSys("c1", {
      population: 300,
      buildings: { metals: 5, electronics: -5 },
    });
    const summary = summariseColonisation([mixed], new Set(), []);
    expect(summary.colony.withTier1Plus).toBe(1);
    expect(summary.colony.populatedButNoIndustry).toBe(0);
  });

  it("flags popCap starvation only for an inhabited system under one whole housing level", () => {
    // Both bounds are strict, and each is the difference between a real trap and a normal world:
    // an empty rock is not starved, and a system with exactly one level of cap is housed.
    const systems = [
      devSys("starved", { population: 300, popCap: 0 }),
      devSys("empty", { population: 0, popCap: 0 }),
      devSys("one-resident", { population: 1, popCap: 0 }),
      devSys("one-level", { population: 300, popCap: 1 }),
    ];
    const summary = summariseColonisation(systems, new Set(), []);
    expect(summary.colony.popCapStarved).toBe(1);
  });
});

describe("summariseColonisation — construction queue split", () => {
  it("splits open projects by target class and sums levels + colony progress", () => {
    const homeworldIds = new Set(["hw"]);
    const projects: WorldConstructionProject[] = [
      project("hw", "ore", { levels: 4, workTotal: 100, workDone: 50 }),      // homeworld
      project("c1", HOUSING_TYPE, { levels: 2, workTotal: 100, workDone: 25 }), // colony, 0.25 progress
      project("c1", "ore", { levels: 3, workTotal: 200, workDone: 100 }),       // colony, 0.50 progress
      project("c2", "metals", { levels: 1, workTotal: 0, workDone: 0 }),        // colony, workTotal 0 → 0 progress
    ];

    const summary = summariseColonisation([], homeworldIds, projects);

    expect(summary.queue.homeworldProjects).toBe(1);
    expect(summary.queue.homeworldLevels).toBe(4);
    expect(summary.queue.colonyProjects).toBe(3);
    expect(summary.queue.colonyLevels).toBe(2 + 3 + 1);
    // Mean over the three colony projects: (0.25 + 0.50 + 0) / 3.
    expect(summary.queue.colonyMeanProgress).toBeCloseTo((0.25 + 0.5 + 0) / 3, 6);
    expect(summary.queue.colonyByKind).toEqual({ housing: 1, tier0: 1, tier1: 1 });
  });

  it("classifies colony project kinds across every role/tier (projectKind), academies collapsing together", () => {
    const projects: WorldConstructionProject[] = [
      project("c", HOUSING_TYPE),
      project("c", VOCATIONAL_SCHOOL_TYPE),   // academy
      project("c", RESEARCH_INSTITUTE_TYPE),  // academy (same bucket)
      project("c", HEAVY_INDUSTRY_COMPLEX),   // complex
      project("c", "ore"),                    // tier0
      project("c", "metals"),                 // tier1
      project("c", "electronics"),            // tier2
      project("c", "mystery"),                // unknown → other
    ];
    const summary = summariseColonisation([], new Set(), projects);

    expect(summary.queue.colonyByKind).toEqual({
      housing: 1, academy: 2, complex: 1, tier0: 1, tier1: 1, tier2: 1, other: 1,
    });
  });

  it("keeps tier2 and untiered projects apart when both are in the queue at once", () => {
    // One of each reads the same totals whichever way the tier2 test points — the two buckets
    // simply swap names. Two tier2 projects against one unknown breaks the symmetry.
    const summary = summariseColonisation([], new Set(), [
      project("c", "electronics"),
      project("c", "electronics"),
      project("c", "mystery"),
    ]);
    expect(summary.queue.colonyByKind).toEqual({ tier2: 2, other: 1 });
  });

  it("counts open centre projects under kind 'centre'", () => {
    const summary = summariseColonisation([], new Set(), [
      { kind: "build", id: "c1", origin: "auto", factionId: "f1", systemId: "x",
        buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1,
        workTotal: workCostPerLevel(CONSTRUCTION_CENTRE_TYPE), workDone: 0 },
    ]);
    expect(summary.queue.colonyByKind["centre"]).toBe(1);
  });

  it("reports zero colony progress when there are no colony projects (division guard)", () => {
    const summary = summariseColonisation([], new Set(["hw"]), [project("hw", "ore")]);
    expect(summary.queue.colonyProjects).toBe(0);
    expect(summary.queue.colonyMeanProgress).toBe(0);
    expect(summary.queue.colonyByKind).toEqual({});
  });

  it("excludes colony-establish projects from the queue split (reported separately, no NaN)", () => {
    const colony: WorldConstructionProject = {
      kind: "colony_establish", id: "c1:establish", origin: "auto", factionId: "f1", systemId: "c1",
      sourceSystemId: "hw", seedPop: 50, housingLevels: 3, workTotal: 84, workDone: 40,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    const summary = summariseColonisation([], new Set(["hw"]), [
      project("hw", "ore", { levels: 4, workTotal: 100, workDone: 50 }),
      colony,
    ]);
    // Only the build project is counted; the colony-establish is skipped (no undefined buildingType/levels).
    expect(summary.queue.homeworldProjects).toBe(1);
    expect(summary.queue.colonyProjects).toBe(0);
    expect(summary.queue.colonyLevels).toBe(0);
    expect(Number.isNaN(summary.queue.colonyMeanProgress)).toBe(false);
  });
});

describe("summariseConstructionPool", () => {
  it("splits base vs centre points and derives the queue ETA", () => {
    // One developed system, 200 pop, 1 staffed centre + school (matches the engine test's fixture).
    const sys = devSys("s1", {
      population: 200,
      buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1, vocational_school: 1 },
    });
    const projects: WorldConstructionProject[] = [
      { kind: "build", id: "p1", origin: "auto", factionId: "f1", systemId: sys.id, buildingType: "metals",
        levels: 2, workTotal: 40, workDone: 10 },
    ];
    const s = summariseConstructionPool([sys], projects);
    expect(s.poolCentres).toBeCloseTo(CONSTRUCTION.POINTS_PER_LEVEL);
    expect(s.poolBase).toBeCloseTo((200 - 7) * CONSTRUCTION.THROUGHPUT_PER_POP);
    expect(s.centreShare).toBeCloseTo(s.poolCentres / (s.poolBase + s.poolCentres));
    expect(s.centreLevels).toBe(1);
    expect(s.queueRemainingWork).toBe(30);
    expect(s.queueEtaCycles).toBeCloseTo(30 / (s.poolBase + s.poolCentres));
  });

  it("reports a null ETA when nothing funds the queue", () => {
    const s = summariseConstructionPool([], [
      { kind: "build", id: "p1", origin: "auto", factionId: "f1", systemId: "x", buildingType: "metals",
        levels: 1, workTotal: 20, workDone: 0 },
    ]);
    expect(s.queueEtaCycles).toBeNull();
    expect(s.queueRemainingWork).toBe(20);
  });

  it("excludes non-developed systems from centreLevels even when they carry the building", () => {
    // Mirrors the outpost fixture pattern above: a controlled (non-developed) system holding a
    // Construction Centre shouldn't count toward built centre levels.
    const outpost = devSys("cc", { control: "controlled", buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1 } });
    const s = summariseConstructionPool([outpost], []);
    expect(s.centreLevels).toBe(0);
  });

  it("counts open centre builds only, upward, over a mixed queue", () => {
    // centreProjects is the pool's own feedback loop made visible — how much of the queue is
    // capacity to build MORE. The queue below holds two centre builds, an ordinary build and a
    // colony-establish, so a filter that widens in any direction lands on a different number.
    const establish: WorldConstructionProject = {
      kind: "colony_establish", id: "e1", origin: "auto", factionId: "f1", systemId: "c9",
      sourceSystemId: "hw", seedPop: 40, housingLevels: 2, workTotal: 80, workDone: 20,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    const projects: WorldConstructionProject[] = [
      project("s1", CONSTRUCTION_CENTRE_TYPE, { workTotal: 60, workDone: 10 }),
      project("s2", CONSTRUCTION_CENTRE_TYPE, { workTotal: 60, workDone: 0 }),
      project("s3", "metals", { workTotal: 40, workDone: 40 }),
      establish,
    ];
    const s = summariseConstructionPool([], projects);

    expect(s.centreProjects).toBe(2);
    // Non-vacuous: the queue really does hold work of all three shapes.
    expect(s.queueRemainingWork).toBe(50 + 60 + 0 + 60);
  });

  it("reports a zero centre share, never a division by an empty pool", () => {
    // An empty galaxy funds nothing. JSON renders NaN as null, which reads as "not measured"
    // rather than "measured, and the pool is empty".
    const s = summariseConstructionPool([], []);
    expect(s.centreShare).toBe(0);
    expect(Number.isFinite(s.centreShare)).toBe(true);
  });

  it("sets the construction warm-up at a first cycle plus the persistence window", () => {
    // Nothing autonomic can commit until a structural deficit has survived the persistence
    // window, and the first construction cycle only lands at CONSTRUCTION_INTERVAL — so the
    // warm-up is one interval for that first cycle plus one per persistence cycle, and is
    // necessarily longer than a single interval.
    expect(DIRECTED_BUILD.PERSISTENCE_CYCLES).toBeGreaterThan(0);
    expect(CONSTRUCTION_WARMUP_TICKS).toBe(
      CONSTRUCTION_INTERVAL + CONSTRUCTION_INTERVAL * DIRECTED_BUILD.PERSISTENCE_CYCLES,
    );
    expect(CONSTRUCTION_WARMUP_TICKS).toBeGreaterThan(CONSTRUCTION_INTERVAL);
  });
});

describe("summariseBuildBursts", () => {
  function rec(tick: number, goodId: string, levels: number): BuildCommitmentRecord {
    return { tick, goodId, levels };
  }

  it("tracks each good's worst single-cycle commitment and the tick it occurred", () => {
    const records: BuildCommitmentRecord[] = [
      rec(24, "food", 3),
      rec(48, "food", 7), // food's worst
      rec(72, "food", 5),
      rec(24, "metals", 10), // metals' (only, and worst) cycle
    ];
    const summary = summariseBuildBursts(records);
    const food = summary.byGood.find((g) => g.goodId === "food");
    const metals = summary.byGood.find((g) => g.goodId === "metals");
    expect(food).toEqual({ goodId: "food", maxLevelsPerCycle: 7, tick: 48 });
    expect(metals).toEqual({ goodId: "metals", maxLevelsPerCycle: 10, tick: 24 });
  });

  it("sorts byGood descending by maxLevelsPerCycle, breaking ties alphabetically by goodId", () => {
    const records: BuildCommitmentRecord[] = [
      rec(24, "food", 5),
      rec(24, "metals", 5), // tied with food — alphabetical tiebreak
      rec(24, "electronics", 9),
    ];
    const summary = summariseBuildBursts(records);
    expect(summary.byGood.map((g) => g.goodId)).toEqual(["electronics", "food", "metals"]);
  });

  it("reports the galaxy-wide worst good/tick as globalMax/worstGood/worstTick", () => {
    const records: BuildCommitmentRecord[] = [
      rec(24, "food", 5),
      rec(48, "metals", 12),
      rec(72, "electronics", 8),
    ];
    const summary = summariseBuildBursts(records);
    expect(summary.globalMax).toBe(12);
    expect(summary.worstGood).toBe("metals");
    expect(summary.worstTick).toBe(48);
  });

  it("reports zero/null for an empty run (no builds committed) — no NaN, no crash", () => {
    const summary = summariseBuildBursts([]);
    expect(summary.byGood).toEqual([]);
    expect(summary.globalMax).toBe(0);
    expect(summary.worstGood).toBeNull();
    expect(summary.worstTick).toBeNull();
  });

  it("keeps the first-seen tick's max, not the LAST tick a good was committed", () => {
    // The max is 7 at tick 24; later ticks propose fewer levels, so the tick pinned must stay 24 —
    // proving the summary tracks the cycle the maximum happened at, not just the final observation.
    const records: BuildCommitmentRecord[] = [rec(24, "food", 7), rec(48, "food", 2), rec(72, "food", 1)];
    const summary = summariseBuildBursts(records);
    expect(summary.byGood).toEqual([{ goodId: "food", maxLevelsPerCycle: 7, tick: 24 }]);
  });

  it("keeps the first-seen tick on an equal-maxima tie (strict >, not >=)", () => {
    // Two cycles commit the SAME max levels; the strict `>` means the first-seen tick (24) must be pinned,
    // not overwritten by the later equal cycle (48). A `>=` regression would pin 48 instead.
    const records: BuildCommitmentRecord[] = [rec(24, "food", 5), rec(48, "food", 5)];
    const summary = summariseBuildBursts(records);
    expect(summary.byGood).toEqual([{ goodId: "food", maxLevelsPerCycle: 5, tick: 24 }]);
  });
});

/**
 * The founding-stock instrument. Its whole job is to see a symptom no galaxy-wide average can —
 * a handful of brand-new colonies opening starved — so what must be pinned is that it samples the
 * right systems at the right moment, weights goods by what the colony actually needs, and does not
 * quietly read a colony as fed.
 */
describe("trackFoundedColonies / summariseFoundingStock", () => {
  /** A seed-sized colony: no buildings, so its basket is pure per-capita civilian demand. */
  const sys = (id: string, control: SystemControl): FoundedColonySystem => ({
    id, control, population: EXPANSION.COLONY_SEED_POP, buildings: {},
  });
  const mkt = (systemId: string, goodId: string, satisfaction: number) =>
    ({ systemId, goodId, satisfaction });
  const rec = (
    systemId: string, openingSatisfaction: number | null, openingShortfall: number | null,
    openingProvision: number | null = openingSatisfaction,
  ): FoundedColonyRecord => ({
    systemId, foundedTick: 0, openingSatisfaction, openingShortfall, openingProvision,
  });
  /** No staging draws behind these colonies — the detection cases are about who is tracked, not cost. */
  const NO_STAGING = new Map<string, FoundingStagingTotals>();
  /** One staging draw as the processor emits it. */
  const draw = (
    systemId: string, tonnage: number, moneyCost: number, founderCover?: number,
  ) => ({ systemId, tonnage, moneyCost, founderCover });

  it("tracks only systems developed after tick 0, not world-gen's own", () => {
    const tracker = new Map<string, FoundedColonyRecord>();
    const developedAtStart = new Set(["home"]);
    trackFoundedColonies(
      [sys("home", "developed"), sys("c1", "developed"), sys("c2", "controlled")],
      12, developedAtStart, tracker, NO_STAGING,
    );

    expect([...tracker.keys()]).toEqual(["c1"]);
    expect(tracker.get("c1")?.foundedTick).toBe(12);
  });

  it("reads at the first cycle strictly after founding, never the founding cycle itself", () => {
    const tracker = new Map<string, FoundedColonyRecord>();
    const systems = [sys("c1", "developed")];
    const markets = [mkt("c1", "food", 1), mkt("c1", "water", 1)];
    trackFoundedColonies(systems, 24, new Set(), tracker, NO_STAGING);

    // Founded ON a cycle-start tick: that same cycle assessed a system that did not exist for the cycle.
    expect(hasColonyAwaitingSample(tracker, 24)).toBe(false);
    sampleFoundedColonies(systems, markets, 24, tracker);
    expect(tracker.get("c1")?.openingSatisfaction).toBeNull();

    expect(hasColonyAwaitingSample(tracker, 48)).toBe(true);
    sampleFoundedColonies(systems, markets, 48, tracker);
    expect(tracker.get("c1")?.openingSatisfaction).toBeCloseTo(1, 6);
    expect(tracker.get("c1")?.openingShortfall).toBeCloseTo(0, 6);
    expect(tracker.get("c1")?.openingProvision).toBeCloseTo(1, 6);
    // Once read, it stops asking to be read again.
    expect(hasColonyAwaitingSample(tracker, 72)).toBe(false);
  });

  it("samples openingProvision once, on the same cycle and basket as the other two readings", () => {
    // A colony sampled twice, or sampled before its first cycle, would move the cohort's Provision
    // mean without the galaxy having changed — the same hazard `openingSatisfaction` already guards
    // against, now checked for the new field too.
    const tracker = new Map<string, FoundedColonyRecord>();
    const systems = [sys("c1", "developed")];
    const markets = [mkt("c1", "water", 0.5)];
    trackFoundedColonies(systems, 24, new Set(), tracker, NO_STAGING);

    // Founded on a cycle-start tick: not due yet, so no reading of any of the three fields.
    sampleFoundedColonies(systems, markets, 24, tracker);
    expect(tracker.get("c1")?.openingProvision).toBeNull();

    sampleFoundedColonies(systems, markets, 48, tracker);
    const firstReading = tracker.get("c1")?.openingProvision;
    expect(firstReading).not.toBeNull();

    // A later cycle's famine must not move the already-taken reading.
    sampleFoundedColonies(systems, [mkt("c1", "water", 0.01)], 72, tracker);
    expect(tracker.get("c1")?.openingProvision).toBe(firstReading);
  });

  it("weights a good by the colony's own need for it, not one vote per good", () => {
    // The discriminating shape: a seed needs far more water than luxuries. Starving it of luxuries
    // must read as nearly fed; starving it of water must not. A flat mean scores both exactly 0.5.
    const systems = [sys("c1", "developed")];

    const noLuxuries = new Map<string, FoundedColonyRecord>();
    trackFoundedColonies(systems, 24, new Set(), noLuxuries, NO_STAGING);
    sampleFoundedColonies(systems, [mkt("c1", "water", 1), mkt("c1", "luxuries", 0)], 48, noLuxuries);

    const noWater = new Map<string, FoundedColonyRecord>();
    trackFoundedColonies(systems, 24, new Set(), noWater, NO_STAGING);
    sampleFoundedColonies(systems, [mkt("c1", "water", 0), mkt("c1", "luxuries", 1)], 48, noWater);

    // Both readings must exist before they are compared — an unsampled colony leaves them undefined,
    // and `undefined > 0.9` is quietly false rather than an error.
    const luxuriesRecord = noLuxuries.get("c1");
    const waterRecord = noWater.get("c1");
    if (luxuriesRecord?.openingSatisfaction == null ||
        luxuriesRecord.openingShortfall === null ||
        waterRecord?.openingSatisfaction == null ||
        waterRecord.openingShortfall === null) {
      throw new Error("fixture: expected both colonies to carry an opening reading");
    }
    expect(luxuriesRecord.openingSatisfaction).toBeGreaterThan(0.9);
    expect(waterRecord.openingSatisfaction).toBeLessThan(0.1);
    // ...and the unrest fold agrees, so instrument and simulation cannot drift apart.
    expect(waterRecord.openingShortfall)
      .toBeGreaterThan(luxuriesRecord.openingShortfall);
  });

  it("leaves openingProvision null on an empty basket, never recorded as fully provisioned", () => {
    // Population 0 makes consumptionRate's per-capita term 0 for every good, so the basket is empty
    // (goods.length === 0 in sampleFoundedColonies) even though market rows exist for the system.
    // provision()'s OWN rule reads an empty basket as 1 ("fully provisioned") — the founding reading
    // must not inherit that: "could not measure" and "opened perfectly supplied" are opposite claims
    // (the founderCover precedent, lib/tick/types.ts:133-137).
    const tracker = new Map<string, FoundedColonyRecord>();
    const emptySys: FoundedColonySystem = { id: "c1", control: "developed", population: 0, buildings: {} };
    trackFoundedColonies([emptySys], 24, new Set(), tracker, NO_STAGING);
    sampleFoundedColonies([emptySys], [mkt("c1", "water", 1), mkt("c1", "food", 1)], 48, tracker);

    expect(tracker.get("c1")?.openingProvision).toBeNull();
    expect(tracker.get("c1")?.openingSatisfaction).toBeNull();
  });

  it("differs from openingSatisfaction when a good's demand share and its necessity disagree", () => {
    // water: per-capita need 0.007, necessity 1.0. gas: need 0.004, necessity 0.4 (physical-economy.ts).
    // Demand-only shares (7:4) and demand×necessity shares (0.007:0.0016 = 35:8) disagree, so weighting
    // the SAME two readings (water 0.2, gas 1.0) by one vs the other must produce different means — if
    // they agreed, the necessity term was dropped and openingProvision is openingSatisfaction relabelled.
    const tracker = new Map<string, FoundedColonyRecord>();
    const systems = [sys("c1", "developed")];
    trackFoundedColonies(systems, 24, new Set(), tracker, NO_STAGING);
    sampleFoundedColonies(systems, [mkt("c1", "water", 0.2), mkt("c1", "gas", 1.0)], 48, tracker);

    const record = tracker.get("c1");
    if (record?.openingSatisfaction == null || record.openingProvision == null) {
      throw new Error("fixture: expected a sampled opening reading");
    }
    expect(record.openingSatisfaction).toBeCloseTo(5.4 / 11, 9);   // demand-only shares: 7:4
    expect(record.openingProvision).toBeCloseTo(15 / 43, 9);       // demand×necessity shares: 35:8
    expect(record.openingProvision).not.toBeCloseTo(record.openingSatisfaction, 3);
    // Necessity weighs water (the worse-served good) more heavily, so Provision reads worse.
    expect(record.openingProvision).toBeLessThan(record.openingSatisfaction);
  });

  it("reads a colony's demand basis off its OWN system row, not merely the first row it is handed", () => {
    // The lookup is by id. Matching on position instead reads the wrong world's population, which
    // does not fail loudly — it produces a plausible opening figure for the wrong colony. The
    // decoy is listed first and holds nobody, so its basis demands nothing at all.
    const decoy: FoundedColonySystem = { id: "decoy", control: "developed", population: 0, buildings: {} };
    const colony = sys("c1", "developed");
    const tracker = new Map<string, FoundedColonyRecord>();
    trackFoundedColonies([colony], 24, new Set(), tracker, NO_STAGING);

    sampleFoundedColonies([decoy, colony], [mkt("c1", "water", 0.25)], 48, tracker);
    expect(tracker.get("c1")?.openingSatisfaction).toBeCloseTo(0.25, 9);
  });

  it("keeps the opening reading, ignoring later cycles", () => {
    const tracker = new Map<string, FoundedColonyRecord>();
    const systems = [sys("c1", "developed")];
    trackFoundedColonies(systems, 24, new Set(), tracker, NO_STAGING);
    sampleFoundedColonies(systems, [mkt("c1", "food", 0.9)], 48, tracker);
    sampleFoundedColonies(systems, [mkt("c1", "food", 0.1)], 72, tracker); // later famine

    expect(tracker.get("c1")?.openingSatisfaction).toBeCloseTo(0.9, 6);
  });

  it("counts a colony that opened deprived, and excludes the unsampled from the means", () => {
    const tracker = new Map<string, FoundedColonyRecord>([
      ["a", rec("a", 0.9, 0.01)],
      ["b", rec("b", 0.1, 0.81)],
      ["c", rec("c", null, null)],
    ]);

    const summary = summariseFoundingStock(tracker);
    expect(summary.foundedCount).toBe(3);
    expect(summary.sampledCount).toBe(2);       // 'c' never reached a cycle — not a zero in the mean
    expect(summary.meanOpeningSatisfaction).toBeCloseTo(0.5, 6);
    expect(summary.meanOpeningShortfall).toBeCloseTo(0.41, 6);
    expect(summary.meanOpeningProvision).toBeCloseTo(0.5, 6);   // rec() defaults provision = satisfaction
    expect(summary.openingDeprivedCount).toBe(1);
  });

  it("excludes a record missing ANY of the three opening readings, not just the last one", () => {
    // The three are written together, so a record holding only some of them is a half-finished
    // sample. Counting it folds a null into a sum as 0 — a colony that reads as having opened
    // with nothing, which is exactly the alarm the founding invariant watches for.
    const tracker = new Map<string, FoundedColonyRecord>([
      ["no-satisfaction", rec("no-satisfaction", null, 0.2, 0.8)],
      ["no-shortfall", rec("no-shortfall", 0.8, null, 0.8)],
      ["no-provision", rec("no-provision", 0.8, 0.2, null)],
    ]);

    const summary = summariseFoundingStock(tracker);
    expect(summary.foundedCount).toBe(3);
    expect(summary.sampledCount).toBe(0);
    expect(summary.meanOpeningProvision).toBeNull();
  });

  it("counts a colony deprived strictly below the half-satisfaction mark", () => {
    // Exactly half is the boundary the constant names, and it is exclusive: a colony sitting on it
    // opened at the mark, not below it.
    const tracker = new Map<string, FoundedColonyRecord>([
      ["under", rec("under", 0.4, 0.6)],
      ["at-mark", rec("at-mark", 0.5, 0.5)],
      ["over", rec("over", 0.9, 0.1)],
    ]);
    expect(summariseFoundingStock(tracker).openingDeprivedCount).toBe(1);
  });

  it("takes the Provision decile from the sampled colonies alone", () => {
    // p10 is the founding invariant's worst-decile reading. A polluted or pre-seeded distribution
    // moves it without any colony having changed, and the mean beside it would still look right.
    const tracker = new Map<string, FoundedColonyRecord>([
      ["a", rec("a", 0.8, 0.2, 0.2)],
      ["b", rec("b", 0.8, 0.2, 0.4)],
      ["c", rec("c", 0.8, 0.2, 0.6)],
      ["d", rec("d", 0.8, 0.2, 0.8)],
      ["e", rec("e", 0.8, 0.2, 1.0)],
    ]);
    const summary = summariseFoundingStock(tracker);
    expect(summary.meanOpeningProvision).toBeCloseTo(0.6, 9);
    // Five readings 0.2…1.0: the 10th percentile sits between the lowest two, well under the mean.
    expect(summary.p10OpeningProvision).not.toBeNull();
    expect(summary.p10OpeningProvision ?? 1).toBeGreaterThanOrEqual(0.2);
    expect(summary.p10OpeningProvision ?? 1).toBeLessThan(0.4);
  });

  it("reports the literal minimum, never the p10 percentile, on a fixture where the two diverge", () => {
    // 10 colonies: eight cluster at 0.3, one deep outlier at 0.05, one healthy at 0.9. This
    // library's quantile() is nearest-rank (s[floor(q*n)]): p10 of 10 sorted readings picks index 1
    // (0.3), not the true minimum (0.05) — exactly the case promise 1's tail check needs a REAL
    // minimum for: p10 bounds 90% of the cohort, but the worst reading can sit well under it, and an
    // implementation that read minOpeningProvision off p10OpeningProvision (or off the sorted
    // percentile neighbour) would report 0.3 here instead of the true 0.05.
    const tracker = new Map<string, FoundedColonyRecord>([
      ["low", rec("low", 0.05, 0.95, 0.05)],
      ["b", rec("b", 0.3, 0.7, 0.3)], ["c", rec("c", 0.3, 0.7, 0.3)], ["d", rec("d", 0.3, 0.7, 0.3)],
      ["e", rec("e", 0.3, 0.7, 0.3)], ["f", rec("f", 0.3, 0.7, 0.3)], ["g", rec("g", 0.3, 0.7, 0.3)],
      ["h", rec("h", 0.3, 0.7, 0.3)], ["i", rec("i", 0.3, 0.7, 0.3)],
      ["j", rec("j", 0.9, 0.1, 0.9)],
    ]);
    const summary = summariseFoundingStock(tracker);
    expect(summary.p10OpeningProvision).toBeCloseTo(0.3, 9);
    expect(summary.minOpeningProvision).toBeCloseTo(0.05, 9);
    expect(summary.minOpeningProvision).not.toBeCloseTo(summary.p10OpeningProvision ?? -1, 3);
  });

  it("folds meanOpeningProvision from openingProvision, not from openingSatisfaction", () => {
    // Every OTHER summary-level test in this file uses rec()'s default, which sets openingProvision
    // equal to openingSatisfaction per record — so a bug that aliased the two summary accumulators
    // (e.g. meanOpeningProvision folded from r.openingSatisfaction) would pass the whole suite despite
    // being wrong. Here the two are deliberately made to differ per colony, and per colony the
    // provision value has no fixed relationship to the satisfaction value (some higher, some lower),
    // so the two summary means can only land on the values below if each is folded from its own field.
    const tracker = new Map<string, FoundedColonyRecord>([
      ["a", rec("a", 0.9, 0.01, 0.5)],
      ["b", rec("b", 0.1, 0.81, 0.9)],
      ["c", rec("c", 0.5, 0.25, 0.7)],
    ]);

    const summary = summariseFoundingStock(tracker);
    expect(summary.meanOpeningSatisfaction).toBeCloseTo((0.9 + 0.1 + 0.5) / 3, 9);   // 0.5
    expect(summary.meanOpeningProvision).toBeCloseTo((0.5 + 0.9 + 0.7) / 3, 9);      // 0.7
    expect(summary.meanOpeningProvision).not.toBeCloseTo(summary.meanOpeningSatisfaction, 3);
  });

  it("reports zeroed means — and NULL cover/Provision readings — when no colony was ever founded", () => {
    // The cover median must be null, not 0: a printed "0.00×" reads as founders drained flat
    // when the truth is that nothing was measured. Provision is null for the same reason: a run
    // that founds nothing has no founding Provision to report, not a Provision of 0%.
    const summary = summariseFoundingStock(new Map());
    expect(summary).toEqual({
      foundedCount: 0, sampledCount: 0, meanOpeningSatisfaction: 0,
      meanOpeningShortfall: 0, meanOpeningProvision: null, p10OpeningProvision: null,
      minOpeningProvision: null,
      openingDeprivedCount: 0,
      meanManifestTonnage: 0, meanFoundingMoneyCost: 0, medianFounderCoverAfter: null,
      // Same rule for the cadence mark: no colonies means there is no mark, and a 0 would read as
      // "the whole burst landed on tick zero".
      cadenceMarkShare: FOUNDING_CADENCE_MARK_SHARE, cadenceMarkTick: null,
    });
  });

  it("separates p10 from the mean on a skewed cohort", () => {
    // A single number can't carry the invariant when the cohort is skewed — the spec measures 376
    // of 562 colonies opening below 50% satisfaction, so most of a run's colonies can be badly
    // provisioned while a handful of well-off ones pull the mean up. Mirror that shape: 6 poor, 4 well.
    const tracker = new Map<string, FoundedColonyRecord>([
      ["a", rec("a", 0.1, 0.81, 0.1)], ["b", rec("b", 0.1, 0.81, 0.1)], ["c", rec("c", 0.1, 0.81, 0.1)],
      ["d", rec("d", 0.1, 0.81, 0.1)], ["e", rec("e", 0.1, 0.81, 0.1)], ["f", rec("f", 0.1, 0.81, 0.1)],
      ["g", rec("g", 0.9, 0.01, 0.9)], ["h", rec("h", 0.9, 0.01, 0.9)],
      ["i", rec("i", 0.9, 0.01, 0.9)], ["j", rec("j", 0.9, 0.01, 0.9)],
    ]);
    const summary = summariseFoundingStock(tracker);
    if (summary.meanOpeningProvision === null || summary.p10OpeningProvision === null) {
      throw new Error("fixture: expected both readings on a founded cohort");
    }
    expect(summary.meanOpeningProvision).toBeCloseTo(0.42, 9);  // (6*0.1 + 4*0.9) / 10
    expect(summary.p10OpeningProvision).toBeCloseTo(0.1, 9);    // the worst decile is still in the poor tail
    expect(summary.p10OpeningProvision).toBeLessThan(summary.meanOpeningProvision);
  });

  it("folds every cycle's draw into the one colony, not just the draw it was founded on", () => {
    // A manifest arrives in slices over the whole establish, and every slice is drawn while the
    // target is still `controlled` — invisible to the founded-colony tracker. Only the accumulator
    // keeps them, so the record has to be built from it at tracking time: read the tracker as the
    // draws happen instead and a colony records its last cycle alone.
    const staging = new Map<string, FoundingStagingTotals>();
    recordFoundingManifest(staging, draw("c1", 40, 12, 0.9));
    recordFoundingManifest(staging, draw("c1", 30, 9, 0.4));   // the deepest draw…
    recordFoundingManifest(staging, draw("c1", 30, 9, 0.7));   // …is not the last one

    const tracker = new Map<string, FoundedColonyRecord>();
    trackFoundedColonies([sys("c1", "developed")], 24, new Set(), tracker, staging);

    expect(tracker.get("c1")?.manifestTonnage).toBeCloseTo(100, 9); // all three slices
    expect(tracker.get("c1")?.foundingMoneyCost).toBeCloseTo(30, 9);
    expect(tracker.get("c1")?.founderCoverAfter).toBeCloseTo(0.4, 9); // the minimum across draws
  });

  it("keeps two colonies drawing on one founder in one cycle as two distinct covers", () => {
    // The founder is left at a different level by each of them, so the second colony's cover is
    // not the first's. Keyed by anything but the TARGET system, the two collapse into one reading.
    const staging = new Map<string, FoundingStagingTotals>();
    recordFoundingManifest(staging, draw("c1", 40, 10, 0.8));
    recordFoundingManifest(staging, draw("c2", 10, 3, 0.2));

    const tracker = new Map<string, FoundedColonyRecord>();
    trackFoundedColonies(
      [sys("c1", "developed"), sys("c2", "developed")], 24, new Set(), tracker, staging,
    );

    expect(tracker.get("c1")?.founderCoverAfter).toBeCloseTo(0.8, 9);
    expect(tracker.get("c2")?.founderCoverAfter).toBeCloseTo(0.2, 9);
    expect(tracker.get("c1")?.manifestTonnage).toBeCloseTo(40, 9);
    expect(tracker.get("c2")?.manifestTonnage).toBeCloseTo(10, 9);
  });

  it("guards every recording edge: zero tonnage, unmeasurable cover, corrupt money", () => {
    const staging = new Map<string, FoundingStagingTotals>();

    // A draw that moved nothing cost the founder nothing — recording it would drag the tonnage
    // mean and invite a cover reading where nothing shipped.
    recordFoundingManifest(staging, draw("c1", 0, 5, 0.5));
    expect(staging.has("c1")).toBe(false);

    // An unmeasurable cover (undefined, or corrupt) records the tonnage but leaves the cover
    // absent — never 0, which reads as a founder drained flat.
    recordFoundingManifest(staging, draw("c1", 100, 10, undefined));
    recordFoundingManifest(staging, draw("c1", 100, 10, Number.NaN));
    expect(staging.get("c1")?.tonnage).toBeCloseTo(200, 9);
    expect(staging.get("c1")?.minFounderCover).toBeUndefined();

    // A corrupt money cost is dropped rather than summed — one NaN would poison the whole run's
    // mean — while the tonnage it moved still counts.
    recordFoundingManifest(staging, draw("c1", 50, Number.NaN, 0.5));
    expect(staging.get("c1")?.tonnage).toBeCloseTo(250, 9);
    expect(staging.get("c1")?.moneyCost).toBeCloseTo(20, 9);
    expect(staging.get("c1")?.minFounderCover).toBeCloseTo(0.5, 9);
  });

  it("folds manifest tonnage, money and founder cover into the founding summary", () => {
    const tracker = new Map<string, FoundedColonyRecord>([
      ["a", { ...rec("a", 0.9, 0.01), manifestTonnage: 100, foundingMoneyCost: 30, founderCoverAfter: 1.0 }],
      ["b", { ...rec("b", 0.5, 0.25), manifestTonnage: 300, foundingMoneyCost: 90, founderCoverAfter: 0.4 }],
      ["c", { ...rec("c", 0.5, 0.25), manifestTonnage: 200, foundingMoneyCost: 60, founderCoverAfter: 0.6 }],
    ]);

    const summary = summariseFoundingStock(tracker);
    expect(summary.meanManifestTonnage).toBeCloseTo(200, 9);
    expect(summary.meanFoundingMoneyCost).toBeCloseTo(60, 9);
    expect(summary.medianFounderCoverAfter).toBeCloseTo(0.6, 9);
  });

  it("excludes a colony that staged nothing from the founder-cover reading", () => {
    // A colony founded with an empty manifest cost its founder nothing; folding a 0 cover in
    // would read as a founder drained flat.
    const tracker = new Map<string, FoundedColonyRecord>([
      ["a", { ...rec("a", 0.9, 0.01), manifestTonnage: 100, founderCoverAfter: 0.8 }],
      ["b", rec("b", 0.9, 0.01)], // never staged a draw
    ]);

    const summary = summariseFoundingStock(tracker);
    expect(summary.medianFounderCoverAfter).toBeCloseTo(0.8, 9);
    expect(summary.meanManifestTonnage).toBeCloseTo(50, 9); // 100 over both founded colonies
  });
});

describe("sampleFoundingTrajectory / summariseFoundingTrajectory", () => {
  const trajSys = (id: string, unrest: number): FoundingTrajectorySystem => ({
    id, population: EXPANSION.COLONY_SEED_POP, buildings: {}, unrest,
  });
  const mkt = (systemId: string, goodId: string, satisfaction: number) => ({ systemId, goodId, satisfaction });
  const recordAt = (foundedTick: number): FoundedColonyRecord => ({
    systemId: "c1", foundedTick, openingSatisfaction: null, openingShortfall: null, openingProvision: null,
  });

  it("buckets by AGE SINCE FOUNDING, not absolute tick — a mid-run founding lands in bucket 0", () => {
    const foundedTick = 240; // mid-run, well past tick 0
    const tracker = new Map([["c1", recordAt(foundedTick)]]);
    const totals = newFoundingTrajectoryTotals();
    // One cycle old: correct (age-keyed) bucketing reads bucket 0. An absolute-tick bucketing
    // (tick / cycleLength / bucketCycles = (240+24)/24/10 = 1.1 -> bucket 1) would instead land
    // this sample in bucket 1 — the fixture is chosen so the two disagree, not just differ in degree.
    const oneCycleOld = foundedTick + 24;
    sampleFoundingTrajectory(
      [trajSys("c1", 0.1)], [mkt("c1", "water", 0.5)], oneCycleOld, 24, tracker, totals,
    );
    const summary = summariseFoundingTrajectory(totals);
    expect(summary.buckets[0].n).toBe(1);
    expect(summary.buckets[1].n).toBe(0);
    expect(summary.buckets[0].meanUnrest).toBeCloseTo(0.1, 9);
  });

  it("excludes a colony once it ages past the whole bucketed window", () => {
    const tracker = new Map([["c1", recordAt(0)]]);
    const totals = newFoundingTrajectoryTotals();
    const windowEdgeTick = FOUNDING_TRAJECTORY_BUCKET_COUNT * FOUNDING_TRAJECTORY_BUCKET_CYCLES * 24;
    sampleFoundingTrajectory(
      [trajSys("c1", 0.5)], [mkt("c1", "water", 0.5)], windowEdgeTick, 24, tracker, totals,
    );
    const summary = summariseFoundingTrajectory(totals);
    expect(summary.buckets.every((b) => b.n === 0)).toBe(true);
  });

  it("accumulates every sample a colony contributes as it ages through a bucket, not just the last", () => {
    const tracker = new Map([["c1", recordAt(0)]]);
    const totals = newFoundingTrajectoryTotals();
    sampleFoundingTrajectory([trajSys("c1", 0)], [mkt("c1", "water", 0.4)], 24, 24, tracker, totals); // age 1 cycle
    sampleFoundingTrajectory([trajSys("c1", 0)], [mkt("c1", "water", 0.8)], 5 * 24, 24, tracker, totals); // age 5 cycles — still bucket 0
    const summary = summariseFoundingTrajectory(totals);
    expect(summary.buckets[0].n).toBe(2);
    expect(summary.buckets[0].meanProvision).toBeCloseTo(0.6, 6);
  });

  it("contributes no sample on the founding tick itself — the market-seeding placeholder, not a real reading — only from the first cycle strictly after it", () => {
    const tracker = new Map([["c1", recordAt(0)]]);
    const totals = newFoundingTrajectoryTotals();
    // Same tick as founding: age 0. This is provision()'s market-seeding placeholder (1.0), not a
    // lived cycle — must contribute nothing to bucket 0.
    sampleFoundingTrajectory([trajSys("c1", 0)], [mkt("c1", "water", 1)], 0, 24, tracker, totals);
    let summary = summariseFoundingTrajectory(totals);
    expect(summary.buckets[0].n).toBe(0);

    // The very next cycle: a real reading, now counted.
    sampleFoundingTrajectory([trajSys("c1", 0)], [mkt("c1", "water", 0.5)], 24, 24, tracker, totals);
    summary = summariseFoundingTrajectory(totals);
    expect(summary.buckets[0].n).toBe(1);
    expect(summary.buckets[0].meanProvision).toBeCloseTo(0.5, 6);
  });

  it("hasColonyInTrajectoryWindow: false on the founding tick itself, true once the first cycle begins, false once past the window", () => {
    const tracker = new Map([["c1", recordAt(0)]]);
    expect(hasColonyInTrajectoryWindow(tracker, 0, 24)).toBe(false); // founding tick itself — nothing due yet
    expect(hasColonyInTrajectoryWindow(tracker, 24, 24)).toBe(true); // one cycle later — due
    const windowEdgeTick = FOUNDING_TRAJECTORY_BUCKET_COUNT * FOUNDING_TRAJECTORY_BUCKET_CYCLES * 24;
    expect(hasColonyInTrajectoryWindow(tracker, windowEdgeTick, 24)).toBe(false);
  });
});

describe("founding cadence mark", () => {
  const at = (systemId: string, foundedTick: number): FoundedColonyRecord => ({
    systemId, foundedTick, openingSatisfaction: null, openingShortfall: null, openingProvision: null,
  });
  const trackerOf = (...ticks: number[]): Map<string, FoundedColonyRecord> =>
    new Map(ticks.map((t, i) => [`c${i}`, at(`c${i}`, t)]));

  it("returns the tick the share'th colony was founded on, not an interpolation", () => {
    // Five colonies, 80% ⇒ the fourth. The mark is a real founding's tick: an interpolated one
    // names a tick on which nothing happened, and two arms cannot be compared on that.
    expect(foundingCadenceMarkTick(trackerOf(100, 200, 300, 400, 5000))).toBe(400);
  });

  it("does not depend on the order colonies were tracked in", () => {
    // The tracker is a Map keyed by system, and its iteration order follows insertion — which
    // follows whichever system the sweep happened to reach first, not founding order.
    const ordered = foundingCadenceMarkTick(trackerOf(100, 200, 300, 400, 5000));
    const shuffled = foundingCadenceMarkTick(trackerOf(100, 5000, 200, 300, 400));
    expect(shuffled).toBe(ordered);
  });

  it("rounds a fractional share UP to a whole colony", () => {
    // Four colonies, 80% ⇒ 3.2 colonies. Three of four is 75% and has NOT reached the mark, so the
    // mark is the fourth's tick — rounding down would report the run 80% founded at 75%.
    expect(foundingCadenceMarkTick(trackerOf(10, 20, 30, 900))).toBe(900);
  });

  it("denominates over the run's OWN total, so it reads pacing and not volume", () => {
    // Twice as many colonies on the same rhythm must read the same mark — otherwise an arm that
    // founds more colonies looks like one that founds them later.
    expect(foundingCadenceMarkTick(trackerOf(100, 200, 300, 400, 500))).toBe(400);
    expect(
      foundingCadenceMarkTick(trackerOf(100, 100, 200, 200, 300, 300, 400, 400, 500, 500)),
    ).toBe(400);
  });

  it("reports no mark for a run that founded nothing, never a zero tick", () => {
    expect(foundingCadenceMarkTick(new Map())).toBeNull();
    // JSON-safe: a NaN or Infinity would serialise to null and read as "not founded" instead.
    const summary = summariseFoundingStock(trackerOf(48));
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it("puts a single founding's own tick on the mark", () => {
    expect(foundingCadenceMarkTick(trackerOf(432))).toBe(432);
  });

  it("carries the mark and its share into the founding-stock summary", () => {
    const summary = summariseFoundingStock(trackerOf(100, 200, 300, 400, 5000));
    expect(summary.cadenceMarkShare).toBe(FOUNDING_CADENCE_MARK_SHARE);
    expect(summary.cadenceMarkTick).toBe(400);
  });
});

describe("founding lifecycle — stall attribution", () => {
  const stall = (
    gate: FoundingStallEvent["gate"],
    extra: { materialsShort?: boolean; stalled?: boolean } = {},
  ): FoundingStallEvent => ({
    systemId: "c1", sourceSystemId: "home", gate,
    materialsShort: extra.materialsShort ?? false,
    stalled: extra.stalled ?? false,
  });

  it("keeps the three causes apart, and counts a materials shortfall as neither", () => {
    // The counter this whole reading exists for. Collapsed into one number, a galaxy where the
    // charter froze founding and one where the construction pool shrank read identically — and the
    // fix for one is the opposite of the fix for the other.
    const totals = newFoundingStallTotals();
    recordFoundingStall(totals, stall("charter"), false);
    recordFoundingStall(totals, stall("funds", { stalled: true }), false);
    // Money bought PART of the share: work is gated below the cap, yet something was staged, so
    // the write-off clock resets. The two counts are not the same question.
    recordFoundingStall(totals, stall("funds"), false);
    recordFoundingStall(totals, stall("pool"), false);
    recordFoundingStall(totals, stall(null, { materialsShort: true, stalled: true }), true);
    recordFoundingStall(totals, stall(null, { materialsShort: true, stalled: true }), false);
    recordFoundingStall(totals, stall(null), false);

    expect(totals.charter).toBe(1);
    expect(totals.funds).toBe(2);
    expect(totals.pool).toBe(1);
    expect(totals.unGated).toBe(3);
    // The four gate buckets partition the observed colony-cycles — no cycle is counted twice and
    // none is lost, so every share printed against `observed` is honest.
    expect(totals.charter + totals.funds + totals.pool + totals.unGated).toBe(totals.observed);
    expect(totals.observed).toBe(7);
    // Materials shortfalls cut ACROSS the partition: informational, never a work gate.
    expect(totals.materialsShort).toBe(2);
    expect(totals.materialsShortUnderEvent).toBe(1);
    // The write-off clock is the world's own materials/money semantics, not the gate split: a
    // pool-starved cycle never advances it, and a partly-funded cycle resets it.
    expect(totals.stalled).toBe(3);
  });

  it("reports an empty census as zeroes that survive JSON, never NaN", () => {
    const totals = newFoundingStallTotals();
    expect(totals.observed).toBe(0);
    expect(JSON.parse(JSON.stringify(totals))).toEqual(totals);
  });
});

describe("founding lifecycle — commitment, completion and concurrency", () => {
  const colony = (systemId: string, foundedTick: number): FoundedColonyRecord => ({
    systemId, foundedTick, openingSatisfaction: null, openingShortfall: null, openingProvision: null,
  });
  const establish = (systemId: string) => ({ kind: "colony_establish" as const, systemId });
  const build = (systemId: string) => ({ kind: "build" as const, systemId });

  it("dates a commitment to the first cycle its establish was seen open, and counts concurrency", () => {
    const commitments = new Map<string, number>();
    const inFlight = newInFlightEstablishTotals();
    sampleOpenColonies([establish("c1"), build("hw")], 24, commitments, inFlight);
    sampleOpenColonies([establish("c1"), establish("c2")], 48, commitments, inFlight);
    sampleOpenColonies([establish("c2")], 72, commitments, inFlight);

    // First seen wins — a colony open for three cycles was committed once, not three times.
    expect(commitments.get("c1")).toBe(24);
    expect(commitments.get("c2")).toBe(48);
    expect(inFlight.samples).toBe(3);
    expect(inFlight.total).toBe(4);
    expect(inFlight.max).toBe(2);
    expect(inFlight.maxTick).toBe(48);
  });

  it("measures duration in construction cycles and excludes colonies never seen committed", () => {
    const commitments = new Map<string, number>([["c1", 24], ["c2", 48]]);
    const inFlight = newInFlightEstablishTotals();
    sampleOpenColonies([establish("c1"), establish("c2")], 96, commitments, inFlight);
    const tracker = new Map<string, FoundedColonyRecord>([
      ["c1", colony("c1", 120)],  // 96 ticks = 4 cycles
      ["c2", colony("c2", 192)],  // 144 ticks = 6 cycles
      ["c3", colony("c3", 200)],  // committed and completed inside one cycle — never in the queue
    ]);

    const summary = summariseFoundingLifecycle(
      tracker, commitments, inFlight, newFoundingStallTotals(), 24,
    );

    // The denominator is colonies with a reading, not colonies founded: folding the unobserved one
    // in as a zero would report founding as a third faster than it is.
    expect(summary.sampledCount).toBe(2);
    expect(summary.unobservedCount).toBe(1);
    expect(summary.meanCycles).toBeCloseTo(5, 9);
    expect(summary.medianCycles).toBeCloseTo(5, 9);
    expect(summary.maxCycles).toBeCloseTo(6, 9);
    expect(summary.inFlight.meanPerCycle).toBeCloseTo(2, 9);
    expect(summary.inFlight.sampledCycles).toBe(1);
  });

  it("dates the concurrency peak to the FIRST cycle that reached it", () => {
    // "When was founding at its busiest" is answered by when the peak was first reached, not by the
    // last cycle that happened to match it — a plateau otherwise reports its own end as its start.
    const commitments = new Map<string, number>();
    const inFlight = newInFlightEstablishTotals();
    sampleOpenColonies([establish("c1"), establish("c2")], 24, commitments, inFlight);
    sampleOpenColonies([establish("c1"), establish("c2")], 48, commitments, inFlight);
    expect(inFlight.max).toBe(2);
    expect(inFlight.maxTick).toBe(24);
  });

  it("keeps the LONGEST founding as the maximum, not the last one measured", () => {
    // The slowest founding is the one the bar is read against; a running maximum that latched every
    // reading would report whichever colony the tracker iterated last.
    const commitments = new Map<string, number>([["slow", 0], ["fast", 0]]);
    const tracker = new Map<string, FoundedColonyRecord>([
      ["slow", colony("slow", 240)], // 10 cycles
      ["fast", colony("fast", 24)],  // 1 cycle — iterated last
    ]);
    const summary = summariseFoundingLifecycle(
      tracker, commitments, newInFlightEstablishTotals(), newFoundingStallTotals(), 24,
    );
    expect(summary.maxCycles).toBeCloseTo(10, 9);
    expect(summary.meanCycles).toBeCloseTo(5.5, 9);
  });

  it("averages concurrency over the cycles sampled, never multiplies by them", () => {
    // meanPerCycle is a rate: `open summed ÷ cycles sampled`. The two figures are within an order
    // of each other in a real run, so a wrong operator here reads as a plausible number.
    const commitments = new Map<string, number>();
    const inFlight = newInFlightEstablishTotals();
    sampleOpenColonies([establish("c1"), establish("c2"), establish("c3")], 24, commitments, inFlight);
    sampleOpenColonies([establish("c1")], 48, commitments, inFlight);
    sampleOpenColonies([], 72, commitments, inFlight);
    const summary = summariseFoundingLifecycle(
      new Map(), commitments, inFlight, newFoundingStallTotals(), 24,
    );
    expect(summary.inFlight.sampledCycles).toBe(3);
    expect(summary.inFlight.meanPerCycle).toBeCloseTo(4 / 3, 9); // not 12
  });

  it("reports durations in ticks rather than dividing by a cadence of zero", () => {
    // An Infinity in a duration would print as the report's headline figure and survive the JSON
    // round-trip as null.
    const summary = summariseFoundingLifecycle(
      new Map<string, FoundedColonyRecord>([["c1", colony("c1", 96)]]),
      new Map([["c1", 24]]),
      newInFlightEstablishTotals(), newFoundingStallTotals(), 0,
    );
    expect(summary.meanCycles).toBe(72);
    expect(summary.maxCycles).toBe(72);
    expect(Number.isFinite(summary.medianCycles)).toBe(true);
  });

  it("reports a run that founded nothing as zeroes, not NaN", () => {
    const summary = summariseFoundingLifecycle(
      new Map(), new Map(), newInFlightEstablishTotals(), newFoundingStallTotals(), 24,
    );
    expect(summary.sampledCount).toBe(0);
    expect(summary.meanCycles).toBe(0);
    expect(summary.medianCycles).toBe(0);
    expect(summary.maxCycles).toBe(0);
    expect(summary.inFlight.meanPerCycle).toBe(0);
    expect(summary.inFlight.maxTick).toBeNull();
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});

describe("summariseFounderCohort", () => {
  const sys = (id: string, control: SystemControl, idle: Record<string, number> = {}) =>
    ({ id, control, buildingIdleCycles: idle });
  const mkt = (
    systemId: string, realisedProductionRate?: number, productionSuppressed?: boolean,
  ) => ({ systemId, realisedProductionRate, productionSuppressed });

  it("splits developed systems by whether they supplied a founding, each with its own denominator", () => {
    const systems = [
      sys("f1", "developed", { ore: 2 }),
      sys("f2", "developed"),
      sys("o1", "developed", { ore: 1, food: 3 }),
      sys("c1", "controlled", { ore: 5 }), // never developed — in neither cohort
    ];
    const markets = [
      mkt("f1", 10), mkt("f1", 30, true),
      mkt("f2", 20),
      mkt("o1", 4), mkt("o1", 2),
      mkt("o1"),                           // never assessed — not a producing market
      mkt("o1", 0),                        // ASSESSED and produces nothing — also not one
      mkt("c1", 999),                      // undeveloped — excluded entirely
    ];

    const summary = summariseFounderCohort(systems, markets, new Set(["f1", "f2"]));

    expect(summary.founder.systemCount).toBe(2);
    expect(summary.other.systemCount).toBe(1);
    expect(summary.founder.meanRealisedProduction).toBeCloseTo(30, 9); // (10+30+20)/2 systems
    expect(summary.other.meanRealisedProduction).toBeCloseTo(6, 9);    // (4+2)/1 system
    expect(summary.founder.producingMarkets).toBe(3);
    // Neither the unassessed row nor the assessed zero counts. By run end almost every row in the
    // galaxy is assessed, so counting a real 0 as a producer would put the whole basket in this
    // denominator and drive the suppressed share toward nothing.
    expect(summary.other.producingMarkets).toBe(2);
    expect(summary.founder.productionSuppressedShare).toBeCloseTo(1 / 3, 9);
    expect(summary.other.productionSuppressedShare).toBe(0);
    expect(summary.founder.meanIdleTypes).toBeCloseTo(0.5, 9);         // one type idle over two systems
    expect(summary.other.meanIdleTypes).toBeCloseTo(2, 9);
    expect(summary.founder.idleSystemShare).toBeCloseTo(0.5, 9);
    expect(summary.other.idleSystemShare).toBe(1);
  });

  it("does not count a building type standing at zero idle cycles as idle", () => {
    // `buildingIdleCycles` carries a counter per type, and a running type sits at 0 rather than
    // being absent. Counting a present-but-zero entry would report every developed system in the
    // galaxy as idle on everything it has built.
    const summary = summariseFounderCohort(
      [sys("f1", "developed", { ore: 0, food: 0 }), sys("o1", "developed", { ore: 0, food: 2 })],
      [mkt("f1", 5), mkt("o1", 5)],
      new Set(["f1"]),
    );
    expect(summary.founder.meanIdleTypes).toBe(0);
    expect(summary.founder.idleSystemShare).toBe(0);
    expect(summary.other.meanIdleTypes).toBeCloseTo(1, 9); // only `food` is genuinely idle
    expect(summary.other.idleSystemShare).toBe(1);
  });

  it("reports an empty founder cohort as zeroes that survive JSON, never NaN", () => {
    const summary = summariseFounderCohort(
      [sys("o1", "developed")], [mkt("o1", 5)], new Set(),
    );
    expect(summary.founder.systemCount).toBe(0);
    expect(summary.founder.meanRealisedProduction).toBe(0);
    expect(summary.founder.productionSuppressedShare).toBe(0);
    expect(summary.founder.idleSystemShare).toBe(0);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});

describe("summariseTierZeroIdle", () => {
  const sys = (
    id: string,
    control: SystemControl,
    buildings: Record<string, number> = {},
    idle: Record<string, number> = {},
  ) => ({ id, control, buildings, buildingIdleCycles: idle });

  it("reports a deliberately idle tier-0 extractor level, split homeworld vs colony", () => {
    // hw: ore's idle countdown is running (>0) — one whole idle tier-0 level.
    // c1: ore itself is calm (idleCycles 0); metals carries an idle countdown but is NOT tier-0
    // (GOOD_TIER_BY_KEY), so it must not be counted.
    const systems = [
      sys("hw", "developed", { ore: 4 }, { ore: 2 }),
      sys("c1", "developed", { ore: 2, metals: 1 }, { ore: 0, metals: 3 }),
    ];
    const summary = summariseTierZeroIdle(systems, new Set(["hw"]));
    expect(summary.homeworld.systemCount).toBe(1);
    expect(summary.homeworld.idleLevels).toBe(1);
    expect(summary.homeworld.systemsWithIdleTier0).toBe(1);
    expect(summary.colony.systemCount).toBe(1);
    expect(summary.colony.idleLevels).toBe(0);
    expect(summary.colony.systemsWithIdleTier0).toBe(0);
  });

  it("reports zero on a fully-utilised world, cross-checked against the decay engine's own teardown signal staying zero too", () => {
    // The same "built = used, calm" fixture the decay engine's own test suite uses
    // (lib/engine/__tests__/infrastructure-decay.test.ts) to prove nothing sheds: 2 ore levels
    // fully staffed and selling. computeSystemDecay confirms the INDEPENDENT signal (whole levels
    // torn down, and the idle countdown itself) both stay at zero for this exact state, so a
    // summariseTierZeroIdle reading of zero over the same buildingIdleCycles input agrees with it
    // rather than merely asserting its own output in isolation.
    const decayResult = computeSystemDecay(
      {
        buildings: { ore: 2 },
        buildingIdleCycles: {},
        collapseDebt: 0,
        population: 2 * ORE_LABOUR,
        unrest: 0,
        sellingFactor: () => 1,
      },
      { idleBufferCycles: 3, unrestThreshold: 0.75 },
    );
    expect(decayResult.newCounts).toEqual({}); // independent signal: nothing torn down
    expect(decayResult.newIdleCycles).toEqual({}); // independent signal: idle countdown never armed

    const summary = summariseTierZeroIdle(
      [sys("c1", "developed", { ore: 2 }, { ore: 0 })],
      new Set(),
    );
    expect(summary.colony.idleLevels).toBe(0);
    expect(summary.colony.systemsWithIdleTier0).toBe(0);
  });

  it("ignores non-developed systems and zero/negative-count building entries", () => {
    const summary = summariseTierZeroIdle(
      [
        sys("outpost", "controlled", { ore: 5 }, { ore: 9 }), // never developed — excluded entirely
        sys("c1", "developed", { ore: 0, metals: -2 }, { ore: 9, metals: 9 }), // no positive tier-0 count
      ],
      new Set(),
    );
    expect(summary.colony.systemCount).toBe(1); // outpost excluded, c1 counted
    expect(summary.colony.idleLevels).toBe(0);
    expect(summary.colony.systemsWithIdleTier0).toBe(0);
  });

  it("reports an empty galaxy as zeroes that survive JSON, never NaN", () => {
    const summary = summariseTierZeroIdle([], new Set());
    expect(summary.homeworld).toEqual({ systemCount: 0, idleLevels: 0, systemsWithIdleTier0: 0 });
    expect(summary.colony).toEqual({ systemCount: 0, idleLevels: 0, systemsWithIdleTier0: 0 });
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});
