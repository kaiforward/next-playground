import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";

describe("treasury over the live tick", () => {
  it("settles every faction on the month pulse with finite, non-negative state", async () => {
    let world = generateWorld({ systemCount: 40, seed: 11 });
    let sawTreasuryRun = false;
    for (let i = 0; i < MONTH_LENGTH; i++) {
      const result = await runWorldTick(world);
      world = result.world;
      if (result.events.processors?.includes("treasury")) sawTreasuryRun = true;
    }
    expect(sawTreasuryRun).toBe(true);
    expect(world.treasuries.length).toBe(world.factions.length);
    for (const t of world.treasuries) {
      expect(t.lastSettlement, t.factionId).not.toBeNull();
      expect(Number.isFinite(t.balance)).toBe(true);
      expect(t.balance).toBeGreaterThanOrEqual(0);
      for (const band of ["maintenance", "logistics", "construction"] as const) {
        expect(t.funded[band]).toBeGreaterThanOrEqual(0);
        expect(t.funded[band]).toBeLessThanOrEqual(1);
      }
      // The world must survive a JSON round-trip (no NaN → null corruption).
      expect(JSON.parse(JSON.stringify(t))).toEqual(t);
    }
    // At least one faction earned something in a seeded 40-system galaxy.
    const totalIncome = world.treasuries.reduce(
      (acc, t) => acc + (t.lastSettlement?.headsIncome ?? 0) + (t.lastSettlement?.productionIncome ?? 0), 0);
    expect(totalIncome).toBeGreaterThan(0);
  });
});
