import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import {
  seedTestUniverse,
  createTestPlayer,
  createTestShip,
  createTestTradeMission,
} from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { calculatePrice } from "@/lib/engine/pricing";
import { MISSION_CONSTANTS } from "@/lib/constants/missions";

// Mock the prisma import so mission service uses our test client
const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

// Import after mock is set up
const { acceptMission, deliverMission, abandonMission } = await import(
  "@/lib/services/missions"
);

describe("trade mission lifecycle (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;
  let shipId: string;
  let missionId: string;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 5000 });
    shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 100,
    });
    missionId = await createTestTradeMission(prisma, {
      systemId: universe.systems.agricultural,
      destinationId: universe.systems.agricultural,
      goodId: universe.goodIds["food"],
      quantity: 10,
      reward: 500,
      deadlineTick: 200,
    });
  });

  // ── acceptMission ──────────────────────────────────────────────

  describe("acceptMission", () => {
    it("sets playerId and acceptedAtTick", async () => {
      const result = await acceptMission(player.playerId, missionId);

      expect(result.ok).toBe(true);

      const mission = await prisma.tradeMission.findUnique({
        where: { id: missionId },
      });
      expect(mission).not.toBeNull();
      expect(mission!.playerId).toBe(player.playerId);
      expect(mission!.acceptedAtTick).toBe(10); // world.currentTick from seed
    });

    it("fails when mission already accepted by another player", async () => {
      const otherPlayer = await createTestPlayer(prisma, { credits: 1000 });

      // First player accepts
      const first = await acceptMission(otherPlayer.playerId, missionId);
      expect(first.ok).toBe(true);

      // Second player tries to accept the same mission
      const second = await acceptMission(player.playerId, missionId);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.error).toMatch(/already accepted|no longer available|unavailable/i);
      }
    });

    it("fails when player at MAX_ACTIVE cap", async () => {
      // Create and accept MAX_ACTIVE_PER_PLAYER missions
      for (let i = 0; i < MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER; i++) {
        const mid = await createTestTradeMission(prisma, {
          systemId: universe.systems.agricultural,
          destinationId: universe.systems.industrial,
          goodId: universe.goodIds["food"],
          quantity: 5,
          reward: 100,
          deadlineTick: 300,
        });
        const res = await acceptMission(player.playerId, mid);
        expect(res.ok).toBe(true);
      }

      // Now try to accept one more — should fail
      const extraMissionId = await createTestTradeMission(prisma, {
        systemId: universe.systems.agricultural,
        destinationId: universe.systems.industrial,
        goodId: universe.goodIds["ore"],
        quantity: 5,
        reward: 100,
        deadlineTick: 300,
      });
      const result = await acceptMission(player.playerId, extraMissionId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/more than.*active missions/i);
      }
    });
  });

  // ── deliverMission ─────────────────────────────────────────────

  describe("deliverMission", () => {
    it("atomic 5-table write: cargo decremented, market supply incremented, credits += goodsValue + reward, trade history created, mission deleted", async () => {
      // Accept the mission first
      await acceptMission(player.playerId, missionId);

      // Pre-load cargo for delivery
      await prisma.cargoItem.create({
        data: { shipId, goodId: universe.goodIds["food"], quantity: 20 },
      });

      // Snapshot before state
      const playerBefore = await prisma.player.findUnique({
        where: { id: player.playerId },
      });
      expect(playerBefore).not.toBeNull();
      const stationId = universe.stations.agricultural;
      const marketBefore = await prisma.stationMarket.findUnique({
        where: {
          stationId_goodId: { stationId, goodId: universe.goodIds["food"] },
        },
        include: { good: true },
      });
      expect(marketBefore).not.toBeNull();

      const expectedUnitPrice = calculatePrice(
        marketBefore!.good.basePrice,
        marketBefore!.supply,
        marketBefore!.demand,
        marketBefore!.good.priceFloor,
        marketBefore!.good.priceCeiling,
      );
      const expectedGoodsValue = expectedUnitPrice * 10;
      const expectedTotalCredit = expectedGoodsValue + 500;

      const result = await deliverMission(
        player.playerId,
        missionId,
        shipId,
      );

      expect(result.ok).toBe(true);

      // 1. Cargo decremented (20 - 10 = 10)
      const cargoAfter = await prisma.cargoItem.findFirst({
        where: { shipId, goodId: universe.goodIds["food"] },
      });
      expect(cargoAfter).not.toBeNull();
      expect(cargoAfter!.quantity).toBe(10);

      // 2. Market supply incremented by mission quantity
      const marketAfter = await prisma.stationMarket.findUnique({
        where: {
          stationId_goodId: { stationId, goodId: universe.goodIds["food"] },
        },
      });
      expect(marketAfter).not.toBeNull();
      expect(marketAfter!.supply).toBe(marketBefore!.supply + 10);

      // 3. Credits += goodsValue + reward
      const playerAfter = await prisma.player.findUnique({
        where: { id: player.playerId },
      });
      expect(playerAfter).not.toBeNull();
      expect(playerAfter!.credits).toBe(
        playerBefore!.credits + expectedTotalCredit,
      );

      // 4. Trade history created
      const history = await prisma.tradeHistory.findFirst({
        where: {
          stationId,
          goodId: universe.goodIds["food"],
          type: "sell",
          playerId: player.playerId,
        },
      });
      expect(history).not.toBeNull();
      expect(history!.quantity).toBe(10);

      // 5. Mission deleted
      const missionAfter = await prisma.tradeMission.findUnique({
        where: { id: missionId },
      });
      expect(missionAfter).toBeNull();
    });

    it("fails when ship not at destination system", async () => {
      await acceptMission(player.playerId, missionId);

      // Move ship to a different system
      const otherShipId = await createTestShip(prisma, {
        playerId: player.playerId,
        systemId: universe.systems.industrial,
        cargoMax: 100,
      });
      await prisma.cargoItem.create({
        data: {
          shipId: otherShipId,
          goodId: universe.goodIds["food"],
          quantity: 20,
        },
      });

      const result = await deliverMission(
        player.playerId,
        missionId,
        otherShipId,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/destination/i);
      }
    });

    it("fails when past deadlineTick", async () => {
      await acceptMission(player.playerId, missionId);
      await prisma.cargoItem.create({
        data: { shipId, goodId: universe.goodIds["food"], quantity: 20 },
      });

      // Advance currentTick past deadline
      await prisma.gameWorld.update({
        where: { id: "world" },
        data: { currentTick: 300 },
      });

      const result = await deliverMission(
        player.playerId,
        missionId,
        shipId,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/expired/i);
      }
    });

    it("fails when insufficient cargo", async () => {
      await acceptMission(player.playerId, missionId);

      // Only load 5 units when mission requires 10
      await prisma.cargoItem.create({
        data: { shipId, goodId: universe.goodIds["food"], quantity: 5 },
      });

      const result = await deliverMission(
        player.playerId,
        missionId,
        shipId,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/cargo/i);
      }
    });
  });

  // ── abandonMission ─────────────────────────────────────────────

  describe("abandonMission", () => {
    it("clears playerId and acceptedAtTick", async () => {
      await acceptMission(player.playerId, missionId);

      // Verify it's accepted
      const before = await prisma.tradeMission.findUnique({
        where: { id: missionId },
      });
      expect(before).not.toBeNull();
      expect(before!.playerId).toBe(player.playerId);

      const result = await abandonMission(player.playerId, missionId);
      expect(result.ok).toBe(true);

      const after = await prisma.tradeMission.findUnique({
        where: { id: missionId },
      });
      expect(after).not.toBeNull();
      expect(after!.playerId).toBeNull();
      expect(after!.acceptedAtTick).toBeNull();
    });
  });
});
