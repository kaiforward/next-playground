import { describe, it, expect } from "vitest";
import {
  sampleTreasuries, summarizeTreasuries, recordSettledCycles, summarizeFoundingEra,
  FOUNDING_ERA_START_TICK,
} from "../treasury-analysis";
import type { FactionCycleRecord } from "../treasury-analysis";
import type { WorldFactionTreasury } from "@/lib/world/types";

function makeTreasury(overrides: Partial<WorldFactionTreasury>): WorldFactionTreasury {
  return {
    factionId: "f1", balance: 10, taxLevel: "normal",
    bands: { maintenance: 1, logistics: 1, construction: 1 },
    funded: { maintenance: 1, logistics: 1, construction: 1 },
    pendingWork: { logistics: 0, construction: 0 },
    pendingFounding: 0,
    lastSettlement: {
      tick: 24, headsIncome: 6, productionIncome: 4, incomeBySystem: [],
      maintenanceBill: 2, maintenanceByType: [], logisticsBill: 1, constructionBill: 1,
      paid: { maintenance: 2, logistics: 1, construction: 1 },
      foundingExpense: 0,
    },
    updatedAtTick: 24,
    ...overrides,
  };
}

describe("treasury analysis", () => {
  it("computes balances, income shares, and flags shorted factions", () => {
    const solvent = makeTreasury({ factionId: "f1", balance: 20 });
    const shorted = makeTreasury({
      factionId: "f2", balance: 0,
      funded: { maintenance: 1, logistics: 0.5, construction: 0 },
    });
    const snap = sampleTreasuries(24, [solvent, shorted]);
    expect(snap.meanBalance).toBeCloseTo(10);
    expect(snap.minBalance).toBe(0);
    expect(snap.shortedFactions).toBe(1);

    const summary = summarizeTreasuries([solvent, shorted], [snap]);
    expect(summary.factionCount).toBe(2);
    expect(summary.meanBalance).toBeCloseTo(10);
    expect(summary.minBalance).toBe(0);
    expect(summary.maxBalance).toBe(20);
    expect(summary.headsShare).toBeCloseTo(0.6); // 12 of 20 total income
    expect(summary.productionShare).toBeCloseTo(0.4);
    // Mean of solvent {1,1,1} and shorted {1,0.5,0}.
    expect(summary.fundedMeans.maintenance).toBeCloseTo(1);
    expect(summary.fundedMeans.logistics).toBeCloseTo(0.75);
    expect(summary.fundedMeans.construction).toBeCloseTo(0.5);
    expect(summary.firstShortfallTick).toBe(24);
    expect(summary.invalidRows).toBe(0);
  });

  it("counts non-finite or negative balances as invalid rows", () => {
    const bad = makeTreasury({ factionId: "f3", balance: NaN });
    expect(summarizeTreasuries([bad], []).invalidRows).toBe(1);
  });

  it("counts non-finite settlement money values as invalid rows", () => {
    const bad = makeTreasury({
      factionId: "f4",
      lastSettlement: {
        tick: 24, headsIncome: NaN, productionIncome: 4, incomeBySystem: [],
        maintenanceBill: 2, maintenanceByType: [], logisticsBill: 1, constructionBill: 1,
        paid: { maintenance: 2, logistics: 1, construction: 1 },
        foundingExpense: 0,
      },
    });
    expect(summarizeTreasuries([bad], []).invalidRows).toBe(1);
  });

  it("counts a non-finite founding expense as an invalid row", () => {
    const bad = makeTreasury({
      factionId: "f6",
      lastSettlement: {
        tick: 24, headsIncome: 6, productionIncome: 4, incomeBySystem: [],
        maintenanceBill: 2, maintenanceByType: [], logisticsBill: 1, constructionBill: 1,
        paid: { maintenance: 2, logistics: 1, construction: 1 },
        foundingExpense: NaN,
      },
    });
    expect(summarizeTreasuries([bad], []).invalidRows).toBe(1);
  });

  it("counts a negative pending-founding accumulator as an invalid row", () => {
    const bad = makeTreasury({ factionId: "f7", pendingFounding: -5 });
    expect(summarizeTreasuries([bad], []).invalidRows).toBe(1);
  });

  it("reports an empty roster as zeroes, not NaN", () => {
    const snap = sampleTreasuries(0, []);
    expect(snap).toEqual({ tick: 0, meanBalance: 0, minBalance: 0, shortedFactions: 0 });
    const summary = summarizeTreasuries([], []);
    expect(summary.meanBalance).toBe(0);
    expect(summary.maxBalance).toBe(0);
    expect(summary.headsShare).toBe(0);
    expect(summary.fundedMeans).toEqual({ maintenance: 0, logistics: 0, construction: 0 });
    expect(summary.firstShortfallTick).toBeNull();
    // No NaN → null corruption under JSON (the "silently reads as not-measured" trap).
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it("records each settlement exactly once, however many ticks it stays the latest", () => {
    const seen = new Map<string, number>();
    const out: FactionCycleRecord[] = [];
    const t = makeTreasury({ factionId: "f1" });

    recordSettledCycles([t], seen, out);
    recordSettledCycles([t], seen, out);      // same settlement, later tick of the same cycle
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ tick: 24, income: 10, foundingExpense: 0, shorted: false });

    const next = makeTreasury({
      factionId: "f1",
      funded: { maintenance: 1, logistics: 1, construction: 0.4 },
      lastSettlement: {
        tick: 48, headsIncome: 8, productionIncome: 2, incomeBySystem: [],
        maintenanceBill: 2, maintenanceByType: [], logisticsBill: 1, constructionBill: 1,
        paid: { maintenance: 2, logistics: 1, construction: 1 },
        foundingExpense: 60,
      },
    });
    recordSettledCycles([next], seen, out);
    expect(out).toHaveLength(2);
    // The funded fractions are read off the settlement that latched them, so a shortfall belongs
    // to the cycle that caused it rather than to whichever cycle happened to be last.
    expect(out[1]).toMatchObject({ tick: 48, foundingExpense: 60, shorted: true, fundedConstruction: 0.4 });
  });

  it("skips a faction that has never settled", () => {
    const out: FactionCycleRecord[] = [];
    recordSettledCycles([makeTreasury({ lastSettlement: null })], new Map(), out);
    expect(out).toEqual([]);
  });
});

