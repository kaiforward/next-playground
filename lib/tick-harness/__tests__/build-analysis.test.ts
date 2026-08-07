import { describe, it, expect } from "vitest";
import {
  summarizeColonisation, summarizeConstructionPool, summarizeBuildBursts,
  trackFoundedColonies, sampleFoundedColonies, hasColonyAwaitingSample, summarizeFoundingStock,
  recordFoundingManifest, newFoundingStallTotals, recordFoundingStall, newInFlightEstablishTotals,
  sampleOpenColonies, summarizeFoundingLifecycle, summarizeFounderCohort,
  foundingCadenceMarkTick, FOUNDING_CADENCE_MARK_SHARE,
} from "../build-analysis";
import type {
  BuildCommitmentRecord, FoundedColonyRecord, FoundedColonySystem, FoundingStagingTotals,
} from "../build-analysis";
import type { FoundingStallEvent } from "@/lib/tick/types";
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
    expect(tracker.get("c1")?.openingDissatisfaction).toBeCloseTo(0, 6);
    // Once read, it stops asking to be read again.
    expect(hasColonyAwaitingSample(tracker, 72)).toBe(false);
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
        luxuriesRecord.openingDissatisfaction === null ||
        waterRecord?.openingSatisfaction == null ||
        waterRecord.openingDissatisfaction === null) {
      throw new Error("fixture: expected both colonies to carry an opening reading");
    }
    expect(luxuriesRecord.openingSatisfaction).toBeGreaterThan(0.9);
    expect(waterRecord.openingSatisfaction).toBeLessThan(0.1);
    // ...and the unrest fold agrees, so instrument and simulation cannot drift apart.
    expect(waterRecord.openingDissatisfaction)
      .toBeGreaterThan(luxuriesRecord.openingDissatisfaction);
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
      meanManifestTonnage: 0, meanFoundingMoneyCost: 0, medianFounderCoverAfter: null,
      // Same rule for the cadence mark: no colonies means there is no mark, and a 0 would read as
      // "the whole burst landed on tick zero".
      cadenceMarkShare: FOUNDING_CADENCE_MARK_SHARE, cadenceMarkTick: null,
    });
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

    const summary = summarizeFoundingStock(tracker);
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

    const summary = summarizeFoundingStock(tracker);
    expect(summary.medianFounderCoverAfter).toBeCloseTo(0.8, 9);
    expect(summary.meanManifestTonnage).toBeCloseTo(50, 9); // 100 over both founded colonies
  });
});

describe("founding cadence mark", () => {
  const at = (systemId: string, foundedTick: number): FoundedColonyRecord => ({
    systemId, foundedTick, openingSatisfaction: null, openingDissatisfaction: null,
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
    // JSON-safe: a NaN or Infinity would serialize to null and read as "not founded" instead.
    const summary = summarizeFoundingStock(trackerOf(48));
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it("puts a single founding's own tick on the mark", () => {
    expect(foundingCadenceMarkTick(trackerOf(432))).toBe(432);
  });

  it("carries the mark and its share into the founding-stock summary", () => {
    const summary = summarizeFoundingStock(trackerOf(100, 200, 300, 400, 5000));
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
    systemId, foundedTick, openingSatisfaction: null, openingDissatisfaction: null,
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

    const summary = summarizeFoundingLifecycle(
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
    const summary = summarizeFoundingLifecycle(
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
    const summary = summarizeFoundingLifecycle(
      new Map(), commitments, inFlight, newFoundingStallTotals(), 24,
    );
    expect(summary.inFlight.sampledCycles).toBe(3);
    expect(summary.inFlight.meanPerCycle).toBeCloseTo(4 / 3, 9); // not 12
  });

  it("reports durations in ticks rather than dividing by a cadence of zero", () => {
    // An Infinity in a duration would print as the report's headline figure and survive the JSON
    // round-trip as null.
    const summary = summarizeFoundingLifecycle(
      new Map<string, FoundedColonyRecord>([["c1", colony("c1", 96)]]),
      new Map([["c1", 24]]),
      newInFlightEstablishTotals(), newFoundingStallTotals(), 0,
    );
    expect(summary.meanCycles).toBe(72);
    expect(summary.maxCycles).toBe(72);
    expect(Number.isFinite(summary.medianCycles)).toBe(true);
  });

  it("reports a run that founded nothing as zeroes, not NaN", () => {
    const summary = summarizeFoundingLifecycle(
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

describe("summarizeFounderCohort", () => {
  const sys = (id: string, control: SystemControl, idle: Record<string, number> = {}) =>
    ({ id, control, buildingIdleCycles: idle });
  const mkt = (
    systemId: string, realizedProductionRate?: number, productionSuppressed?: boolean,
  ) => ({ systemId, realizedProductionRate, productionSuppressed });

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

    const summary = summarizeFounderCohort(systems, markets, new Set(["f1", "f2"]));

    expect(summary.founder.systemCount).toBe(2);
    expect(summary.other.systemCount).toBe(1);
    expect(summary.founder.meanRealizedProduction).toBeCloseTo(30, 9); // (10+30+20)/2 systems
    expect(summary.other.meanRealizedProduction).toBeCloseTo(6, 9);    // (4+2)/1 system
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
    const summary = summarizeFounderCohort(
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
    const summary = summarizeFounderCohort(
      [sys("o1", "developed")], [mkt("o1", 5)], new Set(),
    );
    expect(summary.founder.systemCount).toBe(0);
    expect(summary.founder.meanRealizedProduction).toBe(0);
    expect(summary.founder.productionSuppressedShare).toBe(0);
    expect(summary.founder.idleSystemShare).toBe(0);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});
