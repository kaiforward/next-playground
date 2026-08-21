"use client";

import { useEffect, useRef, useCallback } from "react";
import { useGameSlice } from "@/lib/store/use-game-store";
import type { Speed } from "@/lib/world/tick-loop";
import type { GlobalEventMap } from "@/lib/tick/types";

/**
 * Subscribes to one broadcast channel for as long as the returned unsubscribe is uncalled.
 * The channel name is a checked key of `GlobalEventMap` — a mistyped one fails the build instead
 * of silently subscribing to a channel that never fires — and the callback receives that channel's
 * own payload type, so a consumer never re-narrows what the frame guard already established.
 */
export type SubscribeToEvent = <K extends keyof GlobalEventMap>(
  eventName: K,
  cb: (events: GlobalEventMap[K]) => void,
) => () => void;

/** One listener set per broadcast channel. Every channel is present rather than optional, so a
 *  channel added to `GlobalEventMap` fails the registry initialiser below until it is added there —
 *  which is where its dispatch call sits too. */
type EventListeners = {
  [K in keyof GlobalEventMap]: Set<(events: GlobalEventMap[K]) => void>;
};

interface UseTickResult {
  currentTick: number;
  speed: Speed;
  achievedTps: number;
  isConnected: boolean;
  subscribeToEvent: SubscribeToEvent;
}

/**
 * Reads pacing state (tick/speed/achievedTps) from the store's `pacing` field, fed by the worker's
 * `PacingFrame`s (client-runtime spec §1, §4) — the SSE stream and its REST seeding effect are both
 * gone; the worker's subscribe handshake replies with a full pacing frame immediately, so there is
 * nothing left to seed ahead of a first broadcast (`buildStateFrame`'s "not yet observed" case is
 * simply `pacing === null`, read as the pre-tick defaults below).
 *
 * `subscribeToEvent`'s dispatch registry is preserved verbatim (the events processor and any future
 * channel subscriber all still call it the same way) — it now fires off the store's own pacing
 * updates rather than an `EventSource.onmessage`: an effect watches
 * `pacing` by reference and dispatches once per NEWLY-applied frame (the store only ever hands out a
 * new `pacing` object when `applyPacingFrame` actually changed something, `lib/store/game-store.ts`),
 * so a re-render that doesn't correspond to a new frame dispatches nothing — the same "no
 * edge-counting consumer" cadence the old broadcast throttle guaranteed.
 *
 * `isConnected` used to mean "the SSE connection is open" — no component reads it today (grep,
 * 2026-08-20), so rather than build out Task 11's full worker-liveness state machine early, this
 * reads the narrowest thing that keeps the field meaningful: whether the store has observed at
 * least one pacing frame from the worker at all. Judgment call, named in the PR description.
 */
export function useTick(): UseTickResult {
  const pacing = useGameSlice((state) => state.pacing);
  const eventListeners = useRef<EventListeners>({
    economyTick: new Set(),
    eventNotifications: new Set(),
  });
  const lastDispatched = useRef<typeof pacing>(null);

  useEffect(() => {
    if (!pacing || pacing === lastDispatched.current) return;
    lastDispatched.current = pacing;

    /** Hands one channel's payload to that channel's listeners. Generic per call, because the
     *  payload type is only known channel by channel — a loop over the frame's entries would put
     *  every channel back on one erased type, which is what the callers would then have to undo. */
    const dispatch = <K extends keyof GlobalEventMap>(
      eventName: K,
      events: GlobalEventMap[K] | undefined,
    ) => {
      if (!events || events.length === 0) return;
      for (const cb of eventListeners.current[eventName]) cb(events);
    };

    dispatch("economyTick", pacing.events.economyTick);
    dispatch("eventNotifications", pacing.events.eventNotifications);
  }, [pacing]);

  const subscribeToEvent = useCallback(
    <K extends keyof GlobalEventMap>(eventName: K, cb: (events: GlobalEventMap[K]) => void) => {
      const listeners = eventListeners.current[eventName];
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    [],
  );

  return {
    currentTick: pacing?.currentTick ?? 0,
    speed: pacing?.speed ?? "paused",
    achievedTps: pacing?.achievedTps ?? 0,
    isConnected: pacing !== null,
    subscribeToEvent,
  };
}
