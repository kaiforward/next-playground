/**
 * Faction-treasury analysis for the calibration harness — the coarse health
 * bar for money. Reports balance trajectory, income mix, per-band funded
 * fractions, and shortfall detection, so a run that quietly starves logistics
 * or construction funding shows up without reading raw treasury rows.
 */
import type { WorldFactionTreasury } from "@/lib/world/types";
import { median, quantile } from "@/lib/utils/math";

/** One sampled point of the roster's balance trajectory. */
export interface TreasurySnapshot {
  tick: number;
  meanBalance: number;
  minBalance: number;
  /** Factions whose last settlement shorted any band below its slider. */
  shortedFactions: number;
}

export interface TreasurySummary {
  factionCount: number;
  meanBalance: number;
  minBalance: number;
  maxBalance: number;
  /** Aggregate income shares across the roster's last settlements (0-1; NaN-free). */
  headsShare: number;
  productionShare: number;
  /** Mean latched funded fraction per band. */
  fundedMeans: { maintenance: number; logistics: number; construction: number };
  /** Standing guards: rows with non-finite or negative money values. */
  invalidRows: number;
  /** First sampled tick where any faction shorted a band, or null if never. */
  firstShortfallTick: number | null;
}

const BANDS = ["maintenance", "logistics", "construction"] as const;

function isShorted(t: WorldFactionTreasury): boolean {
  if (t.lastSettlement === null) return false;
  return BANDS.some((band) => t.funded[band] < t.bands[band] - 1e-9);
}

// ── Founding-era money bars ─────────────────────────────────────

/**
 * Last tick of the startup tail. Faction-cycles at or below it are reported apart from the founding
 * era and excluded from its bars: the tail's shortfalls predate any founding (its last event is
 * t=120 against a first founding at t=432), so blaming them on a charter would be false, and letting
 * them into the era's denominator would dilute the share the charter is actually answerable for.
 */
export const FOUNDING_ERA_START_TICK = 400;

/**
 * Close of the FIXED comparison window: the startup horizon, which every arm runs through whatever
 * its founding does. The endogenous era below closes on an arm's own last founding charge, which
 * makes it a description of that arm and NOT a figure two arms can be compared on — a treatment that
 * founds one straggler later measures a different window than its baseline. This window is the same
 * ticks for both, so the share taken over it is the arm-comparable one.
 */
export const FOUNDING_FIXED_WINDOW_END_TICK = 1000;

/**
 * One faction's one settled cycle — the unit every money bar below is counted in. Taken as each
 * settlement lands rather than at run end, because a settlement is overwritten by the next one and a
 * run-end read would see a single cycle per faction.
 */
export interface FactionCycleRecord {
  tick: number;
  /** Heads + production income settled that cycle. */
  income: number;
  /** Charter fees and staged materials charged off the top that cycle. */
  foundingExpense: number;
  /** Any band latched below its slider — the same rule the trajectory's `shortedFactions` uses. */
  shorted: boolean;
  fundedMaintenance: number;
  fundedConstruction: number;
  /** What construction was billed that cycle. Carried because `settleLadder` writes the SLIDER, not
   *  a paid fraction, when a band is billed nothing — so a `funded.construction` of 0 on an unbilled
   *  cycle is a policy setting, and reading it as starvation would fail the bar on a faction that
   *  simply had nothing to build. */
  constructionBill: number;
}

/**
 * Capture every settlement that landed since the last call, one record per faction per cycle.
 * `seenTickByFaction` carries the last settlement tick already taken for each faction, so a
 * settlement is recorded exactly once however many ticks it stays the latest one.
 *
 * The funded fractions are read alongside the settlement that latched them — they are written by the
 * same settlement, so reading them together is the only way to attribute a shortfall to its cycle.
 */
export function recordSettledCycles(
  treasuries: ReadonlyArray<WorldFactionTreasury>,
  seenTickByFaction: Map<string, number>,
  out: FactionCycleRecord[],
): void {
  for (const t of treasuries) {
    const s = t.lastSettlement;
    if (s === null) continue;
    if (seenTickByFaction.get(t.factionId) === s.tick) continue;
    seenTickByFaction.set(t.factionId, s.tick);
    out.push({
      tick: s.tick,
      income: s.headsIncome + s.productionIncome,
      foundingExpense: s.foundingExpense,
      shorted: isShorted(t),
      fundedMaintenance: t.funded.maintenance,
      fundedConstruction: t.funded.construction,
      constructionBill: s.constructionBill,
    });
  }
}

