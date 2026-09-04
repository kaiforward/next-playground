import { describe, it, expect } from "vitest";
import {
  newCharterCensus, recordCharterCensus, checkCharterDebits, checkFoundingWithinBalance,
  newStagedLedgerCensus, recordStagedLedger, checkStagedLedger, checkNetReconciliation,
  summariseConservation, CONSERVATION_TOLERANCE, withinTolerance, conservationGateFailure,
  newDispatchDrainCensus, checkDispatchDrain,
} from "../conservation-analysis";
import type {
  CharterProjectRow, StagedProjectRow, IdentityCheck, ConservationSummary,
} from "../conservation-analysis";
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

describe("withinTolerance", () => {
  it("judges a residual against the larger of the two sides it came from, inclusively", () => {
    // The bound is inclusive: a residual sitting exactly on the tolerance is inside it. Magnitude
    // is floored at 1, so this is the smallest-scale case the check ever sees.
    expect(withinTolerance(1, 0, CONSERVATION_TOLERANCE)).toBe(true);
    expect(withinTolerance(1, 0, CONSERVATION_TOLERANCE * 1.0001)).toBe(false);
  });

  it("refuses a non-finite residual rather than letting an infinite scale swallow it", () => {
    // With an infinite side the tolerance itself goes infinite, and `Infinity <= Infinity` passes —
    // a corrupt row would clear the identity instead of failing it. The finiteness gate comes first
    // for exactly that reason.
    expect(withinTolerance(Infinity, 0, Infinity)).toBe(false);
    expect(withinTolerance(1, 0, Number.NaN)).toBe(false);
  });
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

  it("ignores lane_upgrade projects — a third arm the `kind` narrow still excludes correctly", () => {
    const census = newCharterCensus();
    recordCharterCensus(
      [{ kind: "lane_upgrade" }, establish("p1", true)],
      census,
    );
    const check = checkCharterDebits(census);
    expect(check).toMatchObject({ left: 1, right: 1, pass: true });
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

  it("adds a corrupt row's fault to the real overruns, never against them", () => {
    // Both faults raise the same counter. Counting either one downward lets a corrupt row CANCEL a
    // genuine overrun and the identity reports a clean pass on a run that had two problems.
    const check = checkFoundingWithinBalance(
      [
        cycle("f1", 24, { foundingExpense: Number.NaN, balance: 100 }),
        cycle("f2", 24, { foundingExpense: 0, balance: 100 }),
        cycle("f2", 48, { foundingExpense: 250, balance: 0 }),   // 250 committed against 100
      ],
      new Map([["f1", 1000], ["f2", 1000]]),
    );
    expect(check.pass).toBe(false);
    expect(check.note).toContain("2 over their opening balance");
    expect(check.note).toContain("⚠ 1 non-finite rows");
  });

  it("counts the settled and the committing cycles it actually walked", () => {
    // Both counts are the note's denominators — the reader's only check that the identity looked
    // at the run it claims to have looked at.
    const check = checkFoundingWithinBalance(
      [
        cycle("f1", 24, { foundingExpense: 0, balance: 500 }),
        cycle("f1", 48, { foundingExpense: 100, balance: 400 }),
        cycle("f1", 72, { foundingExpense: 200, balance: 200 }),
      ],
      new Map([["f1", 0]]),
    );
    expect(check.pass).toBe(true);
    expect(check.note).toContain("tightest of 2 founding-committing cycles (of 3 settled)");
    // No corrupt rows this run, so the warning must be absent entirely rather than reading "0".
    expect(check.note).not.toContain("non-finite");
  });

  it("keeps the tightest committing cycle, not the last one it saw", () => {
    // "Tightest" is the largest residual across the run — the cycle whose founding came closest to
    // the balance behind it. Taking whichever committing cycle came last reports a windfall-funded
    // founding as the closest the run ever came.
    const check = checkFoundingWithinBalance(
      [
        cycle("f1", 24, { foundingExpense: 990, balance: 10 }),    // 990 against 1000 — the tightest
        cycle("f1", 48, { foundingExpense: 0, balance: 5000 }),    // a windfall; commits nothing
        cycle("f1", 72, { foundingExpense: 100, balance: 4900 }),  // 100 against 5000 — comfortable
      ],
      new Map([["f1", 1000]]),
    );
    expect(check.pass).toBe(true);
    expect(check.left).toBeCloseTo(990, 9);
    expect(check.right).toBeCloseTo(1000, 9);
  });

  it("does not report a charter revert that never happened", () => {
    // The ⚠ is an annunciator: printed unconditionally it reads "0 charters reverted" on every
    // healthy run and stops meaning anything.
    const census = newCharterCensus();
    recordCharterCensus([establish("p1", true)], census);
    expect(checkCharterDebits(census).note).not.toContain("reverted");
  });
});

describe("staged goods vs founder draws", () => {
  /** One tick's sample, folded into a fresh census. */
  const sample = (
    projects: StagedProjectRow[], staging: Map<string, FoundingStagingTotals>,
  ) => {
    const census = newStagedLedgerCensus();
    recordStagedLedger(projects, staging, census);
    return checkStagedLedger(census);
  };

  it("passes when every open colony's ledger matches what its draws took", () => {
    const check = sample(
      [staged("c1", [40, 60]), staged("c2", [25]), { kind: "build" }, { kind: "lane_upgrade" }],
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

  it("does not charge a re-founded system with the dead colony's draws", () => {
    // Abandonment resets a dead colony to unclaimed frontier, so the same system can be founded
    // again — and the draws are keyed by system, the only key available while the target is still
    // unclaimed. Tick 1: the first founding stages 12 and completes. Tick 2: nothing open. Tick 3: a
    // second establish on the SAME system stages 71 of its own. Without the prune, tick 3 compares
    // 71 against 83 and reports the dead colony's spend as goods missing from its successor.
    const staging = new Map<string, FoundingStagingTotals>();
    const census = newStagedLedgerCensus();

    staging.set("c1", totals(12));
    recordStagedLedger([staged("c1", [12])], staging, census);

    recordStagedLedger([], staging, census);            // the colony opened; the queue is empty
    expect(staging.has("c1")).toBe(false);              // its total went with it

    staging.set("c1", totals(71));                     // the successor's own draws
    recordStagedLedger([staged("c1", [71])], staging, census);

    const check = checkStagedLedger(census);
    expect(check.pass).toBe(true);
    expect(check.right).toBeCloseTo(71, 9);             // 71, not 83
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
    // Each colony's draws are seeded on the tick its establish is open, never before: a draw exists
    // only if its project does, and the runner reads both from the same tick.
    const staging = new Map([["c1", totals(100)]]);
    recordStagedLedger([staged("c1", [100])], staging, census);
    staging.set("c2", totals(50));
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

  it("keeps the worst of two violating ticks, whichever order they arrive in", () => {
    // Between two failures the bigger loss is the one worth reporting — and it has to win from
    // either side, or the census is reporting arrival order rather than severity.
    const worstFirst = newStagedLedgerCensus();
    recordStagedLedger([staged("c1", [40])], new Map([["c1", totals(100)]]), worstFirst); // −60
    recordStagedLedger([staged("c2", [40])], new Map([["c2", totals(50)]]), worstFirst);  // −10

    const worstLast = newStagedLedgerCensus();
    recordStagedLedger([staged("c2", [40])], new Map([["c2", totals(50)]]), worstLast);   // −10
    recordStagedLedger([staged("c1", [40])], new Map([["c1", totals(100)]]), worstLast);  // −60

    expect(checkStagedLedger(worstFirst).residual).toBeCloseTo(-60, 9);
    expect(checkStagedLedger(worstLast).residual).toBeCloseTo(-60, 9);
    expect(worstFirst.violations).toBe(2);
  });

  it("does not swap one violating tick for another of the same size", () => {
    // Equal magnitude is not more evidence. A census that displaced on a tie would report whichever
    // sign happened to land last, and the residual's direction is what says goods vanished rather
    // than appeared.
    const census = newStagedLedgerCensus();
    recordStagedLedger([staged("c1", [40])], new Map([["c1", totals(100)]]), census);  // −60
    recordStagedLedger([staged("c2", [100])], new Map([["c2", totals(40)]]), census);  // +60

    expect(checkStagedLedger(census).residual).toBeCloseTo(-60, 9);
  });

  it("prefers the later of two equally large passing ticks", () => {
    // Among samples that held, the tie-break keeps the most recent equally-big one — so the report
    // shows the state the run ended in rather than the first tick that ever matched it.
    const census = newStagedLedgerCensus();
    recordStagedLedger([staged("c1", [50])], new Map([["c1", totals(50)]]), census);
    recordStagedLedger([staged("c2", [90])], new Map([["c2", totals(90)]]), census);

    const check = checkStagedLedger(census);
    expect(check.pass).toBe(true);
    expect(check.left).toBeCloseTo(90, 9);
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

  it("quarantines a corrupt row instead of folding NaN into the run totals", () => {
    // A non-finite row poisons every number it touches: the running totals go NaN, and the next
    // cycle's delta is measured against a NaN balance. Both sides of the identity then print as
    // null through JSON — "not measured", from a run that WAS measured and was broken.
    const check = checkNetReconciliation(
      [
        cycle("f1", 24, { income: Number.NaN, paidTotal: 60, foundingExpense: 0, balance: 1040 }),
        cycle("f1", 48, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1080 }),
      ],
      new Map([["f1", 1000]]),
    );
    expect(check.pass).toBe(false);
    expect(Number.isFinite(check.left)).toBe(true);
    expect(Number.isFinite(check.right)).toBe(true);
    expect(Number.isFinite(check.residual)).toBe(true);
    expect(check.note).toContain("⚠ 1 non-finite rows");
  });

  it("adds a corrupt row's fault to the mismatched cycles, never against them", () => {
    // Same cancellation hazard as the founding chain: one counter serves both faults, so counting
    // either downward turns two problems into a clean pass.
    const check = checkNetReconciliation(
      [
        cycle("f1", 24, { income: Number.NaN, paidTotal: 60, foundingExpense: 0, balance: 1040 }),
        cycle("f2", 24, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1100 }), // +100 vs net +40
      ],
      new Map([["f1", 1000], ["f2", 1000]]),
    );
    expect(check.pass).toBe(false);
    // Two faults — one corrupt row and one cycle whose balance did not match its itemisation —
    // over the one cycle that was walkable at all.
    expect(check.note).toContain("2 of 1 faction-cycles out");
    expect(check.note).toContain("⚠ 1 non-finite rows");
  });

  it("reports the worst single cycle's residual, and no warning when every row was finite", () => {
    // The note's worst-cycle figure is the size of the problem; the totals beside it telescope.
    // A run with nothing corrupt must not print the ⚠ at all, or the marker stops meaning anything.
    const check = checkNetReconciliation(
      [
        cycle("f1", 24, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1045 }), // +45 vs +40
        cycle("f1", 48, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1245 }), // +200 vs +40
        cycle("f1", 72, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1285 }), // +40 vs +40
      ],
      new Map([["f1", 1000]]),
    );
    expect(check.pass).toBe(false);
    expect(check.note).toContain("2 of 3 faction-cycles out");
    expect(check.note).toContain((160).toExponential(2));
    expect(check.note).not.toContain("non-finite");
  });

  it("does not swap the worst cycle for a later one of the same size but the opposite sign", () => {
    // The residual's SIGN is what the figure says: a balance that ran ahead of its itemisation is
    // a different fault from one that fell behind. Equal magnitude is not new evidence, so the
    // first of the two has to stand.
    const check = checkNetReconciliation(
      [
        cycle("f1", 24, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1160 }), // +120
        cycle("f1", 48, { income: 100, paidTotal: 60, foundingExpense: 0, balance: 1080 }), // −120
      ],
      new Map([["f1", 1000]]),
    );
    expect(check.pass).toBe(false);
    expect(check.note).toContain(` ${(120).toExponential(2)}`);
  });
});

describe("checkDispatchDrain", () => {
  it("passes when dispatched equals credited plus in-flight", () => {
    const census = newDispatchDrainCensus();
    census.dispatchedTotal = 100;
    census.appliedCreditTotal = 70;
    census.finalInFlight = 30;
    const check = checkDispatchDrain(census);
    expect(check.pass).toBe(true);
    expect(check.residual).toBe(0);
  });

  it("passes on a silent zero-flow run — never NaN", () => {
    const check = checkDispatchDrain(newDispatchDrainCensus());
    expect(check.pass).toBe(true);
    expect(Number.isFinite(check.residual)).toBe(true);
  });

  it("fails when the adapter double-credits a row the drain never removed", () => {
    // Red-proof: a broken `settleArrivals` that fails to remove a settled row lets the SAME
    // credit apply twice with no matching second dispatch — exactly the residual this identity
    // exists to catch.
    const census = newDispatchDrainCensus();
    census.dispatchedTotal = 100;
    census.appliedCreditTotal = 170; // 100 credited once, plus a duplicate 70-unit re-credit
    census.finalInFlight = 0;
    const check = checkDispatchDrain(census);
    expect(check.pass).toBe(false);
    expect(check.residual).toBe(-70);
  });
});

describe("summariseConservation", () => {
  const emptyInputs = {
    charters: newCharterCensus(),
    factionCycles: [],
    startingBalances: new Map<string, number>(),
    stagedLedger: newStagedLedgerCensus(),
    dispatchDrain: newDispatchDrainCensus(),
  };

  it("reports all five identities, in the order the spec lists them", () => {
    const summary = summariseConservation(emptyInputs);
    expect(summary.checks).toHaveLength(5);
    expect(summary.checks.map((c) => c.name)).toEqual([
      "charter debits == chartered colonies",
      "founding committed <= opening balance",
      "staged goods == drawn from founders",
      "balance delta == net (income - paid - founding)",
      "Σ dispatch debits = Σ arrival credits + in-flight + returned",
    ]);
    expect(summary.tolerance).toBe(CONSERVATION_TOLERANCE);
    expect(summary.allPass).toBe(true);
  });

  it("fails the whole summary when any single identity fails", () => {
    const charters = newCharterCensus();
    recordCharterCensus([establish("p1", true)], charters);
    recordCharterCensus([establish("p1", false)], charters);
    recordCharterCensus([establish("p1", true)], charters);

    const summary = summariseConservation({ ...emptyInputs, charters });
    expect(summary.allPass).toBe(false);
    expect(summary.checks.filter((c) => !c.pass)).toHaveLength(1);
  });

  it("stays JSON-serialisable — no Set, no NaN, no Infinity", () => {
    // The results document is saved as JSON for arm-to-arm comparison; a Set or an Infinity
    // becomes {} or null on the way out and reads as an absent identity.
    const summary = summariseConservation(emptyInputs);
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });
});

describe("conservationGateFailure", () => {
  /** A summary carrying exactly the checks a case needs, without building the run behind them. */
  const summaryOf = (...checks: IdentityCheck[]): ConservationSummary => ({
    tolerance: CONSERVATION_TOLERANCE,
    checks,
    allPass: checks.every((c) => c.pass),
  });

  const check = (name: string, pass: boolean): IdentityCheck => ({
    name, left: 5, right: 4, residual: pass ? 0 : 1, pass, note: `note for ${name}`,
  });

  it("returns null when every identity in every run held", () => {
    expect(
      conservationGateFailure([
        { label: "startup", summary: summaryOf(check("a", true), check("b", true)) },
        { label: "equilibrium", summary: summaryOf(check("a", true), check("b", true)) },
      ]),
    ).toBeNull();
  });

  it("returns null for a run that checked nothing — there is no failure to report", () => {
    expect(conservationGateFailure([])).toBeNull();
  });

  it("names every failure across every horizon, not only the first", () => {
    // One broken ledger usually breaks more than one identity, and which ones is the diagnosis.
    // Stopping at the first would hand back the least informative half of the evidence.
    const failure = conservationGateFailure([
      { label: "startup", summary: summaryOf(check("charters", false), check("net", true)) },
      { label: "equilibrium", summary: summaryOf(check("charters", false), check("net", false)) },
    ]);
    expect(failure).not.toBeNull();
    expect(failure).toContain("3 of 4 identities");
    expect(failure).toContain("[startup] charters");
    expect(failure).toContain("[equilibrium] charters");
    expect(failure).toContain("[equilibrium] net");
    // The passing check must not appear — a gate that listed it would read as four failures.
    expect(failure).not.toContain("[startup] net");
  });

  it("carries each failure's residual and note, so the message is diagnosable on its own", () => {
    const failure = conservationGateFailure([
      { label: "equilibrium", summary: summaryOf(check("charters", false)) },
    ]);
    expect(failure).toContain("1.00e+0");
    expect(failure).toContain("note for charters");
  });

  it("shows a NaN residual as NaN rather than swallowing it", () => {
    // A corrupt row is exactly what the identities exist to catch, so its residual has to reach the
    // message intact — a formatter that rounded or zeroed it would report the failure without the
    // one detail that says the arithmetic itself broke.
    const nan: IdentityCheck = {
      name: "net", left: 5, right: 0, residual: Number.NaN, pass: false, note: "corrupt",
    };
    expect(conservationGateFailure([{ label: "startup", summary: summaryOf(nan) }])).toContain("NaN");
  });
});
