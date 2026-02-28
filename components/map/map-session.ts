// ── Session storage helpers for map view persistence ────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const SESSION_KEY = "stellarTrader:mapState";

export interface MapSessionState {
  selectedSystemId?: string;
}

export function getMapSessionState(): MapSessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    return { selectedSystemId: typeof parsed.selectedSystemId === "string" ? parsed.selectedSystemId : undefined };
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
