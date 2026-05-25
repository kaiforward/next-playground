// ── Session storage helpers for map view persistence ────────────

const SESSION_KEY = "stellarTrader:mapState";

export interface MapOverlaysState {
  tradeFlow?: boolean;
}

export interface MapSessionState {
  selectedSystemId?: string;
  overlays?: MapOverlaysState;
}

function parseOverlays(value: unknown): MapOverlaysState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const out: MapOverlaysState = {};
  if ("tradeFlow" in value && typeof value.tradeFlow === "boolean") {
    out.tradeFlow = value.tradeFlow;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
 * Persist (or clear) the selected system without disturbing other fields like
 * overlays. Pass `null` to clear just the selection.
 */
export function setSelectedSystemInSession(systemId: string | null): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({
    ...current,
    selectedSystemId: systemId ?? undefined,
  });
}

/**
 * Persist the overlay-toggle state without disturbing the selected system.
 */
export function setOverlaysInSession(overlays: MapOverlaysState): void {
  const current = getMapSessionState() ?? {};
  writeSessionState({ ...current, overlays });
}
