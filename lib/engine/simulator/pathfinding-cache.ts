/**
 * Simulator-internal pathfinding with pre-built adjacency list.
 *
 * The real game's `lib/engine/pathfinding.ts` rebuilds the adjacency list on
 * every call — fine for single requests, but a bottleneck when the simulator
 * calls it thousands of times per run. This module builds the adjacency list
 * once and reuses it across all pathfinding calls.
 */

import { hopDuration } from "@/lib/engine/travel";
import type { ReachableSystem, PathResult } from "@/lib/engine/pathfinding";
import type { SimConnection } from "./types";

// ── Types ───────────────────────────────────────────────────────

export type SimAdjacencyList = Map<string, { toSystemId: string; fuelCost: number }[]>;

// ── Build ───────────────────────────────────────────────────────

/** Build an adjacency list from flat connection array. Call once per simulation. */
export function buildSimAdjacencyList(connections: SimConnection[]): SimAdjacencyList {
  const adj: SimAdjacencyList = new Map();
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

// ── Helpers ─────────────────────────────────────────────────────

function sumTravelDuration(
  path: string[],
  adj: SimAdjacencyList,
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

// ── Dijkstra — fuel-constrained reachability ────────────────────

/**
 * Find all systems reachable from `originId` within `currentFuel`,
 * using a pre-built adjacency list.
 * Optional shipSpeed adjusts travel duration calculations.
 */
export function findReachableSystemsCached(
  originId: string,
  currentFuel: number,
  adj: SimAdjacencyList,
  shipSpeed?: number,
): Map<string, ReachableSystem> {
  const result = new Map<string, ReachableSystem>();

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

    const path: string[] = [];
    let node: string | undefined = systemId;
    while (node !== undefined) {
      path.unshift(node);
      node = prev.get(node);
    }

    const travelDuration = sumTravelDuration(path, adj, shipSpeed);
    result.set(systemId, { systemId, fuelCost, travelDuration, path });
  }

  return result;
}

// ── Dijkstra — shortest path ────────────────────────────────────

/**
 * Find the lowest-fuel-cost path between two systems using a pre-built
 * adjacency list. Optional shipSpeed adjusts travel duration.
 */
export function findShortestPathCached(
  originId: string,
  destinationId: string,
  adj: SimAdjacencyList,
  shipSpeed?: number,
): PathResult | null {
  if (originId === destinationId) return null;

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
    if (current === destinationId) break;

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

  if (!dist.has(destinationId)) return null;

  const path: string[] = [];
  let node: string | undefined = destinationId;
  while (node !== undefined) {
    path.unshift(node);
    node = prev.get(node);
  }

  if (path[0] !== originId) return null;

  const totalFuelCost = dist.get(destinationId)!;
  const totalTravelDuration = sumTravelDuration(path, adj, shipSpeed);

  return { path, totalFuelCost, totalTravelDuration };
}
