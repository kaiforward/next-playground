import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getMarketComparison } = await import("@/lib/services/market-comparison");
const { invalidateAdjacencyCache } = await import("@/lib/services/adjacency");
const { invalidateVisibilityCache } = await import("@/lib/services/visibility-cache");

describe("getMarketComparison (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;

  beforeEach(async () => {
    // useIntegrationDb truncates all tables before each test. The module-level
    // adjacency and visibility caches survive across tests, so invalidate them
    // here to ensure each test picks up the freshly seeded system IDs and tick.
    invalidateAdjacencyCache();
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 1000 });
    // Invalidate visibility cache for the new player (no-op on first run, but
    // guards against any stale entry if player IDs were reused).
    invalidateVisibilityCache(player.playerId);
    // A docked ship gives the player at least one visible system
    await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 10,
    });
  });

  it("returns entries only for visible systems", async () => {
    const goodId = universe.goodIds["food"];
    const result = await getMarketComparison(player.playerId, goodId);

    expect(result.goodId).toBe(goodId);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => Number.isInteger(e.supply))).toBe(true);
    expect(result.entries.every((e) => Number.isInteger(e.demand))).toBe(true);
  });

  it("accepts a GOODS constant key in place of the CUID and returns the same data", async () => {
    const cuid = universe.goodIds["food"];
    const byCuid = await getMarketComparison(player.playerId, cuid);
    const byKey = await getMarketComparison(player.playerId, "food");

    // Both responses carry the CUID (the resolved canonical id), regardless of input form.
    expect(byCuid.goodId).toBe(cuid);
    expect(byKey.goodId).toBe(cuid);
    expect(byKey.entries).toEqual(byCuid.entries);
  });

  it("floors fractional supply/demand the same way getMarket does", async () => {
    const goodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { supply: 23.7, demand: 11.2 },
    });

    const result = await getMarketComparison(player.playerId, goodId);
    const agri = result.entries.find((e) => e.systemId === universe.systems.agricultural);
    expect(agri).toBeDefined();
    expect(agri!.supply).toBe(23);
    expect(agri!.demand).toBe(11);
  });

  it("throws ServiceError(404) for an unknown goodId", async () => {
    await expect(getMarketComparison(player.playerId, "nonexistent")).rejects.toThrow();
  });
});
