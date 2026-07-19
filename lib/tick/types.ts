import type { EventTypeId } from "@/lib/constants/events";

// ── Typed tick event payloads ─────────────────────────────────────

/** Ships are ownerless in Phase 2 (no `Player` entity) — see `WorldShip`'s doc comment. */
export interface ShipArrivedPayload {
  shipId: string;
  shipName: string;
  systemId: string;
  destName: string;
}

export interface EconomyTickPayload {
  /** Number of systems processed in this tick's shard. */
  systemCount: number;
  /** This tick's shard group index (`tick % shardCount`). */
  shardIndex: number;
  /** Total shards in one full economy refresh cycle (= the update interval). */
  shardCount: number;
}

export interface EventNotificationPayload {
  message: string;
  type: EventTypeId;
  refs: Record<string, { id: string; label: string }>;
}

// ── Typed event maps ──────────────────────────────────────────────

export interface GlobalEventMap {
  economyTick: EconomyTickPayload[];
  eventNotifications: EventNotificationPayload[];
  shipArrived: ShipArrivedPayload[];
}

// ── Processor types ───────────────────────────────────────────────

/** Context passed to each processor. */
export interface TickContext {
  /** The new tick number being processed. */
  tick: number;
  /** Results from processors that have already completed (keyed by processor name). */
  results: Map<string, TickProcessorResult>;
}

/**
 * Transient economy-to-population signal threaded in-memory via `ctx.results`.
 * Measures per-system demand-weighted satisfaction from post-tick stock.
 * Not broadcast, not persisted.
 */
export interface EconomySignals {
  /** Per-system convex demand-weighted dissatisfaction D ∈ [0,1], for systems processed this tick. */
  dissatisfactionBySystem: Map<string, number>;
  /**
   * Per-system, per-produced-good output uptake ∈ [0,1] (1 = selling freely, 0 =
   * piling up at the storage ceiling). Seller-side mirror of satisfaction; consumed
   * by the infrastructure-decay processor. Empty inner map ⇒ system produces nothing.
   */
  outputUptakeBySystem: Map<string, Map<string, number>>;
  /** Per-system, per-good physical output actually produced this pulse (post
   *  input-gate and operating-ceiling) — the production-tax base. Absent system ⇒ produced nothing. */
  realizedProductionBySystem: Map<string, Map<string, number>>;
}

/** Result returned by each processor. */
export interface TickProcessorResult {
  /** Global events — broadcast to every connected client. */
  globalEvents?: Partial<GlobalEventMap>;
  /** Transient cross-processor signals (economy → population). Not broadcast. */
  economySignals?: EconomySignals;
}

/** The full payload one tick's run hands to the broadcast layer. */
export interface TickBroadcastRaw {
  currentTick: number;
  /** Merged global events from all processors. */
  events: Partial<GlobalEventMap>;
  /** Which processors ran this tick (dev/debug only). */
  processors?: string[];
}
