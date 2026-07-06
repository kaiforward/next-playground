import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getMarket } = await import("@/lib/services/market");

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

