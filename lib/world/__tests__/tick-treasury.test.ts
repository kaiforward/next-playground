import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";
import { TARGET_COVER } from "@/lib/constants/market-economy";
import type { World } from "@/lib/world/types";

/**
 * Rig a faction with a guaranteed intra-faction haul: promote an unclaimed
 * neighbour of its homeworld to a developed member with a deep food deficit,
 * and pile surplus food at the homeworld. A fresh galaxy has one developed
 * system per faction (logistics needs two), so the gate is unobservable
 * through the real tick without this.
 */
function rigLogisticsPair(world: World, factionId: string): World {
  const home = world.factions.find((f) => f.id === factionId)!.homeworldId;
  const conn = world.connections.find((c) => {
    if (c.fromId !== home && c.toId !== home) return false;
    const otherId = c.fromId === home ? c.toId : c.fromId;
    return world.systems.find((s) => s.id === otherId)!.factionId === null;
  })!;
  const neighbourId = conn.fromId === home ? conn.toId : conn.fromId;
  return {
    ...world,
    systems: world.systems.map((s) =>
      s.id === neighbourId ? { ...s, factionId, control: "developed", population: 200 } : s,
    ),
    markets: world.markets.map((m) => {
      if (m.systemId === neighbourId && m.goodId === "food")
        return { ...m, stock: 0, demandRate: 10 }; // anchor 400 → deep deficit
      if (m.systemId === home && m.goodId === "food")
        // Above the surplus threshold with drawable stock exceeding the
        // neighbour's shortfall, whatever the homeworld's own demand rate.
        return { ...m, stock: TARGET_COVER * m.demandRate * 1.5 + 600 };
      return m;
    }),
  };
}

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

  it("a zero-funded construction band performs no construction work (the queue waits)", async () => {
    // Divergent cadences so construction pulses mid-month and its work lands in
    // pendingWork (observable before settlement clears it).
    const cadence = { month: 48, construction: 24, logistics: 24 };
    let world = generateWorld({ systemCount: 40, seed: 11 });
    const starvedId = world.factions[0].id;
    world = {
      ...world,
      treasuries: world.treasuries.map((t) =>
        t.factionId === starvedId ? { ...t, funded: { ...t.funded, construction: 0 } } : t,
      ),
    };
    for (let tick = 1; tick <= 24; tick++) {
      const result = await runWorldTick(world, { cadence });
      world = result.world;
    }
    const starved = world.treasuries.find((t) => t.factionId === starvedId)!;
    expect(starved.pendingWork.construction).toBe(0);
    // The gate is per-faction: fully-funded factions still worked this pulse.
    const others = world.treasuries.filter((t) => t.factionId !== starvedId);
    expect(others.reduce((acc, t) => acc + t.pendingWork.construction, 0)).toBeGreaterThan(0);
  });

  it("a zero-funded logistics band hauls nothing while a funded twin hauls", async () => {
    // Same divergent cadences: logistics pulses at 24, mid-month, so its work
    // lands in pendingWork (observable before settlement clears it).
    const cadence = { month: 48, construction: 24, logistics: 24 };
    let world = generateWorld({ systemCount: 40, seed: 11 });
    const starvedId = world.factions[0].id;
    const fundedId = world.factions[1].id;
    world = rigLogisticsPair(world, starvedId);
    world = rigLogisticsPair(world, fundedId);
    world = {
      ...world,
      treasuries: world.treasuries.map((t) =>
        t.factionId === starvedId ? { ...t, funded: { ...t.funded, logistics: 0 } } : t,
      ),
    };
    for (let tick = 1; tick <= 24; tick++) {
      const result = await runWorldTick(world, { cadence });
      world = result.world;
    }
    // The rig works: the identically-rigged funded faction hauled this pulse...
    const funded = world.treasuries.find((t) => t.factionId === fundedId)!;
    expect(funded.pendingWork.logistics).toBeGreaterThan(0);
    // ...so the starved faction's zero is the funding gate, not a dead rig.
    const starved = world.treasuries.find((t) => t.factionId === starvedId)!;
    expect(starved.pendingWork.logistics).toBe(0);
  });

  it("a defunded maintenance band suppresses production through the real tick, per-system", async () => {
    const run = async (starvedId: string | null) => {
      let world = generateWorld({ systemCount: 40, seed: 11 });
      world = {
        ...world,
        treasuries: world.treasuries.map((t) =>
          t.factionId === starvedId ? { ...t, funded: { ...t.funded, maintenance: 0 } } : t,
        ),
      };
      for (let tick = 1; tick <= MONTH_LENGTH; tick++) {
        world = (await runWorldTick(world)).world;
      }
      return world;
    };
    const homeStocks = (world: World, factionIndex: number) => {
      const home = world.factions[factionIndex].homeworldId;
      return world.markets.filter((m) => m.systemId === home).map((m) => m.stock);
    };
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const control = await run(null);
    const starved = await run(control.factions[0].id);
    // The malus reached the economy pulse: the starved homeworld produced less...
    expect(sum(homeStocks(starved, 0))).toBeLessThan(sum(homeStocks(control, 0)));
    // ...while an unstarved faction's homeworld is bit-identical (per-system map).
    expect(homeStocks(starved, 1)).toEqual(homeStocks(control, 1));
  });

  it("a higher tax level accumulates unrest faster through the real tick", async () => {
    let world = generateWorld({ systemCount: 40, seed: 11 });
    const taxedId = world.factions[0].id;
    const easedId = world.factions[1].id;
    world = {
      ...world,
      treasuries: world.treasuries.map((t) => {
        if (t.factionId === taxedId) return { ...t, taxLevel: "very_high" };
        if (t.factionId === easedId) return { ...t, taxLevel: "very_low" };
        return t;
      }),
    };
    for (let tick = 1; tick <= MONTH_LENGTH * 2; tick++) {
      world = (await runWorldTick(world)).world;
    }
    const homeUnrest = (factionId: string) => {
      const home = world.factions.find((f) => f.id === factionId)!.homeworldId;
      return world.systems.find((s) => s.id === home)!.unrest;
    };
    // Homeworlds share the same prefab, so the standing tax pressure is the
    // only systematic difference between the two integrators.
    expect(homeUnrest(taxedId)).toBeGreaterThan(homeUnrest(easedId));
  });
});
