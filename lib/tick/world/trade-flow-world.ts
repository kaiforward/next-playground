/**
 * TradeFlowWorld — data interface for the trade-flow processor.
 *
 * Adapters in `lib/tick/adapters/{prisma,memory}/trade-flow.ts` implement
 * this interface. Round-robin region selection and the gradient/budget math
 * live in the shared processor body (`runTradeFlowProcessor`).
 *
 * See `docs/design/active/trade-simulation.md` for the broader pattern.
 */

/** Region row for round-robin selection. */
export interface RegionView {
  id: string;
  name: string;
}

/**
 * One unique unordered edge within a region.
 *
 * Adapters dedupe the bidirectional SystemConnection rows by ordering the
 * endpoints (aSystemId < bSystemId) so the processor body sees each pair once.
 */
export interface EdgeView {
  aSystemId: string;
  bSystemId: string;
}

/**
 * Market snapshot for one (system, good) pair, with the per-good clamps
 * already resolved. The processor indexes these by composite key
 * (`${systemId}|${goodId}`).
 */
export interface MarketSnapshot {
  /** Adapter-owned identifier — round-trips into `MarketUpdate.id`. */
  id: string;
  systemId: string;
  goodId: string;
  basePrice: number;
  stock: number;
  /** Stored pricing-anchor multiplier (1 = none). */
  anchorMult: number;
  /** Days-of-supply pricing denominator (perCapitaNeed × population, floored). */
  demandRate: number;
  priceFloor: number;
  priceCeiling: number;
}

/** Absolute stock write (already clamped). */
export interface MarketUpdate {
  id: string;
  stock: number;
}

/** Increment to a system's tradeVolumeAccum (mirrors player-trade bookkeeping). */
export interface VolumeIncrement {
  systemId: string;
  amount: number;
}

/** One flow event — appended to TradeFlow. */
export interface FlowEventInsert {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}

export interface TradeFlowWorld {
  /** Regions, ordered alphabetically by name (round-robin source). */
  getRegions(): Promise<RegionView[]>;

  /** Unique unordered intra-region edges in the given region. */
  getEdgesForRegion(regionId: string): Promise<EdgeView[]>;

  /** Markets at every system in the region. */
  getMarketSnapshotsForRegion(regionId: string): Promise<MarketSnapshot[]>;

  /**
   * Approximate recent player trade volume in the region. Used to throttle
   * flow when players are providing trade pressure themselves.
   * Returns 0 when the data source is unavailable (sim baseline).
   */
  getRecentPlayerVolume(regionId: string): Promise<number>;

  /** Bulk-write market stock (absolute, already-clamped values). */
  applyMarketUpdates(updates: MarketUpdate[]): Promise<void>;

  /** Bulk-increment tradeVolumeAccum on systems. */
  applyVolumeIncrements(increments: VolumeIncrement[]): Promise<void>;

  /** Append flow events to TradeFlow. */
  appendFlowEvents(events: FlowEventInsert[]): Promise<void>;

  /** Delete TradeFlow rows with tick < beforeTick. */
  pruneFlowEvents(beforeTick: number): Promise<void>;
}

/** Per-tick params passed alongside the world. */
export interface TradeFlowProcessorParams {
  /** Process flow every N ticks (round-robin per region). */
  processEveryNTicks: number;
  /** Max units of one good moved per edge per processor run. */
  flowBudget: number;
  /** Price gradient threshold below which no flow occurs (fraction of basePrice). */
  gradientThreshold: number;
  /** Linear response of flow fraction to gradient. */
  gradientSensitivity: number;
  /** Retention window for flow events (in ticks). */
  flowHistoryTicks: number;
  /** Player activity fully displaces edge flow at this multiple of targetVolume. */
  playerDisplacementFactor: number;
  /** Per-region target trade volume used to normalize player pressure. */
  prosperityTargetVolume: number;
  /** Stock floor — flow can't draw a market below this. */
  minLevel: number;
  /** Stock ceiling — flow can't push a market above this. */
  maxLevel: number;
}
