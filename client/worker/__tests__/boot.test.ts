/**
 * Proves the worker entry seam (spec §6): `bootHost` sets the host config global from a
 * `BootConfig` BEFORE dynamically importing the constants graph, so the module-evaluation-time
 * `ECONOMY_SCALE` read (and the ~10 constant tables built from it) see the resolved value —
 * never the code default, regardless of what `process.env` holds in this process.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import type { BootConfig } from "@/lib/runtime/channel";

describe("bootHost", () => {
  afterEach(() => {
    globalThis.__hostConfig = undefined;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("a worker booted with scale S yields S-scaled constant tables", async () => {
    vi.stubEnv("ECONOMY_SCALE", "999"); // must be ignored: the global set by bootHost wins
    vi.resetModules();
    const { bootHost: freshBootHost } = await import("@/client/worker/boot");
    const config: BootConfig = { economyScale: 7, debugEconomy: false, debugEvents: false };
    const mod = await freshBootHost(config);
    expect(mod.ECONOMY_SCALE).toBe(7);
    expect(mod.scaleValue(3)).toBe(21);
    expect(mod.scaleRecord({ a: 2 })).toEqual({ a: 14 });
  });

  it("leaves the host config global populated from BootConfig after boot", async () => {
    vi.resetModules();
    const { bootHost: freshBootHost } = await import("@/client/worker/boot");
    const config: BootConfig = { economyScale: 3, debugEconomy: true, debugEvents: false };
    await freshBootHost(config);
    expect(globalThis.__hostConfig).toEqual({
      economyScale: "3",
      debugEconomy: true,
      debugEvents: false,
    });
  });

  it("no config means default 100 (nothing booted, nothing in env)", async () => {
    // The vitest config pins ECONOMY_SCALE=1 for the suite (unit-scale assertions elsewhere) —
    // unset it here to prove the CODE default, not the test-env pin.
    vi.stubEnv("ECONOMY_SCALE", undefined);
    vi.resetModules();
    const mod = await import("@/lib/constants/economy-scale");
    expect(mod.ECONOMY_SCALE).toBe(100);
  });
});
