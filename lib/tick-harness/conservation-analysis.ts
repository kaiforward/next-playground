/**
 * Conservation and accounting identities for the calibration harness — the pass/fail half of the
 * colonisation acceptance bar, as opposed to the calibration bars every other analysis module reports.
 *
 * A calibration bar is read and judged; an identity either holds or the bookkeeping is broken. These
 * four are checked over what the run actually recorded, so a founding path that charges a colony
 * twice, commits more than a faction holds, loses staged goods between the founder and the colony's
 * ledger, or writes a balance its own itemisation does not explain, fails the gate rather than
 * shifting a number nobody can attribute.
 *
 * Both sides of every identity come off independent recordings wherever the data allows it. Where it
 * does not, the check says so in its own note rather than closing the gap with a derived quantity,
 * which would make the identity true by construction.
 */
import type { WorldConstructionProject } from "@/lib/world/types";
import type { FoundingStagingTotals } from "./build-analysis";
import type { FactionCycleRecord } from "./treasury-analysis";

type BuildProject = Extract<WorldConstructionProject, { kind: "build" }>;
type ColonyEstablish = Extract<WorldConstructionProject, { kind: "colony_establish" }>;
type LaneUpgrade = Extract<WorldConstructionProject, { kind: "lane_upgrade" }>;

/** The queue fields the charter census reads. A union of the three arms rather than one `Pick`, so
 *  `kind` still narrows to the arm that carries `charterPaid`. */
export type CharterProjectRow =
  | Pick<BuildProject, "kind">
  | Pick<ColonyEstablish, "kind" | "id" | "charterPaid">
  | Pick<LaneUpgrade, "kind">;

/** The queue fields the staged-goods identity reads, narrowed the same way. */
export type StagedProjectRow =
  | Pick<BuildProject, "kind">
  | Pick<ColonyEstablish, "kind" | "systemId" | "stagedManifest">
  | Pick<LaneUpgrade, "kind">;

/**
 * Relative tolerance for float accumulation, matching the 1e-9 the rest of the harness compares
 * money at (`isShorted`, the staging plan's funds-short test). Applied against the larger side, so a
 * residual is judged in proportion to the quantities it came out of rather than as an absolute
 * number that a ten-thousand-tick run outgrows.
 */
export const CONSERVATION_TOLERANCE = 1e-9;

/** Does `residual` fall inside the relative tolerance for the two sides it came from? */
export function withinTolerance(left: number, right: number, residual: number): boolean {
  if (!Number.isFinite(residual)) return false;
  const magnitude = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(residual) <= CONSERVATION_TOLERANCE * magnitude;
}

/** One checked identity: the two sides, what is left over, and whether that clears the tolerance. */
export interface IdentityCheck {
  /** The identity as the spec words it, short enough to align in the report. */
  name: string;
  left: number;
  right: number;
  /** left − right. Signed, so a failure says which way the books are out. */
  residual: number;
  pass: boolean;
  /** What the two sides are, plus anything the check knows that the numbers alone do not — the worst
   *  offending row, the denominator, or the quantity the run does not record. */
  note: string;
}

// ── 1. Charters: one debit per chartered colony ──────────────────────────────

/**
 * Running census of charter payments, taken off the open construction queue.
 *
 * Two sets, deliberately: `paidNow` is the live reading and is cleared for a project whose charter
 * reads unpaid again, while `everPaid` never forgets. A colony charged a second time therefore
 * increments `debits` while leaving `everPaid` where it was, which is the only way the two sides can
 * disagree — and the exact failure the identity exists to catch.
 *
 * Not JSON-serialisable and never returned in the results: this is a runner-side collector, folded
 * into plain numbers by `checkCharterDebits`.
 */
