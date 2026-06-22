/**
 * TradeFlowWorld — data interface for the trade-flow processor.
 *
 * Adapters in `lib/tick/adapters/{prisma,memory}/trade-flow.ts` implement
 * this interface. The flow topology is faction-bounded: an edge is "open"
 * iff both endpoints share a faction (with `null===null` letting adjacent
 * independent systems trade), regardless of region. Region lines no longer
 * gate flow. Scheduling is a fixed-interval edge shard — the processor body
 * processes `shardRange(totalEdges, tick, interval)` over the stable open-edge
 * order each tick, so a full sweep takes `interval` (= `ECONOMY_UPDATE_INTERVAL`)
 * ticks at any scale, bounded independently of faction size and on the same
 * clock as the economy shard.
 *
 * See `docs/active/gameplay/trade-simulation.md` for the broader pattern.
 */

/**
 * One unique unordered open edge (both endpoints share a faction).
 *
 * Adapters dedupe the bidirectional SystemConnection rows by ordering the
 * endpoints (aSystemId < bSystemId) so the processor body sees each pair once.
 * `fuelCost` is the distance source for attenuation.
 */
export interface EdgeView {
  aSystemId: string;
  bSystemId: string;
  fuelCost: number;
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
  storageCapacity: number;
}

/** Absolute stock write (already clamped). */
export interface MarketUpdate {
  id: string;
  stock: number;
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
  /** All open (same-faction; null===null for adjacent independents) deduped edges, stably ordered. */
  getOpenEdges(): Promise<EdgeView[]>;

  /** Markets at the given systems. */
  getMarketSnapshotsForSystems(systemIds: string[]): Promise<MarketSnapshot[]>;

  /** Recent player trade volume per system (0 when unavailable / sim baseline). */
  getRecentPlayerVolumeBySystem(systemIds: string[]): Promise<Map<string, number>>;

  /** Bulk-write market stock (absolute, already-clamped values). */
  applyMarketUpdates(updates: MarketUpdate[]): Promise<void>;

  /** Append flow events to TradeFlow. */
  appendFlowEvents(events: FlowEventInsert[]): Promise<void>;

  /** Delete TradeFlow rows with tick < beforeTick. */
  pruneFlowEvents(beforeTick: number): Promise<void>;
}

/** Per-tick params passed alongside the world. */
export interface TradeFlowProcessorParams {
  /** Ticks for the edge shard to sweep every open edge once (fixed gameplay cadence). */
  interval: number;
  /** Max units of one good moved per edge per processor run. */
  flowBudget: number;
  /** Price gradient threshold below which no flow occurs (fraction of basePrice). */
  gradientThreshold: number;
  /** Linear response of flow fraction to gradient. */
  gradientSensitivity: number;
  /** Retention window for flow events (in ticks). */
  flowHistoryTicks: number;
  /** Player activity fully displaces edge flow at this multiple of playerVolumeTarget. */
  playerDisplacementFactor: number;
  /** Per-system target trade volume used to normalize player pressure. */
  playerVolumeTarget: number;
  /** Distance attenuation: factor = 1/(1 + distanceDecay·fuelCost). 0 = no-op. */
  distanceDecay: number;
}
