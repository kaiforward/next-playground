/**
 * Pure lane engine — the shared substrate routing and investment mechanics build on
 * (docs/planned/logistics-lanes.md §1). Zero I/O, no world reads: callers pass in exactly the rows
 * this module needs.
 */

import type { SystemControl, WorldLane } from "@/lib/world/types";
import { LANES } from "@/lib/constants/lanes";

/**
 * Canonical undirected pair key — the sorted `"a|b"` pair, identical in shape to `buildOpenEdges`'s
 * own dedup key (`lib/tick/world/trade-flow-topology.ts`) so a lane and its open-edge view always
 * agree on identity. Order-independent: `laneKey(a, b) === laneKey(b, a)`.
 */
export function laneKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Capacity at `level` — linear first cut, verbatim from the spec (§1): baseline at level 0, rising
 * by one baseline unit of capacity per level.
 */
export function laneCapacity(level: number): number {
  return LANES.BASE_LANE_CAPACITY * (1 + level);
}

/** The endpoint-ownership shape `laneInvestor` needs — deliberately narrower than `WorldSystem` so
 *  callers don't have to construct one just to check investability. */
export interface LaneEndpointOwner {
  factionId: string | null;
  control: SystemControl;
}

/** Ordinal rank over `SystemControl` so "at least controlled" is a numeric comparison rather than a
 *  repeated `=== "controlled" || === "developed"`. */
const CONTROL_RANK: Record<SystemControl, number> = {
  unclaimed: 0,
  controlled: 1,
  developed: 2,
};

/**
 * The faction that may invest in `lane` — the faction controlling BOTH endpoint systems, each at
 * `control` rank at least `controlled` (spec §1: "a faction may invest in a lane exactly when it
 * controls both endpoint systems … control ≥ controlled"). Null when either endpoint is unclaimed,
 * the endpoints belong to different factions, or either endpoint's control is below `controlled` —
 * a lane with an unclaimed endpoint is deliberately pinned at baseline capacity (§1).
 */
export function laneInvestor(
  lane: Pick<WorldLane, "aId" | "bId">,
  ownerOf: (systemId: string) => LaneEndpointOwner,
): string | null {
  const a = ownerOf(lane.aId);
  const b = ownerOf(lane.bId);
  if (a.factionId === null || b.factionId === null) return null;
  if (a.factionId !== b.factionId) return null;
  if (CONTROL_RANK[a.control] < CONTROL_RANK.controlled) return null;
  if (CONTROL_RANK[b.control] < CONTROL_RANK.controlled) return null;
  return a.factionId;
}