export interface CharterCensus {
  /** Project ids whose charter currently reads paid. */
  paidNow: Set<string>;
  /** Project ids whose charter has EVER read paid — the colonies that reached `charterPaid`. */
  everPaid: Set<string>;
  /** Charter payments observed, counting a re-payment after a revert as a second debit. */
  debits: number;
  /** Charters that read paid and then unpaid again. Must be 0 — a paid colony is a standing
   *  commitment the queue never drops. */
  reverted: number;
}

export function newCharterCensus(): CharterCensus {
  return { paidNow: new Set(), everPaid: new Set(), debits: 0, reverted: 0 };
}

/**
 * Fold one tick's open queue into the census. Called every tick rather than every construction
 * cycle: a charter is paid in the same processor pass that mints its project, so the unpaid state is
 * frequently never visible at all, and only a per-tick read can bound how long a revert could hide.
 */
export function recordCharterCensus(
  projects: ReadonlyArray<CharterProjectRow>,
  census: CharterCensus,
): void {
  for (const p of projects) {
    if (p.kind !== "colony_establish") continue;
    if (p.charterPaid) {
      if (census.paidNow.has(p.id)) continue;
      census.paidNow.add(p.id);
      census.everPaid.add(p.id);
      census.debits++;
      continue;
    }
    // A project that LEAVES the queue simply stops being scanned; only one still in it, reading
    // unpaid after having read paid, is a revert.
    if (census.paidNow.delete(p.id)) census.reverted++;
  }
}

/**
 * Σ charter debits over a run == the number of colonies that ever reached `charterPaid`.
 *
 * Counted in charters, not money: the per-charter fee is not recorded anywhere the harness can read
 * (the processor merges charter fees and staged materials into one `foundingDebitsByFaction` figure
 * that never reaches `TickInstrumentation`), so the money form of this identity has no second side to
 * check against. The count form is the conservation the identity protects — no colony pays twice, and
 * nothing is charged for a colony that never chartered.
 */
export function checkCharterDebits(census: CharterCensus): IdentityCheck {
  const left = census.debits;
  const right = census.everPaid.size;
  const residual = left - right;
  return {
    name: "charter debits == chartered colonies",
    left,
    right,
    residual,
    pass: residual === 0,
    note:
      `${left} debits observed over ${right} colonies that reached charterPaid` +
      (census.reverted > 0 ? ` | ⚠ ${census.reverted} charters reverted to unpaid` : "") +
      " (counted in charters — the per-charter fee is not recorded)",
  };
}

// ── 2. A cycle's founding commitments never exceed the balance it opened with ──

/** Faction-cycles in tick order, per faction — every check below walks them as a chain. */
function byFaction(
  records: ReadonlyArray<FactionCycleRecord>,
): Map<string, FactionCycleRecord[]> {
  const out = new Map<string, FactionCycleRecord[]>();
  for (const r of records) {
    const list = out.get(r.factionId);
    if (list) list.push(r);
    else out.set(r.factionId, [r]);
  }
  // Sorted rather than trusted: the chain's meaning depends on the order, and a check whose answer
  // moves with the order records happened to be appended in is not an identity.
  for (const list of out.values()) list.sort((a, b) => a.tick - b.tick);
  return out;
}

/** Every money value the two settlement-chain checks read, so a NaN fails loudly instead of
 *  propagating into a residual that compares as false and reads as a real fault. */
function chainMoneyFinite(r: FactionCycleRecord): boolean {
  return [r.income, r.foundingExpense, r.paidTotal, r.balance].every((v) => Number.isFinite(v));
}

/**
 * Σ charters committed by one faction in one cycle ≤ that faction's opening balance.
 *
 * Read at the settlement, where the whole cycle's commitments land as one `foundingExpense` — a
 * stronger bar than the spec's, because that figure carries staged materials as well as charters and
 * both are committed against the same working balance. The opening balance is the previous
 * settlement's closing balance (nothing but a settlement writes `balance`), and the run's starting
 * balances open the chain.
 *
 * The two sides are the TIGHTEST cycle that actually committed founding — the run's least headroom,
 * and the only row a failure is actionable from. A cycle that committed nothing cannot exceed a
 * balance that is never negative, so leaving those out costs the check nothing and stops the report
 * from printing "0 vs 0" for a faction's first, empty settlement.
 */
