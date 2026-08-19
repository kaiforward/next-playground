/**
 * The worker↔UI message vocabulary (spec §1, §2, §4, §6) — the pacing frame's shape, the tick-failure
 * notification, the command envelope/result pair commands ride, and the boot configuration the worker
 * entry resolves before dynamically importing the engine/constants graph. Node-portable: no `fs`, no
 * static `process.env` read, no DOM/worker globals — only types and the one re-exported alias.
 */
import type { TickBroadcast } from "@/lib/world/tick-loop";

/**
 * The pacing frame — tick number, speed, achieved tps, and this tick's event NOTIFICATIONS (a
 * `Partial<GlobalEventMap>`, never the per-tick list of active events itself). Identical to today's
 * `TickBroadcast` (`lib/world/tick-loop.ts:23-28`); aliased rather than redefined so the worker
 * boundary and the in-process broadcaster can never drift. Carries no world state — it never has.
 */
export type PacingFrame = TickBroadcast;

/** Posted when a tick throws — the loop hard-pauses (as it does today) and this carries why, so the
 *  UI can show the cause instead of a silent stop (spec §4). */
export interface TickFailedMsg {
  error: string;
}

/**
 * One command posted to the worker — a build/colony order, a treasury policy write, a speed change,
 * a pin, a settings flag, save/load, or a dev cheat. `id` is the correlation key a result is matched
 * back to (Task 5); `type` and `payload` are left generic here rather than widened into one big union
 * — the command registry that enumerates every concrete `type`/`payload` pairing is a later task's
 * interface, not this one's.
 */
export interface CommandEnvelope<TType extends string, TPayload> {
  id: string;
  type: TType;
  payload: TPayload;
}

/**
 * A command's asynchronous answer — the same discriminated-union shape the mutation services already
 * return (`lib/services/construction-orders.ts` etc.), carried back over the channel instead of an
 * HTTP response body.
 */
export type CommandResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Boot configuration the worker entry resolves first, before the dynamic import that evaluates the
 * engine/constants graph — `ECONOMY_SCALE` and the two debug flags are read at module-evaluation time
 * by ~10 constant tables (spec §6), so nothing that imports them may run before this is resolved.
 * `resolveHostConfig` (Task 4) is what produces one; this task only names the shape it produces.
 */
export interface BootConfig {
  /** Positive, finite — see `toEconomyScale` (`lib/constants/economy-scale.ts`). Default 100. */
  economyScale: number;
  debugEconomy: boolean;
  debugEvents: boolean;
}
