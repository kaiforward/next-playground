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

  it("accrues band-pulse work off the month pulse without settling, then bills it at the boundary", async () => {
    // Divergent cadences: construction/logistics pulse at 24 while the month is 48,
    // so the treasury gate's hasWork-only branch fires mid-month.
    const cadence = { month: 48, construction: 24, logistics: 24 };
    let world = generateWorld({ systemCount: 40, seed: 11 });
    let sawOffPulseAccrual = false;
    for (let tick = 1; tick <= 47; tick++) {
      const result = await runWorldTick(world, { cadence });
      world = result.world;
      if (result.events.processors?.includes("treasury")) {
        sawOffPulseAccrual = true;
        // Accrual must never settle ahead of the month boundary.
        for (const t of world.treasuries) expect(t.lastSettlement, t.factionId).toBeNull();
      }
    }
    expect(sawOffPulseAccrual).toBe(true);
    const accrued = world.treasuries.reduce(
      (acc, t) => acc + t.pendingWork.construction + t.pendingWork.logistics, 0);
    expect(accrued).toBeGreaterThan(0);
    expect(Number.isFinite(accrued)).toBe(true);

    const boundary = await runWorldTick(world, { cadence }); // tick 48 — the month pulse
    world = boundary.world;
    expect(boundary.events.processors).toContain("treasury");
    for (const t of world.treasuries) {
      expect(t.lastSettlement, t.factionId).not.toBeNull();
      expect(t.pendingWork).toEqual({ logistics: 0, construction: 0 });
    }
  });
});
