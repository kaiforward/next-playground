import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getMarketComparison } from "@/lib/services/market-comparison";
import { ServiceError } from "@/lib/services/errors";

beforeEach(() => {
  setWorld(generateWorld({ systemCount: 60, seed: 12 }));
});

afterEach(() => {
  clearWorld();
});

describe("getMarketComparison", () => {
  it("returns one entry per system for the good", () => {
    const world = getWorld();
    const result = getMarketComparison("food");

    expect(result.goodId).toBe("food");
    expect(result.entries).toHaveLength(world.systems.length);
    expect(result.entries.every((e) => Number.isInteger(e.stock))).toBe(true);
    expect(result.entries.every((e) => Number.isFinite(e.currentPrice))).toBe(true);
  });

  it("floors fractional stock the same way getMarket does", () => {
    const world = getWorld();
    const systemId = world.systems[0].id;
    setWorld({
      ...world,
      markets: world.markets.map((m) =>
        m.systemId === systemId && m.goodId === "food" ? { ...m, stock: 23.7 } : m,
      ),
    });

    const result = getMarketComparison("food");
    const entry = result.entries.find((e) => e.systemId === systemId)!;
    expect(entry.stock).toBe(23);
  });

  it("throws ServiceError(404) for an unknown good key", () => {
    expect(() => getMarketComparison("nonexistent")).toThrow(ServiceError);
    try {
      getMarketComparison("nonexistent");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});
