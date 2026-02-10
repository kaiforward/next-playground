"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { TickEvent } from "@/lib/types/api";

type EventCallback = (events: unknown[]) => void;

interface UseTickResult {
  currentTick: number;
  isConnected: boolean;
  subscribeToEvent: (eventName: string, cb: EventCallback) => () => void;
  subscribeToArrivals: (cb: (shipIds: string[]) => void) => () => void;
}

/**
 * Connects to the SSE tick stream. Returns current tick and
 * subscription mechanisms for tick events.
 *
 * Intended to be called once (in TickProvider) and shared via context.
 */
export function useTick(): UseTickResult {
  const [currentTick, setCurrentTick] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const eventListeners = useRef<Map<string, Set<EventCallback>>>(new Map());

  // Seed currentTick from world state so transit indicators are correct
  // before the SSE connection establishes
  useEffect(() => {
    fetch("/api/game/world")
      .then((res) => res.json())
      .then((json) => {
        if (json.data?.currentTick) setCurrentTick(json.data.currentTick);
      })
      .catch(() => {}); // SSE will provide the value shortly anyway
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/game/tick-stream");

    es.onopen = () => setIsConnected(true);

    es.onmessage = (e) => {
      try {
        const event: TickEvent = JSON.parse(e.data);
        setCurrentTick(event.currentTick);

        // Dispatch global events to listeners
        for (const [eventName, eventList] of Object.entries(event.events)) {
          const listeners = eventListeners.current.get(eventName);
          if (listeners && eventList.length > 0) {
            for (const cb of listeners) cb(eventList);
          }
        }

        // Dispatch player-scoped events to listeners
        for (const [eventName, eventList] of Object.entries(
          event.playerEvents,
        )) {
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

  // Backward compat wrapper — subscribes to "shipArrived" events
  const subscribeToArrivals = useCallback(
    (cb: (shipIds: string[]) => void) => {
      return subscribeToEvent("shipArrived", (events) => {
        const shipIds = events.map(
          (e) => (e as { shipId: string }).shipId,
        );
        cb(shipIds);
      });
    },
    [subscribeToEvent],
  );

  return { currentTick, isConnected, subscribeToEvent, subscribeToArrivals };
}
