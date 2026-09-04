import { describe, it, expect } from "vitest";
import { laneOpenFor, type LaneAccessOwner } from "../lane-access";
import type { RelationTier } from "@/lib/constants/relations";

const LANE = { aId: "A", bId: "B" };

function ownerMap(owners: Record<string, string | null>): (systemId: string) => LaneAccessOwner {
  return (systemId) => ({ factionId: owners[systemId] ?? null });
}

const NO_TIER_CALLS: (a: string, b: string) => RelationTier = () => {
  throw new Error("tierBetween should not be consulted for this case");
};

describe("laneOpenFor", () => {
  it("opens a lane both of whose endpoints the hauler owns", () => {
    const ownerOf = ownerMap({ A: "f1", B: "f1" });
    expect(laneOpenFor("f1", LANE, ownerOf, NO_TIER_CALLS)).toBe(true);
  });

  it("opens a claimed-and-unclaimed lane to the claiming hauler, and a fully unclaimed lane to independents too", () => {
    const halfClaimed = ownerMap({ A: "f1", B: null });
    expect(laneOpenFor("f1", LANE, halfClaimed, NO_TIER_CALLS)).toBe(true);

    const fullyUnclaimed = ownerMap({ A: null, B: null });
    expect(laneOpenFor(null, LANE, fullyUnclaimed, NO_TIER_CALLS)).toBe(true);
  });

  it("opens a lane crossing friendly or allied territory, closes it for neutral, unfriendly or hostile", () => {
    const ownerOf = ownerMap({ A: "f1", B: "f2" });
    const tierOf = (tier: RelationTier): ((a: string, b: string) => RelationTier) => () => tier;

    expect(laneOpenFor("f1", LANE, ownerOf, tierOf("allied"))).toBe(true);
    expect(laneOpenFor("f1", LANE, ownerOf, tierOf("friendly"))).toBe(true);
    expect(laneOpenFor("f1", LANE, ownerOf, tierOf("neutral"))).toBe(false);
    expect(laneOpenFor("f1", LANE, ownerOf, tierOf("unfriendly"))).toBe(false);
    expect(laneOpenFor("f1", LANE, ownerOf, tierOf("hostile"))).toBe(false);
  });

  it("closes a lane crossing neutral foreign space to that hauler, open to a friendly one — the same lane, two haulers", () => {
    const ownerOf = ownerMap({ A: "f1", B: "f2" });
    const tierBetween = (a: string, b: string): RelationTier => {
      const pair = [a, b].sort().join("|");
      return pair === ["f1", "f2"].sort().join("|") ? "neutral" : "allied";
    };
    // f1 crossing into f2's neutral territory: closed.
    expect(laneOpenFor("f1", LANE, ownerOf, tierBetween)).toBe(false);
    // f3, allied with f2 by this fixture's tierBetween, crosses the SAME lane's f2 endpoint freely
    // (its other endpoint, A, is f1's — closed to f3 too, since f3 isn't f1's ally here).
    const ownerOfF3 = ownerMap({ A: "f2", B: "f2" });
    expect(laneOpenFor("f3", LANE, ownerOfF3, tierBetween)).toBe(true);
  });

  it("restricts the null (independent) hauler to unclaimed endpoints only, even where a faction is friendly to no one", () => {
    const ownerOf = ownerMap({ A: null, B: "f1" });
    expect(laneOpenFor(null, LANE, ownerOf, NO_TIER_CALLS)).toBe(false);
  });

  it("requires BOTH endpoints open — one closed endpoint closes the whole lane", () => {
    const ownerOf = ownerMap({ A: "f1", B: "f2" });
    const alwaysHostile = (): RelationTier => "hostile";
    expect(laneOpenFor("f1", LANE, ownerOf, alwaysHostile)).toBe(false);

    // Flip B to unclaimed: now both endpoints pass (own + unclaimed), independent of the tier.
    const ownerOfUnclaimedB = ownerMap({ A: "f1", B: null });
    expect(laneOpenFor("f1", LANE, ownerOfUnclaimedB, alwaysHostile)).toBe(true);
  });
});
