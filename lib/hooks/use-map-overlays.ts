"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMapSessionState,
  setOverlaysInSession,
  type MapOverlaysState,
} from "@/components/map/map-session";
import {
  overlaysForPreset,
  presetForOverlays,
  type MapPreset,
} from "@/lib/utils/map-presets";

/**
 * Owns which additive map overlays are toggled on. Overlays sit on top of
 * whatever map mode is active and can be stacked freely. State is persisted
 * via `map-session` so a refresh preserves the user's last view.
 *
 * `fleet` and `events` gate the *ambient* display of the docked-fleet and
 * event pills on each system glyph (the data still reveals on hover/select even
 * when the overlay is off). Defaults match the "default" preset so a first-time
 * player sees their fleet and live events.
 */
export interface MapOverlays {
  fleet: boolean;
  events: boolean;
  tradeFlow: boolean;
  priceHeatmap: boolean;
  shipRoutes: boolean;
}

export type MapOverlayKey = keyof MapOverlays;

const DEFAULT_OVERLAYS: MapOverlays = overlaysForPreset("default");

function hydrateFromSession(): MapOverlays {
  if (typeof window === "undefined") return DEFAULT_OVERLAYS;
  const session = getMapSessionState();
  const stored = session?.overlays;
  if (!stored) return DEFAULT_OVERLAYS;
  return {
    fleet: stored.fleet ?? DEFAULT_OVERLAYS.fleet,
    events: stored.events ?? DEFAULT_OVERLAYS.events,
    tradeFlow: stored.tradeFlow ?? DEFAULT_OVERLAYS.tradeFlow,
    priceHeatmap: stored.priceHeatmap ?? DEFAULT_OVERLAYS.priceHeatmap,
    shipRoutes: stored.shipRoutes ?? DEFAULT_OVERLAYS.shipRoutes,
  };
}

export function useMapOverlays(): {
  overlays: MapOverlays;
  toggle: (key: MapOverlayKey) => void;
  preset: MapPreset;
  setPreset: (preset: MapPreset) => void;
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
    // `fleet`/`events` default to ON, so an "off" choice has to be stored
    // explicitly — the truthy-only shorthand used for the opt-in overlays would
    // silently revert them to the default on the next hydrate.
    const stored: MapOverlaysState = {
      fleet: overlays.fleet,
      events: overlays.events,
    };
    if (overlays.tradeFlow) stored.tradeFlow = true;
    if (overlays.priceHeatmap) stored.priceHeatmap = true;
    if (overlays.shipRoutes) stored.shipRoutes = true;
    setOverlaysInSession(stored);
  }, [overlays]);

  const toggle = useCallback((key: MapOverlayKey) => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Derived, not stored — the active preset is always a function of the live
  // overlay set, so manual toggles naturally fall through to "custom".
  const preset = useMemo(() => presetForOverlays(overlays), [overlays]);

  const setPreset = useCallback((next: MapPreset) => {
    if (next === "custom") return; // "custom" is a derived state, not selectable
    setOverlays(overlaysForPreset(next));
  }, []);

  return { overlays, toggle, preset, setPreset };
}
