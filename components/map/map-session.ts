// ── Session storage helpers for map view persistence ────────────

const SESSION_KEY = "stellarTrader:mapState";

export interface MapSessionState {
  regionId?: string;
  selectedSystemId?: string;
}

export function getMapSessionState(): MapSessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as MapSessionState) : null;
  } catch {
    return null;
  }
}

export function setMapSessionState(state: MapSessionState | null): void {
  try {
    if (state) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // SSR or storage full — ignore
  }
}
