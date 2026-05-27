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

  it("price calculation uses raw float ratio, not the floored display values", async () => {
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    // Set fractional values where flooring the supply changes the ratio enough
    // to produce a different price.
    // Raw ratio:    demand/supply = 10.0 / 10.9 ≈ 0.9174  → price = round(30 * 0.9174) = 28
    // Floored ratio (the bug): 10 / 10 = 1.0              → price = round(30 * 1.0)    = 30
    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 10.9, demand: 10.0 },
    });
    const fractional = await getMarket(universe.systems.agricultural);

    // Control: already-integer supply — same floored display value (10), but ratio is exactly 1.0.
    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 10.0, demand: 10.0 },
    });
    const integer = await getMarket(universe.systems.agricultural);

    const food = (entries: typeof fractional.entries) =>
      entries.find((e) => e.goodId === goodId)!;

    // If calculatePrice received floored values, both prices would be equal (30).
    // Because it receives the raw float, they differ (28 vs 30).
    expect(food(fractional.entries).currentPrice).not.toBe(food(integer.entries).currentPrice);

    // Display values are floored to the same integer in both cases.
    expect(food(fractional.entries).supply).toBe(10);
    expect(food(integer.entries).supply).toBe(10);
  });
});
