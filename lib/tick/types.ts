import type { PrismaClient } from "@/app/generated/prisma/client";

/** Transaction client type — works for both shared and independent transactions. */
export type TxClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

/** Context passed to each processor. */
export interface TickContext {
  /** Prisma transaction client for DB operations. */
  tx: TxClient;
  /** The new tick number being processed. */
  tick: number;
  /** Results from processors that have already completed (keyed by processor name). */
  results: Map<string, TickProcessorResult>;
}

/** Result returned by each processor. */
export interface TickProcessorResult {
  /** Global events — broadcast to every connected client. */
  globalEvents?: Record<string, unknown[]>;
  /** Player-scoped events — only sent to the relevant player's SSE stream. */
  playerEvents?: Map<string, Record<string, unknown[]>>;
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
  events: Record<string, unknown[]>;
  /** Player-scoped events keyed by playerId (engine emits all; SSE route filters). */
  playerEvents: Map<string, Record<string, unknown[]>>;
  /** Which processors ran this tick (dev/debug only). */
  processors?: string[];
}
