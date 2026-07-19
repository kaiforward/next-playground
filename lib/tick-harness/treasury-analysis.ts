/**
 * Faction-treasury analysis for the calibration harness — the coarse health
 * bar for money. Reports balance trajectory, income mix, per-band funded
 * fractions, and shortfall detection, so a run that quietly starves logistics
 * or construction funding shows up without reading raw treasury rows.
 */
import type { WorldFactionTreasury } from "@/lib/world/types";

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
    const moneyFields = [t.balance, t.pendingWork.logistics, t.pendingWork.construction];
    if (t.lastSettlement !== null) {
      moneyFields.push(
        t.lastSettlement.headsIncome,
        t.lastSettlement.productionIncome,
        t.lastSettlement.maintenanceBill,
        t.lastSettlement.logisticsBill,
        t.lastSettlement.constructionBill,
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
