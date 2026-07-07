import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getMarket } from "@/lib/services/market";
import { ServiceError } from "@/lib/services/errors";
import type { World } from "@/lib/world/types";

let world: World;
let systemId: string;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 11 });
  systemId = world.systems[0].id;
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

function setFoodStock(stock: number): void {
  const w = getWorld();
  setWorld({
    ...w,
    markets: w.markets.map((m) =>
      m.systemId === systemId && m.goodId === "food" ? { ...m, stock } : m,
    ),
  });
}

describe("getMarket", () => {
  it("returns one entry per catalog good, keyed by the system id", () => {
    const { stationId, entries } = getMarket(systemId);
    expect(stationId).toBe(systemId);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.goodId === "food")).toBe(true);
  });

  it("returns floored integer stock even when the world stores a float", () => {
    setFoodStock(12.734);
    const { entries } = getMarket(systemId);
    const food = entries.find((e) => e.goodId === "food")!;
    expect(food.stock).toBe(12);
    expect(Number.isInteger(food.stock)).toBe(true);
  });

  it("prices scarcity: lower stock reads more expensive than higher stock", () => {
    // Pick stocks either side of the curve's own anchor so neither read is
    // clamped at the price floor/ceiling.
    const targetStock = getMarket(systemId).entries.find((e) => e.goodId === "food")!.targetStock;

    setFoodStock(targetStock * 0.5);
    const scarce = getMarket(systemId).entries.find((e) => e.goodId === "food")!;

    setFoodStock(targetStock * 2);
    const abundant = getMarket(systemId).entries.find((e) => e.goodId === "food")!;

    expect(scarce.currentPrice).toBeGreaterThan(abundant.currentPrice);
    // Buy price always sits at or above the mid (the spread); sell at or below.
    expect(scarce.buyPrice).toBeGreaterThanOrEqual(scarce.currentPrice);
    expect(scarce.sellPrice).toBeLessThanOrEqual(scarce.currentPrice);
  });

  it("throws ServiceError(404) for an unknown system", () => {
    expect(() => getMarket("does-not-exist")).toThrow(ServiceError);
    try {
      getMarket("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});
