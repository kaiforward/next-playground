import type { GlobalEventMap, PlayerEventMap } from "./types";

// ── Main thread → Worker messages ────────────────────────────────

interface RunTickMessage {
  type: "run-tick";
  tick: number;
  previousTick: number;
}

interface ShutdownMessage {
  type: "shutdown";
}

export type MainToWorker = RunTickMessage | ShutdownMessage;

// ── Worker → Main thread messages ────────────────────────────────

interface ReadyMessage {
  type: "ready";
}

interface TickResultMessage {
  type: "tick-result";
  tick: number;
  globalEvents: Partial<GlobalEventMap>;
  /** Serialized as [string, Partial<PlayerEventMap>][] — Map doesn't survive structured clone in all envs */
  playerEvents: Array<[string, Partial<PlayerEventMap>]>;
  timings: Array<[string, number]>;
  processors: string[];
}

interface TickSkippedMessage {
  type: "tick-skipped";
  tick: number;
  reason: string;
}

interface TickErrorMessage {
  type: "tick-error";
  tick: number;
  error: string;
}

export type WorkerToMain =
  | ReadyMessage
  | TickResultMessage
  | TickSkippedMessage
  | TickErrorMessage;
