import { shipArrivalsProcessor } from "./processors/ship-arrivals";
import { eventsProcessor } from "./processors/events";
import { economyProcessor } from "./processors/economy";
import { priceSnapshotsProcessor } from "./processors/price-snapshots";
import type { TickProcessor } from "./types";

/** All registered processors. */
export const processors: TickProcessor[] = [
  shipArrivalsProcessor,
  eventsProcessor,
  economyProcessor,
  priceSnapshotsProcessor,
];

/**
 * Returns the processors that should run on this tick, topologically sorted
 * by `dependsOn`. Filters by frequency + offset.
 */
export function sortProcessors(
  allProcessors: TickProcessor[],
  tick: number,
): TickProcessor[] {
  // Filter to processors active this tick
  const active = allProcessors.filter((p) => {
    const freq = p.frequency ?? 1;
    const offset = p.offset ?? 0;
    return (tick - offset) % freq === 0;
  });

  // Topological sort by dependsOn (Kahn's algorithm)
  const nameToProcessor = new Map(active.map((p) => [p.name, p]));
  const activeNames = new Set(nameToProcessor.keys());

  // Build in-degree map (only count dependencies that are active this tick)
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const p of active) {
    inDegree.set(p.name, 0);
  }
  for (const p of active) {
    for (const dep of p.dependsOn ?? []) {
      if (activeNames.has(dep)) {
        inDegree.set(p.name, (inDegree.get(p.name) ?? 0) + 1);
        const deps = dependents.get(dep) ?? [];
        deps.push(p.name);
        dependents.set(dep, deps);
      }
    }
  }

  // Process nodes with zero in-degree
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: TickProcessor[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(nameToProcessor.get(name)!);
    for (const dep of dependents.get(name) ?? []) {
      const newDegree = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) queue.push(dep);
    }
  }

  if (sorted.length < active.length) {
    const dropped = active
      .filter((p) => !sorted.includes(p))
      .map((p) => p.name);
    console.warn(
      `[TickEngine] WARN Dependency cycle detected — dropped processors: ${dropped.join(", ")}`,
    );
  }

  return sorted;
}
