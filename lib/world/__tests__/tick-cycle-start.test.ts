import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import type { EconomyTickPayload, TickBroadcastRaw } from "@/lib/tick/types";
import type { World } from "@/lib/world/types";

function totalPopulation(w: World): number {
  return w.systems.reduce((sum, s) => sum + s.population, 0);
}

function economyTickEntry(broadcast: TickBroadcastRaw): EconomyTickPayload {
  const entry = broadcast.events.economyTick?.[0];
  if (!entry) throw new Error("expected an economyTick entry on every tick");
  return entry;
}

describe("runWorldTick: cycle start", () => {
  it("changes population only on the cycle boundary tick", async () => {
    let world = generateWorld({ systemCount: 40, seed: 7 });
    const startPop = totalPopulation(world);

    // Ticks 1..CYCLE_LENGTH-1 are off-boundary: population is untouched.
    for (let t = 1; t < CYCLE_LENGTH; t++) {
      world = (await runWorldTick(world)).world;
      expect(world.meta.currentTick).toBe(t);
      expect(totalPopulation(world)).toBeCloseTo(startPop, 6);
    }

    // Snapshot per-system population right before the first boundary tick.
    const before = new Map(world.systems.map((s) => [s.id, s.population]));

    // Tick CYCLE_LENGTH is the first boundary: the population processor runs.
    world = (await runWorldTick(world)).world;
    expect(world.meta.currentTick).toBe(CYCLE_LENGTH);
    // At least one system's population moves. A per-system check (not an aggregate
    // delta) so a chance growth/decline cancellation across systems can't mask the
    // cycle start firing.
    const moved = world.systems.some((s) => Math.abs(s.population - (before.get(s.id) ?? 0)) > 1e-6);
    expect(moved).toBe(true);
  });

  it("changes provision and supplyBand only on the cycle boundary tick", async () => {
    let world = generateWorld({ systemCount: 40, seed: 7 });

    // Never assessed before the first boundary: absent on every system.
    for (const s of world.systems) expect(s.provision).toBeUndefined();

    for (let t = 1; t < CYCLE_LENGTH; t++) {
      world = (await runWorldTick(world)).world;
      for (const s of world.systems) expect(s.provision).toBeUndefined();
    }

    // Tick CYCLE_LENGTH is the first boundary: every system with a market row (the economy
    // processor's shard, `lib/tick/processors/economy.ts`) is now assessed — a bare frontier
    // system with no markets yet is legitimately still absent, so this checks non-vacuity (at
    // least one system moved) rather than universal coverage.
    world = (await runWorldTick(world)).world;
    expect(world.meta.currentTick).toBe(CYCLE_LENGTH);
    expect(world.systems.some((s) => s.provision !== undefined)).toBe(true);
    const assessed = new Map(world.systems.map((s) => [s.id, { provision: s.provision, supplyBand: s.supplyBand }]));

    // Off-boundary ticks through the whole next cycle leave both fields byte-identical.
    for (let t = CYCLE_LENGTH + 1; t < 2 * CYCLE_LENGTH; t++) {
      world = (await runWorldTick(world)).world;
      for (const s of world.systems) {
        expect(s.provision).toBe(assessed.get(s.id)?.provision);
        expect(s.supplyBand).toBe(assessed.get(s.id)?.supplyBand);
      }
    }

    // The second boundary reassesses: at least one system's reading actually moves — a per-system
    // check (not an aggregate) so the assertion above can't be vacuously satisfied by a frozen sim.
    world = (await runWorldTick(world)).world;
    expect(world.meta.currentTick).toBe(2 * CYCLE_LENGTH);
    const moved = world.systems.some((s) =>
      s.provision !== assessed.get(s.id)?.provision || s.supplyBand !== assessed.get(s.id)?.supplyBand,
    );
    expect(moved).toBe(true);
  });

  it("broadcasts economyTick on every tick, cycle or not, with the resolving tick the only one reporting systems", async () => {
    // The cycle-start gate skips the economy stage mid-cycle, so runWorldTick emits the
    // mid-cycle payload in its place. That signal must not go missing: the client re-derives
    // market/population/ownership data from the state frame on every economyTick, so a gate
    // that swallowed it would leave the UI stale for a cycle rather than fail loudly.
    // systemCount is what distinguishes a resolving tick.
    let world = generateWorld({ systemCount: 40, seed: 7 });

    for (let t = 1; t <= CYCLE_LENGTH; t++) {
      const { world: next, events: broadcast } = await runWorldTick(world);
      world = next;
      expect(world.meta.currentTick).toBe(t);

      const entry = economyTickEntry(broadcast);
      expect(entry.shardCount).toBe(CYCLE_LENGTH);
      expect(entry.shardIndex).toBe(t % CYCLE_LENGTH);
      expect(entry.systemCount > 0).toBe(t % CYCLE_LENGTH === 0);
    }
  });

  it("produces no NaN/Infinity in population or stock across a full cycle", async () => {
    let world = generateWorld({ systemCount: 40, seed: 7 });
    for (let t = 0; t < CYCLE_LENGTH + 1; t++) world = (await runWorldTick(world)).world;
    for (const s of world.systems) expect(Number.isFinite(s.population)).toBe(true);
    for (const m of world.markets) expect(Number.isFinite(m.stock)).toBe(true);
  });

  it("cadence override moves the cycle boundary", async () => {
    const world = generateWorld({ systemCount: 40, seed: 7 });
    const cadence = { cycle: 2, construction: 2, logistics: 2 };

    // Tick 1 is mid-cycle under cycle=2 (1 % 2 !== 0): the economy did not resolve,
    // so the mid-cycle payload reports the shifted period and no resolving systems.
    const r1 = await runWorldTick(world, { cadence });
    expect(r1.world.meta.currentTick).toBe(1);
    const e1 = economyTickEntry(r1.events);
    expect(e1.shardCount).toBe(2);
    expect(e1.shardIndex).toBe(1);
    expect(e1.systemCount).toBe(0);

    // Tick 2 is the first boundary under cycle=2 (2 % 2 === 0): the economy resolves,
    // a full cycle ahead of the default cadence's tick-24 boundary.
    const r2 = await runWorldTick(r1.world, { cadence });
    expect(r2.world.meta.currentTick).toBe(2);
    const e2 = economyTickEntry(r2.events);
    expect(e2.shardCount).toBe(2);
    expect(e2.shardIndex).toBe(0);
    expect(e2.systemCount).toBeGreaterThan(0);
  });
});
