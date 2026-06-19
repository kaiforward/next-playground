import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer, createTestShip } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";
import { STRIKE_PARAMS } from "@/lib/constants/population";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getSystemPopulation } = await import("@/lib/services/system-population");
const { invalidateVisibilityCache } = await import("@/lib/services/visibility-cache");

describe("getSystemPopulation (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;
  let system: { id: string };
  let hiddenSystem: { id: string };

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 1000 });
    invalidateVisibilityCache(player.playerId);

    // Place a ship at the agricultural system so it becomes visible.
    // Default ship type (shuttle, role=trade) has sensor range 2 — covers all
    // three test systems. We use tech as the hidden system because it is 2 hops
    // away; to make it invisible we'll use an interceptor (sensor range 1) so
    // only agri and ind are visible.
    await createTestShip(prisma, {
      playerId: player.playerId,
      systemId: universe.systems.agricultural,
      cargoMax: 10,
    });

    // Switch to interceptor (sensor range 1) so tech (2 hops) is hidden.
    await prisma.ship.updateMany({
      where: { playerId: player.playerId },
      data: { shipType: "interceptor" },
    });
    invalidateVisibilityCache(player.playerId);

    system = { id: universe.systems.agricultural };
    hiddenSystem = { id: universe.systems.tech };

    // Give the agricultural system a non-zero popCap so the assertion can verify
    // the value is returned correctly. The test universe fixture doesn't seed
    // body data, so popCap defaults to 0; set it directly here.
    await prisma.starSystem.update({
      where: { id: system.id },
      data: { popCap: 1000 },
    });
  });

  it("returns the population snapshot for a visible system", async () => {
    const data = await getSystemPopulation(player.playerId, system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.population).toBeGreaterThanOrEqual(0);
    expect(data.popCap).toBe(1000);
    expect(data.unrest).toBeGreaterThanOrEqual(0);
    expect(data.unrest).toBeLessThanOrEqual(1);
    expect(data.striking).toBe(data.unrest >= STRIKE_PARAMS.threshold);
    expect(data.demand.length).toBeGreaterThan(0);
    expect(data.demand.length).toBeLessThanOrEqual(6);
    expect(data.demand[0].demandRate).toBeGreaterThanOrEqual(data.demand[1].demandRate);
    // goodName resolves the real display name via the GOODS lookup, not the raw-id
    // fallback (`?? e.goodId`). At population 400 water/food (highest per-capita) lead.
    expect(["Water", "Food"]).toContain(data.demand[0].goodName);
  });

  it("returns { visibility: 'unknown' } for an unsurveyed system", async () => {
    const data = await getSystemPopulation(player.playerId, hiddenSystem.id);
    expect(data).toEqual({ visibility: "unknown" });
  });
});