export function checkFoundingWithinBalance(
  records: ReadonlyArray<FactionCycleRecord>,
  startingBalances: ReadonlyMap<string, number>,
): IdentityCheck {
  let violations = 0;
  let worstExpense = 0;
  let worstOpening = 0;
  let worstResidual = -Infinity;
  let cycles = 0;
  let committing = 0;
  let invalidRows = 0;
  for (const [factionId, list] of byFaction(records)) {
    let opening = startingBalances.get(factionId) ?? 0;
    for (const r of list) {
      if (!chainMoneyFinite(r)) {
        invalidRows++;
        violations++;
        continue;
      }
      cycles++;
      const residual = r.foundingExpense - opening;
      if (r.foundingExpense > 0) {
        committing++;
        if (residual > worstResidual) {
          worstResidual = residual;
          worstExpense = r.foundingExpense;
          worstOpening = opening;
        }
        if (!withinTolerance(r.foundingExpense, opening, residual) && residual > 0) violations++;
      }
      opening = r.balance;
    }
  }
  return {
    name: "founding committed <= opening balance",
    left: worstExpense,
    right: worstOpening,
    residual: worstResidual === -Infinity ? 0 : worstResidual,
    pass: violations === 0,
    note:
      `tightest of ${committing} founding-committing cycles (of ${cycles} settled); ` +
      `${violations} over their opening balance` +
      (invalidRows > 0 ? ` | ⚠ ${invalidRows} non-finite rows` : ""),
  };
}

// ── 3. Staged goods are conserved between the founder and the colony's ledger ──

/**
 * Running record of the staged-goods comparison, sampled per tick.
 *
 * Sampled rather than read once at the end, because the end of a run is the one moment the check has
 * nothing to look at: by the equilibrium horizon every establish has completed and the queue holds no
 * colonies at all, so a run-end read compares 0 against 0 and passes vacuously. Per-tick sampling
 * puts the whole founding burst — up to a couple of hundred concurrent establishes — inside the
 * check.
 *
 * One sample is kept, not a total: summing every tick would count the same in-transit tonnage once
 * per tick it sat in the queue. The sample kept is the worst violating one if any tick violated, and
 * otherwise the one with the most open establishes — the most evidence behind a pass.
 */
export interface StagedLedgerCensus {
  samples: number;
  /** Open colony-establishes in the kept sample. */
  projects: number;
  /** Σ their ledgers, and Σ what their draws took, in that same sample. */
  ledger: number;
  drawn: number;
  residual: number;
  /** The kept sample is one that failed, so a later, larger, passing sample must not displace it. */
  violating: boolean;
  /** Ticks whose sample was out of tolerance. */
  violations: number;
  /** Most open establishes seen concurrently — the check's peak evidence. */
  maxProjects: number;
}

export function newStagedLedgerCensus(): StagedLedgerCensus {
  return {
    samples: 0, projects: 0, ledger: 0, drawn: 0, residual: 0,
    violating: false, violations: 0, maxProjects: 0,
  };
}

/**
 * Total founder stock is unchanged across order → stage: every unit a draw took out of a founder is
 * held in the target project's `stagedManifest` until the colony opens.
 *
 * Sampled over colonies OPEN on this tick. A completed establish hands its ledger to the new colony
 * and clears it, so the two sides of a founded colony no longer exist to compare — including it would
 * report every successful founding as lost goods.
 *
 * Call after this tick's draws have been folded into `staging`, or the last draw of a cycle is
 * missing from the side it is being compared against.
 *
 * The CANCEL leg of the spec's identity has no run-level observable: cancellation returns the ledger
 * to the source, and only the player's construction verb cancels, which a headless run never calls.
 * That leg stays a fixture property.
 */
