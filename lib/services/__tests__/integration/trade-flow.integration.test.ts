import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getSystemLogistics } = await import("@/lib/services/trade-flow");
const { invalidateVisibilityCache } = await import("@/lib/services/visibility-cache");
const { invalidateAdjacencyCache } = await import("@/lib/services/adjacency");

describe("getSystemLogistics (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;
  let system: { id: string }; // agricultural — focal, visible
  let visiblePartner: { id: string }; // industrial — 1 hop, visible
  let hiddenSystem: { id: string }; // tech — 2 hops, hidden

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    // The adjacency graph is cached module-level from the prior test's universe;
    // clear it so visibility BFS runs against this reseed's system ids.
    invalidateAdjacencyCache();
    player = await createTestPlayer(prisma, { credits: 1000 });
    invalidateVisibilityCache(player.playerId);

    // Ship at the agricultural system, switched to interceptor (sensor range 1) so
    // only agri + its 1-hop neighbour (industrial) are visible and tech (2 hops)
    // stays hidden — the same fog-of-war setup the industry/population tests use.
    await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 10,
    });
    await prisma.ship.updateMany({
      where: { playerId: player.playerId },
      data: { shipType: "interceptor" },
    });
    invalidateVisibilityCache(player.playerId);

    system = { id: universe.systems.agricultural };
    visiblePartner = { id: universe.systems.industrial };
    hiddenSystem = { id: universe.systems.tech };

    // Cross-border flows on the focal system, inside the history window
    // (currentTick 10, FLOW_HISTORY_TICKS 200). TradeFlow.goodId stores the good
    // KEY, not the DB id. Water EXPORTS to a visible partner (market + logistics);
    // food IMPORTS from a hidden partner (tech) and a visible one (industrial).
    await prisma.tradeFlow.createMany({
      data: [
        { tick: 9, fromSystemId: system.id, toSystemId: visiblePartner.id, goodId: "water", quantity: 4, flowType: "market" },
        { tick: 10, fromSystemId: system.id, toSystemId: visiblePartner.id, goodId: "water", quantity: 2, flowType: "logistics" },
        { tick: 9, fromSystemId: hiddenSystem.id, toSystemId: system.id, goodId: "food", quantity: 3, flowType: "market" },
        { tick: 10, fromSystemId: visiblePartner.id, toSystemId: system.id, goodId: "food", quantity: 1, flowType: "logistics" },
      ],
    });
  });

  it("assembles the logistics readout for a visible system, split by flow type", async () => {
    const data = await getSystemLogistics(player.playerId, system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    // Exports split by flow type, no inbound flow.
    const water = data.rows.find((r) => r.goodId === "water")!;
    expect(water.exportMarket).toBe(4);
    expect(water.exportLogistics).toBe(2);
    expect(water.importMarket).toBe(0);
    expect(water.importLogistics).toBe(0);
    expect(water.externalNet).toBe(6);
    expect(water.traded).toBe(true);

    // Imports split by flow type, summed across both source partners.
    const food = data.rows.find((r) => r.goodId === "food")!;
    expect(food.importMarket).toBe(3); // from the hidden partner
    expect(food.importLogistics).toBe(1); // from the visible partner
    expect(food.exportMarket).toBe(0);
    expect(food.externalNet).toBe(-4);
    expect(food.traded).toBe(true);

    expect(data.tradedGoodCount).toBe(2);
    // No top-N cap: the full prod/con footprint of a populated system is returned.
    expect(data.activeGoodCount).toBeGreaterThan(5);
    expect(data.internalMax).toBeGreaterThan(0);
    expect(data.externalMax).toBe(6);

    // Volume history covers the window and carries the seeded throughput.
    const totalVolume = data.volumeHistory.reduce((s, b) => s + b.importVolume + b.exportVolume, 0);
    expect(totalVolume).toBeGreaterThan(0);
  });

  it("anonymizes trade partners outside the player's visibility set", async () => {
    const indName = (await prisma.starSystem.findUnique({
      where: { id: visiblePartner.id },
      select: { name: true },
    }))!.name;

    const data = await getSystemLogistics(player.playerId, system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");

    // The visible export partner is named; the partner identity is real.
    const water = data.rows.find((r) => r.goodId === "water")!;
    const exportPartner = water.exportPartners.find((p) => p.systemId === visiblePartner.id)!;
    expect(exportPartner.systemName).toBe(indName);

    // The import sources include a hidden partner (tech) — its name must NOT leak.
    const food = data.rows.find((r) => r.goodId === "food")!;
    const hiddenPartner = food.importPartners.find((p) => p.systemId === hiddenSystem.id)!;
    expect(hiddenPartner.systemName).toBe("Unknown System");
    expect(hiddenPartner.quantity).toBe(3); // quantity still surfaces; only the name is gated
    const visibleImportPartner = food.importPartners.find((p) => p.systemId === visiblePartner.id)!;
    expect(visibleImportPartner.systemName).toBe(indName);
  });

  it("returns { visibility: 'unknown' } for an unsurveyed system", async () => {
    const data = await getSystemLogistics(player.playerId, hiddenSystem.id);
    expect(data).toEqual({ visibility: "unknown" });
  });
});
