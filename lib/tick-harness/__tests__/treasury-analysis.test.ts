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
    // The construction bill rides along: without it a latched 0 cannot be told from a slider at 0.
    expect(out[1].constructionBill).toBe(1);
  });

  it("carries the faction, what it paid and the balance it closed at onto each record", () => {
    // The conservation identities walk each faction's settlements as a chain — one cycle's closing
    // balance is the next one's opening. Without these three the chain cannot be reassembled, and
    // an unattributed row silently joins another faction's chain.
    const out: FactionCycleRecord[] = [];
    recordSettledCycles([makeTreasury({ factionId: "f9", balance: 37 })], new Map(), out);
    expect(out[0].factionId).toBe("f9");
    expect(out[0].balance).toBe(37);
    expect(out[0].paidTotal).toBe(4); // 2 maintenance + 1 logistics + 1 construction
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
    {
      income = 100, foundingExpense = 0, shorted = false, maintenance = 1, construction = 1,
      constructionBill = 1, factionId = "f1", paidTotal = 0, balance = 0,
    } = {},
  ): FactionCycleRecord => ({
    tick, factionId, income, foundingExpense, shorted,
    fundedMaintenance: maintenance, fundedConstruction: construction, constructionBill,
    paidTotal, balance,
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
    const summary = summarizeFoundingEra([cycle(500, { income: 100 }), cycle(9000, { income: 300 })]);
    expect(summary.eraEndTick).toBeNull();
    expect(summary.factionCycles).toBe(2);
    expect(summary.spendShare).toBe(0);
    // An era that never closed is an OPEN window, not an empty one: the income still has to be
    // measured, or a run that founded nothing reads as a run that earned nothing.
    expect(summary.income).toBe(400);
    // …and with no era end there is no "after the era" either.
    expect(summary.postEra).toEqual({ cycles: 0, shorted: 0, share: 0 });
  });

  it("puts a faction-cycle landing exactly on a window boundary on the right side of it", () => {
    // Ticks are real settlement ticks and the windows are half-open at both ends, so a row sitting
    // exactly on a boundary is the common case rather than an edge: the tail's last tick, the era's
    // first, and the fixed window's last are all boundaries a report is read across.
    const summary = summarizeFoundingEra([
      cycle(FOUNDING_ERA_START_TICK, { income: 70, foundingExpense: 7 }),       // the tail's last tick
      cycle(FOUNDING_ERA_START_TICK + 1, { income: 100, foundingExpense: 10 }), // the era's first
      cycle(1000, { income: 100, foundingExpense: 10 }),                        // the fixed window's last
      cycle(1001, { income: 100, foundingExpense: 10 }),                        // one tick past it
    ]);

    expect(summary.startupTail.cycles).toBe(1); // the boundary tick belongs to the tail…
    expect(summary.factionCycles).toBe(3);      // …and not to the era
    expect(summary.income).toBe(300);
    expect(summary.fixedWindow.factionCycles).toBe(2); // 401 and 1000; not 400, not 1001
    expect(summary.fixedWindow.income).toBe(200);
    expect(summary.fixedWindow.foundingSpend).toBe(20);
  });

  it("closes the era on the LATEST founding charge, whatever order the rows arrive in", () => {
    // Records are folded per settled faction-cycle across the whole roster, so they arrive grouped
    // by faction, not sorted by tick. Keeping a running maximum is what makes the era's end the
    // era's end rather than whichever charge the fold happened to see last.
    const summary = summarizeFoundingEra([
      cycle(900, { income: 100, foundingExpense: 10 }),
      cycle(500, { income: 100, foundingExpense: 10 }),
      cycle(600, { income: 100 }),
    ]);
    expect(summary.eraEndTick).toBe(900);
    expect(summary.factionCycles).toBe(3);
    // The run's last settled cycle is 900 too, so the era stopped because the run did.
    expect(summary.eraCensored).toBe(true);
  });

  it("closes the era on a founding charged in the very first settled cycle", () => {
    // Tick 0 is a real settlement tick, and 0 is not "no era end" — a comparison that leaned on a
    // null reading as zero would lose the whole era of a galaxy that founded on its first cycle.
    const summary = summarizeFoundingEra([cycle(0, { income: 100, foundingExpense: 10 })]);
    expect(summary.eraEndTick).toBe(0);
    expect(summary.eraCensored).toBe(true);
  });

  it("measures the fixed window over the same ticks whatever the arm's own era did", () => {
    // Two arms of one seed: the treatment founds a single straggler far later. Their endogenous
    // eras are different windows, so their endogenous shares are not comparable — the fixed window
    // is the same ticks for both, which is what makes an A/B claim mean anything.
    const shared = [
      cycle(500, { income: 100, foundingExpense: 20 }),
      cycle(900, { income: 100, foundingExpense: 20 }),
      cycle(2000, { income: 900 }),
    ];
    const baseline = summarizeFoundingEra(shared);
    const treatment = summarizeFoundingEra([...shared, cycle(2000, { income: 900, foundingExpense: 4 })]);

    expect(baseline.eraEndTick).toBe(900);
    expect(treatment.eraEndTick).toBe(2000);
    expect(baseline.spendShare).not.toBeCloseTo(treatment.spendShare, 3); // the trap this avoids
    // Same window, same denominator, comparable numbers.
    expect(baseline.fixedWindow).toMatchObject({ startTick: 401, endTick: 1000, factionCycles: 2 });
    expect(treatment.fixedWindow.factionCycles).toBe(2);
    expect(baseline.fixedWindow.spendShare).toBeCloseTo(0.2, 9);
    expect(treatment.fixedWindow.spendShare).toBeCloseTo(0.2, 9);
  });

  it("flags an era still open at run end as censored, not bounded", () => {
    // The startup horizon reads this way whenever founding is still going at t=1000: the window
    // stopped because the run did, so its share is "spend so far", not a closed era's figure.
    const censored = summarizeFoundingEra([
      cycle(500, { foundingExpense: 10 }),
      cycle(984, { foundingExpense: 10 }),
    ]);
    expect(censored.eraCensored).toBe(true);

    const closed = summarizeFoundingEra([
      cycle(500, { foundingExpense: 10 }),
      cycle(984, { foundingExpense: 10 }),
      cycle(9984),
    ]);
    expect(closed.eraCensored).toBe(false);
  });

  it("reports post-era faction-cycles in their own slice, in no bar", () => {
    // They are in `totalFoundingSpend`'s span but in none of the shorted slices. Unreported, a
    // post-era shortfall would simply be missing from a report whose counts otherwise add up.
    const summary = summarizeFoundingEra([
      cycle(100, { shorted: true }),
      cycle(500, { foundingExpense: 10 }),
      cycle(2000, { shorted: true }),
      cycle(3000),
    ]);

    expect(summary.postEra).toEqual({ cycles: 2, shorted: 1, share: 0.5 });
    // The slice is the rows AFTER the era, and reading it off the wrong side of the boundary would
    // report the tail's shortfalls as post-era ones — same count, opposite meaning.
    expect(
      summarizeFoundingEra([
        cycle(100),
        cycle(500, { foundingExpense: 10 }),
        cycle(2000, { shorted: true }),
        cycle(3000, { shorted: true }),
      ]).postEra,
    ).toEqual({ cycles: 2, shorted: 2, share: 1 });
    expect(summary.withFounding.cycles + summary.withoutFounding.cycles).toBe(summary.factionCycles);
    // Tail + era + post-era account for every valid row.
    expect(
      summary.startupTail.cycles + summary.factionCycles + summary.postEra.cycles,
    ).toBe(4);
  });

  it("takes the construction minimum over BILLED cycles, so a slider at 0 is not starvation", () => {
    // `settleLadder` latches the SLIDER when a band is billed nothing. A faction with nothing to
    // build therefore reads 0.000 while being perfectly funded, and would fail the ≥0.5 bar for it.
    const summary = summarizeFoundingEra([
      cycle(500, { construction: 0, constructionBill: 0 }),  // nothing to build — not starvation
      cycle(600, { construction: 0.8, constructionBill: 5 }),
      cycle(700, { construction: 1, constructionBill: 5 }),
      cycle(800, { foundingExpense: 1, construction: 1, constructionBill: 5 }),
    ]);

    expect(summary.fundedConstruction?.min).toBeCloseTo(0.8, 9);
    expect(summary.billedConstructionCycles).toBe(3);
  });

  it("reads construction as a distribution over exactly the BILLED cycles the minimum came from", () => {
    // A minimum of 0 is either one outlier cycle or a routine drain, and the two want opposite
    // responses. The median and p10 are what tell them apart — and they must be taken over the
    // same billed set, or the distribution describes a different population from its own floor.
    const summary = summarizeFoundingEra([
      cycle(450, { construction: 0, constructionBill: 0 }),   // unbilled — in no construction figure
      cycle(500, { construction: 0, constructionBill: 5 }),   // the outlier
      cycle(600, { construction: 1, constructionBill: 5 }),
      cycle(700, { construction: 1, constructionBill: 5 }),
      cycle(800, { construction: 1, constructionBill: 5 }),
      cycle(900, { construction: 1, constructionBill: 5 }),
    ]);

    expect(summary.billedConstructionCycles).toBe(5);
    expect(summary.fundedConstruction?.min).toBeCloseTo(0, 9);
    // Four of five billed cycles paid in full: the floor is an outlier, not the norm.
    expect(summary.fundedConstruction?.median).toBeCloseTo(1, 9);
    expect(summary.fundedConstruction?.p10).toBeCloseTo(0, 9);
  });

  it("separates a routine construction drain from a single starved cycle", () => {
    // The same minimum, a completely different reading — this is the pair the distribution exists
    // to distinguish, and a min-only report gives them the identical answer.
    const routine = summarizeFoundingEra([
      cycle(500, { construction: 0.2, constructionBill: 5 }),
      cycle(600, { construction: 0.2, constructionBill: 5 }),
      cycle(700, { construction: 0.2, constructionBill: 5 }),
    ]);
    const outlier = summarizeFoundingEra([
      cycle(500, { construction: 0.2, constructionBill: 5 }),
      cycle(600, { construction: 1, constructionBill: 5 }),
      cycle(700, { construction: 1, constructionBill: 5 }),
    ]);

    expect(routine.fundedConstruction?.min).toBeCloseTo(outlier.fundedConstruction?.min ?? -1, 9);
    expect(routine.fundedConstruction?.median).toBeCloseTo(0.2, 9);
    expect(outlier.fundedConstruction?.median).toBeCloseTo(1, 9);
  });

  it("reports no billed construction cycle as null, not as a starved zero", () => {
    const summary = summarizeFoundingEra([cycle(500, { construction: 0, constructionBill: 0 })]);
    expect(summary.fundedConstruction).toBeNull();
    expect(summary.billedConstructionCycles).toBe(0);
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
    expect(summary.fundedConstruction?.min).toBeCloseTo(0.7, 9);
  });

  it("keeps the era's WORST funded cycle, not whichever one it read last", () => {
    // The bar is a minimum over the era, and the worst cycle is not usually the last one. A running
    // minimum that latched every row would report the run's final cycle and pass a bar the galaxy's
    // actual trough failed.
    const summary = summarizeFoundingEra([
      cycle(500, { maintenance: 1, construction: 1, constructionBill: 5 }),
      cycle(600, { maintenance: 0.6, construction: 0.7, constructionBill: 5 }),
      cycle(700, { maintenance: 1, construction: 1, constructionBill: 5 }),
    ]);
    expect(summary.fundedMaintenance?.min).toBeCloseTo(0.6, 9);
    expect(summary.fundedConstruction?.min).toBeCloseTo(0.7, 9);
    expect(summary.billedConstructionCycles).toBe(3);
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
    // No era at all is not a censored one — an era that never began cannot have been cut short.
    expect(summary.eraEndTick).toBeNull();
    expect(summary.eraCensored).toBe(false);
    expect(summary.withFounding).toEqual({ cycles: 0, shorted: 0, share: 0 });
    // A median of nothing must not print as a starved 0.00 — that is a measurement, not an absence.
    expect(summary.fundedMaintenance).toBeNull();
    expect(summary.fundedConstruction).toBeNull();
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
