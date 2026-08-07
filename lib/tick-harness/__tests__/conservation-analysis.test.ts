import { describe, it, expect } from "vitest";
import {
  newCharterCensus, recordCharterCensus, checkCharterDebits, checkFoundingWithinBalance,
  newStagedLedgerCensus, recordStagedLedger, checkStagedLedger, checkNetReconciliation,
  summarizeConservation, CONSERVATION_TOLERANCE,
} from "../conservation-analysis";
import type { CharterProjectRow, StagedProjectRow } from "../conservation-analysis";
import type { FactionCycleRecord } from "../treasury-analysis";
import type { FoundingStagingTotals } from "../build-analysis";

/** One colony-establish row as the open queue carries it, for the charter census. */
const establish = (id: string, charterPaid: boolean): CharterProjectRow =>
  ({ kind: "colony_establish", id, charterPaid });

/** One colony-establish row carrying its in-transit ledger. */
const staged = (systemId: string, quantities: number[]): StagedProjectRow => ({
  kind: "colony_establish",
  systemId,
  stagedManifest: quantities.map((quantity, i) => ({ goodId: `g${i}`, quantity })),
});

const totals = (tonnage: number): FoundingStagingTotals => ({ tonnage, moneyCost: 0 });

/** One settled faction-cycle. Defaults balance the books exactly, so a test breaks one thing. */
const cycle = (
  factionId: string,
  tick: number,
  { income = 100, paidTotal = 60, foundingExpense = 0, balance = 40 } = {},
): FactionCycleRecord => ({
  tick, factionId, income, foundingExpense, shorted: false,
  fundedMaintenance: 1, fundedConstruction: 1, constructionBill: 1,
  paidTotal, balance,
});

describe("charter census", () => {
  it("counts one debit per colony that reaches charterPaid", () => {
    const census = newCharterCensus();
    // Minted and chartered in the same processor pass — the unpaid state is never visible, which is
    // why the census is taken every tick off whatever the queue holds.
    recordCharterCensus([establish("p1", true), establish("p2", false)], census);
    recordCharterCensus([establish("p1", true), establish("p2", true)], census);
    recordCharterCensus([establish("p2", true)], census);      // p1 completed and left the queue

    const check = checkCharterDebits(census);
    expect(check.left).toBe(2);
    expect(check.right).toBe(2);
    expect(check.residual).toBe(0);
    expect(check.pass).toBe(true);
  });

  it("does not count a project LEAVING the queue as a reverted charter", () => {
    // A completed establish simply stops being scanned. Reading its absence as a revert would fail
    // the identity on every successful founding.
    const census = newCharterCensus();
    recordCharterCensus([establish("p1", true)], census);
    recordCharterCensus([], census);
    recordCharterCensus([], census);

    expect(census.reverted).toBe(0);
    expect(checkCharterDebits(census).pass).toBe(true);
  });

  it("FAILS when a colony is charged a second time", () => {
    // The failure the identity exists for: a paid colony dropped back to unpaid is re-chartered
    // next cycle, and the faction pays twice for one colony.
    const census = newCharterCensus();
    recordCharterCensus([establish("p1", true)], census);
    recordCharterCensus([establish("p1", false)], census);
    recordCharterCensus([establish("p1", true)], census);

    const check = checkCharterDebits(census);
    expect(census.reverted).toBe(1);
    expect(check.left).toBe(2);                 // two debits
    expect(check.right).toBe(1);                // one colony
    expect(check.residual).toBe(1);
    expect(check.pass).toBe(false);
    expect(check.note).toContain("reverted");
  });

  it("ignores ordinary build projects", () => {
    const census = newCharterCensus();
    recordCharterCensus([{ kind: "build" }, { kind: "build" }], census);
    expect(checkCharterDebits(census)).toMatchObject({ left: 0, right: 0, pass: true });
  });
});

