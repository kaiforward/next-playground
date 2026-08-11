import { describe, it, expect } from "vitest";
import {
  computeTrailingProvisionVariance, detectPingPong, newEpisodeCostTotals, perSystemSupplyState,
  recordEpisodeCosts, sampleProvisionBySystem, summarizeInfrastructure, summarizePopulation,
  summarizeSupplyRegimes, worstGoodSatisfaction,
} from "../population-analysis";
import type { SystemSupplyState } from "../population-analysis";
import { EXPECTATION_PARAMS } from "@/lib/constants/population";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { CROWDING } from "@/lib/constants/population";
import { SHORTAGE_SATISFACTION } from "@/lib/constants/economy";
import { GOOD_NAMES } from "@/lib/constants/goods";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
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

  it("reads three snapshots — the shortest series that holds a reversal at all", () => {
    // Two snapshots give one delta and no direction to reverse; three give the first real reading.
    // The floor is exclusive at 3, so a series of exactly three must still be measured.
    const snapshots = [100, 110, 100].map((v) => new Map([["osc", v]]));
    expect(detectPingPong(snapshots, 1)).toBe(1);
  });

  it("does not read a flat step as a change of direction", () => {
    // A system that simply stopped moving for a snapshot has not reversed. Counting the flat
    // delta as a reversal turns any stalled world into an oscillating one.
    const snapshots = [100, 110, 110, 120].map((v) => new Map([["stall", v]]));
    expect(detectPingPong(snapshots, 1)).toBe(0);
  });

  it("carries the last real direction across a flat step, so the reversal after it still counts", () => {
    // Up, flat, down IS a reversal — the flat snapshot must not erase the direction it interrupts,
    // or a system that pauses at each turn reads as perfectly stable.
    const snapshots = [100, 110, 110, 100].map((v) => new Map([["pause", v]]));
    expect(detectPingPong(snapshots, 1)).toBe(1);
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

  it("counts a settled system as collapsed only below one whole building", () => {
    // Ghost industry is a system that HAD industry and lost it. The bound is exclusive at one:
    // a system down to its last building is not yet a collapse, and an unclaimed rock with no
    // buildings never was one. Three systems either side, so the count moves whichever way a
    // flipped comparison points.
    const systems = [
      infraSys("collapsed", { ore: 0 }, 100),
      infraSys("last-building", { ore: 1 }, 100),
      infraSys("working", { ore: 5, [HOUSING_TYPE]: 3 }, 100),
      { ...infraSys("rock", {}, 0), control: "unclaimed" as const },
    ];
    const summary = summarizeInfrastructure(systems, 20);
    expect(summary.collapsedCount).toBe(1);
    expect(summary.builtEnd).toBe(9);
  });

  it("reports 0 decayed, never a division by the start total, for a galaxy that began with nothing", () => {
    // A world-gen that shipped no buildings has no baseline to decay from. JSON renders both
    // Infinity and NaN as null, which prints as "not measured" rather than "measured, and broken".
    const summary = summarizeInfrastructure([infraSys("s1", { ore: 4 }, 100)], 0);
    expect(summary.decayedPct).toBe(0);
    expect(Number.isFinite(summary.decayedPct)).toBe(true);
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

describe("summarizePopulation — the settled denominator and the unrest reads", () => {
  const BRAKE_END = CROWDING.BRAKE_END;

  /** An unclaimed rock: no people, no housing, no opinion — and no business in any denominator. */
  function voidSys(id: string): TickSystem {
    const s = popSys(id, 0, 0, 0);
    return { ...s, control: "unclaimed" };
  }

  it("rates unrest over settled systems only, never over the void the galaxy is mostly made of", () => {
    // Folding the void in does not zero a reading — it halves it, which reads as a calmer galaxy.
    const systems = [
      popSys("angry", 100, 1000, 0.8),
      popSys("calm", 100, 1000, 0.2),
      voidSys("rock-a"),
      voidSys("rock-b"),
    ];
    const summary = summarizePopulation(systems, 200, 0.65, BRAKE_END);

    expect(summary.meanUnrest).toBeCloseTo(0.5, 9);
    expect(summary.maxUnrest).toBeCloseTo(0.8, 9);
    expect(summary.strikingCount).toBe(1);
    expect(summary.strikingShare).toBeCloseTo(0.5, 9);
    expect(summary.emptiedCount).toBe(0);
  });

  it("keeps the running unrest maximum, rather than the last or the smallest reading", () => {
    // The peak is deliberately neither first nor last: a scan that simply assigns, or that keeps
    // the minimum, lands on a different system in each direction.
    const systems = [
      popSys("mid", 100, 1000, 0.4),
      popSys("peak", 100, 1000, 0.9),
      popSys("quiet", 100, 1000, 0.1),
    ];
    const summary = summarizePopulation(systems, 300, 0.65, BRAKE_END);
    expect(summary.maxUnrest).toBeCloseTo(0.9, 9);
  });

  it("counts a system emptied at exactly one resident, and only counts downward", () => {
    // The ghost-town watch is inclusive at 1 — a single resident is a ghost town, not a population.
    const systems = [
      popSys("ghost", 0.5, 1000),
      popSys("last-resident", 1, 1000),
      popSys("alive", 100, 1000),
    ];
    const summary = summarizePopulation(systems, 101.5, 0.65, BRAKE_END);
    expect(summary.emptiedCount).toBe(2);
  });

  it("counts saturation only above the 98% mark, over more than one candidate", () => {
    // Two systems below the mark and one at it: a fixture with a single system on each side reads
    // the same count whichever way the comparison points.
    const systems = [
      popSys("at-mark", 980, 1000),
      popSys("near", 970, 1000),
      popSys("far", 500, 1000),
    ];
    const summary = summarizePopulation(systems, 2450, 0.65, BRAKE_END);
    expect(summary.saturatedCount).toBe(1);
  });

  it("counts a cap left at exactly the stranded epsilon as stranded", () => {
    // STRANDED_POP_CAP is the inclusive bound: a cap sitting exactly on it is no housing at all.
    const systems = [
      popSys("exactly-epsilon", 100, 1e-6),
      popSys("just-above", 100, 2e-6),
    ];
    const summary = summarizePopulation(systems, 200, 0.65, BRAKE_END);
    expect(summary.strandedCount).toBe(1);
    expect(summary.strandedPopulation).toBe(100);
  });

  it("reports 0 growth and 0 mean unrest, never NaN, for a galaxy that started empty", () => {
    // Both guards divide by a run-start quantity: a zero denominator has to print as "no growth",
    // because JSON renders Infinity and NaN alike as null, which reads as "not measured".
    const fromNothing = summarizePopulation([popSys("seed", 10, 100, 0.3)], 0, 0.65, BRAKE_END);
    expect(fromNothing.growthPct).toBe(0);

    const empty = summarizePopulation([], 0, 0.65, BRAKE_END);
    expect(empty.meanUnrest).toBe(0);
    expect(Number.isFinite(empty.meanUnrest)).toBe(true);
    expect(empty.growthPct).toBe(0);
  });

  it("measures growth against the run's own start total", () => {
    const systems = [popSys("a", 120, 1000), popSys("b", 60, 1000)];
    const summary = summarizePopulation(systems, 150, 0.65, BRAKE_END);
    expect(summary.totalEnd).toBe(180);
    expect(summary.growthPct).toBeCloseTo(20, 9);
  });
});

describe("summarizeSupplyRegimes", () => {
  const mkt = (systemId: string, goodId: string, satisfaction: number) => ({ systemId, goodId, satisfaction });
  /** An absolute-scale reference only, at the retired escalation cut's old magnitude — used below to
   *  pin "mild" against "near-total basket collapse" shortfalls. Not tied to any live mechanism
   *  boundary; unrest now reads grievance and the crisis backstops, not this quantity. */
  const LARGE_SHORTFALL_REFERENCE = 0.65;

  it("classifies settled systems and reports shares that sum to 1", () => {
    const systems = [popSys("fed", 100, 1000), popSys("thirsty", 100, 1000)];
    const summary = summarizeSupplyRegimes(systems, [
      mkt("fed", "water", 1), mkt("fed", "food", 1),
      mkt("thirsty", "water", 0), mkt("thirsty", "food", 1),
    ]);
    expect(summary.counted).toBe(2);
    expect(summary.supplied).toBe(1);
    expect(summary.famine).toBe(1);
    expect(
      summary.suppliedShare + summary.strainedShare + summary.rationingShare
        + summary.deprivedShare + summary.famineShare,
    ).toBeCloseTo(1, 10);
  });

  it("counts a Strained world as Strained, not silently folded into a harsher bucket", () => {
    // The defect this fold exists to close: a band that isn't given its own switch arm lands in a
    // catch-all and is counted as something worse. Provision 0.8 sits strictly between
    // RATIONING_PROVISION (0.70) and SUPPLIED_PROVISION (0.90), and no survival good is touched, so
    // this system must read Strained — and every other bucket must read zero.
    const systems = [popSys("strained", 100, 1000)];
    const summary = summarizeSupplyRegimes(systems, [mkt("strained", "water", 0.8)]);
    expect(summary.strained).toBe(1);
    expect(summary.supplied).toBe(0);
    expect(summary.rationing).toBe(0);
    expect(summary.deprived).toBe(0);
    expect(summary.famine).toBe(0);
  });

  it("buckets a system below the Rationing bin edge as rationing, not deprived, strained or famine", () => {
    // Provision-based banding means Rationing is the mid-shortfall band, not "any positive D" the way
    // the old D-scale cut read it: both demanded goods at 0.6 gives Provision exactly 0.6 (uniform
    // satisfaction, so the weights cancel out) — below RATIONING_PROVISION (0.70), above both
    // DEPRIVED_PROVISION (0.50) and the SHORTAGE_SATISFACTION survival floor, so this must read
    // Rationing and nothing else. Without this, a summarizer that mis-routed the rationing branch
    // would still pass the suite.
    const systems = [popSys("peckish", 100, 1000)];
    const summary = summarizeSupplyRegimes(systems, [
      mkt("peckish", "water", 0.6), mkt("peckish", "food", 0.6),
    ]);
    expect(summary.rationing).toBe(1);
    expect(summary.supplied).toBe(0);
    expect(summary.strained).toBe(0);
    expect(summary.deprived).toBe(0);
    expect(summary.famine).toBe(0);
    expect(summary.meanShortfall).toBeGreaterThan(0);
    expect(summary.meanShortfall).toBeLessThan(LARGE_SHORTFALL_REFERENCE);
  });

  it("counts a Deprived world into deprived, not folded up into rationing or down into famine", () => {
    // The new bottom band, and the counter a `switch` without its own arm silently zeroes. Every
    // demanded good at 0.3 puts Provision at exactly 0.3 (uniform satisfaction cancels the weights)
    // — below DEPRIVED_PROVISION (0.50) — while NO survival good is demanded at all, so the famine
    // punch-through cannot fire. The deliberate contrast with the Rationing fixture above: same
    // shape, one band lower, and it must not read as the same word.
    const nonSurvival = GOOD_NAMES.filter((g) => !SURVIVAL_GOODS.includes(g));
    const systems = [popSys("stripped", 100, 1000)];
    const summary = summarizeSupplyRegimes(systems, nonSurvival.map((g) => mkt("stripped", g, 0.3)));
    expect(summary.deprived).toBe(1);
    expect(summary.deprivedShare).toBeCloseTo(1, 10);
    expect(summary.supplied).toBe(0);
    expect(summary.strained).toBe(0);
    expect(summary.rationing).toBe(0);
    expect(summary.famine).toBe(0);
  });

  it("stops at deprived for a near-total basket collapse that never crosses the survival floor", () => {
    // foldSupplyState() has exactly one route to Famine — hasSurvivalShortfall — and no
    // Provision-level cut promotes the band on its own, however low Provision falls. This fixture is
    // the stress case for that: both survival goods sit exactly AT SHORTAGE_SATISFACTION (not below
    // it, so hasSurvivalShortfall stays false) while every other demanded good reads zero — a
    // near-total basket collapse. If a D/Provision cut ever again promoted the band directly, this is
    // the fixture that would first read Famine instead of the axis's own bottom band. Built from the
    // real tables (GOOD_NAMES, SURVIVAL_GOODS) so it re-verifies itself if any weight moves.
    const nonSurvival = GOOD_NAMES.filter((g) => !SURVIVAL_GOODS.includes(g));
    const systems = [popSys("squeezed", 100, 1000)];
    const summary = summarizeSupplyRegimes(systems, [
      ...SURVIVAL_GOODS.map((g) => mkt("squeezed", g, SHORTAGE_SATISFACTION)),
      ...nonSurvival.map((g) => mkt("squeezed", g, 0)),
    ]);
    expect(summary.deprived).toBe(1);
    expect(summary.famine).toBe(0);
    // The shortfall is large — a near-total basket collapse, well past LARGE_SHORTFALL_REFERENCE —
    // yet still reads a Provision band: band promotion had to be dropped explicitly (see the comment
    // above) rather than left to fall out of any Provision- or shortfall-level cut.
    expect(summary.meanShortfall).toBeGreaterThanOrEqual(LARGE_SHORTFALL_REFERENCE);
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
    expect(summary.meanShortfall).toBe(0);
    expect(summary.provisionLevels).toEqual({ median: 0, p10: 0, p90: 0 });
    expect(summary.worstGoodLevels).toEqual({ median: 0, p10: 0, p90: 0 });
  });

  it("excludes an unclaimed system from the Provision and worst-good distributions", () => {
    const claimed = popSys("claimed", 100, 1000);
    const unclaimed = { ...popSys("unclaimed", 100, 1000), control: "unclaimed" as const };
    const markets = [mkt("claimed", "water", 0.5), mkt("unclaimed", "water", 0)];

    const summary = summarizeSupplyRegimes([claimed, unclaimed], markets);

    expect(summary.counted).toBe(1);
    // Water is the only demanded good on "claimed", so both its Provision and its (only, hence
    // worst) good's satisfaction are exactly 0.5. If the unclaimed system's reading leaked into
    // either distribution, the median could not land on that exact value.
    expect(summary.provisionLevels.median).toBeCloseTo(0.5, 6);
    expect(summary.worstGoodLevels.median).toBeCloseTo(0.5, 6);
  });

  it("shows a bimodal population's p10 and p90 apart, not collapsed onto one mean", () => {
    // The spec measures 53.4% of settled systems at exactly D 0 against a short tail — this fixture
    // is the same shape at Provision's scale: half the galaxy fully served, half fully deprived.
    const fed = Array.from({ length: 5 }, (_, i) => popSys(`fed-${i}`, 100, 1000));
    const starved = Array.from({ length: 5 }, (_, i) => popSys(`starved-${i}`, 100, 1000));
    const systems = [...fed, ...starved];
    const markets = [
      ...fed.map((s) => mkt(s.id, "water", 1)),
      ...starved.map((s) => mkt(s.id, "water", 0)),
    ];

    const summary = summarizeSupplyRegimes(systems, markets);

    expect(summary.provisionLevels.p10).toBeCloseTo(0, 6);
    expect(summary.provisionLevels.p90).toBeCloseTo(1, 6);
    expect(summary.worstGoodLevels.p10).toBeCloseTo(0, 6);
    expect(summary.worstGoodLevels.p90).toBeCloseTo(1, 6);
  });

  it("collapses p10, median and p90 onto the same value when every world is identical", () => {
    const systems = [popSys("a", 100, 1000), popSys("b", 100, 1000), popSys("c", 100, 1000)];
    const markets = systems.map((s) => mkt(s.id, "water", 0.6));

    const summary = summarizeSupplyRegimes(systems, markets);

    expect(summary.provisionLevels.p10).toBeCloseTo(summary.provisionLevels.median, 10);
    expect(summary.provisionLevels.median).toBeCloseTo(summary.provisionLevels.p90, 10);
    expect(summary.provisionLevels.median).toBeCloseTo(0.6, 6);
  });
});

function sys(id: string, over: Partial<TickSystem> = {}): TickSystem {
  return {
    id, name: id, economyType: "agricultural", regionId: "r1", factionId: "f1",
    control: "developed", governmentType: "federation", population: 100, popCap: 200,
    unrest: 0, buildings: {}, buildingIdleCycles: {}, collapseDebt: 0,
    yields: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    slotCap: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    generalSpace: 100, habitableSpace: 50,
    ...over,
  };
}

describe("perSystemSupplyState", () => {
  it("returns one entry per settled system", () => {
    const systems = [sys("s1"), sys("s2")];
    const markets = [
      { systemId: "s1", goodId: "water", satisfaction: 1 },
      { systemId: "s2", goodId: "water", satisfaction: 0 },
    ];

    const states = perSystemSupplyState(systems, markets);

    expect(states.size).toBe(2);
    expect(states.get("s1")?.d).toBeLessThan(states.get("s2")?.d ?? 0);
  });

  it("agrees with the galaxy-wide summary it feeds", () => {
    const systems = [sys("s1"), sys("s2")];
    const markets = [
      { systemId: "s1", goodId: "water", satisfaction: 1 },
      { systemId: "s2", goodId: "water", satisfaction: 0 },
    ];

    const states = perSystemSupplyState(systems, markets);
    const summary = summarizeSupplyRegimes(systems, markets);

    const meanD = [...states.values()].reduce((a, s) => a + s.d, 0) / states.size;
    expect(meanD).toBeCloseTo(summary.meanShortfall, 10);
    expect(states.size).toBe(summary.counted);
  });

  it("counts a settled system with no market rows at Provision 1, not dropped", () => {
    const systems = [sys("s1")];

    const states = perSystemSupplyState(systems, []);

    expect(states.size).toBe(1);
    expect(states.get("s1")?.provision).toBe(1);
    expect(states.get("s1")?.worstGoods).toEqual([]);
  });

  it("carries the worst-demanded good's tiny demand share, not just its satisfaction", () => {
    // ship_frames' unskilled per-capita rate (0.0003) sits far below water/food/gas/ore's combined
    // baseline — a real epsilon-demand tail good, the shape the demand-share floor is chosen from.
    // If the harness wiring dropped or zeroed demandShare on the way into worstGoods, this would
    // still pass on satisfaction alone.
    const systems = [sys("s1")];
    const markets = [
      { systemId: "s1", goodId: "water", satisfaction: 1 },
      { systemId: "s1", goodId: "food", satisfaction: 1 },
      { systemId: "s1", goodId: "gas", satisfaction: 1 },
      { systemId: "s1", goodId: "ore", satisfaction: 1 },
      { systemId: "s1", goodId: "ship_frames", satisfaction: 0 },
    ];

    const [worst] = perSystemSupplyState(systems, markets).get("s1")?.worstGoods ?? [];

    expect(worst?.goodId).toBe("ship_frames");
    expect(worst?.satisfaction).toBe(0);
    expect(worst?.demandShare).toBeGreaterThan(0);
    expect(worst?.demandShare).toBeLessThan(0.05);
  });
});

describe("worstGoodSatisfaction", () => {
  const stateOf = (worstGoods: SystemSupplyState["worstGoods"]): SystemSupplyState => ({
    d: 0, regime: "rationing", provision: 1, worstGoods,
    expectationStored: 1, expectationEffective: 1, grievance: 0, emptyBasket: false,
  });

  it("reads 1 for an empty basket — counted as fully served, not dropped", () => {
    expect(worstGoodSatisfaction(stateOf([]))).toBe(1);
  });

  it("reads the first (worst) entry's satisfaction for a populated basket", () => {
    const worstGoods = [
      { goodId: "water", satisfaction: 0.3, demandShare: 0.4, necessity: 1 },
      { goodId: "food", satisfaction: 0.6, demandShare: 0.3, necessity: 1 },
    ];
    expect(worstGoodSatisfaction(stateOf(worstGoods))).toBe(0.3);
  });
});

describe("perSystemSupplyState — adaptive expectation", () => {
  it("reads grievance from the stored memory (G), never re-derived as the absolute shortfall (D)", () => {
    // Stored expectation sits at the read-side floor (0.5) while Provision (0.7) is well above it —
    // this population is doing BETTER than what it is accustomed to, so G = clamp(0.5 - 0.7, 0, 1)
    // = 0, even though the absolute shortfall D = 1 - 0.7 = 0.3 is very much nonzero. A harness that
    // re-derives grievance as 1 - Provision (D) instead of importing grievanceShortfall would read
    // 0.3 here instead of 0 — the two numbers are pinned apart, not just both present.
    const systems = [sys("a", { provisionExpectation: EXPECTATION_PARAMS.floor })];
    const markets = [{ systemId: "a", goodId: "water", satisfaction: 0.7 }];
    const state = perSystemSupplyState(systems, markets).get("a")!;
    expect(state.d).toBeCloseTo(0.3, 6);
    expect(state.grievance).toBeCloseTo(0, 9);
    expect(state.grievance).not.toBeCloseTo(state.d, 2);
  });

  it("resolves an absent stored value by seeding from this cycle's Provision — grievance 0 on a newborn read", () => {
    const systems = [sys("newborn")]; // no provisionExpectation at all
    const markets = [{ systemId: "newborn", goodId: "water", satisfaction: 0.6 }];
    const state = perSystemSupplyState(systems, markets).get("newborn")!;
    expect(state.expectationStored).toBeCloseTo(0.6, 6); // seeded to P
    expect(state.grievance).toBeCloseTo(0, 9);
  });
});

describe("summarizeSupplyRegimes — expectation & grievance distributions, and the stale flag", () => {
  it("flags an emptyBasket system as stale rather than folding its stored memory into the mean", () => {
    // "stale" carries no market rows at all -> an empty goods basket -> emptyBasket: true. Its
    // stored memory (0.9) must be EXCLUDED from expectationLevels, not blended into the mean with
    // "normal"'s 0.6 — the population processor itself skips the update on exactly this condition
    // (SupplyState.emptyBasket), so folding it in would read a frozen, possibly stale number as a
    // current one.
    const systems = [
      sys("stale", { provisionExpectation: 0.9 }),
      sys("normal", { provisionExpectation: 0.6 }),
    ];
    const markets = [{ systemId: "normal", goodId: "water", satisfaction: 0.6 }];
    const summary = summarizeSupplyRegimes(systems, markets);
    expect(summary.staleExpectationCount).toBe(1);
    // Only "normal" contributes — median must land exactly on its own stored value, not a blend.
    expect(summary.expectationLevels.median).toBeCloseTo(0.6, 6);
    expect(summary.expectationLevels.median).not.toBeCloseTo((0.9 + 0.6) / 2, 6);
  });

  it("reports 0/empty distributions, never NaN, when every system is stale", () => {
    const systems = [sys("stale", { provisionExpectation: 0.9 })];
    const summary = summarizeSupplyRegimes(systems, []); // no markets -> empty basket
    expect(summary.staleExpectationCount).toBe(1);
    expect(summary.expectationLevels).toEqual({ median: 0, p10: 0, p90: 0 });
    expect(summary.grievanceLevels).toEqual({ median: 0, p10: 0, p90: 0 });
  });
});

describe("episode costs: newEpisodeCostTotals / recordEpisodeCosts", () => {
  it("conserves — the running total equals the sum of every per-cycle map fed in", () => {
    const totals = newEpisodeCostTotals();
    recordEpisodeCosts(totals, new Map([["a", 2], ["b", 1]]), new Map([["a", 0.5]]));
    recordEpisodeCosts(totals, new Map([["a", 1]]), undefined); // overshoot absent this cycle
    recordEpisodeCosts(totals, undefined, new Map([["b", 3]])); // teardown absent this cycle

    expect(totals.teardownBySystem.get("a")).toBeCloseTo(2 + 1, 9);
    expect(totals.teardownBySystem.get("b")).toBeCloseTo(1, 9);
    expect(totals.overshootDeathBySystem.get("a")).toBeCloseTo(0.5, 9);
    expect(totals.overshootDeathBySystem.get("b")).toBeCloseTo(3, 9);

    // The conservation property itself: Σ of every per-cycle contribution equals the running total —
    // breaking the accumulator's addition (e.g. an overwrite instead of a `+=`) fails this.
    const teardownSum = [...totals.teardownBySystem.values()].reduce((a, b) => a + b, 0);
    const overshootSum = [...totals.overshootDeathBySystem.values()].reduce((a, b) => a + b, 0);
    expect(teardownSum).toBeCloseTo(2 + 1 + 1, 9);
    expect(overshootSum).toBeCloseTo(0.5 + 3, 9);
  });

  it("is a no-op when both maps are absent this cycle", () => {
    const totals = newEpisodeCostTotals();
    recordEpisodeCosts(totals, undefined, undefined);
    expect(totals.teardownBySystem.size).toBe(0);
    expect(totals.overshootDeathBySystem.size).toBe(0);
  });
});

describe("computeTrailingProvisionVariance", () => {
  it("separates jitter from level — equal means, distinguishably different variance", () => {
    const steady = [0.8, 0.8, 0.8, 0.8, 0.8, 0.8];
    const jittery = [0.6, 1.0, 0.6, 1.0, 0.6, 1.0]; // same mean as steady (0.8)
    const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(meanOf(steady)).toBeCloseTo(meanOf(jittery), 9); // premise: the means really do agree

    const snapshots = steady.map((s, i) => new Map([["steady", s], ["jittery", jittery[i]]]));
    const variances = computeTrailingProvisionVariance(snapshots);
    expect(variances.get("steady")).toBeCloseTo(0, 9);
    expect(variances.get("jittery")).toBeCloseTo(0.04, 9); // ((0.2)^2 * 6) / 6 = 0.04
    expect(variances.get("jittery")).toBeGreaterThan(variances.get("steady") ?? -1);
  });

  it("omits a system with fewer than the minimum trailing samples, rather than reporting 0", () => {
    const snapshots = [new Map([["a", 0.5]]), new Map([["a", 0.6]])]; // 2 samples — below the minimum
    const variances = computeTrailingProvisionVariance(snapshots);
    expect(variances.has("a")).toBe(false);
  });

  it("reads only the trailing window, not the whole history", () => {
    // A calm head followed by a jittery tail: reading the whole array would dilute the tail's
    // variance toward a smaller number than the window alone reports.
    const calm = Array.from({ length: 10 }, () => new Map([["a", 0.8]]));
    const jitter = [0.6, 1.0, 0.6, 1.0, 0.6, 1.0].map((v) => new Map([["a", v]]));
    const windowOnly = computeTrailingProvisionVariance(jitter, 6).get("a") ?? -1;
    const wholeHistory = computeTrailingProvisionVariance([...calm, ...jitter], 6).get("a") ?? -1;
    expect(wholeHistory).toBeCloseTo(windowOnly, 9);
  });
});

describe("sampleProvisionBySystem", () => {
  it("reads the same Provision perSystemSupplyState computes, for every settled system", () => {
    const systems = [sys("a"), sys("b")];
    const markets = [
      { systemId: "a", goodId: "water", satisfaction: 0.4 },
      { systemId: "b", goodId: "water", satisfaction: 0.9 },
    ];
    const sampled = sampleProvisionBySystem(systems, markets);
    const states = perSystemSupplyState(systems, markets);
    expect(sampled.get("a")).toBeCloseTo(states.get("a")!.provision, 9);
    expect(sampled.get("b")).toBeCloseTo(states.get("b")!.provision, 9);
  });
});

describe("the consumption-modifier absence premise", () => {
  it("no shipped event definition carries a consumption_rate modifier — when this fails, re-sweep population-analysis", () => {
    // The consumption-modifier plumbing here (rows → aggregateModifiers → consumptionMult) is
    // inert today because nothing produces the parameter, and a batch of mutation-sweep survivors
    // in it were accepted on exactly that premise. This test is the tripwire: the first event
    // definition to ship a consumption_rate rate_multiplier makes those mutants live, and the
    // acceptance must be re-earned with a scoped `npm run mutation` over
    // lib/tick-harness/population-analysis.ts — not inherited.
    const params = Object.values(EVENT_DEFINITIONS)
      .flatMap((d) => d.phases)
      .flatMap((p) => p.modifiers)
      .map((m) => m.parameter);
    expect(params.length).toBeGreaterThan(0); // premise guard: the census itself saw modifiers
    expect(params).not.toContain("consumption_rate");
  });
});
