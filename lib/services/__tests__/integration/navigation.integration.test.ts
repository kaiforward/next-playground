import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";

// Mock the prisma import so executeNavigation uses our test client
const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { executeNavigation } = await import("@/lib/services/navigation");

describe("executeNavigation (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 1000 });
  });

  it("single-hop: status → in_transit, fuel deducted, arrivalTick set", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      fuel: 100,
      speed: 5,
    });

    const route = [universe.systems.agricultural, universe.systems.industrial];
    const result = await executeNavigation(player.playerId, shipId, route);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Ship should be in transit
    const ship = await prisma.ship.findUnique({ where: { id: shipId } });
    expect(ship!.status).toBe("in_transit");
    expect(ship!.fuel).toBe(90); // 100 - 10 (fuel cost agri→ind)
    expect(ship!.destinationSystemId).toBe(universe.systems.industrial);
    expect(ship!.arrivalTick).toBeGreaterThan(10); // current tick is 10

    // Fuel used should match
    expect(result.data.fuelUsed).toBe(10);
  });

  it("multi-hop (sys1→sys2→sys3): total fuel = sum of hops", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      fuel: 100,
      speed: 5,
    });

    // agri → ind → tech (10 + 15 = 25 fuel)
    const route = [
      universe.systems.agricultural,
      universe.systems.industrial,
      universe.systems.tech,
    ];

    const result = await executeNavigation(player.playerId, shipId, route);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ship = await prisma.ship.findUnique({ where: { id: shipId } });
    expect(ship!.fuel).toBe(75); // 100 - 25
    expect(ship!.destinationSystemId).toBe(universe.systems.tech);
    expect(result.data.fuelUsed).toBe(25);
    // Travel duration should reflect both hops
    expect(result.data.travelDuration).toBeGreaterThan(0);
  });

  it("fails when route starts at wrong system", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      fuel: 100,
    });

    // Route starts at industrial, but ship is at agricultural
    const route = [universe.systems.industrial, universe.systems.tech];
    const result = await executeNavigation(player.playerId, shipId, route);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/current system/i);
    }
  });

  it("fails with insufficient fuel", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      fuel: 5, // Not enough for 10-fuel hop
    });

    const route = [universe.systems.agricultural, universe.systems.industrial];
    const result = await executeNavigation(player.playerId, shipId, route);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/fuel/i);
    }
  });

  it("fails when ship is in transit", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      status: "in_transit",
      destinationSystemId: universe.systems.industrial,
      arrivalTick: 20,
    });

    const route = [universe.systems.agricultural, universe.systems.industrial];
    const result = await executeNavigation(player.playerId, shipId, route);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/docked/i);
    }
  });

  it("fails when ship is disabled", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      disabled: true,
    });

    const route = [universe.systems.agricultural, universe.systems.industrial];
    const result = await executeNavigation(player.playerId, shipId, route);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/disabled/i);
    }
  });

  it("fails with no connection between non-adjacent systems", async () => {
    const shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      fuel: 100,
    });

    // agri → tech directly (no connection exists)
    const route = [universe.systems.agricultural, universe.systems.tech];
    const result = await executeNavigation(player.playerId, shipId, route);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/connection|route/i);
    }
  });
});