describe("summarizeFoundingEra", () => {
  const cycle = (
    tick: number,
    { income = 100, foundingExpense = 0, shorted = false, maintenance = 1, construction = 1 } = {},
  ): FactionCycleRecord => ({
    tick, income, foundingExpense, shorted,
    fundedMaintenance: maintenance, fundedConstruction: construction,
  });

  it("shares founding spend against the income of the SAME faction-cycles", () => {
    // Both halves come off one set of rows. A cumulative spend divided by an income accumulated
    // over a different window is the way this reading goes quietly wrong.
    const summary = summarizeFoundingEra([
      cycle(100, { income: 1000, foundingExpense: 500 }), // startup tail — excluded from the share
      cycle(500, { income: 200, foundingExpense: 40 }),
      cycle(500, { income: 300, foundingExpense: 10 }),
    ]);

    expect(summary.startupTailEndTick).toBe(FOUNDING_ERA_START_TICK);
    expect(summary.factionCycles).toBe(2);
    expect(summary.income).toBe(500);
    expect(summary.foundingSpend).toBe(50);
    expect(summary.spendShare).toBeCloseTo(0.1, 9);
    // The tail's spend is still reported, so nothing hides outside the window the share uses.
    expect(summary.totalFoundingSpend).toBe(550);
  });

  it("closes the era on the last founding charge, so a long run cannot dilute the share", () => {
    // The equilibrium horizon is nine thousand ticks of post-founding income. Left unbounded, the
    // same galaxy's share falls simply because the run was longer, and the two horizons could not
    // be read against each other at all.
    const summary = summarizeFoundingEra([
      cycle(500, { income: 100, foundingExpense: 25 }),
      cycle(600, { income: 100, foundingExpense: 25 }),
      cycle(9000, { income: 100_000 }),  // long after the burst — not the era's income
    ]);

    expect(summary.eraEndTick).toBe(600);
    expect(summary.factionCycles).toBe(2);
    expect(summary.income).toBe(200);
    expect(summary.spendShare).toBeCloseTo(0.25, 9);
    // The post-era cycle's spend would still be reported if it had any.
    expect(summary.totalFoundingSpend).toBe(50);
  });

  it("runs the era to the end of the run when nothing was ever charged for a founding", () => {
    const summary = summarizeFoundingEra([cycle(500, { income: 100 }), cycle(9000, { income: 100 })]);
    expect(summary.eraEndTick).toBeNull();
    expect(summary.factionCycles).toBe(2);
    expect(summary.spendShare).toBe(0);
  });

  it("splits shorted faction-cycles by whether the cycle carried a founding charge", () => {
    // The whole point of the split: a charter-caused shortfall must be distinguishable from the
    // ambient rate, and from a startup tail that shorts before any founding has happened at all.
    const summary = summarizeFoundingEra([
      cycle(100, { shorted: true }),                        // tail
      cycle(200, { shorted: true }),                        // tail
      cycle(500, { foundingExpense: 30, shorted: true }),
      cycle(600, { shorted: true }),
      cycle(700),
      cycle(800),
      cycle(900),
      cycle(1000, { foundingExpense: 30 }),  // the era's last founding charge
    ]);

    expect(summary.withFounding).toEqual({ cycles: 2, shorted: 1, share: 0.5 });
    expect(summary.withoutFounding).toEqual({ cycles: 4, shorted: 1, share: 0.25 });
    expect(summary.startupTail).toEqual({ cycles: 2, shorted: 2, share: 1 });
  });

  it("reads funded fractions as a distribution over founding-era cycles, not a roster mean", () => {
    const summary = summarizeFoundingEra([
      cycle(100, { maintenance: 0.1, construction: 0.1 }), // tail — must not set the era's minima
      cycle(500, { maintenance: 1, construction: 1 }),
      cycle(600, { maintenance: 1, construction: 0.7 }),
      cycle(700, { maintenance: 0.6, construction: 0.9 }),
    ]);

    expect(summary.fundedMaintenance).not.toBeNull();
    expect(summary.fundedMaintenance?.median).toBeCloseTo(1, 9);
    expect(summary.fundedMaintenance?.min).toBeCloseTo(0.6, 9);
    expect(summary.minFundedConstruction).toBeCloseTo(0.7, 9);
  });

  it("excludes a non-finite or negative row from every figure, and counts it", () => {
    const summary = summarizeFoundingEra([
      cycle(500, { income: 100, foundingExpense: 10 }),
      cycle(600, { income: Number.NaN, foundingExpense: 10 }),
      cycle(700, { income: 100, foundingExpense: -5 }),
    ]);

    expect(summary.invalidRows).toBe(2);
    expect(summary.factionCycles).toBe(1);
    expect(summary.income).toBe(100);
    expect(summary.foundingSpend).toBe(10);
    expect(summary.spendShare).toBeCloseTo(0.1, 9);
  });

  it("reports a run with no founding-era cycles as nulls and zeroes, never NaN", () => {
    const summary = summarizeFoundingEra([]);
    expect(summary.spendShare).toBe(0);
    expect(summary.withFounding).toEqual({ cycles: 0, shorted: 0, share: 0 });
    // A median of nothing must not print as a starved 0.00 — that is a measurement, not an absence.
    expect(summary.fundedMaintenance).toBeNull();
    expect(summary.minFundedConstruction).toBeNull();
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});

describe("treasury analysis — roster reads", () => {
  it("treats a fresh (never-settled) roster as healthy, not shorted", () => {
    const fresh = makeTreasury({ factionId: "f5", lastSettlement: null });
    const snap = sampleTreasuries(0, [fresh]);
    expect(snap.shortedFactions).toBe(0);
    const summary = summarizeTreasuries([fresh], [snap]);
    expect(summary.headsShare).toBe(0);
    expect(summary.invalidRows).toBe(0);
    expect(summary.firstShortfallTick).toBeNull();
  });
});