describe("founding committed vs opening balance", () => {
  it("passes when every cycle's founding fits inside the balance it opened with", () => {
    const check = checkFoundingWithinBalance(
      [
        cycle("f1", 24, { foundingExpense: 200, balance: 500 }),
        cycle("f1", 48, { foundingExpense: 400, balance: 300 }),   // against the 500 above
      ],
      new Map([["f1", 1000]]),
    );
    expect(check.pass).toBe(true);
    expect(check.residual).toBeLessThanOrEqual(0);
  });

  it("FAILS when a cycle commits more founding than the balance it opened with", () => {
    const check = checkFoundingWithinBalance(
      [
        cycle("f1", 24, { foundingExpense: 0, balance: 100 }),
        cycle("f1", 48, { foundingExpense: 250, balance: 0 }),     // 250 committed against 100
      ],
      new Map([["f1", 1000]]),
    );
    expect(check.pass).toBe(false);
    expect(check.left).toBeCloseTo(250, 9);
    expect(check.right).toBeCloseTo(100, 9);
    expect(check.residual).toBeCloseTo(150, 9);
  });

  it("chains each faction's own settlements, never another's", () => {
    // Pooled, f2's 900 balance would cover f1's 250 commitment and the overrun would vanish.
    const check = checkFoundingWithinBalance(
      [
        cycle("f1", 24, { balance: 100 }),
        cycle("f2", 24, { balance: 900 }),
        cycle("f1", 48, { foundingExpense: 250, balance: 0 }),
      ],
      new Map([["f1", 100], ["f2", 900]]),
    );
    expect(check.pass).toBe(false);
    expect(check.right).toBeCloseTo(100, 9);
  });

  it("does not depend on the order the records were appended in", () => {
    // The chain's meaning is its tick order; records arrive in whatever order the roster was walked.
    const records = [
      cycle("f1", 48, { foundingExpense: 250, balance: 0 }),
      cycle("f1", 24, { foundingExpense: 0, balance: 100 }),
    ];
    const shuffled = checkFoundingWithinBalance(records, new Map([["f1", 1000]]));
    const ordered = checkFoundingWithinBalance([...records].reverse(), new Map([["f1", 1000]]));
    expect(shuffled).toEqual(ordered);
    expect(shuffled.pass).toBe(false);
  });

  it("opens the chain on the run's starting balance, not on zero", () => {
    // A faction's very first settlement committed against the balance world-gen gave it. Opening at
    // zero would fail every run's first founding cycle.
    const check = checkFoundingWithinBalance(
      [cycle("f1", 24, { foundingExpense: 300, balance: 700 })],
      new Map([["f1", 1000]]),
    );
    expect(check.pass).toBe(true);
  });

  it("reports the tightest COMMITTING cycle, not an empty settlement at zero", () => {
    // A faction's first settlement commits nothing against a balance of nothing, and `0 - 0` is the
    // largest residual in a healthy run. Reporting it prints "0 vs 0" and says nothing about how
    // close founding ever came to the balance behind it.
    const check = checkFoundingWithinBalance(
      [
        cycle("f1", 24, { foundingExpense: 0, balance: 0 }),        // nothing earned, nothing spent
        cycle("f1", 48, { foundingExpense: 0, balance: 500 }),
        cycle("f1", 72, { foundingExpense: 480, balance: 20 }),     // 480 against 500 — the tightest
      ],
      new Map([["f1", 0]]),
    );
    expect(check.pass).toBe(true);
    expect(check.left).toBeCloseTo(480, 9);
    expect(check.right).toBeCloseTo(500, 9);
    expect(check.note).toContain("1 founding-committing cycles");
  });

  it("FAILS a non-finite row instead of comparing NaN and passing", () => {
    const check = checkFoundingWithinBalance(
      [cycle("f1", 24, { foundingExpense: Number.NaN, balance: 100 })],
      new Map([["f1", 1000]]),
    );
    expect(check.pass).toBe(false);
    expect(check.note).toContain("non-finite");
  });
});

