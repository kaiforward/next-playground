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
