import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { REPUTATION_TRADE_GAIN_CAP_PER_TICK, REPUTATION_TRADE_GAIN_PER_TRADE } from "@/lib/constants/reputation";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { clampReputationGain, getPlayerReputation, getStandingAt, accrueTradeReputationInTx } =
  await import("@/lib/services/reputation");

describe("clampReputationGain", () => {
  it("returns the candidate when nothing has been accrued yet", () => {
    expect(clampReputationGain(0, REPUTATION_TRADE_GAIN_PER_TRADE)).toBe(
      REPUTATION_TRADE_GAIN_PER_TRADE,
    );
  });

  it("returns the remaining budget when the candidate would overshoot the cap", () => {
    const alreadyAccrued = REPUTATION_TRADE_GAIN_CAP_PER_TICK - 0.2;
    expect(clampReputationGain(alreadyAccrued, REPUTATION_TRADE_GAIN_PER_TRADE)).toBeCloseTo(0.2);
  });

  it("returns 0 when the cap is exactly exhausted", () => {
    expect(clampReputationGain(REPUTATION_TRADE_GAIN_CAP_PER_TICK, 1)).toBe(0);
  });

  it("returns 0 when the cap has been overshot (defensive)", () => {
    expect(clampReputationGain(REPUTATION_TRADE_GAIN_CAP_PER_TICK + 1, 1)).toBe(0);
  });
});

