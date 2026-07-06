import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import { RELATIONS_FREQUENCY, RELATION_HISTORY_MAX } from "@/lib/constants/relations";

async function runTicks(world: ReturnType<typeof generateWorld>, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) {
    const result = await runWorldTick(w);
    w = result.world;
  }
  return w;
}

describe("runWorldTick", () => {
  it("advances meta.currentTick by exactly one per call", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const after = await runTicks(world, 50);
    expect(after.meta.currentTick).toBe(50);
  });

  it("never produces NaN/Infinity in market stock or system population over 50 ticks", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const after = await runTicks(world, 50);

    for (const m of after.markets) {
      expect(Number.isFinite(m.stock)).toBe(true);
      expect(Number.isFinite(m.anchorMult)).toBe(true);
      expect(Number.isFinite(m.demandRate)).toBe(true);
    }
    for (const s of after.systems) {
      expect(Number.isFinite(s.population)).toBe(true);
      expect(Number.isFinite(s.unrest)).toBe(true);
      expect(Number.isFinite(s.popCap)).toBe(true);
    }
  });

  it("changes at least one market's stock over 50 ticks", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const before = new Map(world.markets.map((m) => [`${m.systemId}|${m.goodId}`, m.stock]));
    const after = await runTicks(world, 50);

    const changed = after.markets.some(
      (m) => before.get(`${m.systemId}|${m.goodId}`) !== m.stock,
    );
    expect(changed).toBe(true);
  });

  it("is deterministic — the same world run for the same tick count twice deep-equals", async () => {
    const worldA = generateWorld({ systemCount: 100, seed: 42 });
    const worldB = generateWorld({ systemCount: 100, seed: 42 });

    const afterA = await runTicks(worldA, 50);
    const afterB = await runTicks(worldB, 50);

    expect(afterA).toEqual(afterB);
  });

  it("gates the relations processor by RELATIONS_FREQUENCY — history entries reflect floor(ticks/frequency), not every tick", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const after = await runTicks(world, 50);

    const expectedRuns = Math.floor(50 / RELATIONS_FREQUENCY);
    // History is a ring buffer capped at RELATION_HISTORY_MAX entries per pair
    // (see lib/constants/relations.ts) — floor(50/3) = 16 runs exceeds the cap.
    const expectedHistoryLength = Math.min(expectedRuns, RELATION_HISTORY_MAX);
    for (const relation of after.relations) {
      // Each relations run appends exactly one history entry per pair.
      expect(relation.history.length).toBe(expectedHistoryLength);
      expect(relation.history.length).toBeLessThan(50);
    }
    // Sanity: relations actually has pairs to check (world has ≥2 factions).
    expect(after.relations.length).toBeGreaterThan(0);
  });

  it("does not mutate the input world (immutable-spread style)", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const snapshot = JSON.parse(JSON.stringify(world));
    await runWorldTick(world);
    expect(world).toEqual(snapshot);
  });

  it("returns a TickEventRaw whose currentTick matches the new world's tick", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const { world: after, events } = await runWorldTick(world);
    expect(events.currentTick).toBe(after.meta.currentTick);
    expect(events.currentTick).toBe(1);
  });
});