/** Shorted faction-cycles within one slice of the run, with the slice's own denominator. */
export interface ShortedSlice {
  cycles: number;
  shorted: number;
  /** shorted / cycles; 0 when the slice is empty (never NaN). */
  share: number;
}

/** One window's spend share, with the income it was taken over. */
export interface SpendShareWindow {
  /** First tick INCLUDED in the window. */
  startTick: number;
  /** Last tick included, or null when the window ran to the end of the run. */
  endTick: number | null;
  factionCycles: number;
  income: number;
  foundingSpend: number;
  /** foundingSpend / income; 0 when nothing was earned (never NaN). */
  spendShare: number;
}

/** The founding-era money bars, counted over settled faction-cycles. */
export interface FoundingEraSummary {
  /** Last tick of the excluded startup tail — the era opens after it. */
  startupTailEndTick: number;
  /**
   * Last settled cycle that carried a founding charge — the endogenous era closes on it. Without
   * that bound the era runs to the end of the run, and at the equilibrium horizon the share is a
   * founding burst divided by ten thousand ticks of income: a number that falls as the run lengthens.
   * Null when the run never charged for a founding — there is no burst to bound.
   *
   * **The endogenous window describes ONE arm and cannot compare two.** Its bound moves with the
   * arm's own founding, so a treatment that founds a straggler later measures different ticks than
   * its baseline. Use `fixedWindow` for any arm-to-arm claim.
   */
  eraEndTick: number | null;
  /**
   * The era was still open when the run ended — its last founding charge is the run's last settled
   * cycle, so the window is CENSORED, not bounded. The startup horizon reads this way whenever
   * founding is still going at t=1000, and its share is then "spend so far over income so far",
   * which is not the same quantity a closed era reports.
   */
  eraCensored: boolean;
  /** Founding-era faction-cycles (valid rows only). */
  factionCycles: number;
  /** Σ income across them — the share's denominator. */
  income: number;
  /** Σ founding expense settled across them — the share's numerator. Accumulated from what each
   *  settlement actually charged, never from a per-colony mean, which carries neither the charter
   *  nor a colony still staging. */
  foundingSpend: number;
  /** foundingSpend / income; 0 when nothing was earned (never NaN). */
  spendShare: number;
  /**
   * The same share over the FIXED window (`FOUNDING_ERA_START_TICK`, `FOUNDING_FIXED_WINDOW_END_TICK`]
   * — the same ticks for every arm and every horizon. **This is the arm-comparable reading**; the
   * endogenous one above describes what this arm's own founding era cost. A run shorter than the
   * window simply carries fewer cycles in it, which its `factionCycles` states.
   */
  fixedWindow: SpendShareWindow;
  /** Founding expense settled across the WHOLE run, tail and post-era both included, so no spend
   *  hides outside the window the share is measured over. */
  totalFoundingSpend: number;
  /** Founding-era faction-cycles that carried a founding expense — a charter-caused shortfall shows
   *  here and nowhere else. */
  withFounding: ShortedSlice;
  /** Founding-era faction-cycles that carried none — the ambient rate to read the above against. */
  withoutFounding: ShortedSlice;
  /** The excluded startup tail, reported so its exclusion is visible rather than assumed. */
  startupTail: ShortedSlice;
  /** Faction-cycles after the era closed. In no bar, but reported so the run's cycles add up and a
   *  post-era shortfall is not invisible — `totalFoundingSpend` already spans them. */
  postEra: ShortedSlice;
  /** `funded.maintenance` ACROSS founding-era faction-cycles, not its roster mean: founding is
   *  debited before the ladder, so this is the distribution that says whether the floor was starved.
   *  Null when the era has no cycles — the median of nothing must not print as a starved 0.00. */
  fundedMaintenance: { median: number; p10: number; min: number } | null;
  /** Minimum `funded.construction` over founding-era faction-cycles that were actually BILLED for
   *  construction. An unbilled cycle latches the slider rather than a paid fraction, so including it
   *  would report a faction with nothing to build as a faction starved of funding. Null when no
   *  founding-era cycle was billed. */
  minFundedConstruction: number | null;
  /** Founding-era faction-cycles carrying a construction bill — the minimum above is over these. */
  billedConstructionCycles: number;
  /** Rows carrying a non-finite or negative money value, excluded from every figure above. */
  invalidRows: number;
}

