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
import { catchUpFactor } from "@/lib/tick/shard";
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
 * The stored maintenance bill de-scaled to ONE REFERENCE cycle — the base every charter is quoted
 * against, wherever it is quoted from.
 *
 * `maintenanceBill` is a per-settlement flow (`upkeep.total × catchUp`), but a charter is a one-off
 * charge on an event, not a per-cycle rate: quoting it off the raw stored figure would halve what a
 * colony costs whenever the settlement cadence halves, which is granularity leaking into price. At
 * the shipped cadence the divisor is 1. A cadence of zero cannot divide, and an Infinity written
 * into a price would reach world state as `null`, so it de-scales by nothing instead.
 */
export function referenceMaintenanceBill(
  maintenanceBill: number | undefined,
  cycleTicks: number,
): number {
  const bill =
    maintenanceBill !== undefined && Number.isFinite(maintenanceBill) ? Math.max(0, maintenanceBill) : 0;
  const factor = catchUpFactor(cycleTicks);
  return Number.isFinite(factor) && factor > 0 ? bill / factor : bill;
}

/**
 * The manifest a colony seed WANTS, uncapped — one line per good the seed consumes, `cover` cycles
 * of that good's raw civilian rate at the seed population. Same want expression the per-cycle
 * staging draw uses, with the founder's `surplusDrawable` cap deliberately left off: what a founder
 * will actually be able to spare over the ~17 cycles of an establish is not knowable at proposal
 * time, so the projection is an upper bound and over-reserving is the safe direction.
 *
 * `sourceGoods` decides which goods are on the list — a colony can only ever be provisioned with
 * goods its source system has a market row for. Only the good ids are read, so any of the several
 * per-good market shapes in the tree can be handed straight in.
 */
export function projectedManifestWant(
  sourceGoods: ReadonlyArray<{ goodId: string }>,
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

/** One good at a colony's source, as a staging draw sees it. */
export interface FoundingSourceSupply {
  goodId: string;
  /** What this source can part with for a colony this cycle, already through the export rule. */
  sparable: number;
}

/** Total per good, ignoring negative or unreadable quantities. */
function quantityByGood(lines: ReadonlyArray<FoundingStockLine>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    totals.set(line.goodId, (totals.get(line.goodId) ?? 0) + line.quantity);
  }
  return totals;
}

/** The next cycle's staging share, in money: what it asks for, and what is actually there to buy. */
export interface NextStagingShare {
  /** Value of the share the colony wants this cycle, before the source's shelves are consulted. */
  wantValue: number;
  /** Value of the part of that share the source can spare — the money the founder must find. */
  drawableValue: number;
}

/**
 * What the next cycle of staging would ask of a founder, and what it could actually draw: this
 * cycle's share of the manifest, per good bounded by what is still wanted and then by what the
 * source can spare, both valued through the seam.
 *
 * The processor's own plan is the same expression with the working balance clamped in good by good.
 * Leaving the money out is exactly what makes the pair readable as two questions — is there anything
 * on the shelves (`drawableValue` against `wantValue`), and can the balance pay for it — which is
 * what separates a colony waiting on money from one waiting on goods a founder does not have.
 * `workShare` is the fraction of the whole establish the cycle's absorption cap would build, the
 * same slice the staging draw sizes itself on.
 */
export function nextStagingShare(
  supply: ReadonlyArray<FoundingSourceSupply>,
  stagedManifest: ReadonlyArray<FoundingStockLine>,
  seedPop: number,
  workShare: number,
  cover: number,
  economyScale: number,
): NextStagingShare {
  if (!(workShare > 0)) return { wantValue: 0, drawableValue: 0 };
  const staged = quantityByGood(stagedManifest);
  const sparable = new Map(supply.map((s) => [s.goodId, s.sparable]));
  const wanted = projectedManifestWant(supply, seedPop, cover).map((want) => ({
    goodId: want.goodId,
    quantity: Math.min(
      Math.max(0, want.quantity - (staged.get(want.goodId) ?? 0)),
      workShare * want.quantity,
    ),
  }));
  const drawable = wanted.map((line) => {
    const headroom = sparable.get(line.goodId) ?? 0;
    return {
      goodId: line.goodId,
      quantity: Math.min(line.quantity, Number.isFinite(headroom) ? Math.max(0, headroom) : 0),
    };
  });
  return {
    wantValue: foundingGoodsValue(wanted, economyScale),
    drawableValue: foundingGoodsValue(drawable, economyScale),
  };
}

/**
 * The share of a colony's manifest already staged, in [0,1], value-weighted through the seam so a
 * tonne of water and a tonne of medicine count for what they cost rather than for their mass.
 *
 * The denominator spans every good either still on the source's list or already in the ledger, so a
 * colony whose source has gone dark still reads its progress against what it set out to carry. Both
 * sides are valued at unit scale: a ratio of two S-riding quantities is S-invariant, so the display
 * never needs the env-resolved figure. Nothing to want at all reads 0 — a project with no manifest
 * has staged no share of one.
 */
export function foundingStagedFraction(
  supply: ReadonlyArray<{ goodId: string }>,
  stagedManifest: ReadonlyArray<FoundingStockLine>,
  seedPop: number,
  cover: number,
): number {
  const goodIds = new Set(supply.map((s) => s.goodId));
  for (const line of stagedManifest) goodIds.add(line.goodId);
  const want = projectedManifestWant([...goodIds].map((goodId) => ({ goodId })), seedPop, cover);
  const wantValue = foundingGoodsValue(want, 1);
  if (!(wantValue > 0)) return 0;
  return Math.min(1, Math.max(0, foundingGoodsValue(stagedManifest, 1) / wantValue));
}
