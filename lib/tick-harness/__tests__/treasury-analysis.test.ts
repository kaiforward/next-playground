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
    expect(summary.headsShare).toBeCloseTo(0.6); // 12 of 20 total income
    expect(summary.productionShare).toBeCloseTo(0.4);
    expect(summary.firstShortfallTick).toBe(24);
    expect(summary.invalidRows).toBe(0);
  });

  it("counts non-finite or negative balances as invalid rows", () => {
    const bad = makeTreasury({ factionId: "f3", balance: NaN });
    expect(summarizeTreasuries([bad], []).invalidRows).toBe(1);
  });
});
