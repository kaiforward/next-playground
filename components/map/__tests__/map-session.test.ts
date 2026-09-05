import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { getMapSessionState, setModeInSession } from "../map-session";

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

  describe("a stored `overlays` object (the retired Overlays section)", () => {
    it("hydrates to a mode-only state without throwing", () => {
      sessionStorage.setItem(
        "stellarTrader:mapState",
        JSON.stringify({ mode: "political", overlays: { logistics: true } }),
      );
      expect(() => getMapSessionState()).not.toThrow();
      const state = getMapSessionState();
      expect(state?.mode).toBe("political");
      expect(state).not.toHaveProperty("overlays");
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
  });
});
