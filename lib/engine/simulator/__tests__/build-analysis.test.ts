import { describe, it, expect } from "vitest";
import { summarizeColonisation } from "../build-analysis";
import {
  HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, RESEARCH_INSTITUTE_TYPE, HEAVY_INDUSTRY_COMPLEX,
} from "@/lib/constants/industry";
import { unitResourceVector, emptyResourceVector, makeResourceVector } from "@/lib/engine/resources";
import type { SimSystem } from "@/lib/engine/simulator/types";
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
): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1",
    control: opts.control ?? "developed",
    governmentType: "frontier",
    population: opts.population ?? 0,
    popCap: opts.popCap ?? 1000,
    traits: [], unrest: 0,
    buildings: opts.buildings ?? {},
    buildingIdleMonths: {},
    yields: unitResourceVector(),
    slotCap: opts.slotCap ?? emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0,
  };
}

function project(
  systemId: string, buildingType: string,
  { levels = 1, workTotal = 100, workDone = 0 }: { levels?: number; workTotal?: number; workDone?: number } = {},
): WorldConstructionProject {
  return { id: `${systemId}:${buildingType}`, factionId: "f1", systemId, buildingType, levels, workTotal, workDone };
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

  it("reports zero colony progress when there are no colony projects (division guard)", () => {
    const summary = summarizeColonisation([], new Set(["hw"]), [project("hw", "ore")]);
    expect(summary.queue.colonyProjects).toBe(0);
    expect(summary.queue.colonyMeanProgress).toBe(0);
    expect(summary.queue.colonyByKind).toEqual({});
  });
});
