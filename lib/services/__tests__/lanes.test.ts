import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getLaneStates } from "@/lib/services/lanes";
import { laneCapacity } from "@/lib/engine/lanes";
import type { World, WorldSystem, WorldLane, WorldLaneUpgradeProject, WorldPendingArrival } from "@/lib/world/types";

let world: World;
let a: WorldSystem;
let b: WorldSystem;
const LANE_KEY = "sys-a|sys-b";

beforeEach(() => {
  const generated = generateWorld({ systemCount: 20, seed: 3 });
  a = { ...generated.systems[0], id: "sys-a", factionId: "f1", control: "developed" };
  b = { ...generated.systems[1], id: "sys-b", factionId: "f1", control: "developed" };

  const lane: WorldLane = {
    key: LANE_KEY,
    aId: "sys-a",
    bId: "sys-b",
    level: 2,
    bookedLoad: 5,
    blockedVolume: 0,
    idleCycles: 0,
  };

  world = {
    ...generated,
    systems: [a, b, ...generated.systems.slice(2)],
    lanes: [lane],
    constructionProjects: [],
    pendingArrivals: [],
  };
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getLaneStates", () => {
  it("returns every lane's derived state, joining capacity, investor, in-flight and open upgrades", () => {
    setWorld({
      ...world,
      pendingArrivals: [
        {
          id: "arrival-1",
          factionId: "f1",
          fromSystemId: "sys-a",
          toSystemId: "sys-b",
          goodId: "water",
          quantity: 7,
          dispatchTick: 0,
          arrivalTick: 5,
          routeEdges: [LANE_KEY],
          leg: "outbound",
        } satisfies WorldPendingArrival,
      ],
      constructionProjects: [
        {
          id: "proj-1",
          kind: "lane_upgrade",
          factionId: "f1",
          origin: "player",
          workTotal: 40,
          workDone: 10,
          laneKey: LANE_KEY,
          levels: 2,
        } satisfies WorldLaneUpgradeProject,
      ],
    });

    const states = getLaneStates();
    expect(states).toHaveLength(1);
    const state = states[0];
    expect(state.key).toBe(LANE_KEY);
    expect(state.level).toBe(2);
    expect(state.capacity).toBe(laneCapacity(2));
    expect(state.bookedLoad).toBe(5);
    expect(state.blockedVolume).toBe(0);
    expect(state.inFlight).toBe(7);
    expect(state.investorFactionId).toBe("f1");
    expect(state.openUpgradeLevels).toBe(2);
  });

  it("reads investorFactionId null and openUpgradeLevels 0 when nothing qualifies", () => {
    // Neither endpoint is claimed, so laneInvestor has nobody to credit.
    setWorld({
      ...world,
      systems: world.systems.map((s) =>
        s.id === "sys-a" || s.id === "sys-b" ? { ...s, factionId: null, control: "unclaimed" } : s,
      ),
    });
    const states = getLaneStates();
    expect(states).toHaveLength(1);
    expect(states[0].investorFactionId).toBeNull();
    expect(states[0].openUpgradeLevels).toBe(0);
    expect(states[0].inFlight).toBe(0);
  });

  it("sums in-flight quantity across multiple ledger rows crossing the same lane", () => {
    setWorld({
      ...world,
      pendingArrivals: [
        {
          id: "arrival-1", factionId: "f1", fromSystemId: "sys-a", toSystemId: "sys-b",
          goodId: "water", quantity: 4, dispatchTick: 0, arrivalTick: 5, routeEdges: [LANE_KEY], leg: "outbound",
        },
        {
          id: "arrival-2", factionId: "f1", fromSystemId: "sys-b", toSystemId: "sys-a",
          goodId: "food", quantity: 3, dispatchTick: 0, arrivalTick: 5, routeEdges: [LANE_KEY], leg: "return",
        },
      ],
    });
    expect(getLaneStates()[0].inFlight).toBe(7);
  });

  it("returns an empty array for a world with no lanes", () => {
    setWorld({ ...world, lanes: [] });
    expect(getLaneStates()).toEqual([]);
  });
});
