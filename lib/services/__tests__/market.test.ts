import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getMarket } from "@/lib/services/market";
import { ServiceError } from "@/lib/services/errors";
import { TARGET_COVER } from "@/lib/constants/market-economy";
import type { World } from "@/lib/world/types";

let world: World;
let systemId: string;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 11 });
  // getMarket only returns entries for developed systems; homeworlds are the
  // developed systems in a freshly generated world.
  systemId = world.factions[0].homeworldId;
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
    // Pick stocks either side of the good's per-system anchor (TARGET_COVER ×
    // demandRate × anchorMult) so neither read is clamped at floor/ceiling.
    const market = getWorld().markets.find(
      (m) => m.systemId === systemId && m.goodId === "food",
    )!;
    const anchor = TARGET_COVER * market.demandRate * market.anchorMult;

    setFoodStock(anchor * 0.5);
    const scarce = getMarket(systemId).entries.find((e) => e.goodId === "food")!;

    setFoodStock(anchor * 2);
    const abundant = getMarket(systemId).entries.find((e) => e.goodId === "food")!;

    expect(scarce.currentPrice).toBeGreaterThan(abundant.currentPrice);
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
