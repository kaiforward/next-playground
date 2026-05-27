"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMapSessionState,
  setOverlaysInSession,
  type MapOverlaysState,
} from "@/components/map/map-session";

/**
 * Owns which additive map overlays are toggled on. Overlays sit on top of
 * whatever map mode is active and can be stacked freely. State is persisted
 * via `map-session` so a refresh preserves the user's last view.
 *
 * Defaults to all-off so first-time players see a clean map.
 */
export interface MapOverlays {
  tradeFlow: boolean;
}

export type MapOverlayKey = keyof MapOverlays;

const DEFAULT_OVERLAYS: MapOverlays = {
  tradeFlow: false,
};

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
  const [overlays, setOverlays] = useState<MapOverlays>(DEFAULT_OVERLAYS);
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
