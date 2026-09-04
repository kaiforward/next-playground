/**
 * Lane traversability — the per-hauler predicate a `RouteBooker` view (`lane-routing.ts`
 * `forHauler`) closes over as its `openEdge`. Pure, zero I/O: callers pass in exactly the
 * ownership/relation lookups this needs (docs/active/gameplay/logistics-lanes.md §2, "goods route over
 * own+unclaimed+friendly-or-allied").
 */
import type { RelationTier } from "@/lib/constants/relations";

/** The ownership shape `laneOpenFor` needs from each endpoint system. */
export interface LaneAccessOwner {
  factionId: string | null;
}

/**
 * Is `lane` open to `haulerId`? Both endpoints must independently pass: each is either owned by
 * the hauler, unclaimed (`factionId === null`, always open to everyone), or owned by a faction the
 * hauler holds at `"friendly"` or `"allied"` — otherwise that endpoint, and so the lane, is closed.
 *
 * The `null` hauler (independents) has no faction to be "own" or "friendly" toward, so only the
 * unclaimed branch ever opens for it — traversing unclaimed space alone, which for the null group
 * is also every system it "owns" (independents' own systems ARE the unclaimed ones).
 */
export function laneOpenFor(
  haulerId: string | null,
  lane: { aId: string; bId: string },
  ownerOf: (systemId: string) => LaneAccessOwner,
  tierBetween: (a: string, b: string) => RelationTier,
): boolean {
  const endpointOpen = (systemId: string): boolean => {
    const owner = ownerOf(systemId).factionId;
    if (owner === null) return true;
    if (haulerId === null) return false;
    if (owner === haulerId) return true;
    const tier = tierBetween(haulerId, owner);
    return tier === "friendly" || tier === "allied";
  };
  return endpointOpen(lane.aId) && endpointOpen(lane.bId);
}
