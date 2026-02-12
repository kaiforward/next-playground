"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import type { GameNotification, EntityRef } from "@/lib/types/game";

const MAX_HISTORY = 100;

interface EventHistoryContextValue {
  /** Full ring buffer, newest first. */
  notifications: GameNotification[];
  /** Subscribe to new notifications. Returns unsubscribe fn. */
  subscribe: (cb: (n: GameNotification) => void) => () => void;
}

const EventHistoryContext = createContext<EventHistoryContextValue | null>(null);

let nextSeqId = 0;

/** Raw shape coming from SSE (event notifications channel). */
interface RawNotification {
  message: string;
  type: string;
  refs?: Partial<Record<string, EntityRef>>;
}

function normalize(raw: RawNotification): GameNotification {
  return {
    id: nextSeqId++,
    message: raw.message,
    type: raw.type,
    refs: raw.refs ?? {},
    receivedAt: Date.now(),
  };
}

export function EventHistoryProvider({ children }: { children: React.ReactNode }) {
  const { subscribeToEvent } = useTickContext();
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const subscribersRef = useRef<Set<(n: GameNotification) => void>>(new Set());

  const pushNotification = useCallback((n: GameNotification) => {
    setNotifications((prev) => {
      const next = [n, ...prev];
      return next.length > MAX_HISTORY ? next.slice(0, MAX_HISTORY) : next;
    });
    for (const cb of subscribersRef.current) {
      cb(n);
    }
  }, []);

  // Subscribe to global eventNotifications
  useEffect(() => {
    return subscribeToEvent("eventNotifications", (events: unknown[]) => {
      for (const evt of events) {
        const raw = evt as RawNotification;
        if (raw.message) {
          pushNotification(normalize(raw));
        }
      }
    });
  }, [subscribeToEvent, pushNotification]);

  // Subscribe to player-scoped gameNotifications
  useEffect(() => {
    return subscribeToEvent("gameNotifications", (events: unknown[]) => {
      for (const evt of events) {
        const raw = evt as RawNotification;
        if (raw.message) {
          pushNotification(normalize(raw));
        }
      }
    });
  }, [subscribeToEvent, pushNotification]);

  const subscribe = useCallback((cb: (n: GameNotification) => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const value: EventHistoryContextValue = { notifications, subscribe };

  return (
    <EventHistoryContext.Provider value={value}>
      {children}
    </EventHistoryContext.Provider>
  );
}

export function useEventHistory(): EventHistoryContextValue {
  const ctx = useContext(EventHistoryContext);
  if (!ctx) {
    throw new Error("useEventHistory must be used within an EventHistoryProvider");
  }
  return ctx;
}
