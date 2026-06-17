import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { quoteTrade, curveForGood } from "@/lib/engine/market-pricing";
import { getSpread } from "@/lib/constants/market-economy";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";

// Recompute the exact quote the service should charge, independently of the
// trade's own outcome (so a pricing bug can't hide behind a derived assertion).
// The agri system is Federation-owned and the player starts at Neutral standing
// (rep multiplier 1.0), so totalPrice is the raw quote.
async function expectedQuote(
  goodId: string,
  stock: number,
  quantity: number,
  type: "buy" | "sell",
  demandRate: number,
  anchorMult: number = 1,
) {
  const good = await prisma.good.findUniqueOrThrow({ where: { id: goodId } });
  const curve = curveForGood(good.basePrice, good.priceFloor, good.priceCeiling, demandRate, anchorMult);
  const spread = getSpread(GOVERNMENT_TYPES.federation);
  return quoteTrade(curve, stock, quantity, type, spread);
}

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

  it("buy succeeds: credits deducted, cargo added, market stock decreased, trade history created", async () => {
    const foodGoodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    const marketBefore = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });
    expect(marketBefore).not.toBeNull();

    // Pre-compute the exact total the service should charge for this buy.
    const quote = await expectedQuote(foodGoodId, marketBefore!.stock, 5, "buy", marketBefore!.demandRate, marketBefore!.anchorMult);

    const result = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId: foodGoodId,
      quantity: 5,
      type: "buy",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Credits deducted by exactly the quoted total.
    const playerAfter = await prisma.player.findUnique({ where: { id: player.playerId } });
    expect(playerAfter!.credits).toBe(5000 - quote.totalPrice);

    // Cargo added
    const cargo = await prisma.cargoItem.findFirst({ where: { shipId, goodId: foodGoodId } });
    expect(cargo).not.toBeNull();
    expect(cargo!.quantity).toBe(5);

    // Market stock decreased by exactly the quantity bought.
    const marketAfter = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });
    expect(marketAfter!.stock).toBe(marketBefore!.stock - 5);
    expect(result.data.updatedMarket.stock).toBe(Math.floor(marketBefore!.stock - 5));

    // Trade history created.
    const history = await prisma.tradeHistory.findFirst({
      where: { stationId, goodId: foodGoodId, type: "buy" },
    });
    expect(history).not.toBeNull();
    expect(history!.quantity).toBe(5);
    // History stores the per-unit price = round(quoted total / quantity),
    // pinned to the independently-computed quote (not derived from credits).
    expect(history!.price).toBe(Math.round(quote.totalPrice / 5));
  });

  it("sell succeeds: credits added, cargo removed, market stock increased", async () => {
    const foodGoodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    await prisma.cargoItem.create({
      data: { shipId, goodId: foodGoodId, quantity: 10 },
    });

    const marketBefore = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });

    // Pre-compute the exact proceeds the service should pay for this sell.
    const quote = await expectedQuote(foodGoodId, marketBefore!.stock, 5, "sell", marketBefore!.demandRate, marketBefore!.anchorMult);

    const result = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId: foodGoodId,
      quantity: 5,
      type: "sell",
    });

    expect(result.ok).toBe(true);

    // Credits increased by exactly the quoted proceeds.
    const playerAfter = await prisma.player.findUnique({ where: { id: player.playerId } });
    expect(playerAfter!.credits).toBe(5000 + quote.totalPrice);

    // Cargo reduced.
    const cargo = await prisma.cargoItem.findFirst({ where: { shipId, goodId: foodGoodId } });
    expect(cargo!.quantity).toBe(5);

    // Market stock increased by exactly the quantity sold.
    const marketAfter = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });
    expect(marketAfter!.stock).toBe(marketBefore!.stock + 5);
  });

  it("buy then immediate sell-back nets a loss (the bid-ask spread kills the exploit)", async () => {
    const foodGoodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    const marketBefore = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });
    expect(marketBefore).not.toBeNull();

    const buy = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId: foodGoodId,
      quantity: 10,
      type: "buy",
    });
    expect(buy.ok).toBe(true);

    const sellBack = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId: foodGoodId,
      quantity: 10,
      type: "sell",
    });
    expect(sellBack.ok).toBe(true);

    // Round-trip costs the player money — buying and dumping back is unprofitable.
    const playerAfter = await prisma.player.findUnique({ where: { id: player.playerId } });
    expect(playerAfter!.credits).toBeLessThan(5000);

    // Stock returns to where it started (buy -10 then sell +10).
    const marketAfter = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });
    expect(Math.round(marketAfter!.stock)).toBe(Math.round(marketBefore!.stock));
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

  it("buy is blocked when the player has hostile standing with the system's faction", async () => {
    // Hostile-band score for the federation faction (which owns the agri system).
    await prisma.playerFactionReputation.create({
      data: {
        playerId: player.playerId,
        factionId: universe.factions.federation,
        score: -80,
        updatedAtTick: 0,
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
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/hostile/i);
    }
  });

  it("accrues per-tick capped reputation on a successful buy and updates the accumulator", async () => {
    const factionId = universe.factions.federation;
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    // Two trades in the same tick. Both succeed; the accumulator should
    // show the sum of granted gains.
    const r1 = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId,
      quantity: 1,
      type: "buy",
    });
    const r2 = await executeTrade(player.playerId, shipId, {
      stationId,
      goodId,
      quantity: 1,
      type: "buy",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    const row = await prisma.playerFactionReputation.findUnique({
      where: { playerId_factionId: { playerId: player.playerId, factionId } },
    });
    expect(row?.score).toBeCloseTo(1); // two trades × 0.5 each
    expect(row?.currentTickGainThisTick).toBeCloseTo(1);
    expect(row?.updatedAtTick).toBe(10); // tick from seedTestUniverse
  });

  it("respects REPUTATION_TRADE_GAIN_CAP_PER_TICK across many trades in the same tick", async () => {
    const factionId = universe.factions.federation;
    const stationId = universe.stations.agricultural;
    const goodId = universe.goodIds["food"];

    // Bump credits + cargo so we can do many sequential buys.
    await prisma.player.update({ where: { id: player.playerId }, data: { credits: 100_000 } });
    await prisma.ship.update({ where: { id: shipId }, data: { cargoMax: 500 } });

    // Drive ten buys — well past the cap budget (2.0 / 0.5 = 4 buys).
    for (let i = 0; i < 10; i++) {
      const r = await executeTrade(player.playerId, shipId, {
        stationId,
        goodId,
        quantity: 1,
        type: "buy",
      });
      expect(r.ok).toBe(true);
    }

    const row = await prisma.playerFactionReputation.findUnique({
      where: { playerId_factionId: { playerId: player.playerId, factionId } },
    });
    expect(row?.score).toBeCloseTo(2);
    expect(row?.currentTickGainThisTick).toBeCloseTo(2);
  });
});
