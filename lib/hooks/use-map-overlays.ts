"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
} {
  // SSR: render with defaults; hydrate from session storage after mount so we
  // don't introduce a hydration mismatch on the first paint.
  const [overlays, setOverlays] = useState<MapOverlays>(DEFAULT_OVERLAYS);
  // Skip persisting on the initial mount — overlays starts as DEFAULT and
  // would otherwise overwrite a previously-stored value before hydration.
  const skipPersist = useRef(true);

  useEffect(() => {
    setOverlays(hydrateFromSession());
  }, []);

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    const stored: MapOverlaysState = {};
    if (overlays.tradeFlow) stored.tradeFlow = true;
    setOverlaysInSession(stored);
  }, [overlays]);

  const toggle = useCallback((key: MapOverlayKey) => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { overlays, toggle };
}
