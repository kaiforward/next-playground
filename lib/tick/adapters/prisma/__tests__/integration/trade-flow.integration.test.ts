import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

// Imported after the prisma mock so the adapter's off-transaction open-edge read
// and the adjacency service both resolve to the integration client.
const { PrismaTradeFlowWorld } = await import("@/lib/tick/adapters/prisma/trade-flow");
const { invalidateAdjacencyCache } = await import("@/lib/services/adjacency");

describe("PrismaTradeFlowWorld (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    // useIntegrationDb truncates every table before each test, but the process-level
    // adjacency + open-edge caches survive. Clear them so each test rebuilds the
    // topology from the freshly seeded universe (also exercises the #3 hook).
    invalidateAdjacencyCache();
    universe = await seedTestUniverse(prisma);
  });

  it("getOpenEdges returns only same-faction edges and reads off the tick transaction", async () => {
    // Seeded topology: agri(federation) ↔ ind(corporate) ↔ tech(corporate).
    // Only ind↔tech shares a faction; agri↔ind crosses a faction border and is
    // excluded. The connection read happens via the module prisma client, not tx.
    const edges = await prisma.$transaction((tx) =>
      new PrismaTradeFlowWorld(tx).getOpenEdges(),
    );

    expect(edges).toHaveLength(1);
    const [edge] = edges;
    const corpPair = new Set([universe.systems.industrial, universe.systems.tech]);
    expect(corpPair.has(edge.aSystemId)).toBe(true);
    expect(corpPair.has(edge.bSystemId)).toBe(true);
    expect(edge.fuelCost).toBe(15); // ind↔tech fuelCost from the fixture
    // The cross-faction agri system never appears on an open edge.
    expect(edge.aSystemId).not.toBe(universe.systems.agricultural);
    expect(edge.bSystemId).not.toBe(universe.systems.agricultural);
  });

  it("getRecentPlayerVolumeBySystem sums TradeHistory.quantity per system in SQL", async () => {
    const foodGoodId = universe.goodIds["food"];
    // Two recent trades at the industrial station (60 + 40) and one at tech (25).
    // Station↔System is 1:1, so the SQL join collapses station rows onto systems.
    await prisma.tradeHistory.createMany({
      data: [
        { stationId: universe.stations.industrial, goodId: foodGoodId, price: 100, quantity: 60, type: "buy" },
        { stationId: universe.stations.industrial, goodId: foodGoodId, price: 100, quantity: 40, type: "sell" },
        { stationId: universe.stations.tech, goodId: foodGoodId, price: 100, quantity: 25, type: "buy" },
      ],
    });

    const volume = await prisma.$transaction((tx) =>
      new PrismaTradeFlowWorld(tx).getRecentPlayerVolumeBySystem([
        universe.systems.industrial,
        universe.systems.tech,
        universe.systems.agricultural,
      ]),
    );

    expect(volume.get(universe.systems.industrial)).toBe(100); // 60 + 40
    expect(volume.get(universe.systems.tech)).toBe(25);
    // No trades at agri → absent from the map (the processor treats missing as 0).
    expect(volume.has(universe.systems.agricultural)).toBe(false);
  });

  it("getRecentPlayerVolumeBySystem excludes trades older than the volume window", async () => {
    const foodGoodId = universe.goodIds["food"];
    const stale = new Date(Date.now() - TRADE_SIMULATION.PLAYER_VOLUME_WINDOW_MS - 60_000);
    await prisma.tradeHistory.create({
      data: {
        stationId: universe.stations.tech,
        goodId: foodGoodId,
        price: 100,
        quantity: 25,
        type: "buy",
        createdAt: stale,
      },
    });

    const volume = await prisma.$transaction((tx) =>
      new PrismaTradeFlowWorld(tx).getRecentPlayerVolumeBySystem([universe.systems.tech]),
    );

    expect(volume.has(universe.systems.tech)).toBe(false); // outside the window
  });

  it("invalidateAdjacencyCache clears the open-edge cache so topology changes take effect", async () => {
    // Warm the cache: ind↔tech is the one same-faction (corporate) edge.
    const first = await prisma.$transaction((tx) =>
      new PrismaTradeFlowWorld(tx).getOpenEdges(),
    );
    expect(first).toHaveLength(1);

    // Move tech into the federation faction → ind↔tech becomes a cross-faction border.
    await prisma.starSystem.update({
      where: { id: universe.systems.tech },
      data: { factionId: universe.factions.federation },
    });

    // Stale cache still serves the old edge until invalidated.
    const stale = await prisma.$transaction((tx) =>
      new PrismaTradeFlowWorld(tx).getOpenEdges(),
    );
    expect(stale).toHaveLength(1);

    // Invalidation clears both the faction map and the derived open-edge cache.
    invalidateAdjacencyCache();
    const fresh = await prisma.$transaction((tx) =>
      new PrismaTradeFlowWorld(tx).getOpenEdges(),
    );
    expect(fresh).toHaveLength(0);
  });
});
