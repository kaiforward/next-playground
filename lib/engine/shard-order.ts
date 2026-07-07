/**
 * Canonical shard orderings, shared by the tick processors' world adapters and
 * the cadence read services. Both cadences shard over an ordering derived from
 * the systems array, and the client-facing countdown must rank systems in
 * exactly the order the processor iterates — so both sides call these instead
 * of each re-deriving the order by hand.
 */

/** Economy shard order: system ids sorted by localeCompare. */
export function economyShardOrder(systems: ReadonlyArray<{ id: string }>): string[] {
  return systems.map((s) => s.id).sort((a, b) => a.localeCompare(b));
}

/**
 * Logistics/build shard keys: faction ids in first-seen order across the
 * systems array, null (independents) included where first encountered.
 */
export function factionShardKeys(
  systems: ReadonlyArray<{ factionId: string | null }>,
): Array<string | null> {
  const seen = new Set<string | null>();
  for (const s of systems) seen.add(s.factionId);
  return [...seen];
}
