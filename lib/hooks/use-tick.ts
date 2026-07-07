"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/query/fetcher";
import type { Speed, TickBroadcast } from "@/lib/world/tick-loop";
import type { GameWorldState } from "@/lib/types/game";

type EventCallback = (events: unknown[]) => void;

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
  subscribeToEvent: (eventName: string, cb: EventCallback) => () => void;
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
  const eventListeners = useRef<Map<string, Set<EventCallback>>>(new Map());

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

        // Dispatch global events to listeners
        for (const [eventName, eventList] of Object.entries(event.events)) {
          const listeners = eventListeners.current.get(eventName);
          if (listeners && eventList.length > 0) {
            for (const cb of listeners) cb(eventList);
          }
        }
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
    (eventName: string, cb: EventCallback) => {
      if (!eventListeners.current.has(eventName)) {
        eventListeners.current.set(eventName, new Set());
      }
      eventListeners.current.get(eventName)!.add(cb);
      return () => {
        eventListeners.current.get(eventName)?.delete(cb);
      };
    },
    [],
  );

  return { currentTick, speed, achievedTps, isConnected, subscribeToEvent };
}
