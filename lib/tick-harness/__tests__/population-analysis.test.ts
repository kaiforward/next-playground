import { describe, it, expect } from "vitest";
import { detectPingPong, summarizeInfrastructure, summarizePopulation } from "../population-analysis";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { CROWDING } from "@/lib/constants/population";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { TickSystem } from "@/lib/tick/rows";

/**
 * Characterization tests for detectPingPong. If any of these fail the
 * implementation does not match the documented behavior — report, don't adjust.
 */
describe("detectPingPong", () => {
  it("returns 0 when fewer than 3 snapshots are provided", () => {
    const snap = new Map([["a", 100]]);
    expect(detectPingPong([])).toBe(0);
    expect(detectPingPong([snap])).toBe(0);
    expect(detectPingPong([snap, new Map([["a", 110]])])).toBe(0);
  });

  it("counts a system whose population direction reverses >= minReversals times", () => {
    // Build snapshots: system "osc" alternates up/down 6 times → 5 reversals.
    // Pattern: 100, 110, 100, 110, 100, 110, 100  (6 deltas, alternating sign)
    const values = [100, 110, 100, 110, 100, 110, 100];
    const snapshots = values.map((v) => new Map([["osc", v]]));
    // Default minReversals=4; this system has 5 reversals → counted
    expect(detectPingPong(snapshots)).toBe(1);
  });

  it("does NOT count a monotonically growing system", () => {
    const snapshots = [100, 110, 120, 130, 140, 150, 160].map(
      (v) => new Map([["grow", v]]),
    );
    expect(detectPingPong(snapshots)).toBe(0);
  });

  it("does NOT count a monotonically shrinking system", () => {
    const snapshots = [160, 150, 140, 130, 120, 110, 100].map(
      (v) => new Map([["shrink", v]]),
    );
    expect(detectPingPong(snapshots)).toBe(0);
  });

  it("respects the minReversals threshold — a system just below the threshold is not counted", () => {
    // 3 reversals: 100→110→100→110→100 (4 deltas: +10, -10, +10, -10 → 3 sign changes)
    const values = [100, 110, 100, 110, 100];
    const snapshots = values.map((v) => new Map([["barely", v]]));
    // minReversals=4 (default) → 3 < 4 → not counted
    expect(detectPingPong(snapshots)).toBe(0);
    // minReversals=3 → 3 >= 3 → counted
    expect(detectPingPong(snapshots, 3)).toBe(1);
  });

  it("counts only the oscillating system when mixed with monotone neighbours", () => {
    const oscillating = [100, 110, 100, 110, 100, 110, 100]; // 5 reversals
    const growing     = [100, 110, 120, 130, 140, 150, 160]; // 0 reversals
    const snapshots = oscillating.map((v, i) =>
      new Map([
        ["osc",  v],
        ["grow", growing[i]!],
      ]),
    );
    expect(detectPingPong(snapshots)).toBe(1);
  });
});

function infraSys(id: string, buildings: Record<string, number>, popCap: number): TickSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", control: "developed",
    governmentType: "frontier", population: 50, popCap,
    unrest: 0, buildings, buildingIdleMonths: {}, buildingCollapseDebt: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
  };
}

describe("summarizeInfrastructure", () => {
  it("reports total built, decay %, and counts collapsed systems", () => {
    // Started with 100 built; now 60 → 40% decayed. s2 fully collapsed.
    const systems = [
      infraSys("s1", { [HOUSING_TYPE]: 30, ore: 30 }, 600),
      infraSys("s2", { [HOUSING_TYPE]: 0, ore: 0 }, 0),
    ];
    const summary = summarizeInfrastructure(systems, 100);
    expect(summary.builtStart).toBe(100);
    expect(summary.builtEnd).toBe(60);
    expect(summary.decayedPct).toBeCloseTo(40, 6);
    expect(summary.collapsedCount).toBe(1);
  });
});

function popSys(id: string, population: number, popCap: number, unrest = 0): TickSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", control: "developed",
    governmentType: "frontier", population, popCap,
    unrest, buildings: {}, buildingIdleMonths: {}, buildingCollapseDebt: {},
    yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
  };
}

describe("summarizePopulation", () => {
  const BRAKE_END = CROWDING.BRAKE_END; // 1.15 — growth brakes to 0 at r = BRAKE_END

  it("counts saturatedCount unchanged: population >= 98% of popCap, popCap > 0 only", () => {
    const systems = [
      popSys("at-cap", 980, 1000),   // r = 0.98 → saturated
      popSys("below", 970, 1000),    // r = 0.97 → not saturated
      popSys("no-housing", 500, 0),  // popCap 0 → excluded regardless of population
    ];
    const summary = summarizePopulation(systems, 1000, 0.65, BRAKE_END);
    expect(summary.saturatedCount).toBe(1);
  });

  it("counts brakedCount only for popCap > 0 systems whose crowdFactor has fallen to <= 0.25", () => {
    const systems = [
      popSys("healthy", 1000, 1000),  // r = 1.0 → crowdFactor 1 → not braked
      popSys("braked", 1120, 1000),   // r = 1.12 → deep in the brake, crowdFactor well below 0.25
      popSys("uncrowded", 500, 1000), // r = 0.5 → crowdFactor 1 → not braked
      // popCap 0 reads crowdFactor 0 (fully crowded) but must be excluded by the popCap > 0 guard —
      // otherwise every unhoused system would misread as "braked" rather than "no housing at all".
      popSys("no-housing", 500, 0),
    ];
    const summary = summarizePopulation(systems, 1000, 0.65, BRAKE_END);
    expect(summary.brakedCount).toBe(1);
  });

  it("computes meanOccupancy as the mean of population/popCap over popCap > 0 systems only", () => {
    const systems = [
      popSys("a", 500, 1000),       // 0.5
      popSys("b", 750, 1000),       // 0.75
      popSys("no-housing", 999, 0), // excluded from both sum and count
    ];
    const summary = summarizePopulation(systems, 1000, 0.65, BRAKE_END);
    expect(summary.meanOccupancy).toBeCloseTo(0.625, 6);
  });

  it("guards meanOccupancy to 0 (never NaN) when no system has popCap > 0", () => {
    const systems = [popSys("a", 500, 0), popSys("b", 10, 0)];
    const summary = summarizePopulation(systems, 100, 0.65, BRAKE_END);
    expect(summary.meanOccupancy).toBe(0);
    expect(Number.isFinite(summary.meanOccupancy)).toBe(true);
  });
});
