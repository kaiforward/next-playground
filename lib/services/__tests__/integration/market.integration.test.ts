import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import { marketBand } from "@/lib/engine/market-pricing";
import { demandRateForGood } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import type { TestUniverse } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getMarket } = await import("@/lib/services/market");
const { executeTrade } = await import("@/lib/services/trade");

describe("getMarket (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
  });

  it("returns floored integer stock even when the DB stores a float", async () => {
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { stock: 12.734 },
    });

    const { entries } = await getMarket(universe.systems.agricultural);
    const food = entries.find((e) => e.goodId === goodId);

    expect(food).toBeDefined();
    expect(food!.stock).toBe(12);
    expect(Number.isInteger(food!.stock)).toBe(true);
  });

  it("prices scarcity: lower stock reads more expensive than higher stock", async () => {
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { stock: 50 },
    });
    const scarce = await getMarket(universe.systems.agricultural);

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { stock: 150 },
    });
    const abundant = await getMarket(universe.systems.agricultural);

    const food = (entries: typeof scarce.entries) =>
      entries.find((e) => e.goodId === goodId)!;

    expect(food(scarce.entries).currentPrice).toBeGreaterThan(
      food(abundant.entries).currentPrice,
    );
    // Buy price always sits at or above the mid (the spread).
    expect(food(scarce.entries).buyPrice).toBeGreaterThanOrEqual(
      food(scarce.entries).currentPrice,
    );
    // Sell price always sits at or below the mid.
    expect(food(scarce.entries).sellPrice).toBeLessThanOrEqual(
      food(scarce.entries).currentPrice,
    );
  });
});

describe("executeTrade (integration) — floored stock in buy-cap error", () => {
  it("buy-cap error reports the floored available units, not a raw float", async () => {
    const universe = await seedTestUniverse(prisma);
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    // Agricultural system: population=400, storageCapacity=0 (DB default).
    // Per-market band for food (priceFloor=0.5, priceCeiling=2.0):
    //   demandRate = GOOD_CONSUMPTION.food(0.004) × 400 = 1.6
    //   targetStock = TARGET_COVER(40) × 1.6 = 64
    //   minStock    = 64 / 2.0 = 32   ← per-market scarcity reserve
    //   maxStock    = 64 / 0.5 + 0  = 128
    // With stock overridden to 51.8:
    //   buyable = floor(51.8 - 32) = floor(19.8) = 19  (floored integer)
    // The error must show the integer (19), never the raw float (19.8).
    const AGRI_POPULATION = 400;
    const foodDemandRate = demandRateForGood("food", AGRI_POPULATION);
    const foodGood = GOODS["food"];
    const band = marketBand({
      demandRate: foodDemandRate,
      storageCapacity: 0,
      priceFloor: foodGood.priceFloor,
      priceCeiling: foodGood.priceCeiling,
    });
    const testStock = 51.8;
    const expectedBuyable = Math.floor(testStock - band.minStock);

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { stock: testStock },
    });

    const player = await createTestPlayer(prisma, { credits: 1_000_000 });
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 100,
    });

    // Requesting 1 more than the floored buyable to trigger the error path.
    const result = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId,
      quantity: expectedBuyable + 1,
      type: "buy",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return; // narrow to the error branch for TypeScript
    expect(result.error).toMatch(new RegExp(`available ${expectedBuyable}\\b`));
    expect(result.error).not.toContain(`${testStock - band.minStock}`);
  });
});
