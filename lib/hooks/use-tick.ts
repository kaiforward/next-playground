"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/query/fetcher";
import type { Speed, TickBroadcast } from "@/lib/world/tick-loop";
import type { GameWorldState } from "@/lib/types/game";
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

/** Narrows a parsed SSE frame before it's trusted as a TickBroadcast. */
function isTickBroadcast(value: unknown): value is TickBroadcast {
  return (
    typeof value === "object" &&
    value !== null &&
    "currentTick" in value &&
    typeof value.currentTick === "number" &&
    "speed" in value &&
    (typeof value.speed === "string" || typeof value.speed === "number") &&
    "achievedTps" in value &&
    typeof value.achievedTps === "number" &&
    "events" in value &&
    typeof value.events === "object" &&
    value.events !== null
  );
}

interface UseTickResult {
  currentTick: number;
  speed: Speed;
  achievedTps: number;
  isConnected: boolean;
  subscribeToEvent: SubscribeToEvent;
}

/**
 * Connects to the SSE tick stream. Returns current tick and
 * subscription mechanisms for tick events.
 *
 * Intended to be called once (in TickProvider) and shared via context.
 */
export function useTick(): UseTickResult {
  const [currentTick, setCurrentTick] = useState(0);
  const [speed, setSpeed] = useState<Speed>("paused");
  const [achievedTps, setAchievedTps] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const eventListeners = useRef<EventListeners>({
    economyTick: new Set(),
    eventNotifications: new Set(),
    shipArrived: new Set(),
  });

  // Seed tick/speed/TPS from world state so the sidebar is correct before the
  // SSE connection establishes. apiFetch types the response as GameWorldState,
  // so speed lands as a real `Speed` (no untyped `any` into setSpeed).
  useEffect(() => {
    apiFetch<GameWorldState>("/api/game/world")
      .then((state) => {
        setCurrentTick(state.meta.currentTick);
        setSpeed(state.speed);
        setAchievedTps(state.achievedTps);
      })
      .catch(() => {}); // SSE will provide the values shortly anyway
  }, []);

  useEffect(() => {
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

    const es = new EventSource("/api/game/tick-stream");

    es.onopen = () => setIsConnected(true);

    es.onmessage = (e) => {
      try {
        const parsed: unknown = JSON.parse(e.data);
        if (!isTickBroadcast(parsed)) return;
        const event = parsed;
        setCurrentTick(event.currentTick);
        setSpeed(event.speed);
        setAchievedTps(event.achievedTps);

        // Dispatch global events to listeners, one channel at a time.
        dispatch("economyTick", event.events.economyTick);
        dispatch("eventNotifications", event.events.eventNotifications);
        dispatch("shipArrived", event.events.shipArrived);
      } catch {
        // Ignore malformed messages
      }
    };

    es.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, []);

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

  return { currentTick, speed, achievedTps, isConnected, subscribeToEvent };
}
