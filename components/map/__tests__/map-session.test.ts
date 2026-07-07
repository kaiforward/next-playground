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
    it("keeps tradeFlow when present", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { tradeFlow: true } }),
      );
      expect(getMapSessionState()?.overlays?.tradeFlow).toBe(true);
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

    it("keeps tradeFlow even when a legacy politicalTerritory is also present", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({
          overlays: { tradeFlow: true, politicalTerritory: true },
        }),
      );
      const overlays = getMapSessionState()?.overlays;
      expect(overlays?.tradeFlow).toBe(true);
      expect("politicalTerritory" in (overlays ?? {})).toBe(false);
    });

    it("keeps events when present, including an explicit false", () => {
      // `events` defaults ON, so an explicit `false` must round-trip —
      // a dropped key would silently revert to the default on hydrate.
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { events: false, tradeFlow: true } }),
      );
      const overlays = getMapSessionState()?.overlays;
      expect(overlays?.events).toBe(false);
      expect(overlays?.tradeFlow).toBe(true);
    });

    it("drops a non-boolean events value during parse", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { events: "yes" } }),
      );
      // Non-boolean is ignored; with no valid overlay keys left, overlays
      // collapses to undefined (same as the legacy-only case above).
      expect(getMapSessionState()?.overlays).toBeUndefined();
    });

    it("drops the retired fleet key during parse", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ overlays: { fleet: false, events: true } }),
      );
      const overlays = getMapSessionState()?.overlays;
      expect(overlays?.events).toBe(true);
      expect("fleet" in (overlays ?? {})).toBe(false);
    });

    it("round-trips an explicit events:false through the write path", () => {
      // Exercises setOverlaysInSession → writeSessionState → getMapSessionState
      // end-to-end (not just a seeded parse): a default-ON overlay turned off
      // must survive the write, or it would silently revert on hydrate.
      setOverlaysInSession({ events: false, tradeFlow: true });
      const overlays = getMapSessionState()?.overlays;
      expect(overlays?.events).toBe(false);
      expect(overlays?.tradeFlow).toBe(true);
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
      setOverlaysInSession({ tradeFlow: true });
      setModeInSession("regions");
      const state = getMapSessionState();
      expect(state?.mode).toBe("regions");
      expect(state?.overlays?.tradeFlow).toBe(true);
    });

    it("preserves mode when setting overlays independently", () => {
      setModeInSession("political");
      setOverlaysInSession({ tradeFlow: true });
      const state = getMapSessionState();
      expect(state?.mode).toBe("political");
      expect(state?.overlays?.tradeFlow).toBe(true);
    });
  });
});
