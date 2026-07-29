import { describe, it, expect } from "vitest";
import { detectPingPong, summarizeInfrastructure, summarizePopulation, summarizeSupplyRegimes } from "../population-analysis";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { CROWDING } from "@/lib/constants/population";
import { D_SHORTAGE_CUT } from "@/lib/constants/economy";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldEvent } from "@/lib/world/types";

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
    unrest: 0, buildings, buildingIdleCycles: {}, collapseDebt: 0, yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
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
    unrest, buildings: {}, buildingIdleCycles: {}, collapseDebt: 0,
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

describe("summarizePopulation — striking share and stranded population", () => {
  const BRAKE_END = CROWDING.BRAKE_END;

  it("reports striking as a share of systems alongside the raw count", () => {
    // The count alone reads differently as the galaxy grows: 1 of 4 and 1 of 400 are not the same
    // galaxy, and striking is meant to be a transient minority rather than the ambient state.
    const systems = [
      popSys("calm-a", 100, 1000, 0.1),
      popSys("calm-b", 100, 1000, 0.1),
      popSys("calm-c", 100, 1000, 0.64),  // just under the threshold
      popSys("striking", 100, 1000, 0.65), // exactly at it — inclusive
    ];
    const summary = summarizePopulation(systems, 400, 0.65, BRAKE_END);
    expect(summary.strikingCount).toBe(1);
    expect(summary.strikingShare).toBeCloseTo(0.25, 6);
  });

  it("reports 0 share, not NaN, for an empty galaxy", () => {
    const summary = summarizePopulation([], 0, 0.65, BRAKE_END);
    expect(summary.strikingShare).toBe(0);
    expect(Number.isFinite(summary.strikingShare)).toBe(true);
    expect(summary.strandedCount).toBe(0);
    expect(summary.strandedPopulation).toBe(0);
  });

  it("counts population stranded at popCap ≈ 0, and how many people are caught there", () => {
    // The trap the collapse channel's housing floor closes: residents with no housing left cannot
    // grow (crowdFactor reads fully crowded at popCap 0) and cannot be rebuilt for until fed.
    const systems = [
      popSys("stranded-a", 240, 0),      // housing torn out from under 240 people
      popSys("stranded-b", 60, 0),
      popSys("abandoned", 0, 0),         // no housing AND nobody home — not stranded, just empty
      popSys("healthy", 500, 1000),
    ];
    const summary = summarizePopulation(systems, 800, 0.65, BRAKE_END);
    expect(summary.strandedCount).toBe(2);
    expect(summary.strandedPopulation).toBe(300);
  });

  it("counts a popCap left as float residue, not just an exact zero", () => {
    // What STRANDED_POP_CAP is FOR. Decay arithmetic can leave a cap at 5e-7 rather than a clean 0,
    // which is the same trap — no housing, no growth, no way out — but every other fixture here uses
    // exactly 0, so the constant's magnitude is otherwise untested and any value in (0, 20) passes.
    const systems = [
      popSys("residue", 100, 5e-7),   // stranded: below the epsilon, effectively no housing
      popSys("sliver", 100, 1e-3),    // not stranded: a real, if tiny, cap
    ];
    const summary = summarizePopulation(systems, 200, 0.65, BRAKE_END);
    expect(summary.strandedCount).toBe(1);
    expect(summary.strandedPopulation).toBe(100);
  });

  it("does not count a system that still has a whole housing level", () => {
    // Only an effectively-zero cap qualifies — a system merely over its cap is overcrowded, which is
    // the normal state of a full world, not the absorbing trap.
    const systems = [
      popSys("overcrowded", 1200, 1000),
      popSys("tiny-cap", 100, 20),
    ];
    const summary = summarizePopulation(systems, 1300, 0.65, BRAKE_END);
    expect(summary.strandedCount).toBe(0);
    expect(summary.strandedPopulation).toBe(0);
  });
});

