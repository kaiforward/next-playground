import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getLaneStates, getLaneDetail } from "@/lib/services/lanes";
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

  it("reads a zero-latency row (arrivalTick === dispatchTick) as on no lane — already drained", () => {
    setWorld({
      ...world,
      meta: { ...world.meta, currentTick: 0 },
      pendingArrivals: [
        {
          id: "arrival-1", factionId: "f1", fromSystemId: "sys-a", toSystemId: "sys-b",
          goodId: "water", quantity: 7, dispatchTick: 0, arrivalTick: 0, routeEdges: [LANE_KEY], leg: "outbound",
        },
      ],
    });
    expect(getLaneStates()[0].inFlight).toBe(0);
  });

  it("counts a multi-hop haul on only the lane it is physically crossing right now", () => {
    const laneB: WorldLane = {
      key: "sys-b|sys-c", aId: "sys-b", bId: "sys-c", level: 1, bookedLoad: 0, blockedVolume: 0, idleCycles: 0,
    };
    const c = { ...world.systems[0], id: "sys-c", factionId: "f1", control: "developed" as const };
    // Two hops of fuel 10 each at the live LANES.FREIGHT_SPEED (0.5): hop0 (sys-a|sys-b) starts at
    // dispatch, hop1 (sys-b|sys-c) starts at round(10/0.5)=20.
    const row: WorldPendingArrival = {
      id: "arrival-1", factionId: "f1", fromSystemId: "sys-a", toSystemId: "sys-c",
      goodId: "water", quantity: 9, dispatchTick: 0, arrivalTick: 40,
      routeEdges: [LANE_KEY, "sys-b|sys-c"], leg: "outbound",
    };
    const baseWorld: World = {
      ...world,
      systems: [...world.systems, c],
      lanes: [...world.lanes, laneB],
      connections: [
        ...world.connections,
        { fromId: "sys-a", toId: "sys-b", fuelCost: 10 },
        { fromId: "sys-b", toId: "sys-a", fuelCost: 10 },
        { fromId: "sys-b", toId: "sys-c", fuelCost: 10 },
        { fromId: "sys-c", toId: "sys-b", fuelCost: 10 },
      ],
      pendingArrivals: [row],
    };

    setWorld({ ...baseWorld, meta: { ...world.meta, currentTick: 10 } });
    let states = getLaneStates();
    expect(states.find((s) => s.key === LANE_KEY)!.inFlight).toBe(9);
    expect(states.find((s) => s.key === "sys-b|sys-c")!.inFlight).toBe(0);

    setWorld({ ...baseWorld, meta: { ...world.meta, currentTick: 25 } });
    states = getLaneStates();
    expect(states.find((s) => s.key === LANE_KEY)!.inFlight).toBe(0);
    expect(states.find((s) => s.key === "sys-b|sys-c")!.inFlight).toBe(9);
  });
});