describe("staged goods vs founder draws", () => {
  /** One tick's sample, folded into a fresh census. */
  const sample = (
    projects: StagedProjectRow[], staging: ReadonlyMap<string, FoundingStagingTotals>,
  ) => {
    const census = newStagedLedgerCensus();
    recordStagedLedger(projects, staging, census);
    return checkStagedLedger(census);
  };

  it("passes when every open colony's ledger matches what its draws took", () => {
    const check = sample(
      [staged("c1", [40, 60]), staged("c2", [25]), { kind: "build" }],
      new Map([["c1", totals(100)], ["c2", totals(25)]]),
    );
    expect(check.left).toBeCloseTo(125, 9);
    expect(check.right).toBeCloseTo(125, 9);
    expect(check.pass).toBe(true);
  });

  it("FAILS when a draw left a founder but never landed in the colony's ledger", () => {
    const check = sample([staged("c1", [40])], new Map([["c1", totals(100)]]));
    expect(check.pass).toBe(false);
    expect(check.residual).toBeCloseTo(-60, 9);
  });

  it("excludes a founded colony, whose ledger is consumed on arrival", () => {
    // 'c2' has developed and is no longer in the queue; the accumulator still holds its draws.
    // Counting it would report every successful founding as lost goods.
    const check = sample(
      [staged("c1", [100])],
      new Map([["c1", totals(100)], ["c2", totals(400)]]),
    );
    expect(check.pass).toBe(true);
    expect(check.right).toBeCloseTo(100, 9);
  });

  it("passes a run where nothing was ever staged", () => {
    expect(sample([], new Map())).toMatchObject({ left: 0, right: 0, pass: true });
  });

  it("tolerates float dust from summing the same lines in a different order", () => {
    const check = sample([staged("c1", [0.1, 0.2])], new Map([["c1", totals(0.3)]]));
    expect(check.residual).not.toBe(0);      // 0.1 + 0.2 !== 0.3
    expect(check.pass).toBe(true);
  });

  it("keeps the sample with the most open colonies when every tick held", () => {
    // The run END is the one moment this check has nothing to look at — every establish has
    // completed and the queue is empty. Keeping the emptiest sample would pass vacuously.
    const census = newStagedLedgerCensus();
    const staging = new Map([["c1", totals(100)], ["c2", totals(50)]]);
    recordStagedLedger([staged("c1", [100])], staging, census);
    recordStagedLedger([staged("c1", [100]), staged("c2", [50])], staging, census);
    recordStagedLedger([], staging, census);      // every colony has landed

    const check = checkStagedLedger(census);
    expect(check.pass).toBe(true);
    expect(check.left).toBeCloseTo(150, 9);       // the two-colony tick, not the empty one
    expect(census.maxProjects).toBe(2);
    expect(census.samples).toBe(3);
  });

  it("keeps a violating sample even when a later, larger tick held", () => {
    // A failure must never be displaced by more evidence that the books balanced afterwards.
    const census = newStagedLedgerCensus();
    recordStagedLedger([staged("c1", [40])], new Map([["c1", totals(100)]]), census);
    recordStagedLedger(
      [staged("c2", [10]), staged("c3", [10]), staged("c4", [10])],
      new Map([["c2", totals(10)], ["c3", totals(10)], ["c4", totals(10)]]),
      census,
    );

    const check = checkStagedLedger(census);
    expect(check.pass).toBe(false);
    expect(check.residual).toBeCloseTo(-60, 9);
    expect(census.violations).toBe(1);
  });

  it("catches a tick that lost goods in the middle of the burst, not just at the end", () => {
    const census = newStagedLedgerCensus();
    recordStagedLedger([staged("c1", [50])], new Map([["c1", totals(50)]]), census);
    recordStagedLedger([staged("c1", [50])], new Map([["c1", totals(90)]]), census); // a draw vanished
    recordStagedLedger([], new Map([["c1", totals(90)]]), census);                   // c1 has landed

    expect(checkStagedLedger(census).pass).toBe(false);
  });
});

