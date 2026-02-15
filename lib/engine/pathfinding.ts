/**
 * Pathfinding engine — Dijkstra-based shortest-path and reachability analysis.
 * Pure functions, zero DB dependency, testable with Vitest.
 */

import type { ConnectionInfo } from "./navigation";
import { hopDuration } from "./travel";

// ── Types ───────────────────────────────────────────────────────

export interface PathResult {
  path: string[];
  totalFuelCost: number;
  totalTravelDuration: number;
}

export interface ReachableSystem {
  systemId: string;
  fuelCost: number;
  travelDuration: number;
  path: string[];
}

export type RouteValidationResult =
  | { ok: true; totalFuelCost: number; totalTravelDuration: number }
  | { ok: false; error: string };

// ── Helpers ─────────────────────────────────────────────────────

/** Build adjacency list from flat connection array. */
function buildAdjacencyList(
  connections: ConnectionInfo[],
): Map<string, { toSystemId: string; fuelCost: number }[]> {
  const adj = new Map<string, { toSystemId: string; fuelCost: number }[]>();
  for (const c of connections) {
    let neighbors = adj.get(c.fromSystemId);
    if (!neighbors) {
      neighbors = [];
      adj.set(c.fromSystemId, neighbors);
    }
    neighbors.push({ toSystemId: c.toSystemId, fuelCost: c.fuelCost });
  }
  return adj;
}

// ── Dijkstra — lowest-fuel path ────────────────────────────────

/**
 * Find the lowest-fuel-cost path between two systems using Dijkstra.
 * Returns null if no path exists.
 */
export function findShortestPath(
  originId: string,
  destinationId: string,
  connections: ConnectionInfo[],
): PathResult | null {
  if (originId === destinationId) return null;

  const adj = buildAdjacencyList(connections);

  // dist[node] = lowest fuel cost from origin to node
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();

  dist.set(originId, 0);

  // Simple priority queue via linear scan (fine for small graphs)
  while (true) {
    // Pick unvisited node with smallest distance
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < currentDist) {
        current = node;
        currentDist = d;
      }
    }

    if (current === null) break; // No more reachable nodes
    if (current === destinationId) break; // Found destination

    visited.add(current);

    const neighbors = adj.get(current) ?? [];
    for (const { toSystemId, fuelCost } of neighbors) {
      if (visited.has(toSystemId)) continue;
      const newDist = currentDist + fuelCost;
      if (newDist < (dist.get(toSystemId) ?? Infinity)) {
        dist.set(toSystemId, newDist);
        prev.set(toSystemId, current);
      }
    }
  }

  // Reconstruct path
  if (!dist.has(destinationId)) return null;

  const path: string[] = [];
  let node: string | undefined = destinationId;
  while (node !== undefined) {
    path.unshift(node);
    node = prev.get(node);
  }

  if (path[0] !== originId) return null; // Disconnected

  const totalFuelCost = dist.get(destinationId)!;

  // Sum travel duration per hop
  let totalTravelDuration = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const neighbors = adj.get(path[i]) ?? [];
    const edge = neighbors.find((n) => n.toSystemId === path[i + 1]);
    if (edge) {
      totalTravelDuration += hopDuration(edge.fuelCost);
    }
  }

  return { path, totalFuelCost, totalTravelDuration };
}

// ── Fuel-constrained reachability ──────────────────────────────

/**
 * Find all systems reachable from origin within the given fuel budget.
 * Returns a map of systemId → ReachableSystem (excludes origin).
 */
