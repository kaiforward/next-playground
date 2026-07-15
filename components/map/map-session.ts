// ── Session storage helpers for map view persistence ────────────

import { isMapMode, type MapMode } from "@/lib/types/map";

const SESSION_KEY = "stellarTrader:mapState";

export interface MapOverlaysState {
  logistics?: boolean;
}

export interface MapSessionState {
  mode?: MapMode;
  overlays?: MapOverlaysState;
}

function parseOverlays(value: unknown): MapOverlaysState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const out: MapOverlaysState = {};
  if ("logistics" in value && typeof value.logistics === "boolean") {
    out.logistics = value.logistics;
  }
  // Legacy keys (`politicalTerritory`, `fleet`, `shipRoutes`, `priceHeatmap`, `events`) are
  // silently dropped — mode migrated to its own axis; fleet overlays died with the
  // single-player pivot; events was removed as a map concept.
  return Object.keys(out).length > 0 ? out : undefined;
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
    return {
      mode: "mode" in parsed ? parseMode(parsed.mode) : undefined,
      overlays:
        "overlays" in parsed ? parseOverlays(parsed.overlays) : undefined,
    };
  } catch {
    return null;
  }
}

function writeSessionState(state: MapSessionState): void {
  try {
    // Empty state — clear the key entirely instead of storing "{}".
    if (
      state.mode === undefined &&
      (!state.overlays || Object.keys(state.overlays).length === 0)
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // SSR or storage full — ignore
  }
}

/**
 * Persist the overlay-toggle state without disturbing the mode.
 */
export function setOverlaysInSession(overlays: MapOverlaysState): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({ ...current, overlays });
}

/**
 * Persist the single-select map mode without disturbing the overlays.
 */
export function setModeInSession(mode: MapMode): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({ ...current, mode });
}
