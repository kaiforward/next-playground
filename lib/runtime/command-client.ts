/**
 * The UI-side command dispatch seam (client-runtime build plan Task 8) — the "hook-reachable
 * dispatch seam" the task names as a judgment call to build if none exists yet. `client/main.tsx`
 * (Task 6) already posts `CommandEnvelope`s to the worker and logs rejected results inline; this
 * module is what a hook can reach WITHOUT importing the shell, so every mutation hook posts through
 * the same one path the shell wires to the real worker connection, and a test wires to a fake one.
 *
 * Deliberately NOT generic over `GameCommandType`: constructing a `GameCommandEnvelope` (the
 * worker's own discriminated union, `client/worker/game-worker.ts`) from a type parameter runs into
 * TypeScript's well-known "cannot assign a generic instantiation to a distributed union" gap —
 * closing it needs either an unchecked cast (against the "no `as`" convention) or restructuring the
 * worker's own protocol types (out of this task's file list). Every caller passes a CONCRETE literal
 * envelope (`{ id, type: "setSystemPin", payload }`), which has no such gap — TypeScript accepts a
 * literal object against a union directly. `sendCommand`'s own signature is correspondingly ordinary
 * (`GameCommandEnvelope in, GameCommandResultMessage out`); each domain hook file narrows the result
 * back to its own concrete data type via `narrowCommandResult` (`lib/types/guards.ts`) — the one
 * place this module's id-correlation (a runtime fact TS cannot see) becomes a type.
 */
import type {
  GameCommandEnvelope,
  GameCommandResultMessage,
} from "@/client/worker/game-worker";
import type { DevCommandEnvelope, DevCommandResultMessage } from "@/client/worker/dev-commands";

/** Every envelope this transport can carry — production commands plus dev-only ones (Task 13). Kept
 *  as a local union rather than widening `GameCommandEnvelope` itself: that type backs the
 *  production command registry (`game-worker.ts`'s `GameCommandMap`), and this module is the one
 *  seam BOTH production and dev hooks dispatch through. */
export type AnyCommandEnvelope = GameCommandEnvelope | DevCommandEnvelope;
export type AnyCommandResultMessage = GameCommandResultMessage | DevCommandResultMessage;

/** The narrow surface a command client needs from the worker connection — just "post one envelope".
 *  The shell's real implementation posts `{ type: "command", envelope }` to the worker; a test's
 *  fake implementation records envelopes and replies synchronously via `deliverCommandResult`. */
export interface CommandTransport {
  postCommand(envelope: AnyCommandEnvelope): void;
}

let transport: CommandTransport | null = null;

/**
 * Set once the worker connection is confirmed dead (`client/worker-connection.ts`'s
 * `markWorkerDead`, driven by `worker.onerror`/`onmessageerror`, spec §4). While true, every command
 * — in flight or newly sent — resolves with a rejection instead of ever reaching (or continuing to
 * wait on) a transport that will never answer; "commands issued while dead are rejected, never
 * queued silently" holds even though the worker itself cannot post a real reply once it's gone.
 */
let dead = false;

/** Wires the module to a real (or fake) transport — called once by `client/main.tsx` at boot, and
 *  by a test's setup before any hook under test dispatches a command. Also clears `dead`: supplying
 *  a transport is, by construction, supplying a live connection. */
export function configureCommandTransport(next: CommandTransport | null): void {
  transport = next;
  dead = false;
}

/** One resolver per envelope `id`, awaiting exactly that command's correlated result — `deliver`
 *  below is the only way one leaves this map, whether the worker actually answers or the transport
 *  was never configured (resolved immediately in that case, never left hanging). */
const pending = new Map<string, (message: AnyCommandResultMessage) => void>();

/** See `dead`'s own docstring. Resolves (never leaves hanging) every command currently awaiting a
 *  result, then latches so every future `sendCommand` call resolves the same way without posting. */
export function markTransportDead(): void {
  dead = true;
  for (const [id, resolve] of pending) {
    resolve({ type: "commandResult", id, result: { ok: false, error: "Worker connection lost." } });
  }
  pending.clear();
}

/** Feeds one incoming `commandResult` message to whichever `sendCommand` call is awaiting its `id` —
 *  called by `client/main.tsx`'s `worker.onmessage` handler (the shell) or directly by a test. A
 *  message whose `id` nothing is awaiting (already resolved, or never sent from this tab) is
 *  dropped rather than thrown on — the same "drop what nobody is holding" posture the store's own
 *  frame-versioning takes. */
export function deliverCommandResult(message: AnyCommandResultMessage): void {
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
}

/**
 * Posts one envelope and resolves with its correlated result message. Never rejects — a missing
 * transport (not yet configured, or a dead worker) resolves with a `commandResult` carrying
 * `{ ok: false, error }`, so a caller's `mutateAsync` always has one code path to await rather than
 * a try/catch around dispatch itself; the actual reject-on-failure surface is
 * `useCommandMutation`'s job (`lib/hooks/use-command-mutation.ts`), reading `result.ok`.
 */
export function sendCommand(envelope: AnyCommandEnvelope): Promise<AnyCommandResultMessage> {
  return new Promise((resolve) => {
    if (dead) {
      resolve({
        type: "commandResult",
        id: envelope.id,
        result: { ok: false, error: "Worker connection lost." },
      });
      return;
    }
    if (!transport) {
      resolve({
        type: "commandResult",
        id: envelope.id,
        result: { ok: false, error: "Command transport not configured." },
      });
      return;
    }
    pending.set(envelope.id, resolve);
    transport.postCommand(envelope);
  });
}
