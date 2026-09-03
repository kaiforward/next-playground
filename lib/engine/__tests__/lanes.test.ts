import { describe, it, expect } from "vitest";
import { laneKey, laneCapacity, laneInvestor, type LaneEndpointOwner } from "@/lib/engine/lanes";
import { LANES } from "@/lib/constants/lanes";
import { generateWorld } from "@/lib/world/gen";

describe("laneKey", () => {
  it("is order-independent — laneKey(a, b) === laneKey(b, a)", () => {
    expect(laneKey("system-1", "system-2")).toBe(laneKey("system-2", "system-1"));
  });

  it("is the sorted \"a|b\" pair", () => {
    expect(laneKey("system-2", "system-1")).toBe("system-1|system-2");
  });
});

describe("laneCapacity", () => {
  it("at level 0 is the baseline", () => {
    expect(laneCapacity(0)).toBe(LANES.BASE_LANE_CAPACITY);
  });

  it("strictly rises with level", () => {
    const c0 = laneCapacity(0);
    const c1 = laneCapacity(1);
    const c2 = laneCapacity(2);
    expect(c1).toBeGreaterThan(c0);
    expect(c2).toBeGreaterThan(c1);
  });
});

describe("laneInvestor", () => {
  const developed = (factionId: string | null): LaneEndpointOwner => ({ factionId, control: "developed" });
  const controlled = (factionId: string | null): LaneEndpointOwner => ({ factionId, control: "controlled" });
  const unclaimed: LaneEndpointOwner = { factionId: null, control: "unclaimed" };

  function ownerFrom(map: Record<string, LaneEndpointOwner>) {
    return (systemId: string): LaneEndpointOwner => map[systemId];
  }

  it("returns the shared faction when both endpoints are controlled or developed by it", () => {
    const owner = ownerFrom({ a: developed("faction-1"), b: controlled("faction-1") });
    expect(laneInvestor({ aId: "a", bId: "b" }, owner)).toBe("faction-1");
  });

  it("returns null when one endpoint is unclaimed", () => {
    const owner = ownerFrom({ a: developed("faction-1"), b: unclaimed });
    expect(laneInvestor({ aId: "a", bId: "b" }, owner)).toBeNull();
  });

  it("returns null when the endpoints belong to different factions", () => {
    const owner = ownerFrom({ a: developed("faction-1"), b: developed("faction-2") });
    expect(laneInvestor({ aId: "a", bId: "b" }, owner)).toBeNull();
  });

  it("\"controlled\" (the floor) still qualifies on both endpoints", () => {
    const owner = ownerFrom({ a: controlled("faction-1"), b: controlled("faction-1") });
    expect(laneInvestor({ aId: "a", bId: "b" }, owner)).toBe("faction-1");
  });

  it("returns null when an endpoint's rank is below controlled even with a faction assigned (the rank gate, not just the null-faction gate)", () => {
    // A faction-assigned-but-unclaimed endpoint isn't a shape the generator ever produces, but the
    // type permits it — this isolates the control-rank check from the factionId-null check right
    // above it, which a same-faction/same-null-checked fixture could not tell apart.
    const owner = ownerFrom({
      a: developed("faction-1"),
      b: { factionId: "faction-1", control: "unclaimed" },
    });
    expect(laneInvestor({ aId: "a", bId: "b" }, owner)).toBeNull();
  });
});

describe("generated lanes (lib/world/gen.ts)", () => {
  const world = generateWorld({ systemCount: 60, seed: 7 });

  it("carries at least one lane (non-vacuous)", () => {
    expect(world.lanes.length).toBeGreaterThan(0);
  });

  it("no two generated lanes share a key", () => {
    const keys = world.lanes.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every connection pair has exactly one lane row — both directions collapse to one", () => {
    const connectionKeys = new Set(world.connections.map((c) => laneKey(c.fromId, c.toId)));
    const laneKeys = new Set(world.lanes.map((l) => l.key));
    expect(laneKeys).toEqual(connectionKeys);
  });

  it("every generated lane starts untouched: level 0, no booked/blocked load, no idle history", () => {
    for (const lane of world.lanes) {
      expect(lane.level).toBe(0);
      expect(lane.bookedLoad).toBe(0);
      expect(lane.blockedVolume).toBe(0);
      expect(lane.idleCycles).toBe(0);
    }
  });

  it("stores aId/bId in key order — aId < bId, and key is exactly `${aId}|${bId}`", () => {
    for (const lane of world.lanes) {
      expect(lane.key).toBe(`${lane.aId}|${lane.bId}`);
      expect(lane.aId < lane.bId).toBe(true);
    }
  });
});
