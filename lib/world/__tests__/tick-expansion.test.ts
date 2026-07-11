import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";
import type { World } from "@/lib/world/types";

function ownedCount(w: World): number {
  return w.systems.filter((s) => s.factionId !== null).length;
}
async function advance(world: World, ticks: number): Promise<World> {
  for (let t = 0; t < ticks; t++) world = (await runWorldTick(world)).world;
  return world;
}

describe("runWorldTick: expansion (claim + develop)", () => {
  it("grows owned-system count and produces controlled + developed systems across pulses", async () => {
    let world = generateWorld({ systemCount: 90, seed: 11 });
    const startOwned = ownedCount(world);
    expect(startOwned).toBe(world.factions.length); // one developed homeworld each

    world = await advance(world, MONTH_LENGTH * 4);
    expect(ownedCount(world)).toBeGreaterThan(startOwned); // claiming happened

    const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
    // Every newly-owned non-homeworld system is controlled or developed, never unclaimed.
    for (const s of world.systems) {
      if (s.factionId !== null && !homeworldIds.has(s.id)) {
        expect(s.control === "controlled" || s.control === "developed").toBe(true);
      }
      if (s.factionId === null) expect(s.control).toBe("unclaimed");
    }
    // Developing is now a pool-funded, timed colony-establish project (not an instant flip), and it is
    // saturation-gated (home-first while there is cheap building). So within a few months we assert
    // colonisation is PACED — controlled borders accumulate — rather than a completed developed colony
    // (end-to-end completion + viability is covered by the processor + applyDevelopments unit tests, and
    // long-run pacing by `npm run simulate`).
    const controlledNonHome = world.systems.filter((s) => s.control === "controlled" && !homeworldIds.has(s.id));
    expect(controlledNonHome.length).toBeGreaterThan(0);
    // No colony-establish project ever carries NaN/Infinity work into World state.
    for (const p of world.constructionProjects) {
      expect(Number.isFinite(p.workTotal)).toBe(true);
      expect(Number.isFinite(p.workDone)).toBe(true);
    }
  });

  it("is deterministic — same seed produces the same ownership after several pulses", async () => {
    const a = await advance(generateWorld({ systemCount: 90, seed: 11 }), MONTH_LENGTH * 3);
    const b = await advance(generateWorld({ systemCount: 90, seed: 11 }), MONTH_LENGTH * 3);
    const own = (w: World) => w.systems.map((s) => `${s.id}:${s.control}:${s.factionId ?? "-"}`).sort();
    expect(own(a)).toEqual(own(b));
  });

  it("keeps population finite and non-negative across develop pulses", async () => {
    const before = generateWorld({ systemCount: 90, seed: 11 });
    const total = (w: World) => w.systems.reduce((n, s) => n + s.population, 0);
    // The economy grows/shrinks pop tick to tick, so this only checks the pulse stays sane (no NaN,
    // no negative population) — the develop transfer's conservation itself is unit-tested directly
    // against `applyDevelopments` in apply-developments.test.ts.
    const after = await advance(before, MONTH_LENGTH * 2);
    expect(Number.isFinite(total(after))).toBe(true);
    for (const s of after.systems) expect(s.population).toBeGreaterThanOrEqual(0);
  });

  it("produces no NaN/Infinity in population or stock across the pulses", async () => {
    const world = await advance(generateWorld({ systemCount: 90, seed: 11 }), MONTH_LENGTH * 2 + 1);
    for (const s of world.systems) expect(Number.isFinite(s.population)).toBe(true);
    for (const m of world.markets) expect(Number.isFinite(m.stock)).toBe(true);
  });
});
