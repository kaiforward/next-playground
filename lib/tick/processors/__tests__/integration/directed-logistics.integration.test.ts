import { describe, it, expect, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";
import { PrismaDirectedLogisticsWorld } from "@/lib/tick/adapters/prisma/directed-logistics";

const { prisma } = useIntegrationDb();

describe("directed-logistics Contract I/O (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
  });

  it("creates a logistics Contract, then reads + closes it after its deadline", async () => {
    // Arrange: bind real fixture identifiers from the seeded universe.
    // federation owns the agricultural system; industrial is in the same
    // faction shard (corporate) — use federation faction + two of its systems
    // (agri → ind is connected, so a realistic hop).
    const factionId = universe.factions.federation;
    const fromId = universe.systems.agricultural;
    const toId = universe.systems.industrial;
    // "food" exists as a Good row in every seeded universe (GOODS constant).
    const goodKey = "food";

    // Act: create one Contract due at tick 100.
    await prisma.$transaction(async (tx) => {
      const world = new PrismaDirectedLogisticsWorld(tx);

      await world.createLogisticsContracts([{
        fromSystemId: fromId,
        toSystemId: toId,
        goodId: goodKey,
        quantity: 7,
        reward: 50,
        deadlineTick: 100,
        factionId,
        createdAtTick: 52,
      }]);
    }, { timeout: 30_000 });

    // Assert: the row exists with origin="logistics", unclaimed, and no dangling FK.
    const created = await prisma.tradeMission.findMany({
      where: { origin: "logistics", systemId: fromId, destinationId: toId },
    });
    expect(created).toHaveLength(1);
    expect(created[0].playerId).toBeNull();

    // Act + Assert: not yet expired at tick 99; expired+returned at tick 100;
    // then closeable (deleted). Both live inside one transaction to keep isolation.
    await prisma.$transaction(async (tx) => {
      const world = new PrismaDirectedLogisticsWorld(tx);

      // Not yet expired at tick 99.
      expect(await world.takeExpiredLogisticsContracts(99, [factionId])).toHaveLength(0);

      // Expired at tick 100 → returned with KEY good + correct endpoints.
      const expired = await world.takeExpiredLogisticsContracts(100, [factionId]);
      expect(expired).toHaveLength(1);
      expect(expired[0]).toMatchObject({
        fromSystemId: fromId,
        toSystemId: toId,
        goodId: goodKey,
        quantity: 7,
      });

      // Close (delete) the expired contract.
      await world.closeLogisticsContracts(expired.map((e) => e.id));
    }, { timeout: 30_000 });

    // Assert: row is gone.
    const after = await prisma.tradeMission.findMany({
      where: { origin: "logistics", systemId: fromId, destinationId: toId },
    });
    expect(after).toHaveLength(0);
  });
});
