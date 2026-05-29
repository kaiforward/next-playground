// ── Session storage helpers for map view persistence ────────────

import { isMapMode, type MapMode } from "@/lib/types/map";

const SESSION_KEY = "stellarTrader:mapState";

export interface MapOverlaysState {
  fleet?: boolean;
  events?: boolean;
  tradeFlow?: boolean;
  priceHeatmap?: boolean;
  shipRoutes?: boolean;
}

export interface MapSessionState {
  selectedSystemId?: string;
  mode?: MapMode;
  overlays?: MapOverlaysState;
}

function parseOverlays(value: unknown): MapOverlaysState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const out: MapOverlaysState = {};
  if ("fleet" in value && typeof value.fleet === "boolean") {
    out.fleet = value.fleet;
  }
  if ("events" in value && typeof value.events === "boolean") {
    out.events = value.events;
  }
  if ("tradeFlow" in value && typeof value.tradeFlow === "boolean") {
    out.tradeFlow = value.tradeFlow;
  }
  if ("priceHeatmap" in value && typeof value.priceHeatmap === "boolean") {
    out.priceHeatmap = value.priceHeatmap;
  }
  if ("shipRoutes" in value && typeof value.shipRoutes === "boolean") {
    out.shipRoutes = value.shipRoutes;
  }
  // Legacy `politicalTerritory` is silently dropped — it migrated to the
  // single-select `mode` axis. Users land on the default mode.
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
