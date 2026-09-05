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
 * The tick each hop of a route STARTS crossing, given the whole path's fuel costs in hop order:
 * hop 0 starts at `dispatchTick` itself, hop i at `dispatchTick + round(Σ fuel of hops before it /
 * freightSpeed)` — the same rounding family as `freightArrivalTick`, applied to the cumulative fuel
 * consumed BEFORE each hop rather than the path total. A crossing that straddles a window boundary
 * belongs to the window it starts in (`docs/active/gameplay/logistics-lanes.md` §2), which is why
 * this returns the start tick of every hop rather than just the arrival tick of the last one.
 */
export function hopCrossingTicks(
  dispatchTick: number,
  hopFuelCosts: readonly number[],
  freightSpeed: number,
): number[] {
  const ticks: number[] = [];
  let cumFuelBefore = 0;
  for (const fuelCost of hopFuelCosts) {
    ticks.push(dispatchTick + Math.max(0, Math.round(cumFuelBefore / freightSpeed)));
    cumFuelBefore += fuelCost;
  }
  return ticks;
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
 * The hop index a ledger row is PHYSICALLY crossing at `tick`, or `null` if it isn't crossing any
 * hop of its route right now — the read-time counterpart to `hopCrossingTicks`: hop i occupies the
 * half-open window `[start_i, start_{i+1})`, with the last hop's window ending at `arrivalTick`
 * (docs/active/gameplay/logistics-lanes.md §7). A row at `tick === arrivalTick` has been drained by the
 * goods-arrivals stage and occupies nothing, and a row not yet dispatched (`tick < dispatchTick`,
 * never produced by a real caller reading the live ledger) likewise occupies nothing.
 *
 * `hopFuelCosts` — one entry per `routeEdges` hop, in order — is never read off the row itself
 * (fuel costs aren't persisted on `WorldPendingArrival`); the caller recomputes it from the lane
 * network's static per-lane fuel costs, exactly as the booker does at `lane-routing.ts`'s own
 * booking-seed loop. Build that lookup once per call site, not once per row.
 */
export function currentHopIndex(
  row: Pick<WorldPendingArrival, "dispatchTick" | "arrivalTick" | "routeEdges">,
  tick: number,
  hopFuelCosts: readonly number[],
  freightSpeed: number,
): number | null {
  if (tick < row.dispatchTick || tick >= row.arrivalTick) return null;
  const crossingTicks = hopCrossingTicks(row.dispatchTick, hopFuelCosts, freightSpeed);
  let hop: number | null = null;
  for (let i = 0; i < crossingTicks.length; i++) {
    if (crossingTicks[i] <= tick) hop = i;
    else break;
  }
  return hop;
}

/**
 * Whether a ledger row is physically crossing `laneKey` at `tick` right now — `currentHopIndex`
 * narrowed to a single lane, the read every per-lane "in flight"/"cargo on this lane" surface
 * (the lane card, the map's flow particles) performs. See `currentHopIndex` for the half-open
 * window and the `hopFuelCosts` build-once contract.
 */
export function laneOccupiedAt(
  row: Pick<WorldPendingArrival, "dispatchTick" | "arrivalTick" | "routeEdges">,
  laneKey: string,
  tick: number,
  hopFuelCosts: readonly number[],
  freightSpeed: number,
): boolean {
  const hop = currentHopIndex(row, tick, hopFuelCosts, freightSpeed);
  return hop !== null && row.routeEdges[hop] === laneKey;
}

/**
 * The interdiction query (war's future verb, §3): every ledger row whose transit window
 * `[dispatchTick, arrivalTick]` overlaps `[fromTick, toTick]` AND whose `routeEdges` holds
 * `laneKey` — deliberately ROUTE-WIDE, unlike `laneOccupiedAt`/`currentHopIndex` above: war wants
 * every haul that WILL cross the edge over the window, not only the ones physically on it at one
 * instant. Read-only — new, emitted by the lane substrate; consumed by nothing this pass.
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