describe("reputation service (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma);
  });

  describe("getPlayerReputation", () => {
    it("returns one row per faction at score 0/neutral when the player has no rep rows", async () => {
      const rows = await getPlayerReputation(player.playerId);
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.score).toBe(0);
        expect(r.standing).toBe("neutral");
        expect(r.tradeDenied).toBe(false);
        expect(r.buyMultiplier).toBe(1);
        expect(r.sellMultiplier).toBe(1);
        expect(r.updatedAtTick).toBe(0);
      }
    });

    it("enriches existing rep rows with the matching tier", async () => {
      await prisma.playerFactionReputation.create({
        data: {
          playerId: player.playerId,
          factionId: universe.factions.federation,
          score: 80,
          updatedAtTick: 5,
        },
      });
      const rows = await getPlayerReputation(player.playerId);
      const fed = rows.find((r) => r.factionId === universe.factions.federation);
      expect(fed?.score).toBe(80);
      expect(fed?.standing).toBe("champion");
      expect(fed?.buyMultiplier).toBeLessThan(1);
      expect(fed?.sellMultiplier).toBeGreaterThan(1);
      expect(fed?.tradeDenied).toBe(false);
    });

    it("sets tradeDenied for hostile scores", async () => {
      await prisma.playerFactionReputation.create({
        data: {
          playerId: player.playerId,
          factionId: universe.factions.corporate,
          score: -80,
          updatedAtTick: 5,
        },
      });
      const rows = await getPlayerReputation(player.playerId);
      const corp = rows.find((r) => r.factionId === universe.factions.corporate);
      expect(corp?.standing).toBe("hostile");
      expect(corp?.tradeDenied).toBe(true);
    });
  });

  describe("getStandingAt", () => {
    it("returns neutral defaults when no row exists", async () => {
      const standing = await getStandingAt(player.playerId, universe.factions.federation);
      expect(standing.score).toBe(0);
      expect(standing.standing).toBe("neutral");
      expect(standing.tradeDenied).toBe(false);
    });

    it("returns the persisted score/tier when a row exists", async () => {
      await prisma.playerFactionReputation.create({
        data: {
          playerId: player.playerId,
          factionId: universe.factions.federation,
          score: -30,
          updatedAtTick: 0,
        },
      });
      const standing = await getStandingAt(player.playerId, universe.factions.federation);
      expect(standing.score).toBe(-30);
      expect(standing.standing).toBe("distrusted");
      expect(standing.tradeDenied).toBe(false);
    });
  });

  describe("accrueTradeReputationInTx", () => {
    it("creates a fresh row with REPUTATION_TRADE_GAIN_PER_TRADE on first accrual", async () => {
      const result = await prisma.$transaction((tx) =>
        accrueTradeReputationInTx(tx, player.playerId, universe.factions.federation, 100),
      );
      expect(result.tradeDenied).toBe(false);
      const row = await prisma.playerFactionReputation.findUnique({
        where: {
          playerId_factionId: {
            playerId: player.playerId,
            factionId: universe.factions.federation,
          },
        },
      });
      expect(row?.score).toBe(REPUTATION_TRADE_GAIN_PER_TRADE);
      expect(row?.currentTickGainThisTick).toBe(REPUTATION_TRADE_GAIN_PER_TRADE);
      expect(row?.updatedAtTick).toBe(100);
    });

    it("accumulates within a tick up to REPUTATION_TRADE_GAIN_CAP_PER_TICK", async () => {
      const factionId = universe.factions.federation;
      // Repeatedly accrue in the same tick — verify the cap holds.
      const tradesToReachCap = Math.ceil(
        REPUTATION_TRADE_GAIN_CAP_PER_TICK / REPUTATION_TRADE_GAIN_PER_TRADE,
      );
      for (let i = 0; i < tradesToReachCap + 2; i++) {
        await prisma.$transaction((tx) =>
          accrueTradeReputationInTx(tx, player.playerId, factionId, 7),
        );
      }
      const row = await prisma.playerFactionReputation.findUnique({
        where: { playerId_factionId: { playerId: player.playerId, factionId } },
      });
      expect(row?.score).toBeCloseTo(REPUTATION_TRADE_GAIN_CAP_PER_TICK);
      expect(row?.currentTickGainThisTick).toBeCloseTo(REPUTATION_TRADE_GAIN_CAP_PER_TICK);
      expect(row?.updatedAtTick).toBe(7);
    });

    it("resets the per-tick accumulator on the first accrual of a new tick", async () => {
      const factionId = universe.factions.federation;
      // Saturate the cap in tick 7.
      const tradesToReachCap = Math.ceil(
        REPUTATION_TRADE_GAIN_CAP_PER_TICK / REPUTATION_TRADE_GAIN_PER_TRADE,
      );
      for (let i = 0; i < tradesToReachCap; i++) {
        await prisma.$transaction((tx) =>
          accrueTradeReputationInTx(tx, player.playerId, factionId, 7),
        );
      }
      // First accrual in tick 8 should grant a fresh per-tick budget.
      await prisma.$transaction((tx) =>
        accrueTradeReputationInTx(tx, player.playerId, factionId, 8),
      );
      const row = await prisma.playerFactionReputation.findUnique({
        where: { playerId_factionId: { playerId: player.playerId, factionId } },
      });
      expect(row?.score).toBeCloseTo(REPUTATION_TRADE_GAIN_CAP_PER_TICK + REPUTATION_TRADE_GAIN_PER_TRADE);
      expect(row?.currentTickGainThisTick).toBe(REPUTATION_TRADE_GAIN_PER_TRADE);
      expect(row?.updatedAtTick).toBe(8);
    });

    it("returns tradeDenied:true when the fresh score is in the hostile band and does not accrue", async () => {
      const factionId = universe.factions.federation;
      await prisma.playerFactionReputation.create({
        data: {
          playerId: player.playerId,
          factionId,
          score: -80,
          updatedAtTick: 0,
        },
      });
      const result = await prisma.$transaction((tx) =>
        accrueTradeReputationInTx(tx, player.playerId, factionId, 50),
      );
      expect(result.tradeDenied).toBe(true);
      const row = await prisma.playerFactionReputation.findUnique({
        where: { playerId_factionId: { playerId: player.playerId, factionId } },
      });
      expect(row?.score).toBe(-80); // unchanged
      expect(row?.updatedAtTick).toBe(0); // unchanged
    });
  });
});
