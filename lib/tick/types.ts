import type { Prisma } from "@/app/generated/prisma/client";
import type { EventTypeId } from "@/lib/constants/events";
import type { HazardIncidentEntry, ImportDutyEntry, ContrabandSeizedEntry, CargoLossEntry } from "@/lib/engine/danger";
import type { DamageResult } from "@/lib/engine/damage";

/** Transaction client type — Prisma's official type for `$transaction` callback parameter. */
export type TxClient = Prisma.TransactionClient;

// ── Typed tick event payloads ─────────────────────────────────────

export interface ShipArrivedPayload {
  shipId: string;
  shipName: string;
  systemId: string;
  destName: string;
  playerId: string;
  hazardIncidents?: HazardIncidentEntry[];
  importDuties?: ImportDutyEntry[];
  contrabandSeized?: ContrabandSeizedEntry[];
  cargoLost?: CargoLossEntry[];
  damageResult?: DamageResult;
}

export interface CargoLostPayload {
  shipId: string;
  systemId: string;
  losses: CargoLossEntry[];
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
}

export interface PlayerEventMap {
  shipArrived: ShipArrivedPayload[];
  cargoLost: CargoLostPayload[];
}

// ── Processor types ───────────────────────────────────────────────

/** Context passed to each processor. */
export interface TickContext {
  /** Prisma transaction client for DB operations. */
  tx: TxClient;
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
}

/** Result returned by each processor. */
export interface TickProcessorResult {
  /** Global events — broadcast to every connected client. */
  globalEvents?: Partial<GlobalEventMap>;
  /** Player-scoped events — only sent to the relevant player's SSE stream. */
  playerEvents?: Map<string, Partial<PlayerEventMap>>;
  /** Transient cross-processor signals (economy → population). Not broadcast. */
  economySignals?: EconomySignals;
}

/** A tick processor — one per game system. */
export interface TickProcessor {
  /** Unique name, used as key in results map and dependency references. */
  name: string;
  /** Run every N ticks. Default: 1 (every tick). */
  frequency?: number;
  /** Phase offset — staggers processors that share a frequency.
   *  Runs when: (tick - offset) % frequency === 0. Default: 0. */
  offset?: number;
  /** Names of processors that must complete before this one runs. */
  dependsOn?: string[];
  /** The processing function. */
  process(ctx: TickContext): Promise<TickProcessorResult>;
}

/** The full event payload emitted by the engine (raw — includes all players' events). */
export interface TickEventRaw {
  currentTick: number;
  tickRate: number;
  /** Merged global events from all processors. */
  events: Partial<GlobalEventMap>;
  /** Player-scoped events keyed by playerId (engine emits all; SSE route filters). */
  playerEvents: Map<string, Partial<PlayerEventMap>>;
  /** Which processors ran this tick (dev/debug only). */
  processors?: string[];
}
