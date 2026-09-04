import { describe, it, expect } from "vitest";
import {
  laneKey,
  laneCapacity,
  laneInvestor,
  laneUpkeepWork,
  decayLanes,
  type LaneEndpointOwner,
} from "@/lib/engine/lanes";
import { LANES } from "@/lib/constants/lanes";
import { generateWorld } from "@/lib/world/gen";
import type { WorldLane } from "@/lib/world/types";

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

function makeLane(overrides: Partial<WorldLane> = {}): WorldLane {
  return {
    key: "a|b",
    aId: "a",
    bId: "b",
    level: 1,
    bookedLoad: 0,
    blockedVolume: 0,
    idleCycles: 0,
    ...overrides,
  };
}

describe("laneUpkeepWork", () => {
  const developed = (factionId: string | null): LaneEndpointOwner => ({ factionId, control: "developed" });
  const unclaimed: LaneEndpointOwner = { factionId: null, control: "unclaimed" };

  it("sums level × UPGRADE_WORK_PER_LEVEL over every lane a faction invests in", () => {
    const owner = (systemId: string) => (systemId === "c" ? developed("faction-2") : developed("faction-1"));
    const lanes = [
      makeLane({ key: "a|b", aId: "a", bId: "b", level: 2 }),
      makeLane({ key: "b|c", aId: "b", bId: "c", level: 3 }),
    ];
    const work = laneUpkeepWork(lanes, owner);
    expect(work.get("faction-1")).toBe(2 * LANES.UPGRADE_WORK_PER_LEVEL);
    expect(work.get("faction-2")).toBeUndefined();
  });

  it("bills nobody for a lane with an unclaimed endpoint", () => {
    const owner = (systemId: string) => (systemId === "a" ? developed("faction-1") : unclaimed);
    const work = laneUpkeepWork([makeLane({ level: 4 })], owner);
    expect(work.size).toBe(0);
  });

  it("skips a level-0 lane even when both endpoints qualify a faction as investor", () => {
    const owner = () => developed("faction-1");
    const work = laneUpkeepWork([makeLane({ level: 0 })], owner);
    expect(work.size).toBe(0);
  });
});

describe("decayLanes", () => {
  const B = LANES.BASE_LANE_CAPACITY;

  it("accrues when a whole level's capacity sits unused", () => {
    // level 1 capacity is 2B; attempted = B leaves exactly B (one whole level) unused.
    const lane = makeLane({ level: 1, bookedLoad: B, idleCycles: 0 });
    const result = decayLanes([lane], 1, { idleBufferCycles: 5 });
    expect(result.lanes[0].idleCycles).toBe(1);
    expect(result.lanes[0].level).toBe(1);
  });

  it("does not accrue one unit less than a whole level unused", () => {
    const lane = makeLane({ level: 1, bookedLoad: B + 1, idleCycles: 0 });
    const result = decayLanes([lane], 1, { idleBufferCycles: 5 });
    expect(result.lanes[0].idleCycles).toBe(0);
  });

  it("counts a congested run (blocked volume) as use even with zero booked load", () => {
    const capacity = laneCapacity(1);
    const lane = makeLane({ level: 1, bookedLoad: 0, blockedVolume: capacity, idleCycles: 3 });
    const result = decayLanes([lane], 1, { idleBufferCycles: 5 });
    expect(result.lanes[0].idleCycles).toBe(0);
  });

  it("resets the counter on a run that uses the level, rather than pausing it", () => {
    const lane = makeLane({ level: 1, bookedLoad: laneCapacity(1), idleCycles: 4 });
    const result = decayLanes([lane], 1, { idleBufferCycles: 5 });
    expect(result.lanes[0].idleCycles).toBe(0);
  });

  it("sheds one level at the idle buffer and never below 0", () => {
    const lane = makeLane({ level: 1, bookedLoad: 0, idleCycles: 4 });
    const result = decayLanes([lane], 1, { idleBufferCycles: 5 });
    expect(result.lanes[0].level).toBe(0);
    expect(result.lanes[0].idleCycles).toBe(0);
    expect(result.shed).toEqual([lane.key]);

    // Already at level 0: fully idle forever, never shreds below 0 or accrues further.
    const floor = decayLanes(result.lanes, 1, { idleBufferCycles: 5 });
    expect(floor.lanes[0].level).toBe(0);
    expect(floor.lanes[0].idleCycles).toBe(0);

    // A fractional level below 1 (a lane mid-way through its first upgrade) sheds to exactly 0,
    // never negative — the `level - 1` step alone would go below 0 here, unlike from level 1.
    const fractional = makeLane({ level: 0.5, bookedLoad: 0, idleCycles: 4 });
    const shedFractional = decayLanes([fractional], 1, { idleBufferCycles: 5 });
    expect(shedFractional.lanes[0].level).toBe(0);
  });

  it("scales both the capacity compare and the marginal-level threshold by catchUp", () => {
    // level 1 capacity is 2B; at catchUp 0.5 the scaled capacity is B and the scaled marginal level
    // is 0.5B. attempted = 0.75B leaves 0.25B (scaled) unused — under the scaled marginal level, so
    // it must NOT accrue. Comparing against the unscaled capacity (2B) and marginal (B) instead would
    // read 1.25B unused against a 1B threshold and wrongly accrue — this pins the scale, not just
    // that scaling happens at all.
    const lane = makeLane({ level: 1, bookedLoad: B * 0.75, idleCycles: 0 });
    const result = decayLanes([lane], 0.5, { idleBufferCycles: 5 });
    expect(result.lanes[0].idleCycles).toBe(0);
  });

  it("never accrues or decays a level-0 lane", () => {
    const lane = makeLane({ level: 0, bookedLoad: 0, idleCycles: 0 });
    const result = decayLanes([lane], 1, { idleBufferCycles: 1 });
    expect(result.lanes[0]).toEqual(lane);
    expect(result.shed).toEqual([]);
  });
});
