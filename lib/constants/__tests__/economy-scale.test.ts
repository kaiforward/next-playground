import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toEconomyScale,
  ECONOMY_SCALE,
  scaleValue,
  scaleRecord,
  resolveHostConfig,
  assertHostConfigResolved,
  type HostConfig,
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

describe("resolveHostConfig — the dual-host seam (spec §6)", () => {
  afterEach(() => {
    // A leaked global would bleed into every other test file's module-eval-time ECONOMY_SCALE read.
    globalThis.__hostConfig = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads process.env under Node when no host global is set (today's behaviour, unchanged)", () => {
    vi.stubEnv("ECONOMY_SCALE", "42");
    vi.stubEnv("DEBUG_ECONOMY", "1");
    vi.stubEnv("DEBUG_EVENTS", "0");
    expect(resolveHostConfig()).toEqual({
      economyScale: "42",
      debugEconomy: true,
      debugEvents: false,
    });
  });

  it("reads the host-set global in preference to process.env (the worker branch)", () => {
    // A worker's env is disjoint from the host page's — but even if something coincidentally
    // set process.env in this process, the global must win once boot.ts has set it.
    vi.stubEnv("ECONOMY_SCALE", "999");
    globalThis.__hostConfig = { economyScale: "7", debugEconomy: false, debugEvents: true };
    expect(resolveHostConfig()).toEqual({ economyScale: "7", debugEconomy: false, debugEvents: true });
  });

  it("no config anywhere means economyScale is undefined (the module then defaults to 100)", () => {
    vi.stubEnv("ECONOMY_SCALE", undefined);
    vi.stubEnv("DEBUG_ECONOMY", undefined);
    vi.stubEnv("DEBUG_EVENTS", undefined);
    expect(resolveHostConfig()).toEqual({
      economyScale: undefined,
      debugEconomy: false,
      debugEvents: false,
    });
  });

  it("a worker booted with scale S yields S-scaled constant tables (module-eval sees the global, not env)", async () => {
    vi.stubEnv("ECONOMY_SCALE", "999"); // must be ignored — the global takes precedence
    globalThis.__hostConfig = { economyScale: "7", debugEconomy: false, debugEvents: false };
    vi.resetModules();
    const mod = await import("@/lib/constants/economy-scale");
    expect(mod.ECONOMY_SCALE).toBe(7);
    expect(mod.scaleValue(3)).toBe(21);
  });
});

describe("assertHostConfigResolved — the simulate mismatch guard's logic (spec §6)", () => {
  it("is a no-op when the host config requests no override", () => {
    const config: HostConfig = { economyScale: undefined, debugEconomy: false, debugEvents: false };
    expect(() => assertHostConfigResolved(config, 100)).not.toThrow();
  });

  it("is a no-op when the requested scale matches the already-resolved constant", () => {
    const config: HostConfig = { economyScale: "100", debugEconomy: false, debugEvents: false };
    expect(() => assertHostConfigResolved(config, 100)).not.toThrow();
  });

  it("throws when the requested scale disagrees with the already-resolved constant — the fault: an " +
    "import reached the constants graph before boot configuration was fully resolved", () => {
    const config: HostConfig = { economyScale: "55", debugEconomy: false, debugEvents: false };
    expect(() => assertHostConfigResolved(config, 100)).toThrow(/ECONOMY_SCALE mismatch/);
  });
});
