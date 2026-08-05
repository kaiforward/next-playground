import { describe, it, expect } from "vitest";
import {
  summarizeColonisation, summarizeConstructionPool, summarizeBuildBursts,
  trackFoundedColonies, sampleFoundedColonies, hasColonyAwaitingSample, summarizeFoundingStock,
  recordFoundingManifest,
} from "../build-analysis";
import type { BuildCommitmentRecord, FoundedColonyRecord, FoundedColonySystem } from "../build-analysis";
import { EXPANSION } from "@/lib/constants/expansion";
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, HEAVY_INDUSTRY_COMPLEX,
  CONSTRUCTION_CENTRE_TYPE,
} from "@/lib/constants/industry";
import { CONSTRUCTION, workCostPerLevel } from "@/lib/constants/construction";
import { unitResourceVector, emptyResourceVector, makeResourceVector } from "@/lib/engine/resources";
import type { TickSystem } from "@/lib/tick/rows";
import type { SystemControl, WorldConstructionProject } from "@/lib/world/types";
import type { ResourceVector } from "@/lib/types/game";

/**
 * Characterization tests for the colonisation / build-loop health summary. This is the
 * calibration instrument that surfaces a broken build loop (colonies developed but never
 * built out) which aggregate market health hides — so its own tier classification, stranded
 * flags, class split, and queue math must be pinned. If any of these fail the implementation
 * no longer matches the documented behavior — report, don't adjust.
 */

function devSys(
  id: string,
  opts: {
    control?: SystemControl;
    population?: number;
    popCap?: number;
    buildings?: Record<string, number>;
    slotCap?: ResourceVector;
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
    slotCap: opts.slotCap ?? emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0,
  };
}

function project(
  systemId: string, buildingType: string,
  { levels = 1, workTotal = 100, workDone = 0 }: { levels?: number; workTotal?: number; workDone?: number } = {},
): WorldConstructionProject {
  return { kind: "build", id: `${systemId}:${buildingType}`, origin: "auto", factionId: "f1", systemId, buildingType, levels, workTotal, workDone };
}

describe("summarizeColonisation — per-class build-out", () => {
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
      slotCap: makeResourceVector({ ore: 10 }),
    });

    // Stranded colony: seed population landed but nothing built, on idle deposits, popCap never raised.
    const stranded = devSys("c1", {
      population: 500, popCap: 0,
      buildings: {},
      slotCap: makeResourceVector({ ore: 10 }),
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

    const summary = summarizeColonisation(
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
      slotCap: makeResourceVector({ ore: 5 }),
    });
    const summary = summarizeColonisation([ghostBuilt], new Set(), []);

    expect(summary.colony.withTier0).toBe(0);
    expect(summary.colony.withHousing).toBe(0);
    expect(summary.colony.populatedButNoIndustry).toBe(1);
    expect(summary.colony.depositsIdle).toBe(1); // slotCap > 0 but no positive tier0
  });
});

