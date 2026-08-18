import { generateWorld } from "@/lib/world/gen";
import { getWorld } from "@/lib/world/store";
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
export function controlledNeighbour(habitableSpace: number): { target: WorldSystem; home: WorldSystem } {
  const world = getWorld();
  const home = playerHome();
  const conn = world.connections.find((c) => c.fromId === home.id || c.toId === home.id)!;
  const otherId = conn.fromId === home.id ? conn.toId : conn.fromId;
  const target = world.systems.find((s) => s.id === otherId)!;
  target.factionId = playerFactionId();
  target.control = "controlled";
  target.habitableSpace = habitableSpace;
  return { target, home };
}
