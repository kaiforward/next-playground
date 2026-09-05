/**
 * Pathfinding engine — Dijkstra-based shortest-path and reachability analysis.
 * Pure functions, zero DB dependency, testable with Vitest.
 */

import type { ConnectionInfo } from "./navigation";
import { hopDuration } from "./travel";
import { buildHopAdjacency } from "./visibility";

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

/** Directional fuel adjacency: systemId → outgoing edges. */
export type FuelAdjacency = Map<string, { toSystemId: string; fuelCost: number }[]>;

/**
 * Build a **directional**, fuel-weighted adjacency list from a flat connection array — one edge per
 * connection, in the direction the connection was declared. The hop graph
 * (`buildHopAdjacency`, `lib/engine/visibility.ts`) is the other one: bidirectional and unweighted.
 *
 * Exported so callers that run many path queries over the same graph (e.g. the
 * map's fleet-transit layer) can build it once and pass it in, instead of
 * rebuilding it per query.
 */
export function buildFuelAdjacency(connections: ConnectionInfo[]): FuelAdjacency {
  const adj: FuelAdjacency = new Map();
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

/** Sum travel duration across a path using the adjacency list. */
function sumTravelDuration(
  path: string[],
  adj: FuelAdjacency,
  shipSpeed?: number,
): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const neighbors = adj.get(path[i]) ?? [];
    const edge = neighbors.find((n) => n.toSystemId === path[i + 1]);
    if (edge) {
      total += hopDuration(edge.fuelCost, shipSpeed);
    }
  }
  return total;
}

// ── Dijkstra — lowest-fuel path ────────────────────────────────

/**
 * Dijkstra over the fuel adjacency, with a linear-scan priority queue (fine for small graphs).
 * `maxFuel` drops any node the budget cannot reach; `stopAt` ends the search the moment that node
 * is the cheapest unvisited one, i.e. once its cost is final. `edgeCost`, when given, replaces the
 * raw `fuelCost` edge weight with `edgeCost(from, to, fuelCost, cumRawAtFrom)` — returning `null`
 * closes the edge for this search only (excluded from the graph, never priced). `cumRawAtFrom` is
 * the settled sum of RAW (unweighted) `fuelCost` along the best-known path to `from` — tracked
 * alongside `dist` (which accrues whatever `edgeCost` returns, congestion-priced or not) so a
 * time-dependent caller (`lib/engine/lane-routing.ts`'s windowed booking search) can read "how far
 * into the journey is this edge" without re-deriving it from `prev`. Every existing caller omits
 * the 4th parameter and is unaffected. Exported so callers pricing a congested or partially-closed
 * graph reuse this search verbatim instead of re-deriving Dijkstra.
 * Returns the settled cost map, the raw-distance map, and the predecessor map `reconstructPath` walks.
 */
export function dijkstra(
  originId: string,
  adjacency: FuelAdjacency,
  options: {
    maxFuel?: number;
    stopAt?: string;
    edgeCost?: (from: string, to: string, fuelCost: number, cumRawAtFrom: number) => number | null;
  } = {},
): { dist: Map<string, number>; prev: Map<string, string>; cumRaw: Map<string, number> } {
  const dist = new Map<string, number>();
  const cumRaw = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();

  dist.set(originId, 0);
  cumRaw.set(originId, 0);

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
    if (current === options.stopAt) break; // Target cost is final

    visited.add(current);

    const neighbors = adjacency.get(current) ?? [];
    const cumRawAtCurrent = cumRaw.get(current) ?? 0;
    for (const { toSystemId, fuelCost } of neighbors) {
      if (visited.has(toSystemId)) continue;
      const weight = options.edgeCost
        ? options.edgeCost(current, toSystemId, fuelCost, cumRawAtCurrent)
        : fuelCost;
      if (weight === null) continue; // Edge closed for this search
      const newDist = currentDist + weight;
      if (options.maxFuel !== undefined && newDist > options.maxFuel) continue;
      if (newDist < (dist.get(toSystemId) ?? Infinity)) {
        dist.set(toSystemId, newDist);
        prev.set(toSystemId, current);
        cumRaw.set(toSystemId, cumRawAtCurrent + fuelCost);
      }
    }
  }

  return { dist, prev, cumRaw };
}

/**
 * Walk the predecessor chain back from `target`; the returned path runs origin-first. Exported
 * alongside `dijkstra` so a caller with its own edge-cost hook (`lib/engine/lane-routing.ts`) can
 * reconstruct paths from the `prev` map it gets back, instead of re-implementing this walk.
 */
export function reconstructPath(prev: Map<string, string>, target: string): string[] {
  const path: string[] = [];
  let node: string | undefined = target;
  while (node !== undefined) {
    path.unshift(node);
    node = prev.get(node);
  }
  return path;
}

/**
 * Find the lowest-fuel-cost path between two systems using Dijkstra.
 * Returns null if no path exists.
 * Optional shipSpeed adjusts travel duration calculations.
 * Optional prebuilt `adj` avoids rebuilding the adjacency list when running
 * many queries over the same graph.
 */
