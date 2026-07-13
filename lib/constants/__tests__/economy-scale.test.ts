import { describe, it, expect, vi } from "vitest";
import {
  toEconomyScale,
  ECONOMY_SCALE,
  scaleValue,
  scaleRecord,
} from "@/lib/constants/economy-scale";

describe("toEconomyScale", () => {
  it("parses positive finite numbers", () => {
    expect(toEconomyScale("1")).toBe(1);
    expect(toEconomyScale("10")).toBe(10);
    expect(toEconomyScale("2.5")).toBe(2.5);
  });

  it("rejects non-positive, non-finite, and non-numeric values", () => {
    expect(() => toEconomyScale("0")).toThrow();
    expect(() => toEconomyScale("-1")).toThrow();
    expect(() => toEconomyScale("abc")).toThrow();
    expect(() => toEconomyScale("Infinity")).toThrow();
    expect(() => toEconomyScale("NaN")).toThrow();
    expect(() => toEconomyScale("")).toThrow();
  });
});

describe("scale helpers at the test-pinned scale (S = 1)", () => {
  it("resolves ECONOMY_SCALE to 1 under the test env (vitest pins ECONOMY_SCALE=1)", () => {
    expect(ECONOMY_SCALE).toBe(1);
  });

  it("scaleValue is identity at S = 1", () => {
    expect(scaleValue(8)).toBe(8);
    expect(scaleValue(0.5)).toBe(0.5);
  });

  it("scaleRecord maps every value and preserves keys at S = 1", () => {
    expect(scaleRecord({ a: 2, b: 3 })).toEqual({ a: 2, b: 3 });
  });
});

describe("ECONOMY_SCALE code default", () => {
  it("resolves to 100 when no env override is set (the game's scale)", async () => {
    // The vitest config pins ECONOMY_SCALE=1 for the suite, so the statically-imported value above is 1.
    // Unset the env var and re-import to prove the CODE default is 100 (the scale the game runs at). This
    // guards the sim/game scale-parity fix: a regression back to a default of 1 would otherwise pass
    // unnoticed behind the test-env pin.
    vi.resetModules();
    vi.stubEnv("ECONOMY_SCALE", undefined);
    try {
      const mod = await import("@/lib/constants/economy-scale");
      expect(mod.ECONOMY_SCALE).toBe(100);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
