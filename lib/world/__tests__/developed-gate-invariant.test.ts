import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";
import type { World } from "@/lib/world/types";

async function advance(world: World, ticks: number): Promise<World> {
  for (let t = 0; t < ticks; t++) world = (await runWorldTick(world)).world;
  return world;
}

const marketKey = (systemId: string, goodId: string) => `${systemId}|${goodId}`;

describe("developed-gate invariant: only developed systems are economically active", () => {
  it("keeps non-developed systems at population 0, with frozen markets and no flow activity, across claim + develop pulses", async () => {
    const seed = generateWorld({ systemCount: 90, seed: 11 });
    // Snapshot the seeded market stock so we can assert non-developed markets never moved.
    const seedStock = new Map<string, number>();
    for (const m of seed.markets) seedStock.set(marketKey(m.systemId, m.goodId), m.stock);

    // Advance far enough that both claims (controlled) and developments (developed) fire.
    const world = await advance(seed, MONTH_LENGTH * 4);

    // Sanity: the run actually produced controlled (non-developed, owned) systems — otherwise
    // the migration-leak path this test guards would be exercised vacuously.
    expect(world.systems.some((s) => s.control === "controlled")).toBe(true);

    const nonDeveloped = new Set(
      world.systems.filter((s) => s.control !== "developed").map((s) => s.id),
    );

    // (1) No population settles in a non-developed system.
    for (const s of world.systems) {
      if (s.control !== "developed") expect(s.population).toBe(0);
    }

    // (2) A non-developed system's market stock is unchanged from the seed (no production/
    //     consumption/logistics ran there).
    for (const m of world.markets) {
      if (nonDeveloped.has(m.systemId)) {
        expect(m.stock).toBe(seedStock.get(marketKey(m.systemId, m.goodId)));
      }
    }

    // (3) No flow event references a non-developed system (control is monotonic, so a developed
    //     endpoint was developed when the flow was emitted).
    for (const f of world.flowEvents) {
      expect(nonDeveloped.has(f.fromSystemId)).toBe(false);
      expect(nonDeveloped.has(f.toSystemId)).toBe(false);
    }
  });
});
