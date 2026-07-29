import type { EventTypeId } from "@/lib/constants/events";
import type { SupplyState } from "@/lib/engine/population";

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
 * Measures per-system necessity-weighted satisfaction from post-tick stock.
 * Not broadcast, not persisted.
 */
export interface EconomySignals {
  /** Per-system convex necessity-weighted dissatisfaction D ∈ [0,1], for systems processed this tick. */
  dissatisfactionBySystem: Map<string, number>;
  /** Per-system supplied/rationing/shortage reading of this pulse's consumption satisfaction, with
   *  the survival-good shortfall bit the unrest slope reads. */
  supplyStateBySystem: Map<string, SupplyState>;
  /**
   * Per-system, per-produced-good isolated selling factor ∈ [0,1] (1 = selling
   * freely, 0 = stock at the production ceiling). Consumed by infrastructure
   * decay; an empty inner map means the system produces nothing.
   */
  sellingFactorBySystem: Map<string, Map<string, number>>;
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
  /** Work actually performed this pulse per faction (directed-build: construction
   *  points absorbed; directed-logistics: work-budget consumed). Transient input
   *  to the treasury settlement — not broadcast, not persisted. */
  workPerformedByFaction?: Map<string, number>;
  /** New autonomic production-good build levels committed this pulse (directed-build), by
   *  good id. Counts proposal levels, not the final funded queue. Calibration instrumentation
   *  only — surfaced via `runWorldTick().instrumentation`, never broadcast or persisted. */
  buildCommitmentsByGood?: Map<string, number>;
  /** People moved this monthly pulse (colonist delivery + edge diffusion), conserved flows only.
   *  Calibration instrumentation — surfaced via runWorldTick().instrumentation, never broadcast. */
  migrationMoved?: { colonists: number; diffusion: number };
}

/** Transient, calibration-only signals a tick produced — never broadcast (`TickBroadcastRaw`)
 *  or folded into `World`. The calibration harness is the only reader. Derived from the processor
 *  result so the shared field can't drift. */
export type TickInstrumentation =
  Pick<TickProcessorResult, "buildCommitmentsByGood" | "migrationMoved">;

/** The full payload one tick's run hands to the broadcast layer. */
export interface TickBroadcastRaw {
  currentTick: number;
  /** Merged global events from all processors. */
  events: Partial<GlobalEventMap>;
  /** Which processors ran this tick (dev/debug only). */
  processors?: string[];
}
