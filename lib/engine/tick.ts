/**
 * Economy simulation tick engine — single-stock model.
 *
 * Each market holds one `stock` value. Producers add stock at the full rate up to
 * the brake knee — the larger of "cycles of what this system uses" (the use
 * figure) and "cycles of what it makes" (working inventory) — then decelerate
 * linearly to zero at the ramp end (brakeRamp × knee). Consumers
 * deliver in full at and above the emergency ration threshold
 * (rationCover × demandRate), then ration below it. Stock is clamped to
 * [0, maxStock]. There is no mean-reversion and no `demand` axis — equilibrium
 * emerges spatially via directed logistics.
 * See docs/active/gameplay/economy.md (Per-Tick Simulation).
 *
 * No price-anchor quantity reaches the brake: the knee is denominated in the
 * use figure and the system's own output — never `targetStock`, never
 * `maxStock`, never `MIN_DEMAND`.
 *
 * All functions are pure — no DB or constant imports.
 */

export interface MarketTickEntry {
  goodId: string;
  stock: number;
  /**
   * THE USE FIGURE — what this system's population and industry draw when
   * running (staffing- and strike-gated, civilian at full rate). The brake
   * knee's warehousing denominator. Never the draw figure, never `demandRate`.
   */
  honestUseRate: number;
  /**
   * Reference-cycle production rate: un-catch-up-scaled, un-strike-suppressed,
   * un-event-multiplied. The brake knee's working-inventory denominator —
   * `productionRate` below is none of those things and must not be used here.
   */
  capacityProduction: number;
  /** Pricing-anchor multiplier from events (1 = none). Rides the knee's use term only. */
  anchorMult: number;
  /**
   * Total local draw-rate denominator used to express emergency stock in
   * demand cycles. Independent of pricing anchor shifts.
   */
  demandRate: number;
  /** Stock ceiling used by the storage clamp. */
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
   * Cycles of the use figure the knee's warehousing term covers
   * (BRAKE_USE_COVER). Passed in (not imported) so this module stays
   * constant-free.
   */
  brakeUseCover: number;
  /** Taper width: the ramp ends at brakeRamp × knee (BRAKE_RAMP). */
  brakeRamp: number;
  /** Cycles of reference-cycle capacity the working-inventory term covers (BRAKE_OUTPUT_COVER). */
  brakeOutputCover: number;
  /** Emergency-access cover in demand cycles. */
  rationCover: number;
}

/**
 * Consumption/delivery factor ∈ [0,1] with an emergency ration threshold.
 * Full delivery while stock ≥ rationStock; below it ramps as √(stock / rationStock)
 * — gentle just under the knee, brutal near empty — reaching 0 at stock = 0.
 * The same ramp rations civilian consumption and industrial input draws (the
 * shared scarcity ramp), so every drawer of a scarce good slows at one rate.
 * A non-positive rationStock means the good has no meaningful ration threshold:
 * any stock delivers freely, empty delivers nothing.
 */
export function consumptionFactor(stock: number, rationStock: number): number {
  if (rationStock <= 0) return stock > 0 ? 1 : 0;
  if (stock >= rationStock) return 1;
  return Math.sqrt(Math.max(0, stock) / rationStock);
}

/** Which term set a market's brake knee — the stage-gate evidence BRAKE_OUTPUT_COVER is tuned on. */
export type KneeBindingTerm = "use" | "output";

export interface BrakeKneeInput {
  /** THE USE FIGURE — never the draw figure, never a price-anchor quantity. */
  useRate: number;
  /** Reference-cycle rate: un-catch-up-scaled, un-strike-suppressed, un-event-multiplied. */
  capacityProduction: number;
  /** Event anchor multiplier (1 = none). Rides the use term only. */
  anchorMult: number;
}

export interface BrakeKnee {
  /** Stock level where full-rate production ends. */
  knee: number;
  /** Stock level where production reaches 0 — brakeRamp × knee. */
  rampEnd: number;
  /** Which of the two terms set the knee. Recorded at the knee, not observed after the taper. */
  bindingTerm: KneeBindingTerm;
}