export function recordStagedLedger(
  openProjects: ReadonlyArray<StagedProjectRow>,
  staging: Map<string, FoundingStagingTotals>,
  census: StagedLedgerCensus,
): void {
  // `staging` here is the identity's OWN accumulator, not the lifetime one behind the founding cost
  // reads — this function prunes it, which would wreck those reads.
  //
  // A system can be founded more than once in a run: abandonment resets a dead colony to unclaimed
  // frontier, and frontier is claimable again. The draws are keyed by target system — the only key
  // available while the target is still unclaimed — so a second establish on the same system would
  // be compared against its predecessor's draws as well as its own, and report the dead colony's
  // spend as goods missing from its successor's ledger. Dropping a system's total the moment it has
  // no open establish keeps the accumulator scoped to one founding. This runs BEFORE the comparison
  // so a re-founding is never measured against a stale total, and the prune is inside the recorder
  // rather than left to the caller so the two can never drift apart.
  const openEstablishSystems = new Set(
    openProjects.filter((p) => p.kind === "colony_establish").map((p) => p.systemId),
  );
  for (const systemId of staging.keys()) {
    if (!openEstablishSystems.has(systemId)) staging.delete(systemId);
  }
  let ledger = 0;
  let drawn = 0;
  let projects = 0;
  for (const p of openProjects) {
    if (p.kind !== "colony_establish") continue;
    projects++;
    for (const line of p.stagedManifest) ledger += line.quantity;
    drawn += staging.get(p.systemId)?.tonnage ?? 0;
  }
  census.samples++;
  if (projects > census.maxProjects) census.maxProjects = projects;
  const residual = ledger - drawn;
  const violating = !withinTolerance(ledger, drawn, residual);
  if (violating) census.violations++;
  // A violation always displaces a passing sample; between two of a kind, the bigger sample wins —
  // the worst residual when both failed, the most colonies when both held.
  const displaces = violating
    ? !census.violating || Math.abs(residual) > Math.abs(census.residual)
    : !census.violating && projects >= census.projects;
  if (!displaces) return;
  census.projects = projects;
  census.ledger = ledger;
  census.drawn = drawn;
  census.residual = residual;
  census.violating = violating;
}

/** Fold the sampled comparison into its identity. */
export function checkStagedLedger(census: StagedLedgerCensus): IdentityCheck {
  return {
    name: "staged goods == drawn from founders",
    left: census.ledger,
    right: census.drawn,
    residual: census.residual,
    pass: census.violations === 0,
    note:
      `tonnes in the ledgers of ${census.projects} open establishes vs tonnes their draws took ` +
      `(worst of ${census.samples} sampled ticks, peak ${census.maxProjects} concurrent; ` +
      "completed colonies excluded — their ledger is consumed on arrival; " +
      "the cancel leg is a fixture property, not a run observable)",
  };
}

// ── 4. The settlement's own itemisation explains the balance it wrote ─────────

/**
 * `net` on the treasury service reconciles with the balance delta, cycle by cycle.
 *
 * `net` is income less the three paid bands less the founding taken off the top — the same
 * expression `getFactionTreasury` returns — and the balance a settlement writes must move by exactly
 * that. The residual is where a founding commitment larger than the balance it was committed against
 * would surface, because the settlement floors that subtraction at zero rather than going into debt.
 *
 * The totals are printed as the two sides, but the pass is decided on the WORST CYCLE: summed
 * deltas telescope to (final − starting) and would cancel a pair of equal-and-opposite errors.
 */
