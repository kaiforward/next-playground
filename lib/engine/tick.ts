/**
 * Economy simulation tick engine — single-stock model.
 *
 * Each market holds one `stock` value. Producers add stock at the full rate at and
 * below the anchor (targetStock), then decelerate linearly to zero at the operating
 * ceiling (holdCover × targetStock). Consumers deliver in full at and above the
 * comfort knee (comfortCover × targetStock), then ration on the scarcity ramp below
 * it. Stock is clamped to [0, maxStock]. There is no mean-reversion and no `demand`
 * axis — equilibrium emerges spatially via the trade-flow processor.
 * See docs/active/gameplay/economy.md (Per-Tick Simulation).
 *
 * All functions are pure — no DB or constant imports.
 */

import { clamp } from "@/lib/utils/math";

export interface MarketTickEntry {
  goodId: string;
  stock: number;
  /** Price-saturation point (price hits its ceiling here). Not a draw floor — retained for the decay-uptake band read. */
  minStock: number;
  /**
   * Days-of-supply anchor (price === basePrice). The produce throttle saturates at
   * holdCover × targetStock; the consume/satisfaction factor saturates at targetStock.
   */
  targetStock: number;
  /** Stock ceiling — storage clamp and the decay-uptake band. */
  maxStock: number;
  /** Per-good base production rate (undefined/0 = not a producer of this good). */
  productionRate?: number;
  /** Per-good base consumption rate (undefined/0 = not a consumer of this good). */
  consumptionRate?: number;
  /** Multiplier on production rate from events. Default 1.0. */
  productionMult?: number;
  /** Multiplier on consumption rate from events. Default 1.0. */
  consumptionMult?: number;
}

export interface EconomySimParams {
  /**
   * Operating-ceiling cover multiple on targetStock: the production ceiling
   * ramps from full rate at the anchor to 0 at holdCover × targetStock.
   * Passed in (not imported) so this module stays constant-free.
   */
  holdCover: number;
  /**
   * Comfort-knee cover fraction of targetStock: consumption and input draws
   * deliver in full at/above comfortCover × targetStock and ration on the
   * scarcity ramp below it. Passed in (not imported) — same rule as holdCover.
   */
  comfortCover: number;
}

/**
 * Self-limiting scale factor (sqrt curve). Returns 0 at the boundary and 1 at
 * the opposite extreme; sqrt keeps rates active through mid-range and only drops
 * sharply near the extremes.
 */
export function selfLimitingFactor(
  value: number,
  min: number,
  max: number,
  direction: "produce" | "consume",
): number {
  const range = max - min;
  if (range <= 0) return 0;
  const ratio =
    direction === "produce"
      ? (max - value) / range // production slows as stock approaches the ceiling
      : (value - min) / range; // consumption slows as stock approaches the floor
  return Math.sqrt(Math.max(0, Math.min(1, ratio)));
}

/**
 * Consumption/delivery factor ∈ [0,1] with a comfort knee. Full delivery (1)
 * while stock ≥ comfortStock; below the knee it ramps as √(stock / comfortStock)
 * — gentle just under the knee, brutal near empty — reaching 0 at stock = 0.
 * The same ramp rations civilian consumption and industrial input draws (the
 * shared scarcity ramp), so every drawer of a scarce good slows at one rate.
 * A non-positive comfortStock means the good has no meaningful comfort band:
 * any stock delivers freely, empty delivers nothing.
 */
export function consumptionFactor(stock: number, comfortStock: number): number {
  if (comfortStock <= 0) return stock > 0 ? 1 : 0;
  if (stock >= comfortStock) return 1;
  return Math.sqrt(Math.max(0, stock) / comfortStock);
}

/**
 * Production ceiling factor ∈ [0,1] with a knee at the anchor. Full rate (1)
 * while stock ≤ targetStock; ramps linearly to 0 across
 * [targetStock, holdCover × targetStock] — the deceleration zone that absorbs
 * shocks. A self-supplier with margin capacity rests just above the anchor, so
 * a healthy price sits near base.
 */
export function productionCeiling(stock: number, targetStock: number, holdCover: number): number {
  if (targetStock <= 0) return 0;
  const ceiling = targetStock * holdCover;
  if (stock <= targetStock) return 1;
  if (stock >= ceiling) return 0;
  return (ceiling - stock) / (ceiling - targetStock);
}

