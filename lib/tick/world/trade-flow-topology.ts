import type { EdgeView } from "./trade-flow-world";

/**
 * Build the open-edge list from raw system connections and a systemId → factionId
 * map. An edge is "open" iff both endpoints share a faction (with `null===null`
 * letting adjacent independent systems trade); cross-faction edges are dropped.
 *
 * Self-loops are skipped, reciprocal connections are deduped into a single
 * unordered edge (keyed by the sorted `${a}|${b}` pair, first occurrence wins),
 * and the result is sorted by that key so the work-budget cursor is
 * deterministic across processor runs.
 *
 * Pure and DB-free (type-only import of `EdgeView`) so both the live Prisma
 * adapter and the in-memory adapter share one implementation, and the
 * memory-adapter unit tests never transitively load `lib/prisma`.
 */
export function buildOpenEdges(
  connections: ReadonlyArray<{
    fromSystemId: string;
    toSystemId: string;
    fuelCost: number;
  }>,
  sysFaction: ReadonlyMap<string, string | null>,
): EdgeView[] {
  const seen = new Set<string>();
  const edges: EdgeView[] = [];
  for (const c of connections) {
    if (c.fromSystemId === c.toSystemId) continue;
    // null===null (both independent) is open; same non-null faction is open; else closed.
    if (sysFaction.get(c.fromSystemId) !== sysFaction.get(c.toSystemId)) continue;
    const [a, b] =
      c.fromSystemId < c.toSystemId
        ? [c.fromSystemId, c.toSystemId]
        : [c.toSystemId, c.fromSystemId];
    const key = `${a}|${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ aSystemId: a, bSystemId: b, fuelCost: c.fuelCost });
  }
  edges.sort((x, y) =>
    `${x.aSystemId}|${x.bSystemId}`.localeCompare(`${y.aSystemId}|${y.bSystemId}`),
  );
  return edges;
}
