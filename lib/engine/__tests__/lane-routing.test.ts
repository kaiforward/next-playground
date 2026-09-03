import { describe, it, expect } from "vitest";
import { buildLaneNetwork, createRouteBooker, type LaneNetwork } from "../lane-routing";
import { laneKey } from "../lanes";
import { dijkstra } from "../pathfinding";
import type { ConnectionInfo } from "../navigation";
import type { WorldLane } from "@/lib/world/types";

/**
 * Fixture graph: a cheap 2-hop path S → A → T (fuel 5 + 5 = 10) and a much pricier alternate
 * S → B → T (fuel 50 + 50 = 100) — priced high enough that congestion on the cheap path
 * (bounded by `congestionMax`, so at most 10 × 3 = 30) never makes the alternate the cheaper
 * choice on its own; only outright capacity exclusion pushes traffic onto it. That isolates
 * capacity-driven rerouting from price-driven rerouting, which the congestion tests need kept
 * apart. The cheap path's two edges share capacity 10; the alternate's edges carry capacity 100
 * so they never bind in these tests unless noted.
 */
function buildFixtureLane(a: string, b: string, level: number): WorldLane {
  return {
    key: laneKey(a, b),
    aId: a,
    bId: b,
    level,
    bookedLoad: 0,
    blockedVolume: 0,
    idleCycles: 0,
  };
}

const CONNECTIONS_RAW: [string, string, number][] = [
  ["S", "A", 5],
  ["A", "T", 5],
  ["S", "B", 50],
  ["B", "T", 50],
];

function buildConnections(): ConnectionInfo[] {
  return CONNECTIONS_RAW.flatMap(([from, to, cost]): ConnectionInfo[] => [
    { fromSystemId: from, toSystemId: to, fuelCost: cost },
    { fromSystemId: to, toSystemId: from, fuelCost: cost },
  ]);
}

const LANE_CAPACITY: Record<string, number> = {
  [laneKey("S", "A")]: 10,
  [laneKey("A", "T")]: 10,
  [laneKey("S", "B")]: 100,
  [laneKey("B", "T")]: 100,
};

function buildFixtureNetwork(): LaneNetwork {
  const lanes = [buildFixtureLane("S", "A", 0), buildFixtureLane("A", "T", 0), buildFixtureLane("S", "B", 0), buildFixtureLane("B", "T", 0)];
  return buildLaneNetwork(buildConnections(), lanes, (lane) => LANE_CAPACITY[lane.key]);
}

const CONGESTION_MAX = 3;
const OPEN_ALL = () => true;

describe("RouteBooker.routeAndBook — zero-capacity lane", () => {
  it("excludes a zero-capacity lane from live routing and, when it is the only route, blocks the full haul on it", () => {
    // A single edge S-A whose capacityOf returns 0 — no alternate route exists at all.
    const lanes = [buildFixtureLane("S", "A", 0)];
    const connections: ConnectionInfo[] = [
      { fromSystemId: "S", toSystemId: "A", fuelCost: 5 },
      { fromSystemId: "A", toSystemId: "S", fuelCost: 5 },
    ];
    const network = buildLaneNetwork(connections, lanes, () => 0);
    const booker = createRouteBooker(network, { openEdge: OPEN_ALL, congestionMax: CONGESTION_MAX, catchUp: 1 });

    const booking = booker.routeAndBook("S", "A", 5);
    expect(booking?.placements).toEqual([]);
    expect(booking?.blocked).toEqual([{ laneKey: laneKey("S", "A"), quantity: 5, foreignShare: 0 }]);
    expect(booker.loads().get(laneKey("S", "A"))).toEqual({ booked: 0, blocked: 5 });
  });
});

describe("buildLaneNetwork", () => {
  it("keeps every lane's raw capacity and reports all lane keys sorted", () => {
    const network = buildFixtureNetwork();
    expect(network.laneKeys).toEqual([...network.laneKeys].sort());
    expect(network.laneKeys.length).toBe(4);
    expect(network.capacities.get(laneKey("S", "A"))).toBe(10);
  });

  it("drops a connection with no matching lane row", () => {
    const lanes = [buildFixtureLane("S", "A", 0)];
    const network = buildLaneNetwork(buildConnections(), lanes, () => 10);
    expect(network.adjacency.get("S")?.some((e) => e.toSystemId === "B")).toBe(false);
  });
});

describe("RouteBooker.routeAndBook — capacity exclusion", () => {
  it("excludes an edge at capacity, returning the cheapest remaining path instead of pricing through it", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { openEdge: OPEN_ALL, congestionMax: CONGESTION_MAX, catchUp: 1 });

    // Saturate the cheap path exactly.
    const first = booker.routeAndBook("S", "T", 10);
    expect(first?.placements).toEqual([
      { quantity: 10, edges: [laneKey("S", "A"), laneKey("A", "T")], perUnit: 10, fuelTotal: 10 },
    ]);

    // The cheap path is now fully booked — the next haul must take the pricier alternate.
    const second = booker.routeAndBook("S", "T", 5);
    expect(second?.placements).toHaveLength(1);
    expect(second?.placements[0].edges).toEqual([laneKey("S", "B"), laneKey("B", "T")]);
    expect(second?.placements[0].quantity).toBe(5);
  });

  it("never prices an edge above congestionMax, even at load just under capacity", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { openEdge: OPEN_ALL, congestionMax: CONGESTION_MAX, catchUp: 1 });

    // Book 9 of the 10-capacity path, one unit short of saturation.
    booker.routeAndBook("S", "T", 9);
    // The last affordable unit: multiplier at load=9,capacity=10 is 1 + (3-1)*0.9 = 2.8 per edge.
    const last = booker.routeAndBook("S", "T", 1);
    expect(last?.placements).toHaveLength(1);
    const perUnit = last?.placements[0].perUnit ?? 0;
    // fuelTotal 10 at multiplier 2.8 = 28 (5*2.8 + 5*2.8).
    expect(perUnit).toBeCloseTo(28, 5);
    expect(perUnit).toBeLessThan(10 * CONGESTION_MAX);
  });
});

