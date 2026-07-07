import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemIndustry } from "@/lib/services/universe";
import { ServiceError } from "@/lib/services/errors";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import type { World, WorldSystem } from "@/lib/world/types";

const VALID_BANDS = ["poor", "average", "good", "rich"];

let world: World;
let system: WorldSystem;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 14 });
  // A populated system with buildings exercises the full readout path.
  system = [...world.systems].sort((a, b) => b.population - a.population)[0];
  expect(system.population).toBeGreaterThan(0);
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getSystemIndustry", () => {
  it("assembles the full industry readout", () => {
    const data = getSystemIndustry(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    // economyShardGroup: a static shard index in [0, ECONOMY_UPDATE_INTERVAL),
    // derived from the system's rank in localeCompare id order.
    expect(Number.isInteger(data.economyShardGroup)).toBe(true);
    expect(data.economyShardGroup).toBeGreaterThanOrEqual(0);
    expect(data.economyShardGroup).toBeLessThan(ECONOMY_UPDATE_INTERVAL);

    // Space partition mirrors the world columns; deposit = available − general.
    expect(data.space.available).toBe(system.availableSpace);
    expect(data.space.general).toBe(system.generalSpace);
    expect(data.space.habitable).toBe(system.habitableSpace);
    expect(data.space.deposit).toBeCloseTo(system.availableSpace - system.generalSpace, 6);
    for (const v of [data.space.depositWorked, data.space.generalUsed, data.space.habitableUsed]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }

    // Deposits: one row per resource with slots, worked within cap, valid band.
    for (const d of data.deposits) {
      expect(d.slotCap).toBeGreaterThan(0);
      expect(d.worked).toBeGreaterThanOrEqual(0);
      expect(d.worked).toBeLessThanOrEqual(d.slotCap);
      expect(Number.isFinite(d.yieldMult)).toBe(true);
      expect(VALID_BANDS).toContain(d.band);
    }

    // Readout core: building roster present, labour ratio bounded, supply chain present.
    expect(data.buildings.length).toBeGreaterThan(0);
    expect(data.labourFulfillment).toBeGreaterThanOrEqual(0);
    expect(data.labourFulfillment).toBeLessThanOrEqual(1);
    expect(Array.isArray(data.supplyChain)).toBe(true);

    // Production/consumption profile resolves through the world market rows
    // (the marketBandForRow path) without producing NaN.
    expect(data.goods.length).toBeGreaterThan(0);
    for (const g of data.goods) {
      expect(Number.isFinite(g.production)).toBe(true);
      expect(Number.isFinite(g.consumption)).toBe(true);
    }
  });

  it("throws ServiceError(404) for an unknown system", () => {
    expect(() => getSystemIndustry("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemIndustry("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});
