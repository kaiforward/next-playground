/**
 * Faction treasury math — pure (no I/O, no world imports). Income lines value
 * real economic activity (employed heads by grade; realized physical output at
 * fixed reference values); bills are paid in a fixed priority ladder
 * maintenance → logistics → construction, so flow costs (a stalled queue)
 * starve before stock costs (unpaid upkeep) compound. Balance never goes
 * negative — there is no debt instrument.
 *
 * Every entry point coerces non-finite inputs to 0: a NaN reaching World state
 * becomes null under JSON.stringify and corrupts the save.
 */
import { clamp } from "@/lib/utils/math";
import { workCostPerLevel } from "@/lib/constants/construction";

/** One value per budget band. Used both for slider settings and paid/funded fractions. */
export interface TreasuryBands {
  maintenance: number;
  logistics: number;
  construction: number;
}

/** Employed heads by grade — the shape of `LabourAllocation`'s working fields. */
export interface HeadsTaxInput {
  unskilled: number;
  technicians: number;
  engineers: number;
}

export interface MaintenanceBillLine {
  buildingType: string;
  amount: number;
}

export interface MaintenanceBillResult {
  total: number;
  byType: MaintenanceBillLine[];
}

export interface SettlementLadderResult {
  /** Post-settlement balance, ≥ 0. */
  balance: number;
  /** Money actually paid per band. */
  paid: TreasuryBands;
  /** Paid fraction of each band's FULL bill — the effective funding level its
   *  consumers run at next month. When a band's bill is 0 this is the slider
   *  value (never 0/0). */
  funded: TreasuryBands;
}

/** Coerce a money-path value: non-finite → 0, floored at 0. Exported so the
 *  treasury processor applies the same guarantee to sums it persists. */
export const safeMoney = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0);
const safe = safeMoney;

export function headsTaxIncome(
  alloc: HeadsTaxInput,
  weights: HeadsTaxInput,
  ratePerHead: number,
  rateMult: number,
): number {
  const weighted =
    safe(alloc.unskilled) * safe(weights.unskilled) +
    safe(alloc.technicians) * safe(weights.technicians) +
    safe(alloc.engineers) * safe(weights.engineers);
  return weighted * safe(ratePerHead) * safe(rateMult);
}

export function productionTaxIncome(
  realizedByGood: ReadonlyMap<string, number>,
  referenceValues: Record<string, number>,
  rate: number,
  rateMult: number,
  economyScale: number,
): number {
  const scale = Number.isFinite(economyScale) && economyScale > 0 ? economyScale : 1;
  let assessed = 0;
  for (const [goodId, units] of realizedByGood) {
    const ref = referenceValues[goodId];
    if (ref === undefined || !Number.isFinite(ref) || !Number.isFinite(units) || units <= 0) continue;
    assessed += (units / scale) * ref;
  }
  return assessed * safe(rate) * safe(rateMult);
}

export function maintenanceBill(
  levelsByType: ReadonlyMap<string, number>,
  ratePerWork: number,
): MaintenanceBillResult {
  const rate = safe(ratePerWork);
  const byType: MaintenanceBillLine[] = [];
  let total = 0;
  for (const [buildingType, levels] of levelsByType) {
    const amount = safe(levels) * workCostPerLevel(buildingType) * rate;
    if (amount <= 0) continue;
    byType.push({ buildingType, amount });
    total += amount;
  }
  return { total, byType };
}

const BAND_LADDER = ["maintenance", "logistics", "construction"] as const;

export function settleLadder(
  balance: number,
  income: number,
  bills: TreasuryBands,
  sliders: TreasuryBands,
): SettlementLadderResult {
  let available = safe(balance) + safe(income);
  const paid: TreasuryBands = { maintenance: 0, logistics: 0, construction: 0 };
  const funded: TreasuryBands = { maintenance: 0, logistics: 0, construction: 0 };
  for (const band of BAND_LADDER) {
    const bill = safe(bills[band]);
    const slider = clamp(Number.isFinite(sliders[band]) ? sliders[band] : 1, 0, 1);
    const charge = bill * slider;
    const pay = Math.min(charge, available);
    available -= pay;
    paid[band] = pay;
    funded[band] = bill > 0 ? pay / bill : slider;
  }
  return { balance: available, paid, funded };
}
