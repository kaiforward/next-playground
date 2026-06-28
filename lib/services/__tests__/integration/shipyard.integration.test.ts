import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse, createTestPlayer } from "@/lib/test-utils/fixtures";
import type { TestUniverse, TestPlayerResult } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { purchaseShip } = await import("@/lib/services/shipyard");
const { getVisibleSystemIds, invalidateVisibilityCache } = await import(
  "@/lib/services/visibility-cache"
);
const { invalidateAdjacencyCache } = await import("@/lib/services/adjacency");

describe("purchaseShip (integration)", () => {
  let universe: TestUniverse;
  let player: TestPlayerResult;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
    player = await createTestPlayer(prisma, { credits: 100_000 });
    invalidateVisibilityCache(player.playerId);
    invalidateAdjacencyCache();
  });

  it("reveals the new ship's system immediately, without waiting for a tick", async () => {
    const target = universe.systems.industrial;

    // No ships yet → nothing visible. This first read also populates the
    // per-(player, tick) visibility cache for the current tick — the stale
    // entry a purchase has to invalidate (buying a ship doesn't advance ticks).
    const before = await getVisibleSystemIds(player.playerId);
    expect(before).not.toContain(target);

    const result = await purchaseShip(player.playerId, target, "light_freighter");
    expect(result.ok).toBe(true);

    // Same tick — the freshly bought ship's system must be visible right away.
    const after = await getVisibleSystemIds(player.playerId);
    expect(after).toContain(target);
  });
});
