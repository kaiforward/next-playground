import { describe, it, expect } from "vitest";
import { sampleTreasuries, summarizeTreasuries } from "../treasury-analysis";
import type { WorldFactionTreasury } from "@/lib/world/types";

function makeTreasury(overrides: Partial<WorldFactionTreasury>): WorldFactionTreasury {
  return {
    factionId: "f1", balance: 10, taxLevel: "normal",
    bands: { maintenance: 1, logistics: 1, construction: 1 },
    funded: { maintenance: 1, logistics: 1, construction: 1 },
    pendingWork: { logistics: 0, construction: 0 },
    lastSettlement: {
      tick: 24, headsIncome: 6, productionIncome: 4, incomeBySystem: [],
      maintenanceBill: 2, maintenanceByType: [], logisticsBill: 1, constructionBill: 1,
      paid: { maintenance: 2, logistics: 1, construction: 1 },
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
      },
    });
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