describe("summarizeColonisation — construction queue split", () => {
  it("splits open projects by target class and sums levels + colony progress", () => {
    const homeworldIds = new Set(["hw"]);
    const projects: WorldConstructionProject[] = [
      project("hw", "ore", { levels: 4, workTotal: 100, workDone: 50 }),      // homeworld
      project("c1", HOUSING_TYPE, { levels: 2, workTotal: 100, workDone: 25 }), // colony, 0.25 progress
      project("c1", "ore", { levels: 3, workTotal: 200, workDone: 100 }),       // colony, 0.50 progress
      project("c2", "metals", { levels: 1, workTotal: 0, workDone: 0 }),        // colony, workTotal 0 → 0 progress
    ];

    const summary = summarizeColonisation([], homeworldIds, projects);

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
    const summary = summarizeColonisation([], new Set(), projects);

    expect(summary.queue.colonyByKind).toEqual({
      housing: 1, academy: 2, complex: 1, tier0: 1, tier1: 1, tier2: 1, other: 1,
    });
  });

  it("counts open centre projects under kind 'centre'", () => {
    const summary = summarizeColonisation([], new Set(), [
      { kind: "build", id: "c1", origin: "auto", factionId: "f1", systemId: "x",
        buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1,
        workTotal: workCostPerLevel(CONSTRUCTION_CENTRE_TYPE), workDone: 0 },
    ]);
    expect(summary.queue.colonyByKind["centre"]).toBe(1);
  });

  it("reports zero colony progress when there are no colony projects (division guard)", () => {
    const summary = summarizeColonisation([], new Set(["hw"]), [project("hw", "ore")]);
    expect(summary.queue.colonyProjects).toBe(0);
    expect(summary.queue.colonyMeanProgress).toBe(0);
    expect(summary.queue.colonyByKind).toEqual({});
  });

  it("excludes colony-establish projects from the queue split (reported in PR4, no NaN)", () => {
    const colony: WorldConstructionProject = {
      kind: "colony_establish", id: "c1:establish", origin: "auto", factionId: "f1", systemId: "c1",
      sourceSystemId: "hw", seedPop: 50, housingLevels: 3, workTotal: 84, workDone: 40,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    const summary = summarizeColonisation([], new Set(["hw"]), [
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

describe("summarizeConstructionPool", () => {
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
    const s = summarizeConstructionPool([sys], projects);
    expect(s.poolCentres).toBeCloseTo(CONSTRUCTION.POINTS_PER_LEVEL);
    expect(s.poolBase).toBeCloseTo((200 - 7) * CONSTRUCTION.THROUGHPUT_PER_POP);
    expect(s.centreShare).toBeCloseTo(s.poolCentres / (s.poolBase + s.poolCentres));
    expect(s.centreLevels).toBe(1);
    expect(s.queueRemainingWork).toBe(30);
    expect(s.queueEtaCycles).toBeCloseTo(30 / (s.poolBase + s.poolCentres));
  });

  it("reports a null ETA when nothing funds the queue", () => {
    const s = summarizeConstructionPool([], [
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
    const s = summarizeConstructionPool([outpost], []);
    expect(s.centreLevels).toBe(0);
  });
});

describe("summarizeBuildBursts", () => {
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
    const summary = summarizeBuildBursts(records);
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
    const summary = summarizeBuildBursts(records);
    expect(summary.byGood.map((g) => g.goodId)).toEqual(["electronics", "food", "metals"]);
  });

  it("reports the galaxy-wide worst good/tick as globalMax/worstGood/worstTick", () => {
    const records: BuildCommitmentRecord[] = [
      rec(24, "food", 5),
      rec(48, "metals", 12),
      rec(72, "electronics", 8),
    ];
    const summary = summarizeBuildBursts(records);
    expect(summary.globalMax).toBe(12);
    expect(summary.worstGood).toBe("metals");
    expect(summary.worstTick).toBe(48);
  });

  it("reports zero/null for an empty run (no builds committed) — no NaN, no crash", () => {
    const summary = summarizeBuildBursts([]);
    expect(summary.byGood).toEqual([]);
    expect(summary.globalMax).toBe(0);
    expect(summary.worstGood).toBeNull();
    expect(summary.worstTick).toBeNull();
  });

  it("keeps the first-seen tick's max, not the LAST tick a good was committed", () => {
    // The max is 7 at tick 24; later ticks propose fewer levels, so the tick pinned must stay 24 —
    // proving the summary tracks the cycle the maximum happened at, not just the final observation.
    const records: BuildCommitmentRecord[] = [rec(24, "food", 7), rec(48, "food", 2), rec(72, "food", 1)];
    const summary = summarizeBuildBursts(records);
    expect(summary.byGood).toEqual([{ goodId: "food", maxLevelsPerCycle: 7, tick: 24 }]);
  });

  it("keeps the first-seen tick on an equal-maxima tie (strict >, not >=)", () => {
    // Two cycles commit the SAME max levels; the strict `>` means the first-seen tick (24) must be pinned,
    // not overwritten by the later equal cycle (48). A `>=` regression would pin 48 instead.
    const records: BuildCommitmentRecord[] = [rec(24, "food", 5), rec(48, "food", 5)];
    const summary = summarizeBuildBursts(records);
    expect(summary.byGood).toEqual([{ goodId: "food", maxLevelsPerCycle: 5, tick: 24 }]);
  });
});

/**
 * The founding-stock instrument. Its whole job is to see a symptom no galaxy-wide average can —
 * a handful of brand-new colonies opening starved — so what must be pinned is that it samples the
 * right systems at the right moment, weights goods by what the colony actually needs, and does not
 * quietly read a colony as fed.
 */
describe("trackFoundedColonies / summarizeFoundingStock", () => {
  /** A seed-sized colony: no buildings, so its basket is pure per-capita civilian demand. */
  const sys = (id: string, control: SystemControl): FoundedColonySystem => ({
    id, control, population: EXPANSION.COLONY_SEED_POP, buildings: {},
  });
  const mkt = (systemId: string, goodId: string, satisfaction: number) =>
    ({ systemId, goodId, satisfaction });
  const rec = (
    systemId: string, openingSatisfaction: number | null, openingDissatisfaction: number | null,
  ): FoundedColonyRecord => ({ systemId, foundedTick: 0, openingSatisfaction, openingDissatisfaction });

  it("tracks only systems developed after tick 0, not world-gen's own", () => {
    const tracker = new Map<string, FoundedColonyRecord>();
    const developedAtStart = new Set(["home"]);
    trackFoundedColonies(
      [sys("home", "developed"), sys("c1", "developed"), sys("c2", "controlled")],
      12, developedAtStart, tracker,
    );

    expect([...tracker.keys()]).toEqual(["c1"]);
    expect(tracker.get("c1")?.foundedTick).toBe(12);
  });

  it("reads at the first cycle strictly after founding, never the founding cycle itself", () => {
    const tracker = new Map<string, FoundedColonyRecord>();
    const systems = [sys("c1", "developed")];
    const markets = [mkt("c1", "food", 1), mkt("c1", "water", 1)];
    trackFoundedColonies(systems, 24, new Set(), tracker);

    // Founded ON a cycle-start tick: that same cycle assessed a system that did not exist for the cycle.
    expect(hasColonyAwaitingSample(tracker, 24)).toBe(false);
    sampleFoundedColonies(systems, markets, 24, tracker);
    expect(tracker.get("c1")?.openingSatisfaction).toBeNull();

    expect(hasColonyAwaitingSample(tracker, 48)).toBe(true);
    sampleFoundedColonies(systems, markets, 48, tracker);
    expect(tracker.get("c1")?.openingSatisfaction).toBeCloseTo(1, 6);
    expect(tracker.get("c1")?.openingDissatisfaction).toBeCloseTo(0, 6);
    // Once read, it stops asking to be read again.
    expect(hasColonyAwaitingSample(tracker, 72)).toBe(false);
  });

  it("weights a good by the colony's own need for it, not one vote per good", () => {
    // The discriminating shape: a seed needs far more water than luxuries. Starving it of luxuries
    // must read as nearly fed; starving it of water must not. A flat mean scores both exactly 0.5.
    const systems = [sys("c1", "developed")];

    const noLuxuries = new Map<string, FoundedColonyRecord>();
    trackFoundedColonies(systems, 24, new Set(), noLuxuries);
    sampleFoundedColonies(systems, [mkt("c1", "water", 1), mkt("c1", "luxuries", 0)], 48, noLuxuries);

    const noWater = new Map<string, FoundedColonyRecord>();
    trackFoundedColonies(systems, 24, new Set(), noWater);
    sampleFoundedColonies(systems, [mkt("c1", "water", 0), mkt("c1", "luxuries", 1)], 48, noWater);

    expect(noLuxuries.get("c1")!.openingSatisfaction!).toBeGreaterThan(0.9);
    expect(noWater.get("c1")!.openingSatisfaction!).toBeLessThan(0.1);
    // ...and the unrest fold agrees, so instrument and simulation cannot drift apart.
    expect(noWater.get("c1")!.openingDissatisfaction!)
      .toBeGreaterThan(noLuxuries.get("c1")!.openingDissatisfaction!);
  });

  it("keeps the opening reading, ignoring later cycles", () => {
    const tracker = new Map<string, FoundedColonyRecord>();
    const systems = [sys("c1", "developed")];
    trackFoundedColonies(systems, 24, new Set(), tracker);
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

    const summary = summarizeFoundingStock(tracker);
    expect(summary.foundedCount).toBe(3);
    expect(summary.sampledCount).toBe(2);       // 'c' never reached a cycle — not a zero in the mean
    expect(summary.meanOpeningSatisfaction).toBeCloseTo(0.5, 6);
    expect(summary.meanOpeningDissatisfaction).toBeCloseTo(0.41, 6);
    expect(summary.openingDeprivedCount).toBe(1);
  });

  it("reports zeroed means — and a NULL cover median — when no colony was ever founded", () => {
    // The cover median must be null, not 0: a printed "0.00×" reads as founders drained flat
    // when the truth is that nothing was measured.
    const summary = summarizeFoundingStock(new Map());
    expect(summary).toEqual({
      foundedCount: 0, sampledCount: 0, meanOpeningSatisfaction: 0,
      meanOpeningDissatisfaction: 0, openingDeprivedCount: 0,
      meanManifestTonnage: 0, medianFounderCoverAfter: null,
    });
  });

  it("records what the founding cost its founder, at the founding tick", () => {
    // The manifest's cap is use-figure denominated, so a founder whose own draw was overstated
    // now parts with more per colony. Both halves are read where it happens: the tonnage that
    // left, and the founder's own remaining cover against the floor it is supposed to keep.
    const tracker = new Map<string, FoundedColonyRecord>();
    trackFoundedColonies([sys("c1", "developed")], 24, new Set(), tracker);

    recordFoundingManifest(tracker, "c1", 300, 0.75);

    expect(tracker.get("c1")?.manifestTonnage).toBe(300);
    expect(tracker.get("c1")?.founderCoverAfter).toBeCloseTo(0.75, 9);
  });

  it("guards every recording edge: zero tonnage, unknown colony, unmeasurable cover", () => {
    const tracker = new Map<string, FoundedColonyRecord>();
    trackFoundedColonies([sys("c1", "developed")], 24, new Set(), tracker);

    // A zero-tonnage manifest cost the founder nothing — recording it would drag the tonnage
    // mean and invite a cover reading where nothing shipped.
    recordFoundingManifest(tracker, "c1", 0, 0.5);
    expect(tracker.get("c1")?.manifestTonnage).toBeUndefined();
    expect(tracker.get("c1")?.founderCoverAfter).toBeUndefined();

    // A colony the tracker never saw is a no-op, not a crash or a phantom record.
    recordFoundingManifest(tracker, "nope", 100, 0.5);
    expect(tracker.has("nope")).toBe(false);

    // An unmeasurable cover (undefined, or corrupt) records the tonnage but leaves the cover
    // absent — never 0, which reads as a founder drained flat.
    recordFoundingManifest(tracker, "c1", 100, undefined);
    expect(tracker.get("c1")?.manifestTonnage).toBe(100);
    expect(tracker.get("c1")?.founderCoverAfter).toBeUndefined();
    recordFoundingManifest(tracker, "c1", 100, Number.NaN);
    expect(tracker.get("c1")?.founderCoverAfter).toBeUndefined();
  });

  it("folds manifest tonnage and founder cover into the founding summary", () => {
    const tracker = new Map<string, FoundedColonyRecord>([
      ["a", { ...rec("a", 0.9, 0.01), manifestTonnage: 100, founderCoverAfter: 1.0 }],
      ["b", { ...rec("b", 0.5, 0.25), manifestTonnage: 300, founderCoverAfter: 0.4 }],
      ["c", { ...rec("c", 0.5, 0.25), manifestTonnage: 200, founderCoverAfter: 0.6 }],
    ]);

    const summary = summarizeFoundingStock(tracker);
    expect(summary.meanManifestTonnage).toBeCloseTo(200, 9);
    expect(summary.medianFounderCoverAfter).toBeCloseTo(0.6, 9);
  });

  it("excludes a colony that shipped no manifest from the founder-cover reading", () => {
    // A colony founded with an empty manifest cost its founder nothing; folding a 0 cover in
    // would read as a founder drained flat.
    const tracker = new Map<string, FoundedColonyRecord>([
      ["a", { ...rec("a", 0.9, 0.01), manifestTonnage: 100, founderCoverAfter: 0.8 }],
      ["b", rec("b", 0.9, 0.01)], // never recorded a manifest
    ]);

    const summary = summarizeFoundingStock(tracker);
    expect(summary.medianFounderCoverAfter).toBeCloseTo(0.8, 9);
    expect(summary.meanManifestTonnage).toBeCloseTo(50, 9); // 100 over both founded colonies
  });
});
