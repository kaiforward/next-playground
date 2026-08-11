import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import type { World } from "../types";
import { CYCLE_LENGTH, CONSTRUCTION_INTERVAL, LOGISTICS_INTERVAL } from "@/lib/constants/tick-cadence";

/**
 * Where a colony's seed population comes from.
 *
 * The tick picks each in-flight colony's source system itself, and the pick is written into the
 * establish project and honoured months of game time later when the colony lands. A source that is
 * the wrong faction's, or not developed, or absent altogether, still produces a plausible-looking
 * colony — the damage shows up as population appearing from, or vanishing into, a system that was
 * never party to the founding.
 */

const LIVE_CADENCE = {
  cycle: CYCLE_LENGTH,
  construction: CONSTRUCTION_INTERVAL,
  logistics: LOGISTICS_INTERVAL,
};

/** Jumps from `originId` to every system it can reach, by breadth-first search over the graph. */
function hopDistancesFrom(world: World, originId: string): Map<string, number> {
  const neighbours = new Map<string, string[]>();
  for (const c of world.connections) {
    neighbours.set(c.fromId, [...(neighbours.get(c.fromId) ?? []), c.toId]);
    neighbours.set(c.toId, [...(neighbours.get(c.toId) ?? []), c.fromId]);
  }
  const distances = new Map<string, number>([[originId, 0]]);
  const queue = [originId];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const distance = distances.get(current) ?? 0;
    for (const next of neighbours.get(current) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, distance + 1);
      queue.push(next);
    }
  }
  return distances;
}

/** Run until at least one colony-establish project exists, or give up. */
async function advanceToFirstEstablish(world: World, maxTicks: number): Promise<World> {
  let current = world;
  for (let i = 0; i < maxTicks; i++) {
    current = (await runWorldTick(current, { cadence: LIVE_CADENCE })).world;
    if (current.constructionProjects.some((p) => p.kind === "colony_establish")) break;
  }
  return current;
}

describe("runWorldTick — the seed source an establish project is founded from", () => {
  it("names a DEVELOPED system of the founding faction, never a neighbour's and never nothing", async () => {
    const world = await advanceToFirstEstablish(generateWorld({ systemCount: 90, seed: 11 }), 60);
    const establishes = world.constructionProjects.filter((p) => p.kind === "colony_establish");
    // Premise: the galaxy actually got as far as funding a colony, or there is nothing to check.
    expect(establishes.length).toBeGreaterThan(0);

    const systemById = new Map(world.systems.map((s) => [s.id, s]));
    for (const project of establishes) {
      const source = systemById.get(project.sourceSystemId);
      expect(source).toBeDefined();
      if (!source) continue;
      expect(source.id).not.toBe(project.systemId);
      expect(source.factionId).toBe(project.factionId);
      expect(source.control).toBe("developed");
      expect(systemById.has(project.systemId)).toBe(true);

      // …and it is the NEAREST such system. Seed population is a real transfer out of a real place;
      // drawing it from the far side of the realm when a neighbour could have supplied it drains the
      // wrong world and prices the colony against the wrong distance.
      const distances = hopDistancesFrom(world, project.systemId);
      const eligible = world.systems.filter(
        (s) => s.control === "developed" && s.factionId === project.factionId && distances.has(s.id),
      );
      const nearest = Math.min(...eligible.map((s) => distances.get(s.id) ?? Infinity));
      expect(distances.get(source.id)).toBe(nearest);
    }
  });

  it("skips a controlled system with no connections instead of reaching into an empty hop map", async () => {
    // A claim can sit on a system the hop map has no entry for at all. The colony scan walks every
    // controlled system the faction holds, so it meets that system every construction cycle.
    const base = generateWorld({ systemCount: 90, seed: 11 });
    const factionId = base.factions[0].id;
    const rock = base.systems.find((s) => s.control === "unclaimed");
    if (!rock) throw new Error("fixture premise: no unclaimed system to claim");
    const world: World = {
      ...base,
      meta: { ...base.meta, currentTick: 0 },
      systems: base.systems.map((s) =>
        s.id === rock.id ? { ...s, factionId, control: "controlled" as const } : s,
      ),
      connections: base.connections.filter((c) => c.fromId !== rock.id && c.toId !== rock.id),
    };
    expect(world.connections.length).toBeLessThan(base.connections.length); // premise: it was connected

    const after = (await runWorldTick(world, { cadence: { cycle: 1, construction: 1, logistics: 1 } })).world;

    // It is still just a claim: unreachable from any developed seed source, so nothing was founded on it.
    expect(after.systems.find((s) => s.id === rock.id)?.control).toBe("controlled");
    expect(after.constructionProjects.some((p) => p.kind === "colony_establish" && p.systemId === rock.id)).toBe(false);
  });
});