export function checkNetReconciliation(
  records: ReadonlyArray<FactionCycleRecord>,
  startingBalances: ReadonlyMap<string, number>,
): IdentityCheck {
  let totalDelta = 0;
  let totalNet = 0;
  let worstResidual = 0;
  let violations = 0;
  let cycles = 0;
  let invalidRows = 0;
  for (const [factionId, list] of byFaction(records)) {
    let previous = startingBalances.get(factionId) ?? 0;
    for (const r of list) {
      if (!chainMoneyFinite(r)) {
        invalidRows++;
        violations++;
        continue;
      }
      cycles++;
      const delta = r.balance - previous;
      const net = r.income - r.paidTotal - r.foundingExpense;
      const residual = delta - net;
      totalDelta += delta;
      totalNet += net;
      if (Math.abs(residual) > Math.abs(worstResidual)) worstResidual = residual;
      if (!withinTolerance(delta, net, residual)) violations++;
      previous = r.balance;
    }
  }
  return {
    name: "balance delta == net (income - paid - founding)",
    left: totalDelta,
    right: totalNet,
    residual: totalDelta - totalNet,
    pass: violations === 0,
    note:
      `${violations} of ${cycles} faction-cycles out; worst cycle residual ${worstResidual.toExponential(2)}` +
      (invalidRows > 0 ? ` | ⚠ ${invalidRows} non-finite rows` : ""),
  };
}

// ── The four, folded ─────────────────────────────────────────────────────────

/** The pass/fail half of the acceptance bar: four identities and the tolerance they were judged at. */
export interface ConservationSummary {
  /** Relative tolerance applied to every residual — printed, so a pass is never taken on trust. */
  tolerance: number;
  checks: IdentityCheck[];
  allPass: boolean;
}

/** What the run recorded that the identities are checked over. */
export interface ConservationInputs {
  charters: CharterCensus;
  factionCycles: ReadonlyArray<FactionCycleRecord>;
  /** Per-faction balance before the first tick — the chain checks' opening value. */
  startingBalances: ReadonlyMap<string, number>;
  stagedLedger: StagedLedgerCensus;
}

/** One run's identities, labelled by the horizon or experiment that produced them. */
export interface ConservationReport {
  /** How the gate names this run — "startup", "equilibrium", or an experiment's label. */
  label: string;
  summary: ConservationSummary;
}

/**
 * The failure message `npm run simulate` exits non-zero on, or `null` when every identity in every
 * run held.
 *
 * Separate from the table because a failed identity has to reach someone who never reads the
 * output: the report already printed FAIL and the run still exited 0, which is how a broken
 * founding ledger once cleared a PR. Every failure across every horizon is listed, not just the
 * first — one broken ledger usually breaks more than one identity, and the set is what says which.
 */
export function conservationGateFailure(
  reports: ReadonlyArray<ConservationReport>,
): string | null {
  const failures = reports.flatMap(({ label, summary }) =>
    summary.checks.filter((c) => !c.pass).map((c) => ({ label, check: c })),
  );
  if (failures.length === 0) return null;
  const total = reports.reduce((n, r) => n + r.summary.checks.length, 0);
  const lines = [
    `CONSERVATION GATE FAILED — ${failures.length} of ${total} identities are out ` +
      `across ${reports.length} run(s).`,
  ];
  for (const { label, check } of failures) {
    // Exponential whatever the magnitude: a residual's interesting range is float dust at one end
    // and a NaN from a corrupt row at the other, and rounding would print both as "0".
    lines.push(
      `  [${label}] ${check.name}: ${check.left} vs ${check.right} | ` +
        `residual ${check.residual.toExponential(2)}`,
    );
    lines.push(`      ${check.note}`);
  }
  lines.push(
    "The founding ledger is out, not merely mistuned — nothing measured in this run is evidence " +
      "for anything downstream until it holds.",
  );
  return lines.join("\n");
}

/** Check all four identities, in the order the spec's acceptance section lists them. */
export function summariseConservation(inputs: ConservationInputs): ConservationSummary {
  const checks = [
    checkCharterDebits(inputs.charters),
    checkFoundingWithinBalance(inputs.factionCycles, inputs.startingBalances),
    checkStagedLedger(inputs.stagedLedger),
    checkNetReconciliation(inputs.factionCycles, inputs.startingBalances),
  ];
  return {
    tolerance: CONSERVATION_TOLERANCE,
    checks,
    allPass: checks.every((c) => c.pass),
  };
}