function shortedSlice(records: ReadonlyArray<FactionCycleRecord>): ShortedSlice {
  const shorted = records.filter((r) => r.shorted).length;
  return {
    cycles: records.length,
    shorted,
    share: records.length > 0 ? shorted / records.length : 0,
  };
}

/** Σ income and Σ founding expense over one window of faction-cycles, with its own share. */
function spendShareWindow(
  records: ReadonlyArray<FactionCycleRecord>,
  startTick: number,
  endTick: number | null,
): SpendShareWindow {
  let income = 0;
  let foundingSpend = 0;
  let factionCycles = 0;
  for (const r of records) {
    if (r.tick < startTick) continue;
    if (endTick !== null && r.tick > endTick) continue;
    factionCycles++;
    income += r.income;
    foundingSpend += r.foundingExpense;
  }
  return {
    startTick, endTick, factionCycles, income, foundingSpend,
    spendShare: income > 0 ? foundingSpend / income : 0,
  };
}

/**
 * Fold the run's settled faction-cycles into the founding-era bars.
 *
 * Both halves of every spend share come off the same rows, so a numerator can never be measured over
 * a window its denominator was not: a cumulative spend divided by an income accumulated somewhere
 * else is the way this reading goes quietly wrong.
 *
 * Two windows, deliberately. The endogenous era closes on this arm's own last founding charge and
 * says what THIS arm's founding era cost; the fixed window is the same ticks for every arm and is
 * the only one two arms may be compared on.
 */
export function summarizeFoundingEra(
  records: ReadonlyArray<FactionCycleRecord>,
  startupTailEndTick: number = FOUNDING_ERA_START_TICK,
  fixedWindowEndTick: number = FOUNDING_FIXED_WINDOW_END_TICK,
): FoundingEraSummary {
  const valid: FactionCycleRecord[] = [];
  let invalidRows = 0;
  for (const r of records) {
    const money = [
      r.income, r.foundingExpense, r.fundedMaintenance, r.fundedConstruction, r.constructionBill,
    ];
    if (money.some((v) => !Number.isFinite(v) || v < 0)) invalidRows++;
    else valid.push(r);
  }
  let eraEndTick: number | null = null;
  let lastSettledTick: number | null = null;
  for (const r of valid) {
    if (r.foundingExpense > 0 && (eraEndTick === null || r.tick > eraEndTick)) eraEndTick = r.tick;
    if (lastSettledTick === null || r.tick > lastSettledTick) lastSettledTick = r.tick;
  }
  const era = valid.filter(
    (r) => r.tick > startupTailEndTick && (eraEndTick === null || r.tick <= eraEndTick),
  );
  const tail = valid.filter((r) => r.tick <= startupTailEndTick);
  const postEra = valid.filter((r) => eraEndTick !== null && r.tick > eraEndTick);
  const maintenance: number[] = [];
  let minConstruction: number | null = null;
  let billedConstructionCycles = 0;
  let minMaintenance = 0;
  for (const r of era) {
    if (maintenance.length === 0 || r.fundedMaintenance < minMaintenance) {
      minMaintenance = r.fundedMaintenance;
    }
    maintenance.push(r.fundedMaintenance);
    // Only a billed cycle says anything about construction funding — an unbilled one latches the
    // slider, and a faction with nothing to build would otherwise fail the bar for a 0 it chose.
    if (!(r.constructionBill > 0)) continue;
    billedConstructionCycles++;
    if (minConstruction === null || r.fundedConstruction < minConstruction) {
      minConstruction = r.fundedConstruction;
    }
  }
  let totalFoundingSpend = 0;
  for (const r of valid) totalFoundingSpend += r.foundingExpense;
  const endogenous = spendShareWindow(era, startupTailEndTick + 1, eraEndTick);

  return {
    startupTailEndTick,
    eraEndTick,
    // Its last founding charge IS the run's last settled cycle: founding had not stopped, the run
    // did. The share is then "spend so far over income so far", not a closed era's figure.
    eraCensored: eraEndTick !== null && eraEndTick === lastSettledTick,
    factionCycles: era.length,
    income: endogenous.income,
    foundingSpend: endogenous.foundingSpend,
    spendShare: endogenous.spendShare,
    fixedWindow: spendShareWindow(valid, startupTailEndTick + 1, fixedWindowEndTick),
    totalFoundingSpend,
    withFounding: shortedSlice(era.filter((r) => r.foundingExpense > 0)),
    withoutFounding: shortedSlice(era.filter((r) => !(r.foundingExpense > 0))),
    startupTail: shortedSlice(tail),
    postEra: shortedSlice(postEra),
    fundedMaintenance:
      maintenance.length > 0
        ? {
            median: median(maintenance),
            p10: quantile(maintenance, 0.1),
            min: minMaintenance,
          }
        : null,
    minFundedConstruction: minConstruction,
    billedConstructionCycles,
    invalidRows,
  };
}