export function findReachableSystems(
  originId: string,
  currentFuel: number,
  connections: ConnectionInfo[],
): Map<string, ReachableSystem> {
  const adj = buildAdjacencyList(connections);
  const result = new Map<string, ReachableSystem>();

  // Dijkstra with fuel constraint
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();

  dist.set(originId, 0);

  while (true) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < currentDist) {
        current = node;
        currentDist = d;
      }
    }

    if (current === null) break;

    visited.add(current);

    const neighbors = adj.get(current) ?? [];
    for (const { toSystemId, fuelCost } of neighbors) {
      if (visited.has(toSystemId)) continue;
      const newDist = currentDist + fuelCost;
      if (newDist <= currentFuel && newDist < (dist.get(toSystemId) ?? Infinity)) {
        dist.set(toSystemId, newDist);
        prev.set(toSystemId, current);
      }
    }
  }

  // Build results (exclude origin)
  for (const [systemId, fuelCost] of dist) {
    if (systemId === originId) continue;

    // Reconstruct path
    const path: string[] = [];
    let node: string | undefined = systemId;
    while (node !== undefined) {
      path.unshift(node);
      node = prev.get(node);
    }

    // Sum travel duration
    let travelDuration = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const neighbors = adj.get(path[i]) ?? [];
      const edge = neighbors.find((n) => n.toSystemId === path[i + 1]);
      if (edge) {
        travelDuration += hopDuration(edge.fuelCost);
      }
    }

    result.set(systemId, { systemId, fuelCost, travelDuration, path });
  }

  return result;
}

// ── All-pairs hop distances (BFS) ──────────────────────────────

/**
 * BFS hop-count from every system to every other system.
 * Returns Map<origin, Map<dest, hops>>. ~40 systems × BFS = trivial cost.
 */
export function computeAllHopDistances(
  connections: ConnectionInfo[],
): Map<string, Map<string, number>> {
  // Build bidirectional adjacency list (connections are directed, but we need both directions)
  const adj = new Map<string, string[]>();
  const allSystems = new Set<string>();

  for (const c of connections) {
    allSystems.add(c.fromSystemId);
    allSystems.add(c.toSystemId);

    let neighborsFrom = adj.get(c.fromSystemId);
    if (!neighborsFrom) {
      neighborsFrom = [];
      adj.set(c.fromSystemId, neighborsFrom);
    }
    neighborsFrom.push(c.toSystemId);

    // Also add reverse direction for undirected hop counting
    let neighborsTo = adj.get(c.toSystemId);
    if (!neighborsTo) {
      neighborsTo = [];
      adj.set(c.toSystemId, neighborsTo);
    }
    neighborsTo.push(c.fromSystemId);
  }

  const result = new Map<string, Map<string, number>>();

  for (const origin of allSystems) {
    const distances = new Map<string, number>();
    distances.set(origin, 0);
    const queue: string[] = [origin];
    let head = 0;

    while (head < queue.length) {
      const current = queue[head++];
      const currentDist = distances.get(current)!;
      const neighbors = adj.get(current) ?? [];

      for (const neighbor of neighbors) {
        if (!distances.has(neighbor)) {
          distances.set(neighbor, currentDist + 1);
          queue.push(neighbor);
        }
      }
    }

    result.set(origin, distances);
  }

  return result;
}

// ── Linear route validation (server-side) ──────────────────────

/**
 * Validate a pre-computed route by walking each consecutive hop.
 * Checks that each pair is connected and total fuel is within budget.
 */
export function validateRoute(
  route: string[],
  connections: ConnectionInfo[],
  currentFuel: number,
): RouteValidationResult {
  if (route.length < 2) {
    return { ok: false, error: "Route must have at least 2 systems." };
  }

  const adj = buildAdjacencyList(connections);
  let totalFuelCost = 0;
  let totalTravelDuration = 0;

  for (let i = 0; i < route.length - 1; i++) {
    const from = route[i];
    const to = route[i + 1];

    if (from === to) {
      return { ok: false, error: `Route contains duplicate consecutive system: ${from}.` };
    }

    const neighbors = adj.get(from) ?? [];
    const edge = neighbors.find((n) => n.toSystemId === to);

    if (!edge) {
      return { ok: false, error: `No connection from ${from} to ${to}.` };
    }

    totalFuelCost += edge.fuelCost;
    totalTravelDuration += hopDuration(edge.fuelCost);
  }

  if (totalFuelCost > currentFuel) {
    return {
      ok: false,
      error: `Not enough fuel. Need ${totalFuelCost}, have ${currentFuel}.`,
    };
  }

  return { ok: true, totalFuelCost, totalTravelDuration };
}
