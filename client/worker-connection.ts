/**
 * The main-thread side of the worker channel (client-runtime build plan Task 11, spec §4, §5) —
 * everything `client/main.tsx`'s `worker.onmessage`/`onerror`/`onmessageerror` handlers delegate to.
 * Pulled out of `main.tsx` on purpose: that module constructs a real `Worker` and posts messages the
 * instant it is imported (`new Worker(...)`, `post({ type: "boot", ... })` at module scope), so it
 * cannot be imported from a test without side effects. Every function here is pure over its inputs
 * (a `GameStore`, a message, a fake "send" function) — no `Worker`, no `self`, no DOM required — so a
 * test drives the exact liveness/failure transitions a real worker triggers without one.
 *
 * Liveness driving (spec §4): `worker.onerror`/`onmessageerror` → dead (`markWorkerDead`); a
 * `tickFailed` message → paused + cause (`applyOutboundMessage`, via `store.setTickFailed`); a state
 * frame's `worldVersion` → no-world (`0`, the worker's own no-engine sentinel,
 * `client/worker/game-worker.ts`'s `noWorldStateFrame`) or live — but never live while a tick-failure
 * pause is standing (see `applyOutboundMessage`'s own docstring for why the ordering of a failed
 * tick's own three posted messages makes that guard necessary).
 */
import { deliverCommandResult, markTransportDead } from "@/lib/runtime/command-client";
import type { GameStore } from "@/lib/store/game-store";
import type { OutboundMessage, GameCommandEnvelope, GameCommandResultMessage } from "./worker/game-worker";

/**
 * Feeds one message posted by the worker into the store — the shared body behind `main.tsx`'s
 * `worker.onmessage`. `pacing` and `commandResult` apply exactly as Task 6/8 already wired them;
 * `tickFailed` and `state` are this task's additions.
 *
 * The `state` case's liveness derivation reads the STORE's own `worldVersion` AFTER
 * `applyStateFrame` has run, never the raw incoming `message.frame.worldVersion` — two reasons,
 * both real:
 *
 * 1. A stale in-flight frame from a world `GameStore.beginWorldReplacement()` is discarding
 *    (`lib/store/game-store.ts`'s `replacementFloor`) still carries its OWN real `worldVersion` on
 *    the wire, but `applyStateFrame` drops it. Deriving liveness off the message itself would flip
 *    liveness back to `"live"` for a frame the store just refused — resurrecting the outgoing
 *    world's liveness during the very swap window the reset exists to keep clean. Deriving off the
 *    store's post-apply `worldVersion` instead means a dropped frame changes nothing, because
 *    nothing in the store changed.
 * 2. It deliberately does NOT set `"live"` when liveness is already `"paused"`: a failing tick's
 *    broadcast posts `pacing`, then `tickFailed`, then `state` (in that order, `game-worker.ts`'s
 *    `pushPacingFrame`/`pushStateFrame`) — three separate `postMessage` calls, each its own task on
 *    the main thread. By the time the `state` message's task runs, the `tickFailed` message already
 *    flipped liveness to `"paused"` one task earlier; a handler that set `"live"` unconditionally on
 *    `worldVersion > 0` would immediately undo that pause. `"dead"` is likewise never overwritten by
 *    an ordinary frame — nothing should still be listening on a dead worker's channel, but the guard
 *    costs nothing and stays honest if that ever changes.
 */
export function applyOutboundMessage(store: GameStore, message: OutboundMessage): void {
  switch (message.type) {
    case "pacing":
      store.applyPacingFrame(message.frame);
      return;
    case "state": {
      store.applyStateFrame(message.frame);
      const { worldVersion, liveness } = store.getSnapshot();
      if (worldVersion === 0) {
        store.setLiveness("no-world");
      } else if (worldVersion !== null && liveness !== "paused" && liveness !== "dead") {
        store.setLiveness("live");
      }
      return;
    }
    case "tickFailed":
      store.setTickFailed(message.msg.error);
      return;
    case "autosaveResult":
      // Build plan Task 12: the in-game (60 s cadence / on-pause) autosave now surfaces its own
      // failures the same way `handlePageHideSave` below already does for the pagehide save — via
      // the store, which `LivenessBanner` reads, never only `console.error` (`TickLoop.autosave`).
      store.setAutosaveFailure(message.error);
      return;
    case "commandResult":
      // `useCommandMutation`'s `mutate()` (`lib/hooks/use-command-mutation.ts`) already logs a
      // rejection when its caller gave no `onError`, and every `mutateAsync` caller this task adds
      // (start-screen, create-faction-form) awaits it in a try/catch that renders the error. This
      // log is the net underneath both: kept from the Task 6 stand-in (not trimmed) because a
      // command dispatched from anywhere that skips both of those still must not vanish silently —
      // spec §2's "a rejected command is never silently queued" has no other backstop at this layer.
      if (!message.result.ok) {
        console.error("[shell] command rejected:", message.id, message.result.error);
      }
      deliverCommandResult(message);
      return;
  }
}

/**
 * The dead-worker driver (spec §4) — called from `worker.onerror`/`onmessageerror`. Flips liveness
 * to `"dead"` and rejects every in-flight command plus every command sent from now on
 * (`markTransportDead`, `lib/runtime/command-client.ts`) so "commands issued while dead are
 * rejected, never queued silently" holds without a real worker termination event to observe.
 */
export function markWorkerDead(store: GameStore): void {
  store.setLiveness("dead");
  markTransportDead();
}

/**
 * The `pagehide` save driver (spec §5, §11) — fires an autosave command in the web packaging so a
 * refresh or tab close doesn't discard up to 60 s of play (`whenAutosaveSettled()`'s job on desktop,
 * which has no browser analogue). Fire-and-log by construction: `pagehide` gives no reliable window
 * to await a result before the page actually unloads, so this never blocks navigation — it only
 * updates the store for whichever continuation the browser lets run. Honest about what exists today:
 * the web save backend is Task 12's job, so this command's dynamic import of the Node file backend
 * fails in-browser by design — that failure IS the autosave-failure path `LivenessBanner` renders,
 * not a bug to work around here.
 *
 * No-ops when no world exists (`liveness === "no-world"` or `"dead"`) — closing the tab from the
 * start screen, or after the worker has already died, has nothing to save and must not manufacture a
 * spurious "autosave failed" banner out of a command that was never going to succeed.
 */
export function handlePageHideSave(
  store: GameStore,
  send: (envelope: GameCommandEnvelope) => Promise<GameCommandResultMessage>,
  autosaveName: string,
): void {
  const { liveness } = store.getSnapshot();
  if (liveness === "no-world" || liveness === "dead") return;

  const id = crypto.randomUUID();
  void send({ id, type: "saveGame", payload: { name: autosaveName } }).then((message) => {
    store.setAutosaveFailure(message.result.ok ? null : message.result.error);
  });
}
