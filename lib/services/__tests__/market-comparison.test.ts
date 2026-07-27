import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getMarketComparison } from "@/lib/services/market-comparison";
import { ServiceError } from "@/lib/services/errors";
import type { World } from "@/lib/world/types";

beforeEach(() => {
  setWorld(generateWorld({ systemCount: 60, seed: 12 }));
});

afterEach(() => {
  clearWorld();
});

/** A system that actually trades — unsettled systems have no market rows to compare. */
const settledSystemId = (world: World): string =>
  world.systems.find((s) => s.control === "developed")!.id;

describe("getMarketComparison", () => {
  it("returns one entry per system that has a market for the good", () => {
    const world = getWorld();
    const result = getMarketComparison("food");
    const settled = world.systems.filter((s) => s.control === "developed");

    expect(result.goodId).toBe("food");
    expect(settled.length).toBeGreaterThan(0); // sanity: comparing something, not an empty galaxy
    expect(result.entries).toHaveLength(settled.length);
    expect(result.entries.every((e) => Number.isInteger(e.stock))).toBe(true);
    expect(result.entries.every((e) => Number.isFinite(e.currentPrice))).toBe(true);
  });

  it("floors fractional stock the same way getMarket does", () => {
    const world = getWorld();
    const systemId = settledSystemId(world);
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