describe("balance delta vs net", () => {
  it("passes when each settlement's balance moved by exactly its own itemisation", () => {
    const check = checkNetReconciliation(
      [
        cycle("f1", 24, { income: 100, paidTotal: 60, foundingExpense: 10, balance: 1030 }),
        cycle("f1", 48, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1070 }),
      ],
      new Map([["f1", 1000]]),
    );
    expect(check.pass).toBe(true);
    expect(check.left).toBeCloseTo(70, 9);
    expect(check.right).toBeCloseTo(70, 9);
  });

  it("FAILS when a balance does not match what the settlement says it spent", () => {
    // The shape a founding commitment larger than the balance takes: the settlement floors the
    // subtraction at zero rather than going into debt, and the balance stops matching `net`.
    const check = checkNetReconciliation(
      [cycle("f1", 24, { income: 100, paidTotal: 60, foundingExpense: 500, balance: 0 })],
      new Map([["f1", 100]]),
    );
    expect(check.pass).toBe(false);
    expect(check.residual).toBeCloseTo(360, 9);   // delta -100 vs net -460
  });

  it("decides on the WORST cycle, not on totals that telescope", () => {
    // Summed deltas collapse to (final − starting), so an equal-and-opposite pair of errors cancels
    // exactly. A totals-only test passes a run whose every cycle is wrong.
    const check = checkNetReconciliation(
      [
        cycle("f1", 24, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1100 }), // +100, net +40
        cycle("f1", 48, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1080 }), // −20,  net +40
      ],
      new Map([["f1", 1000]]),
    );
    expect(check.left).toBeCloseTo(check.right, 9);   // totals agree
    expect(check.pass).toBe(false);                   // the cycles do not
  });

  it("does not depend on the order the records were appended in", () => {
    const records = [
      cycle("f1", 48, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1080 }),
      cycle("f1", 24, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1040 }),
    ];
    const shuffled = checkNetReconciliation(records, new Map([["f1", 1000]]));
    const ordered = checkNetReconciliation([...records].reverse(), new Map([["f1", 1000]]));
    expect(shuffled).toEqual(ordered);
    expect(shuffled.pass).toBe(true);
  });

  it("tolerates float accumulation in proportion to the quantities it came from", () => {
    const check = checkNetReconciliation(
      [cycle("f1", 24, { income: 1e6, paidTotal: 0, foundingExpense: 0, balance: 1e6 + 1e-4 })],
      new Map([["f1", 0]]),
    );
    expect(check.residual).not.toBe(0);
    expect(check.pass).toBe(true);
    // An absolute epsilon would have judged the same residual a failure.
    expect(Math.abs(check.residual)).toBeGreaterThan(CONSERVATION_TOLERANCE);
  });
});

describe("summarizeConservation", () => {
  const emptyInputs = {
    charters: newCharterCensus(),
    factionCycles: [],
    startingBalances: new Map<string, number>(),
    stagedLedger: newStagedLedgerCensus(),
  };

  it("reports all four identities, in the order the spec lists them", () => {
    const summary = summarizeConservation(emptyInputs);
    expect(summary.checks).toHaveLength(4);
    expect(summary.checks.map((c) => c.name)).toEqual([
      "charter debits == chartered colonies",
      "founding committed <= opening balance",
      "staged goods == drawn from founders",
      "balance delta == net (income - paid - founding)",
    ]);
    expect(summary.tolerance).toBe(CONSERVATION_TOLERANCE);
    expect(summary.allPass).toBe(true);
  });

  it("fails the whole summary when any single identity fails", () => {
    const charters = newCharterCensus();
    recordCharterCensus([establish("p1", true)], charters);
    recordCharterCensus([establish("p1", false)], charters);
    recordCharterCensus([establish("p1", true)], charters);

    const summary = summarizeConservation({ ...emptyInputs, charters });
    expect(summary.allPass).toBe(false);
    expect(summary.checks.filter((c) => !c.pass)).toHaveLength(1);
  });

  it("stays JSON-serializable — no Set, no NaN, no Infinity", () => {
    // The results document is saved as JSON for arm-to-arm comparison; a Set or an Infinity
    // becomes {} or null on the way out and reads as an absent identity.
    const summary = summarizeConservation(emptyInputs);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});
