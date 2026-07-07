"use client";

import { createContext, useContext } from "react";
import { useTick } from "./use-tick";
import type { Speed } from "@/lib/world/tick-loop";

type EventCallback = (events: unknown[]) => void;

interface TickContextValue {
  currentTick: number;
  speed: Speed;
  achievedTps: number;
  isConnected: boolean;
  subscribeToEvent: (eventName: string, cb: EventCallback) => () => void;
  subscribeToArrivals: (cb: (shipIds: string[]) => void) => () => void;
}

const TickContext = createContext<TickContextValue | null>(null);

export function TickProvider({ children }: { children: React.ReactNode }) {
  const tick = useTick();

  return <TickContext.Provider value={tick}>{children}</TickContext.Provider>;
}

export function useTickContext(): TickContextValue {
  const ctx = useContext(TickContext);
  if (!ctx) {
    throw new Error("useTickContext must be used within a TickProvider");
  }
  return ctx;
}
