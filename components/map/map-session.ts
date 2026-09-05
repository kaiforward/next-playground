// ── Session storage helpers for map view persistence ────────────

import { isMapMode, type MapMode } from "@/lib/types/map";

const SESSION_KEY = "stellarTrader:mapState";

export interface MapSessionState {
  mode?: MapMode;
}

function parseMode(value: unknown): MapMode | undefined {
  return isMapMode(value) ? value : undefined;
}

export function getMapSessionState(): MapSessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    // A stored `overlays` object (the retired Overlays section) is silently ignored, the same way
    // the legacy `politicalTerritory` key inside it once was — the overlay concept no longer exists
    // on this axis, and a stale sessionStorage entry from an older build must not throw.
    return {
      mode: "mode" in parsed ? parseMode(parsed.mode) : undefined,
    };
  } catch {
    return null;
  }
}

function writeSessionState(state: MapSessionState): void {
  try {
    // Empty state — clear the key entirely instead of storing "{}".
    if (state.mode === undefined) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // SSR or storage full — ignore
  }
}

/**
 * Persist the single-select map mode.
 */
export function setModeInSession(mode: MapMode): void {
  writeSessionState({ mode });
}
