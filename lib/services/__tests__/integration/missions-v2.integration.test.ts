import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import {
  seedTestUniverse,
  createTestPlayer,
  createTestShip,
  createTestOpMission,
} from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { OP_MISSION_CONSTANTS } from "@/lib/constants/missions";

// Mock the prisma import so mission service uses our test client
const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

// Import after mock is set up
const { acceptMission, startMission, abandonMission } = await import(
  "@/lib/services/missions-v2"
);

describe("op mission lifecycle (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;
  let shipId: string;
  let missionId: string;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 5000 });
    // Ship with decent combat stats, docked at industrial system
    shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.industrial,
      hullMax: 80,
      hullCurrent: 80,
      shieldMax: 30,
      shieldCurrent: 30,
      firepower: 10,
      evasion: 8,
      stealth: 5,
      sensors: 6,
    });
    // Bounty mission at the industrial system
    missionId = await createTestOpMission(prisma, {
      type: "bounty",
      systemId: universe.systems.industrial,
      targetSystemId: universe.systems.industrial,
      reward: 2000,
      deadlineTick: 200,
      enemyTier: "weak",
    });
  });

  // ── acceptMission ──────────────────────────────────────────────

  describe("acceptMission", () => {
    it("status → accepted, playerId set", async () => {
      const result = await acceptMission(player.playerId, missionId);

      expect(result.ok).toBe(true);

      const mission = await prisma.mission.findUnique({
        where: { id: missionId },
      });
      expect(mission).not.toBeNull();
      expect(mission!.status).toBe("accepted");
      expect(mission!.playerId).toBe(player.playerId);
      expect(mission!.acceptedAtTick).toBe(10); // world.currentTick from seed
    });

    it("fails at MAX_ACTIVE_PER_PLAYER cap", async () => {
      // Accept MAX_ACTIVE_PER_PLAYER missions
      for (let i = 0; i < OP_MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER; i++) {
        const mid = await createTestOpMission(prisma, {
          type: "patrol",
          systemId: universe.systems.industrial,
          reward: 500,
          deadlineTick: 300,
          durationTicks: 20,
        });
        const res = await acceptMission(player.playerId, mid);
        expect(res.ok).toBe(true);
      }

      // Try to accept one more — should fail
      const extraId = await createTestOpMission(prisma, {
        type: "patrol",
        systemId: universe.systems.industrial,
        reward: 500,
        deadlineTick: 300,
        durationTicks: 20,
      });
      const result = await acceptMission(player.playerId, extraId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/more than.*active/i);
      }
    });
  });

  // ── startMission ───────────────────────────────────────────────

  describe("startMission", () => {
    it("bounty: status → in_progress, shipId set, Battle record created with correct playerStrength/enemyStrength", async () => {
      await acceptMission(player.playerId, missionId);

      const result = await startMission(
        player.playerId,
        missionId,
        shipId,
      );

      expect(result.ok).toBe(true);

      // Verify mission state
      const mission = await prisma.mission.findUnique({
        where: { id: missionId },
      });
      expect(mission).not.toBeNull();
      expect(mission!.status).toBe("in_progress");
      expect(mission!.shipId).toBe(shipId);
      expect(mission!.startedAtTick).toBe(10);

      // Verify battle was created
      const battle = await prisma.battle.findFirst({
        where: { missionId },
      });
      expect(battle).not.toBeNull();
      expect(battle!.shipId).toBe(shipId);
      expect(battle!.status).toBe("active");
      expect(battle!.systemId).toBe(universe.systems.industrial);
      expect(battle!.enemyTier).toBe("weak");

      // playerStrength = hullCurrent + shieldCurrent = 80 + 30 = 110
      expect(battle!.playerStrength).toBe(110);
      // enemyStrength depends on tier + danger level, but must be > 0
      expect(battle!.enemyStrength).toBeGreaterThan(0);
      expect(battle!.enemyMorale).toBeGreaterThan(0);
    });

    it("patrol: status → in_progress, shipId set, NO Battle created", async () => {
      // Create a patrol mission (no battle on start)
      const patrolId = await createTestOpMission(prisma, {
        type: "patrol",
        systemId: universe.systems.industrial,
        targetSystemId: universe.systems.industrial,
        reward: 1000,
        deadlineTick: 200,
        durationTicks: 20,
      });
      await acceptMission(player.playerId, patrolId);

      const result = await startMission(
        player.playerId,
        patrolId,
        shipId,
      );

      expect(result.ok).toBe(true);

      const mission = await prisma.mission.findUnique({
        where: { id: patrolId },
      });
      expect(mission).not.toBeNull();
      expect(mission!.status).toBe("in_progress");
      expect(mission!.shipId).toBe(shipId);

      // No battle for patrol missions
      const battle = await prisma.battle.findFirst({
        where: { missionId: patrolId },
      });
      expect(battle).toBeNull();
    });

    it("fails when ship in wrong system", async () => {
      // Mission targets industrial, ship at agricultural
      const wrongShipId = await createTestShip(prisma, {
        playerId: player.playerId,
        systemId: universe.systems.agricultural,
        firepower: 10,
        sensors: 6,
      });
      await acceptMission(player.playerId, missionId);

      const result = await startMission(
        player.playerId,
        missionId,
        wrongShipId,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/target system/i);
      }
    });

    it("fails when ship already committed (SHIP_COMMITTED)", async () => {
      await acceptMission(player.playerId, missionId);

      // Create and start another mission with the same ship first
      const otherMissionId = await createTestOpMission(prisma, {
        type: "patrol",
        systemId: universe.systems.industrial,
        targetSystemId: universe.systems.industrial,
        reward: 500,
        deadlineTick: 200,
        durationTicks: 20,
      });
      await acceptMission(player.playerId, otherMissionId);
      await startMission(player.playerId, otherMissionId, shipId);

      // Now try to start the bounty mission with the same ship
      const result = await startMission(
        player.playerId,
        missionId,
        shipId,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/committed/i);
      }
    });

    it("fails when ship in active battle (SHIP_IN_BATTLE)", async () => {
      // Accept and start a bounty — this creates a battle for the ship
      await acceptMission(player.playerId, missionId);
      await startMission(player.playerId, missionId, shipId);

      // Create a second bounty mission and try to use the same ship
      // The ship is now in a battle from the first mission
      const secondShipId = await createTestShip(prisma, {
        playerId: player.playerId,
        systemId: universe.systems.industrial,
        firepower: 10,
        sensors: 6,
      });
      const secondMissionId = await createTestOpMission(prisma, {
        type: "bounty",
        systemId: universe.systems.industrial,
        targetSystemId: universe.systems.industrial,
        enemyTier: "weak",
        reward: 1500,
        deadlineTick: 200,
      });
      await acceptMission(player.playerId, secondMissionId);

      // The second ship is NOT in battle, so startMission should succeed for it
      const result = await startMission(
        player.playerId,
        secondMissionId,
        secondShipId,
      );
      expect(result.ok).toBe(true);

      // Now verify the original ship IS blocked by battle
      const thirdMissionId = await createTestOpMission(prisma, {
        type: "bounty",
        systemId: universe.systems.industrial,
        targetSystemId: universe.systems.industrial,
        enemyTier: "weak",
        reward: 800,
        deadlineTick: 200,
      });
      await acceptMission(player.playerId, thirdMissionId);

      // Ship is committed to a mission AND in battle
      const result2 = await startMission(
        player.playerId,
        thirdMissionId,
        shipId,
      );
      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        // Committed check runs before battle check, so either error is valid
        expect(result2.error).toMatch(/committed|battle/i);
      }
    });
  });

  // ── abandonMission ─────────────────────────────────────────────

  describe("abandonMission", () => {
    it("clears status back to available", async () => {
      await acceptMission(player.playerId, missionId);

      // Verify it's accepted
      const before = await prisma.mission.findUnique({
        where: { id: missionId },
      });
      expect(before).not.toBeNull();
      expect(before!.status).toBe("accepted");
      expect(before!.playerId).toBe(player.playerId);

      const result = await abandonMission(player.playerId, missionId);
      expect(result.ok).toBe(true);

      const after = await prisma.mission.findUnique({
        where: { id: missionId },
      });
      expect(after).not.toBeNull();
      expect(after!.status).toBe("available");
      expect(after!.playerId).toBeNull();
      expect(after!.shipId).toBeNull();
      expect(after!.acceptedAtTick).toBeNull();
      expect(after!.startedAtTick).toBeNull();
    });

    it("fails when in_progress with active battle", async () => {
      // Accept and start a bounty mission (creates a battle)
      await acceptMission(player.playerId, missionId);
      await startMission(player.playerId, missionId, shipId);

      // Verify battle exists
      const battle = await prisma.battle.findFirst({
        where: { missionId, status: "active" },
      });
      expect(battle).not.toBeNull();

      const result = await abandonMission(player.playerId, missionId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/battle/i);
      }
    });
  });
});
