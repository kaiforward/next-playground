"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { TickEvent } from "@/lib/types/api";

interface UseTickResult {
  currentTick: number;
  isConnected: boolean;
  subscribeToArrivals: (cb: (shipIds: string[]) => void) => () => void;
}

/**
 * Connects to the SSE tick stream. Returns current tick and
 * a subscription mechanism for ship arrivals.
 *
 * Intended to be called once (in TickProvider) and shared via context.
 */
export function useTick(): UseTickResult {
  const [currentTick, setCurrentTick] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const arrivalListeners = useRef<Set<(shipIds: string[]) => void>>(new Set());

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

        if (event.arrivedShipIds.length > 0) {
          for (const cb of arrivalListeners.current) {
            cb(event.arrivedShipIds);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      // EventSource auto-reconnects — no manual retry needed
    };

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, []);

  const subscribeToArrivals = useCallback(
    (cb: (shipIds: string[]) => void) => {
      arrivalListeners.current.add(cb);
      return () => {
        arrivalListeners.current.delete(cb);
      };
    },
    [],
  );

  return { currentTick, isConnected, subscribeToArrivals };
}
