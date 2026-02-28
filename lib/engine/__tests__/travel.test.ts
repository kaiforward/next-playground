import { describe, it, expect } from "vitest";
import { hopDuration } from "@/lib/engine/travel";
import { SHIP_TYPES } from "@/lib/constants/ships";

describe("hopDuration", () => {
  it("backward compatible: no speed args returns fuelCost/2 rounded up", () => {
    expect(hopDuration(10)).toBe(5);
    expect(hopDuration(11)).toBe(6);
    expect(hopDuration(1)).toBe(1);
    expect(hopDuration(0)).toBe(1); // minimum 1
  });

  it("shuttle speed produces same results as no-speed (reference speed)", () => {
    const shuttleSpeed = SHIP_TYPES.shuttle.speed;
    expect(hopDuration(10, shuttleSpeed)).toBe(hopDuration(10));
    expect(hopDuration(20, shuttleSpeed)).toBe(hopDuration(20));
  });

  it("faster ships travel in fewer ticks", () => {
    const baseDuration = hopDuration(10); // 5 ticks at reference speed 5
    const fastDuration = hopDuration(10, 8); // speed 8 → ceil(5 * 5/8) = ceil(3.125) = 4
    expect(fastDuration).toBeLessThan(baseDuration);
    expect(fastDuration).toBe(4);
  });

  it("slower ships travel in more ticks", () => {
    const baseDuration = hopDuration(10); // 5 ticks at reference speed 5
    const slowDuration = hopDuration(10, 2); // speed 2 → ceil(5 * 5/2) = ceil(12.5) = 13
    expect(slowDuration).toBeGreaterThan(baseDuration);
    expect(slowDuration).toBe(13);
  });

  it("minimum duration is always 1 tick", () => {
    expect(hopDuration(1, 100)).toBe(1);
    expect(hopDuration(0, 100)).toBe(1);
  });

  it("speed values match expectations for all ship types", () => {
    // Heavy freighter (speed 2) should take longer than shuttle (speed 5)
    const heavyDuration = hopDuration(10, SHIP_TYPES.heavy_freighter.speed);
    const shuttleDuration = hopDuration(10, SHIP_TYPES.shuttle.speed);
    const interceptorDuration = hopDuration(10, SHIP_TYPES.interceptor.speed);

    expect(heavyDuration).toBeGreaterThan(shuttleDuration);
    expect(interceptorDuration).toBeLessThan(shuttleDuration);
  });

  it("custom reference speed works correctly", () => {
    // With referenceSpeed=10 and shipSpeed=5, travel should take 2x base
    const doubled = hopDuration(10, 5, 10); // ceil(5 * 10/5) = 10
    expect(doubled).toBe(10);
  });
});
