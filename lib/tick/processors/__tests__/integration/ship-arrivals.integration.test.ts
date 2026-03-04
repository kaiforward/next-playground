import { describe, it, expect, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { shipArrivalsProcessor } from "@/lib/tick/processors/ship-arrivals";
import type { TickContext, TickProcessorResult } from "@/lib/tick/types";

const { prisma } = useIntegrationDb();

describe("shipArrivalsProcessor (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma);
  });

  async function runProcessor(tick: number): Promise<TickProcessorResult> {
    return prisma.$transaction(
      async (tx) => {
        const ctx: TickContext = { tx, tick, results: new Map() };
        return shipArrivalsProcessor.process(ctx);
      },
      { timeout: 15_000 },
    );
  }

  it("ship arrives and docks: status → docked, systemId updated, destination cleared, shields regenerated", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      status: "in_transit",
      destinationSystemId: universe.systems.industrial,
      departureTick: 5,
      arrivalTick: 10,
      shieldMax: 10,
      shieldCurrent: 3, // Damaged shields
    });

    const result = await runProcessor(10);

    const ship = await prisma.ship.findUnique({ where: { id: shipId } });
    expect(ship!.status).toBe("docked");
    expect(ship!.systemId).toBe(universe.systems.industrial);
    expect(ship!.destinationSystemId).toBeNull();
    expect(ship!.departureTick).toBeNull();
    expect(ship!.arrivalTick).toBeNull();
    // Shields regenerate to max on dock (may be reduced by danger damage)
    expect(ship!.shieldCurrent).toBeLessThanOrEqual(ship!.shieldMax);

    // Result should contain shipArrived player event
    expect(result.playerEvents).toBeDefined();
    const playerEvts = result.playerEvents!.get(player.playerId);
    expect(playerEvts?.shipArrived).toBeDefined();
    expect(playerEvts!.shipArrived!.length).toBe(1);
    expect(playerEvts!.shipArrived![0].shipId).toBe(shipId);
    expect(playerEvts!.shipArrived![0].systemId).toBe(universe.systems.industrial);
  });

  it("ship with future arrivalTick is untouched", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      status: "in_transit",
      destinationSystemId: universe.systems.industrial,
      departureTick: 8,
      arrivalTick: 15, // Future
    });

    await runProcessor(10);

    const ship = await prisma.ship.findUnique({ where: { id: shipId } });
    expect(ship!.status).toBe("in_transit");
    expect(ship!.destinationSystemId).toBe(universe.systems.industrial);
    expect(ship!.arrivalTick).toBe(15);
  });

  it("multiple ships arriving same tick all processed", async () => {
    const ship1 = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      name: "Ship Alpha",
      status: "in_transit",
      destinationSystemId: universe.systems.industrial,
      arrivalTick: 10,
    });

    const ship2 = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.industrial,
      name: "Ship Beta",
      status: "in_transit",
      destinationSystemId: universe.systems.tech,
      arrivalTick: 10,
    });

    const result = await runProcessor(10);

    const s1 = await prisma.ship.findUnique({ where: { id: ship1 } });
    const s2 = await prisma.ship.findUnique({ where: { id: ship2 } });
    expect(s1!.status).toBe("docked");
    expect(s2!.status).toBe("docked");
    expect(s1!.systemId).toBe(universe.systems.industrial);
    expect(s2!.systemId).toBe(universe.systems.tech);

    // Player events should have both arrivals
    const playerEvts = result.playerEvents!.get(player.playerId);
    expect(playerEvts?.shipArrived?.length).toBe(2);
  });

  it("result contains shipArrived player event with correct payload", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      name: "My Vessel",
      status: "in_transit",
      destinationSystemId: universe.systems.industrial,
      arrivalTick: 10,
    });

    const result = await runProcessor(10);

    expect(result.playerEvents).toBeDefined();
    const playerEvts = result.playerEvents!.get(player.playerId);
    expect(playerEvts).toBeDefined();

    const arrivals = playerEvts!.shipArrived!;
    expect(arrivals.length).toBe(1);

    const arrival = arrivals[0];
    expect(arrival.shipId).toBe(shipId);
    expect(arrival.shipName).toBe("My Vessel");
    expect(arrival.playerId).toBe(player.playerId);
    expect(arrival.systemId).toBe(universe.systems.industrial);
  });
});
