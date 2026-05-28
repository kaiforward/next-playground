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

describe("executeTrade (integration) — floored supply in trade error messages", () => {
  it("trade error message reports floored integer supply, not a raw float", async () => {
    const universe = await seedTestUniverse(prisma);
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    // supply=46.8 → UI shows floor(46.8)=46.
    // Before the fix, the validator error said "available 46.8" (raw float).
    // After the fix, it says "available 46" (integer, matching the UI).
    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 46.8, demand: 30 },
    });

    const player = await createTestPlayer(prisma, { credits: 1_000_000 });
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 100,
    });

    // Requesting 1 more than the floored display value to trigger the
    // "not enough supply" error path and inspect the message.
    const result = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId,
      quantity: 47,
      type: "buy",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return; // narrow to the error branch for TypeScript
    // Error must show the integer (46), not the raw float (46.8).
    expect(result.error).toMatch(/available 46\b/);
    expect(result.error).not.toContain("46.8");
  });
});
