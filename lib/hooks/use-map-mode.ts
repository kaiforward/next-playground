"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMapSessionState,
  setModeInSession,
} from "@/components/map/map-session";
import type { MapMode } from "@/lib/types/map";

/**
 * Owns the single-select map mode (the territory tint). One of "political",
 * "regions", or "none". Default `"political"` — factions are the most
 * gameplay-relevant tint. Persisted via the existing
 * `map-session` mechanism so a refresh preserves the user's last view.
 */

const DEFAULT_MODE: MapMode = "political";

function hydrateFromSession(): MapMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const session = getMapSessionState();
  return session?.mode ?? DEFAULT_MODE;
}

export function useMapMode(): {
  mode: MapMode;
  setMode: (mode: MapMode) => void;
} {
  // SSR: render with the default; hydrate from session storage after mount so
  // we don't introduce a hydration mismatch on the first paint.
  const [mode, setModeState] = useState<MapMode>(DEFAULT_MODE);
  // Skip persisting on the initial mount — mode starts as DEFAULT and would
  // otherwise overwrite a previously-stored value before hydration runs.
  const skipPersist = useRef(true);

  useEffect(() => {
    setModeState(hydrateFromSession());
  }, []);

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    setModeInSession(mode);
  }, [mode]);

  const setMode = useCallback((next: MapMode) => {
    setModeState(next);
  }, []);

  return { mode, setMode };
}