/**
 * The production brake's knee for one producing market — the single definition
 * every call site (the coupled tick, the decay/selling signal, the Industry
 * readout, the draw figure's brake pass) derives its ceiling from.
 *
 *   knee    = max(brakeUseCover × useRate × anchorMult,   // cycles of what this system uses
 *                 brakeOutputCover × capacityProduction)  // cycles of what it makes
 *   rampEnd = brakeRamp × knee
 *
 * The output term answers the pure-exporter trap: a producer with negligible
 * local use still gets a working-inventory band instead of a zero knee. It uses
 * capacity, not realized output — realized contains the ceiling and a
 * self-referential denominator can latch shut.
 *
 * Deliberately NO physical-storage term: today's storage constants are a
 * maxStock depth model authored per producing building, ~2 orders of magnitude
 * below 40 cycles of system-wide draw (measured 16×–843× per good), so capping
 * the ramp with them hard-stopped production galaxy-wide. A brake-relevant
 * warehouse limit is a future design pass of its own — with this knee as the
 * capacity the autonomic build would build storage toward.
 */
export function brakeKnee(input: BrakeKneeInput, params: EconomySimParams): BrakeKnee {
  // A corrupt scalar must never silently erase a real need (the same polarity honest-demand's
  // `gate()` documents): a non-finite rate drops out of its own max() term rather than turning
  // the whole knee NaN and welding every market's brake shut, while a non-finite anchorMult reads
  // as unshifted (1) rather than as zero, which would erase the use term it multiplies.
  const useRate = Number.isFinite(input.useRate) ? Math.max(0, input.useRate) : 0;
  const capacityProduction = Number.isFinite(input.capacityProduction)
    ? Math.max(0, input.capacityProduction)
    : 0;
  const anchorMult = Number.isFinite(input.anchorMult) ? Math.max(0, input.anchorMult) : 1;
  const useTerm = params.brakeUseCover * useRate * anchorMult;
  const outputTerm = params.brakeOutputCover * capacityProduction;
  const knee = Math.max(useTerm, outputTerm);
  return {
    knee,
    rampEnd: params.brakeRamp * knee,
    bindingTerm: useTerm >= outputTerm ? "use" : "output",
  };
}

/**
 * Production ceiling factor ∈ [0,1] against the brake knee. Full rate (1) while
 * stock ≤ knee; linear taper to 0 over [knee, rampEnd].
 */
export function productionCeiling(stock: number, knee: BrakeKnee): number {
  if (stock <= knee.knee) return 1;
  if (stock >= knee.rampEnd) return 0;
  // Reaching here requires knee < stock < rampEnd, so the taper exists
  // (brakeRamp > 1, knee > 0) and its denominator is strictly positive.
  return (knee.rampEnd - stock) / (knee.rampEnd - knee.knee);
}

// ── Tick entry builder ──────────────────────────────────────────

/**
 * Pre-resolved inputs for building a MarketTickEntry — the caller resolves its
 * own row shape into this common shape, and the builder handles the shared
 * computation.
 */
export interface TickEntryInput {
  goodId: string;
  stock: number;
  /** THE USE FIGURE for this good at this system (see MarketTickEntry.honestUseRate). */
  honestUseRate: number;
  /** Reference-cycle production rate — pre-catchUp, pre-suppress, pre-event. */
  capacityProduction: number;
  /** Event anchor multiplier (1 = none). */
  anchorMult: number;
  /** Total local demand rate used to derive the ration threshold. */
  demandRate: number;
  /** Stock ceiling for this market entry — resolved upstream from the pricing-band. */
  maxStock: number;
  /** Base production rate from the substrate driver (undefined = not a producer). */
  baseProductionRate?: number;
  /** Base consumption rate from the substrate driver (undefined = not a consumer). */
  baseConsumptionRate?: number;
  /** Production-only suppression multiplier (1 = none). Strike state from unrest. */
  productionSuppress?: number;
}

/**
 * Build a MarketTickEntry from pre-resolved inputs. Callers spread event
 * productionMult/consumptionMult on top if present.
 */
export function buildMarketTickEntry(input: TickEntryInput): MarketTickEntry {
  const productionRate =
    input.baseProductionRate != null
      ? input.baseProductionRate * (input.productionSuppress ?? 1)
      : undefined;

  const consumptionRate = input.baseConsumptionRate;

  return {
    goodId: input.goodId,
    stock: input.stock,
    honestUseRate: input.honestUseRate,
    capacityProduction: input.capacityProduction,
    anchorMult: input.anchorMult,
    demandRate: input.demandRate,
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
