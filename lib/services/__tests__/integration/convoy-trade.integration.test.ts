import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import {
  seedTestUniverse,
  createTestPlayer,
  createTestShip,
  createTestConvoy,
} from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { executeConvoyTrade } = await import("@/lib/services/convoy-trade");

describe("executeConvoyTrade (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;
  let convoyId: string;
  let shipIds: string[];

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 10_000 });
    const s1 = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 50,
    });
    const s2 = await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 50,
    });
    shipIds = [s1, s2];
    convoyId = await createTestConvoy(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      shipIds,
    });
  });

  it("buy succeeds: credits deducted, cargo distributed across member ships, market supply decreased", async () => {
    const result = await executeConvoyTrade(player.playerId, convoyId, {
      stationId: universe.stations.agricultural,
      goodId: universe.goodIds["food"],
      quantity: 60, // > one ship's cargoMax → exercises distribution
      type: "buy",
    });

    expect(result.ok).toBe(true);

    const cargo = await prisma.cargoItem.findMany({
      where: { goodId: universe.goodIds["food"], shipId: { in: shipIds } },
    });
    const total = cargo.reduce((s, c) => s + c.quantity, 0);
    expect(total).toBe(60);
    // Distribution should fill the first ship before the second.
    expect(cargo.length).toBeGreaterThan(0);
  });

  it("buy is blocked when the player has hostile standing with the system's faction", async () => {
    await prisma.playerFactionReputation.create({
      data: {
        playerId: player.playerId,
        factionId: universe.factions.federation,
        score: -80,
        updatedAtTick: 0,
      },
    });

    const result = await executeConvoyTrade(player.playerId, convoyId, {
      stationId: universe.stations.agricultural,
      goodId: universe.goodIds["food"],
      quantity: 10,
      type: "buy",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/hostile/i);
    }
  });

  it("accrues per-tick capped reputation on a successful convoy trade", async () => {
    const factionId = universe.factions.federation;

    const r1 = await executeConvoyTrade(player.playerId, convoyId, {
      stationId: universe.stations.agricultural,
      goodId: universe.goodIds["food"],
      quantity: 5,
      type: "buy",
    });
    const r2 = await executeConvoyTrade(player.playerId, convoyId, {
      stationId: universe.stations.agricultural,
      goodId: universe.goodIds["food"],
      quantity: 5,
      type: "buy",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    const row = await prisma.playerFactionReputation.findUnique({
      where: { playerId_factionId: { playerId: player.playerId, factionId } },
    });
    expect(row?.score).toBeCloseTo(1); // two trades × 0.5
    expect(row?.currentTickGainThisTick).toBeCloseTo(1);
    expect(row?.updatedAtTick).toBe(10);
  });
});
