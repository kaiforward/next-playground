/**
 * Fog-of-war visibility engine.
 * Pure functions — no DB dependency. Players can only see dynamic game state
 * (events, danger, ship presence) at systems within sensor range of their ships.
 */

import type { ShipRole } from "@/lib/constants/ships";

// ── Constants ────────────────────────────────────────────────────

/** How many connection hops each ship role can "see" from its current system. */
export const SENSOR_RANGE: Record<ShipRole, number> = {
  scout: 3,
  trade: 2,
  support: 2,
  combat: 1,
  stealth: 1,
};

// ── Types ────────────────────────────────────────────────────────

export interface ShipPosition {
  systemId: string;
  role: ShipRole;
}

// ── Functions ────────────────────────────────────────────────────

/**
 * Build a bidirectional adjacency list from a list of connections.
 * Each connection adds both fromSystem→toSystem and toSystem→fromSystem.
 */
export function buildAdjacencyList(
  connections: ReadonlyArray<{ fromSystemId: string; toSystemId: string }>,
): Map<string, string[]> {
  const adj = new Map<string, string[]>();

  for (const { fromSystemId, toSystemId } of connections) {
    let fromList = adj.get(fromSystemId);
    if (!fromList) {
      fromList = [];
      adj.set(fromSystemId, fromList);
    }
    fromList.push(toSystemId);

    let toList = adj.get(toSystemId);
    if (!toList) {
      toList = [];
      adj.set(toSystemId, toList);
    }
    toList.push(fromSystemId);
  }

  return adj;
}

/**
 * BFS from a starting system, returning all systems reachable within maxHops.
 * Includes the start system itself. Returns an empty set for unknown start nodes.
 */
export function bfsReachable(
  start: string,
  adjacency: Map<string, string[]>,
  maxHops: number,
): Set<string> {
  if (!adjacency.has(start)) return new Set();

  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: start, depth: 0 }];
  visited.add(start);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxHops) continue;

    const neighbors = adjacency.get(id);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    }
  }

  return visited;
}

/**
 * Compute the full visibility set for a player given their ship positions.
 * Returns the union of BFS reachable sets for each ship, using the ship's
 * role to determine sensor range.
 */
export function computeVisibilitySet(
  ships: ReadonlyArray<ShipPosition>,
  adjacency: Map<string, string[]>,
): Set<string> {
  const visible = new Set<string>();

  for (const ship of ships) {
    const reachable = bfsReachable(ship.systemId, adjacency, SENSOR_RANGE[ship.role]);
    for (const systemId of reachable) {
      visible.add(systemId);
    }
  }

  return visible;
}
