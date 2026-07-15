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
 */
export interface MapOverlays {
  logistics: boolean;
}

export type MapOverlayKey = keyof MapOverlays;

const DEFAULT_OVERLAYS: MapOverlays = {
  logistics: false,
};

function hydrateFromSession(): MapOverlays {
  if (typeof window === "undefined") return DEFAULT_OVERLAYS;
  const session = getMapSessionState();
  const stored = session?.overlays;
  if (!stored) return DEFAULT_OVERLAYS;
  return {
    logistics: stored.logistics ?? DEFAULT_OVERLAYS.logistics,
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
    if (overlays.logistics) stored.logistics = true;
    setOverlaysInSession(stored);
  }, [overlays]);

  const toggle = useCallback((key: MapOverlayKey) => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { overlays, toggle };
}
