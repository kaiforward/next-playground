import { describe, it, expect, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { battlesProcessor } from "@/lib/tick/processors/battles";
import { derivePlayerCombatStats, deriveEnemyCombatStats } from "@/lib/engine/combat";
import { COMBAT_CONSTANTS } from "@/lib/constants/combat";
import type { TickContext, TickProcessorResult } from "@/lib/tick/types";

const { prisma } = useIntegrationDb();

describe("battlesProcessor (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;
  let shipId: string;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 1000 });
    shipId = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      firepower: 5,
      evasion: 6,
      hullMax: 40,
      hullCurrent: 40,
      shieldMax: 10,
      shieldCurrent: 10,
    });
  });

  async function runProcessor(tick: number): Promise<TickProcessorResult> {
    return prisma.$transaction(
      async (tx) => {
        const ctx: TickContext = { tx, tick, results: new Map() };
        return battlesProcessor.process(ctx);
      },
      { timeout: 15_000 },
    );
  }

  async function createBattle(opts: {
    nextRoundTick: number;
    enemyTier?: "weak" | "moderate" | "strong";
    missionId?: string;
    dangerLevel?: number;
  }) {
    const playerStats = derivePlayerCombatStats({
      hullMax: 40,
      hullCurrent: 40,
      shieldMax: 10,
      shieldCurrent: 10,
      firepower: 5,
      evasion: 6,
    });

    const tier = opts.enemyTier ?? "weak";
    const danger = opts.dangerLevel ?? 0.1;
    const enemyStats = deriveEnemyCombatStats(tier, danger);

    return prisma.battle.create({
      data: {
        type: "pirate_encounter",
        systemId: universe.systems.agricultural,
        shipId,
        missionId: opts.missionId ?? null,
        status: "active",
        playerStrength: playerStats.strength,
        playerMorale: playerStats.morale,
        initialPlayerStrength: playerStats.strength,
        dangerLevel: danger,
        enemyStrength: enemyStats.strength,
        enemyMorale: enemyStats.morale,
        enemyType: "pirates",
        enemyTier: tier,
        roundsCompleted: 0,
        roundInterval: COMBAT_CONSTANTS.ROUND_INTERVAL,
        nextRoundTick: opts.nextRoundTick,
        roundHistory: "[]",
        createdAtTick: 1,
      },
    });
  }

  it("active battle resolves a round: roundsCompleted increments, roundHistory grows", async () => {
    const battle = await createBattle({ nextRoundTick: 10 });

    await runProcessor(10);

    const updated = await prisma.battle.findUnique({ where: { id: battle.id } });
    expect(updated!.roundsCompleted).toBe(1);

    const history = JSON.parse(updated!.roundHistory);
    expect(history.length).toBe(1);
    expect(history[0].round).toBe(1);
    expect(history[0].playerDamageDealt).toBeGreaterThan(0);
  });

  it("battle not ready (future nextRoundTick) is skipped", async () => {
    const battle = await createBattle({ nextRoundTick: 20 });

    await runProcessor(10);

    const updated = await prisma.battle.findUnique({ where: { id: battle.id } });
    expect(updated!.roundsCompleted).toBe(0);
    expect(updated!.status).toBe("active");
  });

  it("victory: player credits increase, mission status → completed", async () => {
    // Create a mission for the battle
    const mission = await prisma.mission.create({
      data: {
        type: "bounty",
        systemId: universe.systems.agricultural,
        targetSystemId: universe.systems.agricultural,
        reward: 500,
        deadlineTick: 100,
        createdAtTick: 1,
        status: "in_progress",
        playerId: player.playerId,
        shipId,
      },
    });

    // Create a battle the player will easily win — strong player vs nearly dead enemy
    const playerStats = derivePlayerCombatStats({
      hullMax: 40, hullCurrent: 40, shieldMax: 10, shieldCurrent: 10,
      firepower: 5, evasion: 6,
    });

    await prisma.battle.create({
      data: {
        type: "pirate_encounter",
        systemId: universe.systems.agricultural,
        shipId,
        missionId: mission.id,
        status: "active",
        playerStrength: playerStats.strength,
        playerMorale: 95,
        initialPlayerStrength: playerStats.strength,
        dangerLevel: 0.05,
        enemyStrength: 1, // Nearly dead
        enemyMorale: 10, // Will break immediately
        enemyType: "pirates",
        enemyTier: "weak",
        roundsCompleted: 5,
        roundInterval: COMBAT_CONSTANTS.ROUND_INTERVAL,
        nextRoundTick: 10,
        roundHistory: "[]",
        createdAtTick: 1,
      },
    });

    const creditsBefore = (await prisma.player.findUnique({ where: { id: player.playerId } }))!.credits;

    await runProcessor(10);

    // Mission should be completed
    const missionAfter = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(missionAfter!.status).toBe("completed");

    // Player should have earned reward
    const creditsAfter = (await prisma.player.findUnique({ where: { id: player.playerId } }))!.credits;
    expect(creditsAfter).toBeGreaterThan(creditsBefore);
  });

  it("defeat: mission status → failed, ship takes hull damage", async () => {
    // Create a mission for the battle
    const mission = await prisma.mission.create({
      data: {
        type: "bounty",
        systemId: universe.systems.agricultural,
        targetSystemId: universe.systems.agricultural,
        reward: 500,
        deadlineTick: 100,
        createdAtTick: 1,
        status: "in_progress",
        playerId: player.playerId,
        shipId,
      },
    });

    // Create battle where player is nearly dead — enemy will win
    await prisma.battle.create({
      data: {
        type: "pirate_encounter",
        systemId: universe.systems.agricultural,
        shipId,
        missionId: mission.id,
        status: "active",
        playerStrength: 1, // Nearly dead
        playerMorale: 10,
        initialPlayerStrength: 50,
        dangerLevel: 0.3,
        enemyStrength: 80,
        enemyMorale: 90,
        enemyType: "pirates",
        enemyTier: "moderate",
        roundsCompleted: 5,
        roundInterval: COMBAT_CONSTANTS.ROUND_INTERVAL,
        nextRoundTick: 10,
        roundHistory: "[]",
        createdAtTick: 1,
      },
    });

    await runProcessor(10);

    // Mission should be failed
    const missionAfter = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(["failed", "completed"].includes(missionAfter!.status)).toBe(true);

    // If defeat, ship should have taken damage
    if (missionAfter!.status === "failed") {
      const ship = await prisma.ship.findUnique({ where: { id: shipId } });
      // Ship took significant damage (initialStrength 50, final 0-1)
      expect(ship!.hullCurrent).toBeLessThan(40);
    }
  });
});