describe("RouteBooker.routeAndBook — partial fill, reroute, blocked volume", () => {
  it("ships what fits on the cheapest path and reroutes the rest, recording blocked volume once on the choke edge", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { openEdge: OPEN_ALL, congestionMax: CONGESTION_MAX, catchUp: 1 });

    const booking = booker.routeAndBook("S", "T", 15);
    expect(booking?.placements).toHaveLength(2);
    expect(booking?.placements[0]).toMatchObject({ quantity: 10, edges: [laneKey("S", "A"), laneKey("A", "T")] });
    expect(booking?.placements[1]).toMatchObject({ quantity: 5, edges: [laneKey("S", "B"), laneKey("B", "T")] });

    // Blocked once, on the first edge of the cheap path.
    expect(booking?.blocked).toEqual([{ laneKey: laneKey("S", "A"), quantity: 5, foreignShare: 0 }]);

    const loads = booker.loads();
    expect(loads.get(laneKey("S", "A"))).toEqual({ booked: 10, blocked: 5 });
    expect(loads.get(laneKey("A", "T"))).toEqual({ booked: 10, blocked: 0 });
    expect(loads.get(laneKey("S", "B"))).toEqual({ booked: 5, blocked: 0 });
  });
});

describe("RouteBooker.routeAndBook — closed edges", () => {
  it("never traverses a closed edge, even when it is the only cheap route", () => {
    const network = buildFixtureNetwork();
    const openEdge = (key: string) => key !== laneKey("S", "A");
    const booker = createRouteBooker(network, { openEdge, congestionMax: CONGESTION_MAX, catchUp: 1 });

    const booking = booker.routeAndBook("S", "T", 5);
    expect(booking?.placements).toHaveLength(1);
    expect(booking?.placements[0].edges).toEqual([laneKey("S", "B"), laneKey("B", "T")]);
  });

  it("reports nothing blocked, and nothing placed, when the destination is unreachable over open edges", () => {
    const network = buildFixtureNetwork();
    const openEdge = (key: string) => key !== laneKey("S", "A") && key !== laneKey("S", "B");
    const booker = createRouteBooker(network, { openEdge, congestionMax: CONGESTION_MAX, catchUp: 1 });

    const booking = booker.routeAndBook("S", "T", 5);
    expect(booking?.placements).toEqual([]);
    expect(booking?.blocked).toEqual([]);
  });
});

describe("RouteBooker.routeAndBook — shared ledger across factions", () => {
  it("lets two factions see and contend for each other's booked load on the same edge", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { openEdge: OPEN_ALL, congestionMax: CONGESTION_MAX, catchUp: 1 });

    booker.routeAndBook("S", "T", 6, "factionA");
    const second = booker.routeAndBook("S", "T", 6, "factionB");

    // Only 4 units of room remained on the cheap path; factionB is pushed onto the alternate for the rest.
    expect(second?.placements[0]).toMatchObject({ quantity: 4, edges: [laneKey("S", "A"), laneKey("A", "T")] });
    expect(second?.placements[1]).toMatchObject({ quantity: 2, edges: [laneKey("S", "B"), laneKey("B", "T")] });

    // The choke edge's booked load (10) is 6 factionA + 4 factionB — 60% foreign to factionB.
    expect(second?.blocked).toEqual([{ laneKey: laneKey("S", "A"), quantity: 2, foreignShare: 0.6 }]);

    expect(booker.loads().get(laneKey("S", "A"))).toEqual({ booked: 10, blocked: 2 });
  });
});

describe("RouteBooker.priceFrom", () => {
  it("prices every reachable donor from a sink over the current graph, undirected", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { openEdge: OPEN_ALL, congestionMax: CONGESTION_MAX, catchUp: 1 });

    const priceFromT = booker.priceFrom("T");
    expect(priceFromT("S")).toBe(10); // cheap path, uncongested: 5 + 5
    expect(priceFromT("nowhere")).toBeNull();
  });

  it("freezes prices for the caller's fan-out — a later routeAndBook does not retroactively change them", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { openEdge: OPEN_ALL, congestionMax: CONGESTION_MAX, catchUp: 1 });

    const priceFromT = booker.priceFrom("T");
    const before = priceFromT("S");
    booker.routeAndBook("S", "T", 10); // saturates the cheap path
    expect(priceFromT("S")).toBe(before); // the returned lookup is a frozen snapshot
  });
});

describe("RouteBooker.routeAndBook — degenerate input", () => {
  it("returns null for same origin and destination, and for a non-positive quantity", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { openEdge: OPEN_ALL, congestionMax: CONGESTION_MAX, catchUp: 1 });
    expect(booker.routeAndBook("S", "S", 5)).toBeNull();
    expect(booker.routeAndBook("S", "T", 0)).toBeNull();
  });
});

// ── Dijkstra edge-cost hook — vacuity check on the pathfinding.ts refactor ──────────────────

describe("dijkstra edgeCost hook", () => {
  it("closes an edge for the search when the hook returns null", () => {
    const network = buildFixtureNetwork();
    const closeSA = (from: string, to: string, fuelCost: number): number | null =>
      laneKey(from, to) === laneKey("S", "A") ? null : fuelCost;
    const { dist } = dijkstra("S", network.adjacency, { stopAt: "T", edgeCost: closeSA });
    expect(dist.get("T")).toBe(100); // forced onto the alternate S-B-T path
  });
});
