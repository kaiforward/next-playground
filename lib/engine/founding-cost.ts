/**
 * What a colony costs to commit to — pure (no I/O, no world reads).
 *
 * Founding is priced in two streams: a one-off CHARTER fee paid when the establish project first
 * receives funding, and MATERIALS staged and paid for cycle by cycle as the project absorbs work.
 * Both are money, both leave the world (there is no counterparty), and both are quoted through the
 * one valuation seam below so the planner, the player's colony verb and the staging check can never
 * read three different numbers for the same colony.
 *
 * The establish WORK cost is deliberately not here: it bills generically through the construction
 * band like any other build.
 */
import { GOODS } from "@/lib/constants/goods";
import { consumptionRate } from "@/lib/engine/physical-economy";
import type { CivilianDemandBasis } from "@/lib/engine/physical-economy";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { FoundingStockLine } from "@/lib/tick/world/directed-build-world";

/** A treasury balance and the charter's scale base, as one candidate's affordability check sees them. */
export interface FoundingChargeParams {
  /** Multiplier on the maintenance bill. */
  mult: number;
  /** Hard floor under the fee. */
  min: number;
}

/**
 * THE valuation seam: what a quantity of goods costs to procure, in money.
 *
 * `Σ (quantity / economyScale) × basePrice`. The `/ economyScale` is load-bearing, not cosmetic —
 * goods quantities ride ECONOMY_SCALE (`GOOD_CONSUMPTION` and friends are `scaleRecord`s) and money
 * does not (treasury values are S-invariant by construction), so every quantity crossing into money
 * normalises the same way `productionTaxIncome` does. The scale arrives as a PARAMETER for the same
 * reason it does there: the engine graph never imports the env-resolved constant.
 *
 * It reads the catalog `basePrice` — a reference price, not a live local one. Live prices are the
 * upgrade this seam exists to make a one-function change; today they misprice by type. It
 * deliberately does NOT read `REFERENCE_VALUE`, which is a cadastral tax assessment net of inputs
 * and would price a processed good below the sum of its own inputs.
 */
export function foundingGoodsValue(
  lines: ReadonlyArray<{ goodId: string; quantity: number }>,
  economyScale: number,
): number {
  const scale = Number.isFinite(economyScale) && economyScale > 0 ? economyScale : 1;
  let value = 0;
  for (const line of lines) {
    const basePrice = GOODS[line.goodId]?.basePrice;
    if (basePrice === undefined || !Number.isFinite(basePrice)) continue;
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    value += (line.quantity / scale) * basePrice;
  }
  return value;
}

/**
 * The one-off fee for committing to a colony, scaled to how much faction there is to administer:
 * `max(min, mult × maintenanceBill)`. `min` is a real floor — it binds for any faction whose
 * maintenance bill has collapsed, and covers the pre-first-settlement case — never a null-fallback.
 */
export function charterFee(maintenanceBill: number, params: FoundingChargeParams): number {
  const bill = Number.isFinite(maintenanceBill) ? Math.max(0, maintenanceBill) : 0;
  const mult = Number.isFinite(params.mult) ? Math.max(0, params.mult) : 0;
  const min = Number.isFinite(params.min) ? Math.max(0, params.min) : 0;
  return Math.max(min, mult * bill);
}

/**
 * The manifest a colony seed WANTS, uncapped — one line per good the seed consumes, `cover` cycles
 * of that good's raw civilian rate at the seed population. Same want expression the per-cycle
 * staging draw uses, with the founder's `surplusDrawable` cap deliberately left off: what a founder
 * will actually be able to spare over the ~17 cycles of an establish is not knowable at proposal
 * time, so the projection is an upper bound and over-reserving is the safe direction.
 *
 * `sourceGoods` decides which goods are on the list — a colony can only ever be provisioned with
 * goods its source system has a market row for.
 */
export function projectedManifestWant(
  sourceGoods: ReadonlyArray<GoodMarketState>,
  seedPop: number,
  cover: number,
): FoundingStockLine[] {
  if (!(seedPop > 0) || !(cover > 0)) return [];
  const basis: CivilianDemandBasis = { population: seedPop, technicians: 0, engineers: 0 };
  const lines: FoundingStockLine[] = [];
  for (const good of sourceGoods) {
    const colonyDemandRate = consumptionRate(good.goodId, basis);
    if (colonyDemandRate <= 0) continue; // the seed does not consume it
    lines.push({ goodId: good.goodId, quantity: cover * colonyDemandRate });
  }
  return lines;
}

/**
 * The money a faction must have free before it may commit to a colony: the charter it pays now plus
 * `headroom` cycles' worth of the materials it will owe later. One function so the autonomic
 * planner's gate, the player verb's `insufficient_funds` block and the staging affordability check
 * are the same number by construction.
 */
export function foundingCommitmentCost(
  charter: number,
  projectedBillValue: number,
  headroom: number,
): number {
  const safeCharter = Number.isFinite(charter) ? Math.max(0, charter) : 0;
  const safeBill = Number.isFinite(projectedBillValue) ? Math.max(0, projectedBillValue) : 0;
  const safeHeadroom = Number.isFinite(headroom) ? Math.max(0, headroom) : 0;
  return safeCharter + safeHeadroom * safeBill;
}
