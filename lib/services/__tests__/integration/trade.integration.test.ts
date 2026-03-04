import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { calculatePrice } from "@/lib/engine/pricing";
import { GOODS } from "@/lib/constants/goods";

// Mock the prisma import so executeTrade uses our test client
const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

// Import after mock is set up
const { executeTrade } = await import("@/lib/services/trade");

describe("executeTrade (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;
  let shipId: string;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 5000 });
    shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 50,
    });
  });

  it("buy succeeds: credits deducted, cargo added, market supply decreased, trade history created", async () => {
    const foodGoodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    // Get market state before trade
    const marketBefore = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
      include: { good: true },
    });
    expect(marketBefore).not.toBeNull();

    const expectedPrice = calculatePrice(
      marketBefore!.good.basePrice,
      marketBefore!.supply,
      marketBefore!.demand,
      marketBefore!.good.priceFloor,
      marketBefore!.good.priceCeiling,
    );

    const result = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId: foodGoodId,
      quantity: 5,
      type: "buy",
    });

    expect(result.ok).toBe(true);

    // Verify credits deducted
    const playerAfter = await prisma.player.findUnique({ where: { id: player.playerId } });
    expect(playerAfter!.credits).toBe(5000 - expectedPrice * 5);

    // Verify cargo added
    const cargo = await prisma.cargoItem.findFirst({ where: { shipId, goodId: foodGoodId } });
    expect(cargo).not.toBeNull();
    expect(cargo!.quantity).toBe(5);

    // Verify market supply decreased
    const marketAfter = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });
    expect(marketAfter!.supply).toBe(marketBefore!.supply - 5);

    // Verify trade history created
    const history = await prisma.tradeHistory.findFirst({
      where: { stationId, goodId: foodGoodId, type: "buy" },
    });
    expect(history).not.toBeNull();
    expect(history!.quantity).toBe(5);
    expect(history!.price).toBe(expectedPrice);
  });

  it("sell succeeds: credits added, cargo removed, market supply increased", async () => {
    const foodGoodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    // Pre-load cargo
    await prisma.cargoItem.create({
      data: { shipId, goodId: foodGoodId, quantity: 10 },
    });

    const marketBefore = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
      include: { good: true },
    });

    const expectedPrice = calculatePrice(
      marketBefore!.good.basePrice,
      marketBefore!.supply,
      marketBefore!.demand,
      marketBefore!.good.priceFloor,
      marketBefore!.good.priceCeiling,
    );

    const result = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId: foodGoodId,
      quantity: 5,
      type: "sell",
    });

    expect(result.ok).toBe(true);

    // Credits added
    const playerAfter = await prisma.player.findUnique({ where: { id: player.playerId } });
    expect(playerAfter!.credits).toBe(5000 + expectedPrice * 5);

    // Cargo reduced
    const cargo = await prisma.cargoItem.findFirst({ where: { shipId, goodId: foodGoodId } });
    expect(cargo!.quantity).toBe(5);

    // Market supply increased
    const marketAfter = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });
    expect(marketAfter!.supply).toBe(marketBefore!.supply + 5);
  });

  it("buy fails with insufficient credits", async () => {
    // Set credits very low
    await prisma.player.update({ where: { id: player.playerId }, data: { credits: 1 } });

    const result = await executeTrade(player.playerId, shipId, {
      stationId: universe.stations.agricultural,
      goodId: universe.goodIds["electronics"],
      quantity: 10,
      type: "buy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/credits/i);
    }
  });

  it("buy fails when cargo is full", async () => {
    // Fill cargo to max
    await prisma.cargoItem.create({
      data: { shipId, goodId: universe.goodIds["ore"], quantity: 50 },
    });

    const result = await executeTrade(player.playerId, shipId, {
      stationId: universe.stations.agricultural,
      goodId: universe.goodIds["food"],
      quantity: 1,
      type: "buy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cargo/i);
    }
  });

  it("sell fails when no cargo of that good", async () => {
    const result = await executeTrade(player.playerId, shipId, {
      stationId: universe.stations.agricultural,
      goodId: universe.goodIds["food"],
      quantity: 5,
      type: "sell",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cargo/i);
    }
  });

  it("buy fails when ship is in transit", async () => {
    await prisma.ship.update({
      where: { id: shipId },
      data: {
        status: "in_transit",
        destinationSystemId: universe.systems.industrial,
        arrivalTick: 20,
      },
    });

    const result = await executeTrade(player.playerId, shipId, {
      stationId: universe.stations.agricultural,
      goodId: universe.goodIds["food"],
      quantity: 1,
      type: "buy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/docked/i);
    }
  });
});
