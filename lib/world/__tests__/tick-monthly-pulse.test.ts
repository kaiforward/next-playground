import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";
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

describe("runWorldTick: monthly pulse", () => {
  it("changes population only on the month boundary tick", async () => {
    let world = generateWorld({ systemCount: 40, seed: 7 });
    const startPop = totalPopulation(world);

    // Ticks 1..MONTH_LENGTH-1 are off-boundary: population is untouched.
    for (let t = 1; t < MONTH_LENGTH; t++) {
      world = (await runWorldTick(world)).world;
      expect(world.meta.currentTick).toBe(t);
      expect(totalPopulation(world)).toBeCloseTo(startPop, 6);
    }

    // Snapshot per-system population right before the first boundary tick.
    const before = new Map(world.systems.map((s) => [s.id, s.population]));

    // Tick MONTH_LENGTH is the first boundary: the population processor runs.
    world = (await runWorldTick(world)).world;
    expect(world.meta.currentTick).toBe(MONTH_LENGTH);
    // At least one system's population moves. A per-system check (not an aggregate
    // delta) so a chance growth/decline cancellation across systems can't mask the
    // pulse firing.
    const moved = world.systems.some((s) => Math.abs(s.population - (before.get(s.id) ?? 0)) > 1e-6);
    expect(moved).toBe(true);
  });

  it("broadcasts economyTick on every tick, pulse or not, with the resolving tick the only one reporting systems", async () => {
    // The pulse gate skips the economy stage off-pulse, so runWorldTick emits the
    // off-pulse payload in its place. That signal must not go missing: the client
    // (useTickInvalidation) refetches market/population/ownership data on every
    // economyTick, so a gate that swallowed it would leave the UI stale for a month
    // rather than fail loudly. systemCount is what distinguishes a resolving tick.
    let world = generateWorld({ systemCount: 40, seed: 7 });

    for (let t = 1; t <= MONTH_LENGTH; t++) {
      const { world: next, events: broadcast } = await runWorldTick(world);
      world = next;
      expect(world.meta.currentTick).toBe(t);

      const entry = economyTickEntry(broadcast);
      expect(entry.shardCount).toBe(MONTH_LENGTH);
      expect(entry.shardIndex).toBe(t % MONTH_LENGTH);
      expect(entry.systemCount > 0).toBe(t % MONTH_LENGTH === 0);
    }
  });

  it("produces no NaN/Infinity in population or stock across a full month", async () => {
    let world = generateWorld({ systemCount: 40, seed: 7 });
    for (let t = 0; t < MONTH_LENGTH + 1; t++) world = (await runWorldTick(world)).world;
    for (const s of world.systems) expect(Number.isFinite(s.population)).toBe(true);
    for (const m of world.markets) expect(Number.isFinite(m.stock)).toBe(true);
  });
});
