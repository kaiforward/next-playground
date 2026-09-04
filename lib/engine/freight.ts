/**
 * Pure freight-scheduling engine — the arrival-time formula and read-only ledger queries the
 * goods-arrivals stage and its future clients (the interdiction query, war's severed-lane verb)
 * share (docs/active/gameplay/logistics-lanes.md §3). Zero I/O: callers pass in exactly the rows this
 * module needs.
 */

import type { WorldPendingArrival } from "@/lib/world/types";

/**
 * Dispatch-time arrival tick for a haul: `now + max(0, round(fuelTotal / freightSpeed))` — the
 * whole-path formula (§3), not a sum of per-hop `hopDuration` calls (`lib/engine/travel.ts`),
 * because that primitive floors every hop at one tick at any speed. This formula has no per-hop
 * floor: a large enough `freightSpeed` collapses every arrival to `now`, the zero-latency fallback.
 */
export function freightArrivalTick(now: number, fuelTotal: number, freightSpeed: number): number {
  return now + Math.max(0, Math.round(fuelTotal / freightSpeed));
}

/**
 * Outbound-leg scheduled inbound, keyed `"toSystemId|goodId"` — the inbound-aware classification
 * term §3 adds at the matcher's feed site ("the sink test reads stock + scheduled inbound for that
 * good"). Return legs are deliberately excluded: they are goods heading back to a donor, not
 * inbound supply a destination should stop ordering against.
 */
export function scheduledInbound(
  ledger: readonly WorldPendingArrival[],
): ReadonlyMap<string, number> {
  const inbound = new Map<string, number>();
  for (const row of ledger) {
    if (row.leg !== "outbound") continue;
    const key = `${row.toSystemId}|${row.goodId}`;
    inbound.set(key, (inbound.get(key) ?? 0) + row.quantity);
  }
  return inbound;
}

/**
 * The interdiction query (war's future verb, §3): every ledger row whose transit window
 * `[dispatchTick, arrivalTick]` overlaps `[fromTick, toTick]` AND whose `routeEdges` holds
 * `laneKey`. Read-only — new, emitted by the lane substrate; consumed by nothing this pass.
 */
export function flowsCrossingEdge(
  ledger: readonly WorldPendingArrival[],
  laneKey: string,
  fromTick: number,
  toTick: number,
): WorldPendingArrival[] {
  return ledger.filter(
    (row) =>
      row.routeEdges.includes(laneKey) &&
      row.dispatchTick <= toTick &&
      row.arrivalTick >= fromTick,
  );
}
