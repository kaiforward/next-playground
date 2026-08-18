/**
 * Faction treasury math — pure (no I/O, no world imports). Income lines value
 * real economic activity (employed heads by grade; realised physical output at
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
   *  consumers run at next cycle. When a band's bill is 0 this is the slider
   *  value (never 0/0). */
  funded: TreasuryBands;
  /** What each band was ASKED to pay — `bill × the slider in force at this settlement`, after the
   *  same clamp the ladder applies. Reported because a band is insolvent exactly when `paid` falls
   *  short of this, and the slider is live player policy that moves between settlements: recovering
   *  the charge later from `bands` would compare a frozen payment against a slider that has since
   *  changed. */
  charged: TreasuryBands;
}

/** Coerce a money-path value: non-finite → 0, floored at 0. Exported so the
 *  treasury processor applies the same guarantee to sums it persists. */
export const safeMoney = (n: number): number => (Number.isFinite(n) ? Math.max(0, n) : 0);
const safe = safeMoney;

/**
 * The money a faction may genuinely commit to founding: its balance less the founding already
 * committed this settlement period and not yet charged.
 *
 * One expression, because three readers must price against the same purse — the planner's
 * affordability gate and the player verb's `insufficient_funds` block, the tick's own charter and
 * staging phases, and the readout that says why a founding is stuck. Money-path coerced on both
 * sides and floored at 0: a faction is never in founding debt.
 */
export function foundingWorkingBalance(balance: number, pendingFounding: number): number {
  return safe(safe(balance) - safe(pendingFounding));
}

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
  realisedByGood: ReadonlyMap<string, number>,
  referenceValues: Record<string, number>,
  rate: number,
  rateMult: number,
  economyScale: number,
): number {
  const scale = Number.isFinite(economyScale) && economyScale > 0 ? economyScale : 1;
  let assessed = 0;
  for (const [goodId, units] of realisedByGood) {
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
  const charged: TreasuryBands = { maintenance: 0, logistics: 0, construction: 0 };
  for (const band of BAND_LADDER) {
    const bill = safe(bills[band]);
    const slider = clamp(Number.isFinite(sliders[band]) ? sliders[band] : 1, 0, 1);
    const charge = bill * slider;
    const pay = Math.min(charge, available);
    available -= pay;
    paid[band] = pay;
    funded[band] = bill > 0 ? pay / bill : slider;
    charged[band] = charge;
  }
  return { balance: available, paid, funded, charged };
}

/**
 * How much a settlement fell short of what it ASKED a band to pay, or `null` when it did not fall
 * short at all. The single insolvency test — every surface that says "shorted" or "unfunded" reads
 * it, so no two of them can disagree about the same faction.
 *
 * Both terms come from the same frozen settlement, and that is the whole point. The funding sliders
 * are live player policy: `updateTreasuryPolicy` writes one with no re-settle, so a `paid` figure
 * latched under the old slider says nothing about the new one. Comparing across that seam — a frozen
 * `paid` (or the `funded` fraction derived from it) against today's slider — reports a solvent
 * faction as short the moment the player RAISES a band, which is the very action the badge asks for,
 * and hides a real shortfall when they lower it. Both readings persist until the next settlement,
 * indefinitely while the game is paused.
 *
 * `null` for a settlement that predates `charged` (an older save) rather than a guess from the live
 * slider: absence reads as never-assessed here exactly as it does elsewhere, the faction's next
 * settlement fills it in, and falling back would reinstate the fault this function exists to remove.
 * `null` too for no settlement at all — a faction that has never settled has not failed to pay
 * anything. Solvency is exact, not epsilon-guarded: `settleLadder` assigns `pay = min(charge,
 * available)`, so a band that paid in full holds a value identical to its charge, never a float
 * residue below it.
 */
export function bandShortfall(
  settlement: { paid: TreasuryBands; charged?: TreasuryBands } | null | undefined,
  band: keyof TreasuryBands,
): number | null {
  const charged = settlement?.charged;
  if (settlement === null || settlement === undefined || charged === undefined) return null;
  const short = charged[band] - settlement.paid[band];
  return short > 0 ? short : null;
}

/** Effective funding for the curves below: non-finite → 1 (fully funded — the
 *  no-effect default), else clamped to [0,1]. */
const safeFunding = (f: number): number => (Number.isFinite(f) ? clamp(f, 0, 1) : 1);

/**
 * Flow-only maintenance output malus: a production multiplier scaling linearly
 * with the funding shortfall (1 at full funding, 1 − slope at zero). Rides
 * productionSuppress in the market-tick builder — it must never feed the
 * buildingUsed utilisation signal, or the flow-only promise silently breaks.
 */
export function maintenanceOutputMalus(funding: number, slope: number): number {
  return 1 - clamp(slope, 0, 1) * (1 - safeFunding(funding));
}

/**
 * Idle-buffer length multiplier from maintenance funding. Linear `base + f`:
 * 1.0 at f = 1 − base (the slider range's midpoint for base 0.25 — today's
 * buffer), gentler above, and a short fast-death buffer under deep insolvency.
 */
export function maintenanceBufferScale(funding: number, base: number): number {
  return Math.max(0, base) + safeFunding(funding);
}
