import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getSystemIndustry } = await import("@/lib/services/universe");
const { invalidateVisibilityCache } = await import("@/lib/services/visibility-cache");

const VALID_BANDS = ["poor", "average", "good", "rich"];

describe("getSystemIndustry (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;
  let system: { id: string };
  let hiddenSystem: { id: string };

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 1000 });
    invalidateVisibilityCache(player.playerId);

    // Ship at the agricultural system → it becomes visible; switch to interceptor
    // (sensor range 1) so the tech system (2 hops) stays hidden — same fog-of-war
    // setup the population integration test uses.
    await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
    });
    await prisma.ship.updateMany({
      where: { playerId: player.playerId },
      data: { shipType: "interceptor" },
    });
    invalidateVisibilityCache(player.playerId);

    system = { id: universe.systems.agricultural };
    hiddenSystem = { id: universe.systems.tech };

    // The fixture seeds building rows but leaves the system's space-partition and
    // deposit/yield columns at their defaults. Set a coherent substrate directly
    // (mirrors how the population test seeds popCap) so the assembled space / deposit
    // view is meaningful: available 200 = general 120 + deposit land 80; the
    // arable/water/biomass deposits match the agricultural fixture substrate at
    // uniform yield 1.0.
    await prisma.starSystem.update({
      where: { id: system.id },
      data: {
        availableSpace: 200,
        generalSpace: 120,
        habitableSpace: 72,
        slotArable: 10,
        slotWater: 6,
        slotBiomass: 4,
        yieldArable: 1,
        yieldWater: 1,
        yieldBiomass: 1,
      },
    });
  });

  it("assembles the full industry readout for a visible system", async () => {
    const data = await getSystemIndustry(player.playerId, system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    // economyShardGroup: a static shard index in [0, ECONOMY_UPDATE_INTERVAL),
    // derived from the system's id-rank via the two count() queries.
    expect(Number.isInteger(data.economyShardGroup)).toBe(true);
    expect(data.economyShardGroup).toBeGreaterThanOrEqual(0);
    expect(data.economyShardGroup).toBeLessThan(ECONOMY_UPDATE_INTERVAL);

    // Space partition mirrors the seeded columns; deposit = available − general.
    expect(data.space.available).toBe(200);
    expect(data.space.general).toBe(120);
    expect(data.space.habitable).toBe(72);
    expect(data.space.deposit).toBe(80);
    for (const v of [data.space.depositWorked, data.space.generalUsed, data.space.habitableUsed]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }

    // Deposits: one row per resource with slots, richest cap first (arable 10 > water 6 > biomass 4).
    expect(data.deposits.map((d) => d.resource)).toEqual(["arable", "water", "biomass"]);
    for (const d of data.deposits) {
      expect(d.slotCap).toBeGreaterThan(0);
      expect(d.worked).toBeGreaterThanOrEqual(0);
      expect(d.worked).toBeLessThanOrEqual(d.slotCap);
      expect(Number.isFinite(d.yieldMult)).toBe(true);
      expect(VALID_BANDS).toContain(d.band);
    }

    // Readout core: building roster seeded, labour ratio bounded, supply chain present.
    expect(data.buildings.length).toBeGreaterThan(0);
    expect(data.labourFulfillment).toBeGreaterThanOrEqual(0);
    expect(data.labourFulfillment).toBeLessThanOrEqual(1);
    expect(Array.isArray(data.supplyChain)).toBe(true);

    // Production/consumption profile resolves through the market goods (the
    // GOOD_NAME_TO_KEY + marketBandForRow path) without producing NaN.
    expect(data.goods.length).toBeGreaterThan(0);
    for (const g of data.goods) {
      expect(Number.isFinite(g.production)).toBe(true);
      expect(Number.isFinite(g.consumption)).toBe(true);
    }
  });

  it("returns { visibility: 'unknown' } for an unsurveyed system", async () => {
    const data = await getSystemIndustry(player.playerId, hiddenSystem.id);
    expect(data).toEqual({ visibility: "unknown" });
  });
});