export function findShortestPath(
  originId: string,
  destinationId: string,
  connections: ConnectionInfo[],
  shipSpeed?: number,
  adj?: FuelAdjacency,
): PathResult | null {
  if (originId === destinationId) return null;

  const adjacency = adj ?? buildFuelAdjacency(connections);
  const { dist, prev } = dijkstra(originId, adjacency, { stopAt: destinationId });

  const totalFuelCost = dist.get(destinationId);
  if (totalFuelCost === undefined) return null;

  const path = reconstructPath(prev, destinationId);
  if (path[0] !== originId) return null; // Disconnected

  const totalTravelDuration = sumTravelDuration(path, adjacency, shipSpeed);

  return { path, totalFuelCost, totalTravelDuration };
}

// ── Fuel-constrained reachability ──────────────────────────────

/**
 * Find all systems reachable from origin within the given fuel budget.
 * Returns a map of systemId → ReachableSystem (excludes origin).
 * Optional shipSpeed adjusts travel duration calculations.
 */
export function findReachableSystems(
  originId: string,
  currentFuel: number,
  connections: ConnectionInfo[],
  shipSpeed?: number,
): Map<string, ReachableSystem> {
  const adj = buildFuelAdjacency(connections);
  const { dist, prev } = dijkstra(originId, adj, { maxFuel: currentFuel });
  const result = new Map<string, ReachableSystem>();

  // Build results (exclude origin)
  for (const [systemId, fuelCost] of dist) {
    if (systemId === originId) continue;

    const path = reconstructPath(prev, systemId);
    const travelDuration = sumTravelDuration(path, adj, shipSpeed);
    result.set(systemId, { systemId, fuelCost, travelDuration, path });
  }

  return result;
}

// ── Hop distance helpers ─────────────────────────────────────────

/**
 * BFS hop-count from one origin over a bidirectional adjacency list.
 * Always includes the origin at 0; `maxHops`, when given, stops the frontier at that depth.
 */
function bfsHopDistances(
  origin: string,
  adj: Map<string, string[]>,
  maxHops?: number,
): Map<string, number> {
  const distances = new Map<string, number>();
  distances.set(origin, 0);
  const queue: string[] = [origin];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const currentDist = distances.get(current) ?? 0;
    if (maxHops !== undefined && currentDist >= maxHops) continue;

    const neighbors = adj.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, currentDist + 1);
        queue.push(neighbor);
      }
    }
  }

  return distances;
}

// ── All-pairs hop distances (BFS) ──────────────────────────────

/**
 * BFS hop-count from every system to every other system.
 * Returns Map<origin, Map<dest, hops>>.
 *
 * WARNING: O(V²) memory and O(V×(V+E)) time — only suitable for small graphs.
 * For large universes, use computeBoundedHopDistances instead.
 */
export function computeAllHopDistances(
  connections: ConnectionInfo[],
): Map<string, Map<string, number>> {
  const adj = buildHopAdjacency(connections);
  const result = new Map<string, Map<string, number>>();

  for (const origin of adj.keys()) {
    result.set(origin, bfsHopDistances(origin, adj));
  }

  return result;
}

// ── Bounded hop distances (BFS with depth limit) ────────────────

/**
 * BFS hop-count from every system, stopping at maxHops depth.
 * Returns Map<origin, Map<dest, hops>> with only nearby systems included.
 *
 * Much faster than computeAllHopDistances for large universes — each BFS
 * visits at most ~branching_factor^maxHops nodes instead of the entire graph.
 */
export function computeBoundedHopDistances(
  connections: ConnectionInfo[],
  maxHops: number,
): Map<string, Map<string, number>> {
  const adj = buildHopAdjacency(connections);
  const result = new Map<string, Map<string, number>>();

  for (const origin of adj.keys()) {
    result.set(origin, bfsHopDistances(origin, adj, maxHops));
  }

  return result;
}

// ── Single-origin bounded hop distances (BFS) ──────────────────

/**
 * BFS hop-count from a single origin, stopping at maxHops depth.
 * Always includes the origin itself at distance 0.
 */
export function boundedHopsFromOrigin(
  origin: string,
  connections: ConnectionInfo[],
  maxHops: number,
): Map<string, number> {
  return bfsHopDistances(origin, buildHopAdjacency(connections), maxHops);
}

// ── Linear route validation (server-side) ──────────────────────

/**
 * Validate a pre-computed route by walking each consecutive hop.
 * Checks that each pair is connected and total fuel is within budget.
 * Optional shipSpeed adjusts travel duration calculations.
 */
export function validateRoute(
  route: string[],
  connections: ConnectionInfo[],
  currentFuel: number,
  shipSpeed?: number,
): RouteValidationResult {
  if (route.length < 2) {
    return { ok: false, error: "Route must have at least 2 systems." };
  }

  const adj = buildFuelAdjacency(connections);
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
    totalTravelDuration += hopDuration(edge.fuelCost, shipSpeed);
  }

  if (totalFuelCost > currentFuel) {
    return {
      ok: false,
      error: `Not enough fuel. Need ${totalFuelCost}, have ${currentFuel}.`,
    };
  }

  return { ok: true, totalFuelCost, totalTravelDuration };
}