describe("getLaneDetail", () => {
  it("returns null for a key naming no lane in the current world", () => {
    expect(getLaneDetail("nope|nope")).toBeNull();
  });

  it("joins endpoint ownership, fuel cost, and the derived reads getLaneStates already computes", () => {
    setWorld({
      ...world,
      connections: [
        ...world.connections,
        { fromId: "sys-a", toId: "sys-b", fuelCost: 8.6 },
        { fromId: "sys-b", toId: "sys-a", fuelCost: 8.6 },
      ],
    });
    const detail = getLaneDetail(LANE_KEY);
    expect(detail).not.toBeNull();
    expect(detail!.fuelCost).toBe(8.6);
    expect(detail!.level).toBe(2);
    expect(detail!.capacity).toBe(laneCapacity(2));
    expect(detail!.investorFactionId).toBe("f1");
    expect(detail!.a).toEqual({
      systemId: "sys-a", systemName: a.name, factionId: "f1", unclaimed: false,
    });
    expect(detail!.b).toEqual({
      systemId: "sys-b", systemName: b.name, factionId: "f1", unclaimed: false,
    });
  });

  it("reads an unclaimed endpoint's ownership so the invest verb can name it", () => {
    setWorld({
      ...world,
      systems: world.systems.map((s) => (s.id === "sys-b" ? { ...s, factionId: null, control: "unclaimed" } : s)),
    });
    const detail = getLaneDetail(LANE_KEY)!;
    expect(detail.b.unclaimed).toBe(true);
    expect(detail.b.factionId).toBeNull();
    expect(detail.investorFactionId).toBeNull();
  });

  it("lists cargo in flight on this lane, one row per ledger entry, by the ledger's own route endpoints", () => {
    setWorld({
      ...world,
      pendingArrivals: [
        {
          id: "arrival-1", factionId: "f1", fromSystemId: "sys-a", toSystemId: "sys-b",
          goodId: "water", quantity: 18, dispatchTick: 0, arrivalTick: 12, routeEdges: [LANE_KEY], leg: "outbound",
        },
      ],
    });
    const detail = getLaneDetail(LANE_KEY)!;
    expect(detail.cargo).toHaveLength(1);
    expect(detail.cargo[0]).toEqual({
      goodId: "water", goodName: "Water", quantity: 18,
      fromSystemId: "sys-a", fromSystemName: a.name, toSystemId: "sys-b", toSystemName: b.name,
      arrivalTick: 12,
    });
    expect(detail.inFlight).toBe(18);
  });

  it("lists a multi-hop haul's cargo on a lane only while it is physically crossing that lane", () => {
    const laneB: WorldLane = {
      key: "sys-b|sys-c", aId: "sys-b", bId: "sys-c", level: 1, bookedLoad: 0, blockedVolume: 0, idleCycles: 0,
    };
    const c = { ...world.systems[0], id: "sys-c", factionId: "f1", control: "developed" as const };
    const row: WorldPendingArrival = {
      id: "arrival-1", factionId: "f1", fromSystemId: "sys-a", toSystemId: "sys-c",
      goodId: "water", quantity: 9, dispatchTick: 0, arrivalTick: 40,
      routeEdges: [LANE_KEY, "sys-b|sys-c"], leg: "outbound",
    };
    const baseWorld: World = {
      ...world,
      systems: [...world.systems, c],
      lanes: [...world.lanes, laneB],
      connections: [
        ...world.connections,
        { fromId: "sys-a", toId: "sys-b", fuelCost: 10 },
        { fromId: "sys-b", toId: "sys-a", fuelCost: 10 },
        { fromId: "sys-b", toId: "sys-c", fuelCost: 10 },
        { fromId: "sys-c", toId: "sys-b", fuelCost: 10 },
      ],
      pendingArrivals: [row],
    };

    setWorld({ ...baseWorld, meta: { ...world.meta, currentTick: 10 } });
    let detail = getLaneDetail(LANE_KEY)!;
    expect(detail.cargo).toHaveLength(1);
    expect(detail.inFlight).toBe(9);
    expect(getLaneDetail("sys-b|sys-c")!.cargo).toHaveLength(0);

    setWorld({ ...baseWorld, meta: { ...world.meta, currentTick: 25 } });
    detail = getLaneDetail(LANE_KEY)!;
    expect(detail.cargo).toHaveLength(0);
    expect(detail.inFlight).toBe(0);
    expect(getLaneDetail("sys-b|sys-c")!.cargo).toHaveLength(1);
  });

  it("enriches an open lane-upgrade project into the same row shape ConstructionRow renders", () => {
    // readoutForFaction requires a real faction row (unlike getLaneStates, which never resolves
    // one) — the fixture's "f1" investor id names no faction, so this test's project rides a
    // faction id that actually exists in the generated world.
    const factionId = world.factions[0].id;
    setWorld({
      ...world,
      systems: world.systems.map((s) => (s.id === "sys-a" || s.id === "sys-b" ? { ...s, factionId } : s)),
      constructionProjects: [
        { id: "proj-1", kind: "lane_upgrade", factionId, origin: "player", workTotal: 20, workDone: 5, laneKey: LANE_KEY, levels: 1 },
      ],
    });
    const detail = getLaneDetail(LANE_KEY)!;
    expect(detail.openProjects).toHaveLength(1);
    expect(detail.openProjects[0].id).toBe("proj-1");
    expect(detail.openProjects[0].laneKey).toBe(LANE_KEY);
  });
});
