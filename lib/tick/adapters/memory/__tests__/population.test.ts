import { describe, it, expect } from "vitest";
import { InMemoryPopulationWorld } from "../population";
import type { TickSystem } from "@/lib/tick/rows";
import { generateWorld } from "@/lib/world/gen";
import { toTickSystems } from "@/lib/world/tick";

/**
 * `populationChange` is written by the tick body (`lib/world/tick.ts`), not by this adapter — the
 * realised figure needs the post-migration population, which this processor never sees. The adapter
 * still has to carry a pre-existing value through untouched: `applyPopulationUpdates` rebuilds every
 * row via `{ ...s, population: ..., unrest: ... }`, and nothing in that spread should strip a field
 * this processor doesn't own.
 */
describe("InMemoryPopulationWorld.applyPopulationUpdates — populationChange pass-through", () => {
  it("carries a row's existing populationChange through an update untouched", async () => {
    const base = toTickSystems(generateWorld({ systemCount: 100, seed: 42 }))[0];
    const stale: TickSystem = { ...base, populationChange: -42 };
    const world = new InMemoryPopulationWorld({ systems: [stale], markets: [] });

    await world.applyPopulationUpdates([
      { systemId: stale.id, population: stale.population + 5, unrest: 0.1 },
    ]);

    expect(world.systems[0].populationChange).toBe(-42);
  });

  it("leaves populationChange absent when the row never had one", async () => {
    const base = toTickSystems(generateWorld({ systemCount: 100, seed: 42 }))[0];
    expect(base.populationChange).toBeUndefined();
    const world = new InMemoryPopulationWorld({ systems: [base], markets: [] });

    await world.applyPopulationUpdates([
      { systemId: base.id, population: base.population + 5, unrest: 0.1 },
    ]);

    expect(world.systems[0].populationChange).toBeUndefined();
  });
});

/**
 * `habitabilityQuality` is a MEMORY field, same write convention as `provisionExpectation` above
 * (not the no-memory snapshot convention `provision`/`supplyBand` use): a corrupt or absent write
 * must keep the row's existing cached value rather than dropping to absent, and a genuinely
 * never-assessed row has no prior value to fall back to.
 */
describe("InMemoryPopulationWorld.applyPopulationUpdates — habitabilityQuality write convention", () => {
  it("writes a finite habitabilityQuality straight through", async () => {
    const base = toTickSystems(generateWorld({ systemCount: 100, seed: 42 }))[0];
    const world = new InMemoryPopulationWorld({ systems: [base], markets: [] });

    await world.applyPopulationUpdates([
      {
        systemId: base.id, population: base.population, unrest: 0,
        habitabilityQuality: { quality: 0.75, frontierIndex: 1 },
      },
    ]);

    expect(world.systems[0].habitabilityQuality).toEqual({ quality: 0.75, frontierIndex: 1 });
  });

  it("keeps the row's existing habitabilityQuality when the update carries a corrupt (NaN) one", async () => {
    const base = toTickSystems(generateWorld({ systemCount: 100, seed: 42 }))[0];
    const stale = { ...base, habitabilityQuality: { quality: 0.6, frontierIndex: 0 } };
    const world = new InMemoryPopulationWorld({ systems: [stale], markets: [] });

    await world.applyPopulationUpdates([
      {
        systemId: stale.id, population: stale.population, unrest: 0,
        habitabilityQuality: { quality: Number.NaN, frontierIndex: 1 },
      },
    ]);

    expect(world.systems[0].habitabilityQuality).toEqual({ quality: 0.6, frontierIndex: 0 });
  });

  it("leaves habitabilityQuality absent — never a fabricated reading — for a never-assessed row given no update", async () => {
    const base = toTickSystems(generateWorld({ systemCount: 100, seed: 42 }))[0];
    expect(base.habitabilityQuality).toBeUndefined();
    const world = new InMemoryPopulationWorld({ systems: [base], markets: [] });

    await world.applyPopulationUpdates([
      { systemId: base.id, population: base.population, unrest: 0 },
    ]);

    expect(world.systems[0].habitabilityQuality).toBeUndefined();
    expect("habitabilityQuality" in world.systems[0]).toBe(false);
  });
});
