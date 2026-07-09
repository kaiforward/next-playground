import { describe, it, expect } from "vitest";
import { detectPingPong, summarizeInfrastructure } from "../population-analysis";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { SimSystem } from "@/lib/engine/simulator/types";

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

function infraSys(id: string, buildings: Record<string, number>, popCap: number): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", control: "developed",
    governmentType: "frontier", population: 50, popCap, traits: [],
    unrest: 0, buildings, buildingIdleMonths: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
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
