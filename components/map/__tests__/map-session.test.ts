import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  getMapSessionState,
  setOverlaysInSession,
  setModeInSession,
} from "../map-session";

// The repo has no jsdom dev dependency and Vitest's unit project runs in Node
// by default. `map-session.ts` only touches `sessionStorage` inside its
// function bodies (not at module-evaluation time), so installing the stub in
// beforeAll runs before any test calls those functions.
beforeAll(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
      clear: () => {
        storage.clear();
      },
    },
  });
});

describe("map-session", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe("parseOverlays (via getMapSessionState)", () => {
    it("keeps logistics when present", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { logistics: true } }),
      );
      expect(getMapSessionState()?.overlays?.logistics).toBe(true);
    });

    it("silently drops a legacy politicalTerritory key", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { politicalTerritory: true } }),
      );
      // Legacy key is gone from the parsed shape — and because it was the
      // only overlay, `overlays` itself collapses to undefined.
      expect(getMapSessionState()?.overlays).toBeUndefined();
    });

    it("keeps logistics even when a legacy politicalTerritory is also present", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({
          overlays: { logistics: true, politicalTerritory: true },
        }),
      );
      const overlays = getMapSessionState()?.overlays;
      expect(overlays?.logistics).toBe(true);
      expect("politicalTerritory" in (overlays ?? {})).toBe(false);
    });

    it("drops a non-boolean logistics value during parse", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { logistics: "yes" } }),
      );
      // Non-boolean is ignored; with no valid overlay keys left, overlays
      // collapses to undefined (same as the legacy-only case above).
      expect(getMapSessionState()?.overlays).toBeUndefined();
    });

    it("drops the retired fleet key during parse", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { fleet: false, logistics: true } }),
      );
      const overlays = getMapSessionState()?.overlays;
      expect(overlays?.logistics).toBe(true);
      expect("fleet" in (overlays ?? {})).toBe(false);
    });

    it("round-trips an explicit logistics:true through the write path", () => {
      // Exercises setOverlaysInSession → writeSessionState → getMapSessionState
      // end-to-end (not just a seeded parse).
      setOverlaysInSession({ logistics: true });
      const overlays = getMapSessionState()?.overlays;
      expect(overlays?.logistics).toBe(true);
    });
  });

  describe("mode persistence", () => {
    it("returns undefined when no mode is stored", () => {
      expect(getMapSessionState()?.mode).toBeUndefined();
    });

    it("round-trips a valid mode", () => {
      setModeInSession("political");
      expect(getMapSessionState()?.mode).toBe("political");
    });

    it("drops an invalid mode value during parse", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ mode: "not-a-mode" }),
      );
      expect(getMapSessionState()?.mode).toBeUndefined();
    });

    it("preserves overlays when setting mode independently", () => {
      setOverlaysInSession({ logistics: true });
      setModeInSession("regions");
      const state = getMapSessionState();
      expect(state?.mode).toBe("regions");
      expect(state?.overlays?.logistics).toBe(true);
    });

    it("preserves mode when setting overlays independently", () => {
      setModeInSession("political");
      setOverlaysInSession({ logistics: true });
      const state = getMapSessionState();
      expect(state?.mode).toBe("political");
      expect(state?.overlays?.logistics).toBe(true);
    });
  });
});
