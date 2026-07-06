import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";

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
