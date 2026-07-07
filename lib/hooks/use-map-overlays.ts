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
 * `events` gates the *ambient* display of the event pill on each system glyph
 * (the data still reveals on hover/select even when the overlay is off). It
 * defaults ON so a first-time player sees live events; the opt-in overlays
 * default off for a clean map.
 */
export interface MapOverlays {
  events: boolean;
  tradeFlow: boolean;
  logistics: boolean;
  priceHeatmap: boolean;
}

export type MapOverlayKey = keyof MapOverlays;

const DEFAULT_OVERLAYS: MapOverlays = {
  events: true,
  tradeFlow: false,
  logistics: false,
  priceHeatmap: false,
};

function hydrateFromSession(): MapOverlays {
  if (typeof window === "undefined") return DEFAULT_OVERLAYS;
  const session = getMapSessionState();
  const stored = session?.overlays;
  if (!stored) return DEFAULT_OVERLAYS;
  return {
    events: stored.events ?? DEFAULT_OVERLAYS.events,
    tradeFlow: stored.tradeFlow ?? DEFAULT_OVERLAYS.tradeFlow,
    logistics: stored.logistics ?? DEFAULT_OVERLAYS.logistics,
    priceHeatmap: stored.priceHeatmap ?? DEFAULT_OVERLAYS.priceHeatmap,
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
    // `events` defaults to ON, so an "off" choice has to be stored explicitly —
    // the truthy-only shorthand used for the opt-in overlays would silently
    // revert it to the default on the next hydrate.
    const stored: MapOverlaysState = {
      events: overlays.events,
    };
    if (overlays.tradeFlow) stored.tradeFlow = true;
    if (overlays.logistics) stored.logistics = true;
    if (overlays.priceHeatmap) stored.priceHeatmap = true;
    setOverlaysInSession(stored);
  }, [overlays]);

  const toggle = useCallback((key: MapOverlayKey) => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { overlays, toggle };
}