export function sampleTreasuries(tick: number, treasuries: WorldFactionTreasury[]): TreasurySnapshot {
  const balances = treasuries.map((t) => t.balance);
  const total = balances.reduce((acc, b) => acc + b, 0);
  return {
    tick,
    meanBalance: treasuries.length > 0 ? total / treasuries.length : 0,
    minBalance: balances.length > 0 ? Math.min(...balances) : 0,
    shortedFactions: treasuries.filter(isShorted).length,
  };
}

export function summarizeTreasuries(
  treasuries: WorldFactionTreasury[],
  snapshots: TreasurySnapshot[],
): TreasurySummary {
  const balances = treasuries.map((t) => t.balance);
  const total = balances.reduce((acc, b) => acc + b, 0);
  let heads = 0;
  let production = 0;
  const fundedSums = { maintenance: 0, logistics: 0, construction: 0 };
  let invalidRows = 0;
  for (const t of treasuries) {
    // Every money value that feeds the aggregates below must be in this guard,
    // or a NaN would corrupt the summary without ever incrementing invalidRows.
    const moneyFields = [
      t.balance,
      t.pendingWork.logistics,
      t.pendingWork.construction,
      t.pendingFounding,
    ];
    if (t.lastSettlement !== null) {
      moneyFields.push(
        t.lastSettlement.headsIncome,
        t.lastSettlement.productionIncome,
        t.lastSettlement.maintenanceBill,
        t.lastSettlement.logisticsBill,
        t.lastSettlement.constructionBill,
        t.lastSettlement.foundingExpense,
      );
    }
    for (const band of BANDS) moneyFields.push(t.funded[band]);
    if (moneyFields.some((v) => !Number.isFinite(v) || v < 0)) invalidRows++;
    heads += t.lastSettlement?.headsIncome ?? 0;
    production += t.lastSettlement?.productionIncome ?? 0;
    for (const band of BANDS) fundedSums[band] += t.funded[band];
  }
  const income = heads + production;
  const n = Math.max(1, treasuries.length);
  const firstShortfall = snapshots.find((s) => s.shortedFactions > 0);
  return {
    factionCount: treasuries.length,
    meanBalance: treasuries.length > 0 ? total / treasuries.length : 0,
    minBalance: balances.length > 0 ? Math.min(...balances) : 0,
    maxBalance: balances.length > 0 ? Math.max(...balances) : 0,
    headsShare: income > 0 ? heads / income : 0,
    productionShare: income > 0 ? production / income : 0,
    fundedMeans: {
      maintenance: fundedSums.maintenance / n,
      logistics: fundedSums.logistics / n,
      construction: fundedSums.construction / n,
    },
    invalidRows,
    firstShortfallTick: firstShortfall ? firstShortfall.tick : null,
  };
}
