import { generateWorld } from "@/lib/world/gen";
import { getWorld } from "@/lib/world/store";
import { toTickConnections } from "@/lib/world/tick";
import { boundedHopsFromOrigin } from "@/lib/engine/pathfinding";
import { COLONY_REACH_HOPS } from "@/lib/services/colony-eligibility";
import type { World, WorldSystem } from "@/lib/world/types";

/**
 * The player-seat fixture every service test in this directory is written against: 60 systems at
 * seed 42, seated on a federation/mercantile faction that owns a developed homeworld. Shared, so
 * "the seat world" means the same galaxy in every file — a per-file copy that drifted in seed or
 * system count would quietly be asserting against a different layout while still reading as the
 * same fixture. Tests wanting a different shape (no seat, another seed) build their own.
 */
export function seatWorld(): World {
  return generateWorld({
    systemCount: 60,
    seed: 42,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
}

/**
 * The seated world's homeworld row. Every colony-side fixture starts from it, and world-gen picks
 * which system it is, so no test may assume an index.
 */
export function playerHome(): WorldSystem {
  const world = getWorld();
  const faction = world.factions.find((f) => f.id === playerFactionId())!;
  return world.systems.find((s) => s.id === faction.homeworldId)!;
}

/** An unclaimed system directly connected to the homeworld — the seated galaxy's own frontier edge. */
export function unclaimedNeighbour(): WorldSystem {
  const w = getWorld();
  const home = playerHome();
  for (const c of w.connections) {
    let otherId: string | null = null;
    if (c.fromId === home.id) otherId = c.toId;
    else if (c.toId === home.id) otherId = c.fromId;
    if (otherId === null) continue;
    const other = w.systems.find((s) => s.id === otherId)!;
    if (other.factionId === null) return other;
  }
  throw new Error("fixture: seeded galaxy has no unclaimed neighbour of the homeworld");
}

/**
 * An unclaimed system with NO lane into player-held territory — the claim verb's "not adjacent"
 * case. Throws when the seeded galaxy has none, so a test that needs one fails loudly rather than
 * returning early and passing on nothing.
 */
export function farUnclaimedSystem(): WorldSystem {
  const w = getWorld();
  const pid = playerFactionId();
  const ownedIds = new Set(w.systems.filter((s) => s.factionId === pid).map((s) => s.id));
  const far = w.systems.find((s) => {
    if (s.factionId !== null) return false;
    return !w.connections.some((c) => {
      const otherId = c.fromId === s.id ? c.toId : c.toId === s.id ? c.fromId : null;
      return otherId !== null && ownedIds.has(otherId);
    });
  });
  if (!far) throw new Error("fixture: seeded galaxy has no unclaimed system away from player territory");
  return far;
}

/** The faction the seat controls. Throws rather than reading `undefined` into a fixture. */
function playerFactionId(): string {
  const player = getWorld().player;
  if (!player) throw new Error("fixture: expected a player seat");
  return player.controlledFactionId;
}

/**
 * A controlled, amply-landed player system next to the homeworld — eligibility manufactured, not
 * rolled: the first system world-gen connected to the homeworld is handed to the player faction at
 * the `controlled` tier with the space asked for. Mutates the stored world in place, so callers
 * must already have set it.
 */
export function controlledNeighbour(peopleLand: number): { target: WorldSystem; home: WorldSystem } {
  const world = getWorld();
  const home = playerHome();
  const conn = world.connections.find((c) => c.fromId === home.id || c.toId === home.id)!;
  const otherId = conn.fromId === home.id ? conn.toId : conn.fromId;
  const target = world.systems.find((s) => s.id === otherId)!;
  target.factionId = playerFactionId();
  target.control = "controlled";
  target.peopleLand = peopleLand;
  return { target, home };
}

/**
 * A second controlled, amply-landed player system distinct from `excludeId` — reachable from the
 * homeworld within the colony verb's own seed-source search radius (`COLONY_REACH_HOPS`), not
 * necessarily a direct connection: corridor topology (spec `docs/active/gameplay/universe.md`)
 * does not guarantee the homeworld has two direct neighbours the way `controlledNeighbour` alone
 * assumes. Throws with a clear message rather than a bare `undefined!` crash if the seeded galaxy
 * doesn't offer one.
 */
export function secondControlledSystem(excludeId: string, peopleLand: number): WorldSystem {
  const world = getWorld();
  const home = playerHome();
  const hops = boundedHopsFromOrigin(home.id, toTickConnections(world), COLONY_REACH_HOPS);
  const candidate = world.systems.find(
    (s) => s.id !== home.id && s.id !== excludeId && s.control !== "developed" && hops.has(s.id),
  );
  if (!candidate) {
    throw new Error(
      `seeded galaxy has no second colonisable system within ${COLONY_REACH_HOPS} hops of the homeworld`,
    );
  }
  candidate.factionId = playerFactionId();
  candidate.control = "controlled";
  candidate.peopleLand = peopleLand;
  return candidate;
}