describe("summarizeSupplyRegimes", () => {
  const mkt = (systemId: string, goodId: string, satisfaction: number) => ({ systemId, goodId, satisfaction });

  it("classifies settled systems and reports shares that sum to 1", () => {
    const systems = [popSys("fed", 100, 1000), popSys("thirsty", 100, 1000)];
    const summary = summarizeSupplyRegimes(systems, [
      mkt("fed", "water", 1), mkt("fed", "food", 1),
      mkt("thirsty", "water", 0), mkt("thirsty", "food", 1),
    ]);
    expect(summary.counted).toBe(2);
    expect(summary.supplied).toBe(1);
    expect(summary.shortage).toBe(1);
    expect(summary.suppliedShare + summary.rationingShare + summary.shortageShare).toBeCloseTo(1, 10);
  });

  it("buckets a mildly-short system as rationing, not supplied or shortage", () => {
    // The bucket the other fixtures never produce. Water at 0.9 is above the survival line, and the
    // squared gap folds to D ≈ 0.005 — non-zero, so not supplied; far under the cut, so not shortage.
    // Without this, a summarizer that mis-routed the rationing branch would still pass the suite.
    const systems = [popSys("peckish", 100, 1000)];
    const summary = summarizeSupplyRegimes(systems, [
      mkt("peckish", "water", 0.9), mkt("peckish", "food", 1),
    ]);
    expect(summary.rationing).toBe(1);
    expect(summary.supplied).toBe(0);
    expect(summary.shortage).toBe(0);
    expect(summary.meanDissatisfaction).toBeGreaterThan(0);
    expect(summary.meanDissatisfaction).toBeLessThan(D_SHORTAGE_CUT);
  });

  it("reaches shortage through the D cut, not only the survival shortcut", () => {
    // Both survival goods sit ABOVE SHORTAGE_SATISFACTION (0.55 > 0.5), so hasSurvivalShortfall is
    // false and the shortcut cannot fire — a deeply-missing low-necessity good carries D over the cut
    // on its own. The "thirsty" fixture above takes the shortcut, so without this case the cut branch
    // is never the thing under test.
    const systems = [popSys("squeezed", 100, 1000)];
    const summary = summarizeSupplyRegimes(systems, [
      mkt("squeezed", "water", 0.55), mkt("squeezed", "food", 0.55), mkt("squeezed", "gas", 0),
    ]);
    expect(summary.shortage).toBe(1);
    expect(summary.meanDissatisfaction).toBeGreaterThanOrEqual(D_SHORTAGE_CUT);
  });

  it("folds active events without disturbing the reading when none touches consumption", () => {
    // The instrument rebuilds consumption modifiers from the persisted events so it cannot drift from
    // the tick. No shipped event carries a consumption_rate multiplier today, so an active event must
    // leave the classification exactly where it was — this pins that the wiring is inert, not lossy.
    const systems = [popSys("fed", 100, 1000), popSys("thirsty", 100, 1000)];
    const markets = [
      mkt("fed", "water", 1), mkt("fed", "food", 1),
      mkt("thirsty", "water", 0), mkt("thirsty", "food", 1),
    ];
    const event: WorldEvent = {
      id: "e1", type: "inner_system_conflict", phase: "tensions",
      systemId: "thirsty", regionId: "r1", startTick: 0, phaseStartTick: 0, phaseDuration: 10,
      severity: 1, sourceEventId: null, metadata: null,
    };
    expect(summarizeSupplyRegimes(systems, markets, [event]))
      .toEqual(summarizeSupplyRegimes(systems, markets));
  });

  it("counts only settled systems and never reports NaN for an empty galaxy", () => {
    const summary = summarizeSupplyRegimes([], []);
    expect(summary.counted).toBe(0);
    expect(Number.isFinite(summary.suppliedShare)).toBe(true);
    expect(summary.meanDissatisfaction).toBe(0);
  });
});
