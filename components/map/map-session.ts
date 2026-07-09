// ── Session storage helpers for map view persistence ────────────

import { isMapMode, type MapMode } from "@/lib/types/map";

const SESSION_KEY = "stellarTrader:mapState";

export interface MapOverlaysState {
  events?: boolean;
  logistics?: boolean;
  priceHeatmap?: boolean;
}

export interface MapSessionState {
  selectedSystemId?: string;
  mode?: MapMode;
  overlays?: MapOverlaysState;
}

function parseOverlays(value: unknown): MapOverlaysState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const out: MapOverlaysState = {};
  if ("events" in value && typeof value.events === "boolean") {
    out.events = value.events;
  }
  if ("logistics" in value && typeof value.logistics === "boolean") {
    out.logistics = value.logistics;
  }
  if ("priceHeatmap" in value && typeof value.priceHeatmap === "boolean") {
    out.priceHeatmap = value.priceHeatmap;
  }
  // Legacy keys (`politicalTerritory`, `fleet`, `shipRoutes`) are silently
  // dropped — mode migrated to its own axis; fleet overlays died with the
  // single-player pivot.
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
      selectedSystemId:
        "selectedSystemId" in parsed &&
        typeof parsed.selectedSystemId === "string"
          ? parsed.selectedSystemId
          : undefined,
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
      state.selectedSystemId === undefined &&
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
 * Persist (or clear) the selected system without disturbing other fields.
 */
export function setSelectedSystemInSession(systemId: string | null): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({
    ...current,
    selectedSystemId: systemId ?? undefined,
  });
}

/**
 * Persist the overlay-toggle state without disturbing the selected system or mode.
 */
export function setOverlaysInSession(overlays: MapOverlaysState): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({ ...current, overlays });
}

/**
 * Persist the single-select map mode without disturbing the selected system or overlays.
 */
export function setModeInSession(mode: MapMode): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({ ...current, mode });
}
