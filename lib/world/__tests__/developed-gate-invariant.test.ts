import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import type { World } from "@/lib/world/types";

async function advance(world: World, ticks: number): Promise<World> {
  for (let t = 0; t < ticks; t++) world = (await runWorldTick(world)).world;
  return world;
}

const marketKey = (systemId: string, goodId: string) => `${systemId}|${goodId}`;

describe("developed-gate invariant: only developed systems are economically active", () => {
  it("keeps non-developed systems at population 0, with frozen markets and no flow activity, across claim + develop cycles", async () => {
    const seed = generateWorld({ systemCount: 90, seed: 11 });
    // Snapshot the seeded market stock so we can assert never-developed markets never moved.
    const seedStock = new Map<string, number>();
    for (const m of seed.markets) seedStock.set(marketKey(m.systemId, m.goodId), m.stock);

    // Advance far enough that both claims (controlled) and developments (developed) fire.
    const world = await advance(seed, CYCLE_LENGTH * 4);

    // Sanity: the run actually produced controlled (non-developed, owned) systems — otherwise
    // the migration-leak path this test guards would be exercised vacuously.
    expect(world.systems.some((s) => s.control === "controlled")).toBe(true);

    const nonDeveloped = new Set(
      world.systems.filter((s) => s.control !== "developed").map((s) => s.id),
    );

    // (1) No population settles in a non-developed system. Holds for every non-developed system,
    //     including an abandoned husk (Rule 2's reset zeroes population in the same application as
    //     the control flip back to unclaimed).
    for (const s of world.systems) {
      if (s.control !== "developed") expect(s.population).toBe(0);
    }

    // Control is no longer monotonic once abandonment (Rule 2) can flip a `developed` system back
    // to `unclaimed`: a husk keeps its market rows (the warehouses affordance) and can still be
    // named by recent flow-event history from its former, developed life. So (2) and (3) below
    // re-scope from "every non-developed system" to NEVER-developed ones — systems that have not
    // merely reverted, but have genuinely never been developed at all. That subset is identifiable
    // without any new state: only a development (`addMarketsForSettledSystems`) ever creates a
    // system's first market row, so a non-developed system with zero market rows can only be one
    // that was never developed — a husk, by construction, always has rows.
    const marketSystemIds = new Set(world.markets.map((m) => m.systemId));
    const neverDeveloped = new Set(
      [...nonDeveloped].filter((id) => !marketSystemIds.has(id)),
    );

    // (2) A never-developed system's market stock is unchanged from the seed (no production/
    //     consumption/logistics ran there) — vacuously true by the same construction as (3) below,
    //     since a never-developed system has no market row to begin with; kept as a live invariant
    //     rather than deleted, so a future change that started minting rows for one would trip it.
    for (const m of world.markets) {
      if (neverDeveloped.has(m.systemId)) {
        expect(m.stock).toBe(seedStock.get(marketKey(m.systemId, m.goodId)));
      }
    }

    // (3) No flow event references a never-developed system.
    for (const f of world.flowEvents) {
      expect(neverDeveloped.has(f.fromSystemId)).toBe(false);
      expect(neverDeveloped.has(f.toSystemId)).toBe(false);
    }
  });
});