/**
 * Seller-side output uptake ∈ [0,1] — the produce-direction self-limiting factor.
 * 1 when stock sits at the floor (output sells freely), → 0 as stock pins against
 * the storage ceiling (overproduction, piling up). The mirror of the consume-side
 * satisfaction signal; the infrastructure-decay processor uses it to decide whether
 * a producer's built capacity is actually "used" (staffed AND selling).
 */
export function outputUptake(stock: number, minStock: number, maxStock: number): number {
  return selfLimitingFactor(stock, minStock, maxStock, "produce");
}

/**
 * Simulate one economy tick across all market entries. For each entry: producers
 * add stock at full rate to the anchor and decelerate linearly to zero at the
 * operating ceiling; consumers deliver in full at/above the comfort knee and ration
 * on the scarcity ramp below it, capped by available stock; stock clamps to [0, maxStock].
 * Returns a new array without mutating input.
 */
export function simulateEconomyTick(
  markets: MarketTickEntry[],
  params: EconomySimParams,
): MarketTickEntry[] {
  const { holdCover, comfortCover } = params;

  return markets.map((entry) => {
    let stock = entry.stock;
    const { maxStock, targetStock } = entry;

    const effectiveProduction = (entry.productionRate ?? 0) * (entry.productionMult ?? 1);
    if (effectiveProduction > 0) {
      stock += effectiveProduction * productionCeiling(stock, targetStock, holdCover);
    }

    const effectiveConsumption = (entry.consumptionRate ?? 0) * (entry.consumptionMult ?? 1);
    if (effectiveConsumption > 0) {
      const factor = consumptionFactor(stock, comfortCover * targetStock);
      stock -= Math.min(effectiveConsumption * factor, Math.max(0, stock));
    }

    stock = clamp(stock, 0, maxStock);

    return { ...entry, stock };
  });
}

// ── Tick entry builder ──────────────────────────────────────────

/**
 * Pre-resolved inputs for building a MarketTickEntry — the caller resolves its
 * own row shape into this common shape, and the builder handles the shared
 * computation (gov consumption boost).
 */
export interface TickEntryInput {
  goodId: string;
  stock: number;
  /** Stock floor for this market entry — resolved upstream from the pricing-band. */
  minStock: number;
  /**
   * Days-of-supply anchor (price === basePrice) — resolved upstream from the pricing-band.
   * The production throttle saturates at holdCover × targetStock (operating ceiling).
   */
  targetStock: number;
  /** Stock ceiling for this market entry — resolved upstream from the pricing-band. */
  maxStock: number;
  /** Base production rate from the substrate driver (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate from the substrate driver (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Government consumption boost for this good. */
  govConsumptionBoost: number;
  /** Production-only suppression multiplier (1 = none). Strike state from unrest. */
  productionSuppress?: number;
}

/**
 * Build a MarketTickEntry from pre-resolved inputs. Folds the government
 * consumption boost into the consumption rate. Callers spread event
 * productionMult/consumptionMult on top if present.
 */
export function buildMarketTickEntry(input: TickEntryInput): MarketTickEntry {
  const productionRate =
    input.baseProductionRate != null
      ? input.baseProductionRate * (input.productionSuppress ?? 1)
      : undefined;

  const consumptionRate =
    input.baseConsumptionRate != null
      ? input.baseConsumptionRate + input.govConsumptionBoost
      : undefined;

  return {
    goodId: input.goodId,
    stock: input.stock,
    minStock: input.minStock,
    targetStock: input.targetStock,
    maxStock: input.maxStock,
    productionRate,
    consumptionRate,
  };
}

// ── Ship arrival processing ─────────────────────────────────────

export interface InTransitShip {
  id: string;
  arrivalTick: number;
}

/**
 * Given a list of in-transit ships and the current tick,
 * returns the IDs of ships that have arrived (arrivalTick <= currentTick).
 * Pure function — no DB dependency.
 */
export function processShipArrivals(
  ships: InTransitShip[],
  currentTick: number,
): string[] {
  return ships
    .filter((ship) => ship.arrivalTick <= currentTick)
    .map((ship) => ship.id);
}
