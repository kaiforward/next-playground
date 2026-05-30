import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
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

    // stock=51.8, STOCK_MIN=5 → buyable = floor(51.8 - 5) = floor(46.8) = 46.
    // The error must show the integer (46), never the raw float (46.8).
    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { stock: 51.8 },
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
      quantity: 47,
      type: "buy",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return; // narrow to the error branch for TypeScript
    expect(result.error).toMatch(/available 46\b/);
    expect(result.error).not.toContain("46.8");
  });
});
