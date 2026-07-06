import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { ServiceError } from "@/lib/services/errors";

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
    });
  });

  it("returns entries only for visible systems and excludes systems outside sensor range", async () => {
    // The default ship (shuttle, role=trade) at `agricultural` has sensor range 2.
    // Graph: agri(0) → ind(1) → tech(2). All three systems are within range 2, so
    // we can't prove exclusion with the default ship.
    // Switch to `interceptor` (role=combat, sensor range=1): agri and ind are
    // visible but tech (hop 2) is outside sensor range and must not appear.
    await prisma.ship.updateMany({
      where: { playerId: player.playerId },
      data: { shipType: "interceptor" },
    });
    // Flush the visibility cache so the updated ship type takes effect.
    invalidateVisibilityCache(player.playerId);

    const goodId = universe.goodIds["food"];
    const result = await getMarketComparison(player.playerId, goodId);

    expect(result.goodId).toBe(goodId);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => Number.isInteger(e.stock))).toBe(true);

    // tech system (hop 2 from agri) must be absent — proves non-visible systems
    // are filtered out, not just that some entries are returned.
    const returnedSystemIds = new Set(result.entries.map((e) => e.systemId));
    expect(returnedSystemIds.has(universe.systems.tech)).toBe(false);
    // Sanity-check: the systems that are visible (agri + ind) may have entries.
    expect(
      result.entries.every(
        (e) =>
          e.systemId === universe.systems.agricultural ||
          e.systemId === universe.systems.industrial,
      ),
    ).toBe(true);
  });

  it("floors fractional stock the same way getMarket does", async () => {
    const goodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId } },
      data: { stock: 23.7 },
    });

    const result = await getMarketComparison(player.playerId, goodId);
    const agri = result.entries.find((e) => e.systemId === universe.systems.agricultural);
    expect(agri).toBeDefined();
    expect(agri!.stock).toBe(23);
  });

  it("throws ServiceError(404) for an unknown goodId", async () => {
    await expect(
      getMarketComparison(player.playerId, "nonexistent"),
    ).rejects.toBeInstanceOf(ServiceError);
    await expect(
      getMarketComparison(player.playerId, "nonexistent"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
