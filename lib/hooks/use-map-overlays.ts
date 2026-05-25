"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getMapSessionState,
  setOverlaysInSession,
  type MapOverlaysState,
} from "@/components/map/map-session";

/**
 * Owns which map overlays are toggled on. The toggle button cluster sets
 * these; `useTradeFlow`, the Pixi `TradeFlowLayer`, and any future overlays
 * read from here. State is persisted via the existing map-session mechanism
 * so a page refresh preserves the user's last view.
 *
 * Defaults to all-off so first-time players see the clean map.
 */
export interface MapOverlays {
  tradeFlow: boolean;
}

export type MapOverlayKey = keyof MapOverlays;

const DEFAULT_OVERLAYS: MapOverlays = { tradeFlow: false };

function hydrateFromSession(): MapOverlays {
  if (typeof window === "undefined") return DEFAULT_OVERLAYS;
  const session = getMapSessionState();
  const stored = session?.overlays;
  if (!stored) return DEFAULT_OVERLAYS;
  return {
    tradeFlow: stored.tradeFlow ?? DEFAULT_OVERLAYS.tradeFlow,
  };
}

export function useMapOverlays(): {
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
  set: (key: MapOverlayKey, value: boolean) => void;
} {
  // SSR: render with defaults; hydrate from session storage after mount so we
  // don't introduce a hydration mismatch on the first paint.
  const [overlays, setOverlays] = useState<MapOverlays>(DEFAULT_OVERLAYS);

  useEffect(() => {
    setOverlays(hydrateFromSession());
  }, []);

  const persist = useCallback((next: MapOverlays) => {
    // Strip false values from the persisted payload so the session only stores
    // the active overlays. Restored state interprets missing keys as off.
    const stored: MapOverlaysState = {};
    if (next.tradeFlow) stored.tradeFlow = true;
    setOverlaysInSession(stored);
  }, []);

  const set = useCallback(
    (key: MapOverlayKey, value: boolean) => {
      setOverlays((prev) => {
        const next = { ...prev, [key]: value };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const toggle = useCallback(
    (key: MapOverlayKey) => {
      setOverlays((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return { overlays, toggle, set };
}
