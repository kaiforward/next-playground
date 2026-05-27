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

  it("returns floored integer supply and demand even when DB stores floats", async () => {
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 12.734, demand: 8.992 },
    });

    const { entries } = await getMarket(universe.systems.agricultural);
    const food = entries.find((e) => e.goodId === goodId);

    expect(food).toBeDefined();
    expect(food!.supply).toBe(12);
    expect(food!.demand).toBe(8);
    expect(Number.isInteger(food!.supply)).toBe(true);
    expect(Number.isInteger(food!.demand)).toBe(true);
  });

  it("price calculation uses raw float ratio (unchanged from rounded supply/demand)", async () => {
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 50.0, demand: 50.0 },
    });
    const a = await getMarket(universe.systems.agricultural);

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 50.4, demand: 50.4 },
    });
    const b = await getMarket(universe.systems.agricultural);

    const priceA = a.entries.find((e) => e.goodId === goodId)!.currentPrice;
    const priceB = b.entries.find((e) => e.goodId === goodId)!.currentPrice;

    expect(priceA).toBe(priceB);
  });
});
