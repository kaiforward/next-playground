import { getWorld } from "@/lib/world/store";
import type { AtlasData } from "@/lib/types/game";
import { regionInfos } from "@/lib/services/world-index";

/**
 * Lightweight map data: positions, economies, regions, connections.
 * No names or descriptions — those are fetched via static/dynamic tiles.
 *
 * Each region's government is derived from its dominant owning faction
 * rather than stored on the region itself.
 */
export function getAtlas(): AtlasData {
  const world = getWorld();
  const factions = [...world.factions].sort((a, b) => a.name.localeCompare(b.name));

  const playerFactionId = world.player?.controlledFactionId ?? null;
  const playerHomeworldId = playerFactionId
    ? world.factions.find((f) => f.id === playerFactionId)?.homeworldId ?? null
    : null;

  return {
    meta: {
      mapSize: world.meta.mapSize,
      systemCount: world.meta.systemCount,
      seed: world.meta.seed,
    },
    regions: regionInfos(),
    systems: world.systems.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      regionId: s.regionId,
      factionId: s.factionId,
      economyType: s.economyType,
      isGateway: s.isGateway,
      developed: s.control === "developed",
      sunClass: s.sunClass,
    })),
    connections: world.connections.map((c) => ({
      id: `${c.fromId}:${c.toId}`,
      fromSystemId: c.fromId,
      toSystemId: c.toId,
      fuelCost: c.fuelCost,
    })),
    factions: factions.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
    })),
    player:
      playerFactionId && playerHomeworldId
        ? { controlledFactionId: playerFactionId, homeworldSystemId: playerHomeworldId }
        : null,
  };
}
