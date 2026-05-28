/**
 * Pure helpers for placing in-transit ship markers on the map. Zero DB / Pixi
 * dependency, testable with Vitest. The path is reconstructed client-side
 * because only origin → final destination + ticks are persisted on the ship.
 */
import type { ConnectionInfo } from "./navigation";
import { findShortestPath } from "./pathfinding";
import { hopDuration } from "./travel";

export interface Vec2 {
  x: number;
  y: number;
}

export interface TransitPathNode {
  systemId: string;
  cumulativeDuration: number; // ticks from origin to this node
}

export interface TransitPath {
  nodes: TransitPathNode[];
  totalDuration: number; // ticks, always >= 1
  straightLine: boolean; // true when we fell back to a direct origin→dest line
}

export interface TransitPlacement {
  x: number;
  y: number;
  angleRad: number; // heading of the active segment (toward destination)
  segmentIndex: number;
}

export interface ClusterInput<T> {
  id: string;
  x: number;
  y: number;
  item: T;
}

export interface Cluster<T> {
  x: number;
  y: number;
  items: T[];
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Reconstruct the hop path + per-node cumulative duration for an in-transit unit. */
export function reconstructTransitPath(
  originId: string,
  destinationId: string,
  connections: ConnectionInfo[],
  speed: number,
): TransitPath {
  const result = findShortestPath(originId, destinationId, connections, speed);
  if (!result || result.path.length < 2) {
    return {
      nodes: [
        { systemId: originId, cumulativeDuration: 0 },
        { systemId: destinationId, cumulativeDuration: 1 },
      ],
      totalDuration: 1,
      straightLine: true,
    };
  }

  const fuelByPair = new Map<string, number>();
  for (const c of connections) {
    fuelByPair.set(`${c.fromSystemId}|${c.toSystemId}`, c.fuelCost);
    fuelByPair.set(`${c.toSystemId}|${c.fromSystemId}`, c.fuelCost);
  }

  const nodes: TransitPathNode[] = [{ systemId: result.path[0], cumulativeDuration: 0 }];
  let cum = 0;
  for (let i = 0; i < result.path.length - 1; i++) {
    const fuel = fuelByPair.get(`${result.path[i]}|${result.path[i + 1]}`) ?? 0;
    cum += hopDuration(fuel, speed);
    nodes.push({ systemId: result.path[i + 1], cumulativeDuration: cum });
  }

  return { nodes, totalDuration: Math.max(1, cum), straightLine: false };
}

/** Interpolate a marker's world position + heading along a path at `progress` ∈ [0,1]. */
export function interpolateTransit(
  path: TransitPath,
  positions: Map<string, Vec2>,
  progress: number,
): TransitPlacement | null {
  const target = clamp01(progress) * path.totalDuration;

  for (let i = 0; i < path.nodes.length - 1; i++) {
    const a = path.nodes[i];
    const b = path.nodes[i + 1];
    if (target <= b.cumulativeDuration || i === path.nodes.length - 2) {
      const from = positions.get(a.systemId);
      const to = positions.get(b.systemId);
      if (!from || !to) return null;
      const span = b.cumulativeDuration - a.cumulativeDuration;
      const segT = span <= 0 ? 0 : clamp01((target - a.cumulativeDuration) / span);
      return {
        x: from.x + (to.x - from.x) * segT,
        y: from.y + (to.y - from.y) * segT,
        angleRad: Math.atan2(to.y - from.y, to.x - from.x),
        segmentIndex: i,
      };
    }
  }
  return null;
}

/** Greedy, order-stable screen-space clustering of markers within `thresholdPx`. */
export function clusterMarkers<T>(
  inputs: ClusterInput<T>[],
  thresholdPx: number,
): Cluster<T>[] {
  const clusters: Cluster<T>[] = [];
  const t2 = thresholdPx * thresholdPx;
  for (const input of inputs) {
    let placed = false;
    for (const c of clusters) {
      const dx = c.x - input.x;
      const dy = c.y - input.y;
      if (dx * dx + dy * dy <= t2) {
        c.items.push(input.item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ x: input.x, y: input.y, items: [input.item] });
  }
  return clusters;
}
