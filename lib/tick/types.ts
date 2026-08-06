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
  /** Per-system supplied/rationing/shortage reading of this cycle's consumption satisfaction, with
   *  the survival-good shortfall bit the unrest slope reads. */
  supplyStateBySystem: Map<string, SupplyState>;
  /**
   * Per-system, per-produced-good isolated selling factor ∈ [0,1] (1 = selling
   * freely, 0 = stock at the production ceiling). Consumed by infrastructure
   * decay; an empty inner map means the system produces nothing.
   */
  sellingFactorBySystem: Map<string, Map<string, number>>;
  /** Per-system, per-good physical output actually produced this cycle (post
   *  input-gate and operating-ceiling) — the production-tax base. Absent system ⇒ produced nothing. */
  realizedProductionBySystem: Map<string, Map<string, number>>;
  /**
   * Per-system strike × maintenance production scalar ∈ (0,1] this cycle applied. Emitted rather
   * than recomputed downstream: the strike params and the treasury-fed maintenance malus reach
   * only this processor, and a recompute at population time would read the just-written unrest.
   * Absent system ⇒ 1.
   */
  productionSuppressBySystem: Map<string, number>;
}

/** Result returned by each processor. */
export interface TickProcessorResult {
  /** Global events — broadcast to every connected client. */
  globalEvents?: Partial<GlobalEventMap>;
  /** Transient cross-processor signals (economy → population). Not broadcast. */
  economySignals?: EconomySignals;
  /** Work actually performed this cycle per faction (directed-build: construction
   *  points absorbed; directed-logistics: work-budget consumed). Transient input
   *  to the treasury settlement — not broadcast, not persisted. */
  workPerformedByFaction?: Map<string, number>;
  /** Money directed build committed to colony founding this cycle per faction — charter fees and
   *  staged materials, already valued through the founding seam. A settlement INPUT, not
   *  instrumentation: the treasury processor accrues it into `pendingFounding` and charges it off the
   *  top at the next settlement. */
  foundingDebitsByFaction?: Map<string, number>;
  /** New autonomic production-good build levels committed this cycle (directed-build), by
   *  good id. Counts proposal levels, not the final funded queue. Calibration instrumentation
   *  only — surfaced via `runWorldTick().instrumentation`, never broadcast or persisted. */
  buildCommitmentsByGood?: Map<string, number>;
  /** People moved this cycle start (colonist delivery + edge diffusion), conserved flows only.
   *  Calibration instrumentation — surfaced via runWorldTick().instrumentation, never broadcast. */
  migrationMoved?: { colonists: number; diffusion: number };
  /** Founding materials staged this cycle, one entry per draw a colony made on its founder.
   *  Calibration instrumentation — the cost side of colonisation, invisible to any galaxy-wide
   *  average because foundings are rare. */
  foundingManifests?: FoundingStagingEvent[];
  /** Per-faction haul-budget ledger for this cycle's directed-logistics resolution.
   *  Faction-owned systems only — the independent (null-faction) group hauls but is not
   *  ledgered, matching `workPerformedByFaction`. Calibration instrumentation — surfaced via
   *  `runWorldTick().instrumentation`, never broadcast or persisted. */
  logisticsBudget?: Map<string, LogisticsBudgetLedger>;
}

/**
 * One colony's materials draw on its founder in a single cycle: what left the founder's warehouses,
 * which goods it came out of, what the faction paid for it, and how much cover the founder was left
 * holding on the good that draw bound hardest.
 *
 * One event per DRAW, not per colony: a manifest is staged in slices over the whole establish, so a
 * colony contributes as many events as it had funded cycles, and a founder supplying two colonies in
 * one cycle emits one event each. `founderCover` is computed by the processor as it stages, because
 * post-tick reconstruction reads the founder after every draw and cannot tell those two apart.
 */
export interface FoundingStagingEvent {
  /** The colony the goods are staged for — still `controlled` until the establish completes. */
  systemId: string;
  /** The developed system the goods left. */
  sourceSystemId: string;
  /** Total quantity staged by this draw, across its goods. */
  tonnage: number;
  goodIds: string[];
  /** What the faction paid for this draw through the founding valuation seam (charter excluded). */
  moneyCost: number;
  /** The founder's post-draw stock ÷ donor floor, minimum across the goods this draw moved. Below 1
   *  means the draw left the founder under the floor it keeps for itself. Absent when nothing was
   *  measurable — no good this draw moved carries a positive donor floor — because "could not
   *  measure" and "drained to nothing" are opposite readings and must never share a value. */
  founderCover?: number;
}

/** One faction's haul-budget ledger for a single directed-logistics resolution: the budget
 *  granted (post catch-up and funding), the transfer cost it actually paid, and how many
 *  deficits were recorded funding-bound. Shared by the processor that builds it and the
 *  result field that carries it, so the two cannot drift. */
export interface LogisticsBudgetLedger {
  total: number;
  spent: number;
  fundingBoundCount: number;
}

/** Transient, calibration-only signals a tick produced — never broadcast (`TickBroadcastRaw`)
 *  or folded into `World`. The calibration harness is the only reader. Derived from the processor
 *  result so the shared field can't drift. */
export type TickInstrumentation = Pick<
  TickProcessorResult,
  "buildCommitmentsByGood" | "migrationMoved" | "foundingManifests" | "logisticsBudget"
>;

/** The full payload one tick's run hands to the broadcast layer. */
export interface TickBroadcastRaw {
  currentTick: number;
  /** Merged global events from all processors. */
  events: Partial<GlobalEventMap>;
  /** Which processors ran this tick (dev/debug only). */
  processors?: string[];
}
