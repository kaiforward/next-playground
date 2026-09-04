import { describe, it, expect } from "vitest";
import { buildLaneNetwork, createRouteBooker, type LaneNetwork } from "../lane-routing";
import { laneKey } from "../lanes";
import { dijkstra } from "../pathfinding";
import type { ConnectionInfo } from "../navigation";
import type { WorldLane, WorldPendingArrival } from "@/lib/world/types";

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

/** Every direct test goes through `forHauler` — `RouteBooker`'s own public surface is just
 *  `loads()` + `forHauler()` (no traversal-open top-level view, see `RouteBooker`'s own
 *  docstring), so `openEdge` must be chosen at every call site rather than left to a default. */
function hauler(booker: ReturnType<typeof createRouteBooker>, openEdge: (key: string) => boolean = OPEN_ALL, factionKey: string | null = null) {
  return booker.forHauler(openEdge, factionKey);
}

describe("RouteBooker.routeAndBook — zero-capacity lane", () => {
  it("excludes a zero-capacity lane from live routing and, when it is the only route, blocks the full haul on it", () => {
    // A single edge S-A whose capacityOf returns 0 — no alternate route exists at all.
    const lanes = [buildFixtureLane("S", "A", 0)];
    const connections: ConnectionInfo[] = [
      { fromSystemId: "S", toSystemId: "A", fuelCost: 5 },
      { fromSystemId: "A", toSystemId: "S", fuelCost: 5 },
    ];
    const network = buildLaneNetwork(connections, lanes, () => 0);
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker);

    const booking = h.routeAndBook("S", "A", 5);
    expect(booking?.placements).toEqual([]);
    expect(booking?.blocked).toEqual([{ laneKey: laneKey("S", "A"), quantity: 5, foreignShare: 0 }]);
    expect(booker.loads().get(laneKey("S", "A"))).toEqual({ bookedLoad: 0, blockedVolume: 5 });
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
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker);

    // Saturate the cheap path exactly.
    const first = h.routeAndBook("S", "T", 10);
    expect(first?.placements).toEqual([
      { quantity: 10, edges: [laneKey("S", "A"), laneKey("A", "T")], perUnit: 10, fuelTotal: 10 },
    ]);

    // The cheap path is now fully booked — the next haul must take the pricier alternate.
    const second = h.routeAndBook("S", "T", 5);
    expect(second?.placements).toHaveLength(1);
    expect(second?.placements[0].edges).toEqual([laneKey("S", "B"), laneKey("B", "T")]);
    expect(second?.placements[0].quantity).toBe(5);
  });

  it("never prices an edge above congestionMax, even at load just under capacity", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker);

    // Book 9 of the 10-capacity path, one unit short of saturation.
    h.routeAndBook("S", "T", 9);
    // The last affordable unit: multiplier at load=9,capacity=10 is 1 + (3-1)*0.9 = 2.8 per edge.
    const last = h.routeAndBook("S", "T", 1);
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
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker);

    const booking = h.routeAndBook("S", "T", 15);
    expect(booking?.placements).toHaveLength(2);
    expect(booking?.placements[0]).toMatchObject({ quantity: 10, edges: [laneKey("S", "A"), laneKey("A", "T")] });
    expect(booking?.placements[1]).toMatchObject({ quantity: 5, edges: [laneKey("S", "B"), laneKey("B", "T")] });

    // Blocked once, on the first edge of the cheap path.
    expect(booking?.blocked).toEqual([{ laneKey: laneKey("S", "A"), quantity: 5, foreignShare: 0 }]);

    const loads = booker.loads();
    expect(loads.get(laneKey("S", "A"))).toEqual({ bookedLoad: 10, blockedVolume: 5 });
    expect(loads.get(laneKey("A", "T"))).toEqual({ bookedLoad: 10, blockedVolume: 0 });
    expect(loads.get(laneKey("S", "B"))).toEqual({ bookedLoad: 5, blockedVolume: 0 });
  });
});

describe("RouteBooker.routeAndBook — closed edges", () => {
  it("never traverses a closed edge, even when it is the only cheap route", () => {
    const network = buildFixtureNetwork();
    const openEdge = (key: string) => key !== laneKey("S", "A");
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker, openEdge);

    const booking = h.routeAndBook("S", "T", 5);
    expect(booking?.placements).toHaveLength(1);
    expect(booking?.placements[0].edges).toEqual([laneKey("S", "B"), laneKey("B", "T")]);
  });

  it("reports nothing blocked, and nothing placed, when the destination is unreachable over open edges", () => {
    const network = buildFixtureNetwork();
    const openEdge = (key: string) => key !== laneKey("S", "A") && key !== laneKey("S", "B");
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker, openEdge);

    const booking = h.routeAndBook("S", "T", 5);
    expect(booking?.placements).toEqual([]);
    expect(booking?.blocked).toEqual([]);
  });
});

describe("RouteBooker.routeAndBook — shared ledger across factions", () => {
  it("lets two factions see and contend for each other's booked load on the same edge", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });

    hauler(booker, OPEN_ALL, "factionA").routeAndBook("S", "T", 6);
    const second = hauler(booker, OPEN_ALL, "factionB").routeAndBook("S", "T", 6);

    // Only 4 units of room remained on the cheap path; factionB is pushed onto the alternate for the rest.
    expect(second?.placements[0]).toMatchObject({ quantity: 4, edges: [laneKey("S", "A"), laneKey("A", "T")] });
    expect(second?.placements[1]).toMatchObject({ quantity: 2, edges: [laneKey("S", "B"), laneKey("B", "T")] });

    // The choke edge's booked load (10) is 6 factionA + 4 factionB — 60% foreign to factionB.
    expect(second?.blocked).toEqual([{ laneKey: laneKey("S", "A"), quantity: 2, foreignShare: 0.6 }]);

    expect(booker.loads().get(laneKey("S", "A"))).toEqual({ bookedLoad: 10, blockedVolume: 2 });
  });
});

describe("RouteBooker.priceFrom", () => {
  it("prices every reachable donor from a sink over the current graph, undirected", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker);

    const priceFromT = h.priceFrom("T");
    expect(priceFromT("S")).toBe(10); // cheap path, uncongested: 5 + 5
    expect(priceFromT("nowhere")).toBeNull();
  });

  it("freezes prices for the caller's fan-out — a later routeAndBook does not retroactively change them", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker);

    const priceFromT = h.priceFrom("T");
    const before = priceFromT("S");
    h.routeAndBook("S", "T", 10); // saturates the cheap path
    expect(priceFromT("S")).toBe(before); // the returned lookup is a frozen snapshot
  });
});

describe("RouteBooker.reachableFrom — reachability ignores saturation, not traversability", () => {
  it("stays true for a donor whose only path is saturated, unlike priceFrom", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker);

    // Saturate BOTH paths so priceFrom genuinely returns null for S.
    h.routeAndBook("S", "T", 10); // fills the cheap path
    h.routeAndBook("S", "T", 100); // fills the alternate too

    expect(h.priceFrom("T")("S")).toBeNull(); // no live-priced path remains
    expect(h.reachableFrom("T")("S")).toBe(true); // a path still structurally exists
  });

  it("is false for a donor no open edge reaches at all", () => {
    const network = buildFixtureNetwork();
    const openEdge = (key: string) => key !== laneKey("S", "A") && key !== laneKey("S", "B");
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker, openEdge);

    expect(h.reachableFrom("T")("S")).toBe(false);
    expect(h.reachableFrom("T")("nowhere")).toBe(false);
  });
});

describe("RouteBooker.routeAndBook — degenerate input", () => {
  it("returns null for same origin and destination, and for a non-positive quantity", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });
    const h = hauler(booker);
    expect(h.routeAndBook("S", "S", 5)).toBeNull();
    expect(h.routeAndBook("S", "T", 0)).toBeNull();
  });
});

describe("RouteBooker.forHauler — shared ledger, per-hauler openEdge", () => {
  it("two haulers with different openEdge share one load ledger", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, { congestionMax: CONGESTION_MAX, catchUp: 1 });

    // Hauler A may use every edge; hauler B is closed off the cheap path entirely, so it must
    // route the whole alternate corridor.
    const haulerA = booker.forHauler(OPEN_ALL, "factionA");
    const closeCheapPath = (key: string) => key !== laneKey("S", "A") && key !== laneKey("A", "T");
    const haulerB = booker.forHauler(closeCheapPath, "factionB");

    const bookingA = haulerA.routeAndBook("S", "T", 4);
    expect(bookingA?.placements[0].edges).toEqual([laneKey("S", "A"), laneKey("A", "T")]);

    const bookingB = haulerB.routeAndBook("S", "T", 3);
    expect(bookingB?.placements[0].edges).toEqual([laneKey("S", "B"), laneKey("B", "T")]);

    // One shared ledger: hauler A's booking is visible to hauler B's price/priority view on the
    // edge they both could have used, and `loads()` reports the sum across both haulers.
    const loads = booker.loads();
    expect(loads.get(laneKey("S", "A"))?.bookedLoad).toBe(4);
    expect(loads.get(laneKey("S", "B"))?.bookedLoad).toBe(3);

    // Hauler B's own priceFrom never offers the cheap path at all — it stays closed to B
    // regardless of what A booked on it.
    const priceFromT_B = haulerB.priceFrom("T");
    // forced onto the alternate: 100 fuel × congestion multiplier at load 3/capacity 100
    // (1 + (3-1) × 0.03 = 1.06)
    expect(priceFromT_B("S")).toBeCloseTo(106, 6);
  });
});

// ── Windowed booking (docs/active/gameplay/logistics-lanes.md §2: "a lane is booked for the cycle
// the cargo crosses it, not the cycle it is dispatched") ─────────────────────────────────────────

function pendingArrival(over: Partial<WorldPendingArrival> & { routeEdges: string[] }): WorldPendingArrival {
  return {
    id: "seed",
    factionId: null,
    fromSystemId: "donor",
    toSystemId: "sink",
    goodId: "water",
    quantity: 0,
    dispatchTick: 0,
    arrivalTick: 0,
    leg: "outbound",
    ...over,
  };
}

describe("RouteBooker — windowed booking", () => {
  it("(a) a 3-lane route whose later crossings start in later windows books only lane 1 in window 0", () => {
    // Linear chain S-A-B-T, fuel 10 per hop, freightSpeed 1, windowTicks 10, now 0:
    // hop0 (S-A) starts at offset 0 -> window 0; hop1 (A-B) at offset 10 -> window 1;
    // hop2 (B-T) at offset 20 -> window 2. Capacities are ample so nothing saturates.
    const lanes = [
      buildFixtureLane("S", "A", 0),
      buildFixtureLane("A", "B", 0),
      buildFixtureLane("B", "T", 0),
    ];
    const connections: ConnectionInfo[] = [
      { fromSystemId: "S", toSystemId: "A", fuelCost: 10 },
      { fromSystemId: "A", toSystemId: "S", fuelCost: 10 },
      { fromSystemId: "A", toSystemId: "B", fuelCost: 10 },
      { fromSystemId: "B", toSystemId: "A", fuelCost: 10 },
      { fromSystemId: "B", toSystemId: "T", fuelCost: 10 },
      { fromSystemId: "T", toSystemId: "B", fuelCost: 10 },
    ];
    const network = buildLaneNetwork(connections, lanes, () => 1000);
    const booker = createRouteBooker(network, {
      congestionMax: CONGESTION_MAX,
      catchUp: 1,
      windowTicks: 10,
      now: 0,
      freightSpeed: 1,
    });
    const h = hauler(booker);

    const booking = h.routeAndBook("S", "T", 50);
    expect(booking?.placements).toEqual([
      { quantity: 50, edges: [laneKey("S", "A"), laneKey("A", "B"), laneKey("B", "T")], perUnit: 30, fuelTotal: 30 },
    ]);

    const loads = booker.loads();
    expect(loads.get(laneKey("S", "A"))).toEqual({ bookedLoad: 50, blockedVolume: 0 });
    expect(loads.get(laneKey("A", "B"))).toEqual({ bookedLoad: 0, blockedVolume: 0 });
    expect(loads.get(laneKey("B", "T"))).toEqual({ bookedLoad: 0, blockedVolume: 0 });

    expect(booker.loadAt(laneKey("S", "A"), 0)).toBe(50);
    expect(booker.loadAt(laneKey("A", "B"), 1)).toBe(50);
    expect(booker.loadAt(laneKey("B", "T"), 2)).toBe(50);
  });

  it("(b) seeding: an in-flight ledger row filling a lane's window 0 excludes a new booking there and blocks it", () => {
    const lanes = [buildFixtureLane("S", "T", 0)];
    const connections: ConnectionInfo[] = [
      { fromSystemId: "S", toSystemId: "T", fuelCost: 5 },
      { fromSystemId: "T", toSystemId: "S", fuelCost: 5 },
    ];
    const network = buildLaneNetwork(connections, lanes, () => 10);
    const seedRow = pendingArrival({
      id: "in-flight",
      factionId: "seed-faction",
      routeEdges: [laneKey("S", "T")],
      quantity: 10,
      dispatchTick: 100,
    });
    const booker = createRouteBooker(network, {
      congestionMax: CONGESTION_MAX,
      catchUp: 1,
      windowTicks: 10,
      now: 100,
      freightSpeed: 1,
      scheduled: [seedRow],
    });

    // Seeding alone fills window 0 to capacity.
    expect(booker.loadAt(laneKey("S", "T"), 0)).toBe(10);

    const h = hauler(booker, OPEN_ALL, "hauler-faction");
    const booking = h.routeAndBook("S", "T", 5);
    expect(booking?.placements).toEqual([]);
    expect(booking?.blocked).toEqual([{ laneKey: laneKey("S", "T"), quantity: 5, foreignShare: 1 }]);

    // The seeded row itself is a plain data fixture — the booker never mutates it.
    expect(seedRow.quantity).toBe(10);
  });

  it("(c) earlier outranks later: a seeded row filling a lane's future window blocks a haul reaching it in that window, not one reaching it a window earlier", () => {
    // D1 is a short hop from M (offset 15 -> window 1); D2 is a longer hop from M (offset 25 ->
    // window 2). The shared lane M-T (capacity 10) is seeded full in window 2 only.
    const lanes = [
      buildFixtureLane("D1", "M", 0),
      buildFixtureLane("D2", "M", 0),
      buildFixtureLane("M", "T", 0),
    ];
    const connections: ConnectionInfo[] = [
      { fromSystemId: "D1", toSystemId: "M", fuelCost: 15 },
      { fromSystemId: "M", toSystemId: "D1", fuelCost: 15 },
      { fromSystemId: "D2", toSystemId: "M", fuelCost: 25 },
      { fromSystemId: "M", toSystemId: "D2", fuelCost: 25 },
      { fromSystemId: "M", toSystemId: "T", fuelCost: 5 },
      { fromSystemId: "T", toSystemId: "M", fuelCost: 5 },
    ];
    const network = buildLaneNetwork(connections, lanes, (lane) => (lane.key === laneKey("M", "T") ? 10 : 100_000));
    const seedRow = pendingArrival({
      routeEdges: [laneKey("D2", "M"), laneKey("M", "T")],
      quantity: 10,
      dispatchTick: 0,
    });
    const booker = createRouteBooker(network, {
      congestionMax: CONGESTION_MAX,
      catchUp: 1,
      windowTicks: 10,
      now: 0,
      freightSpeed: 1,
      scheduled: [seedRow],
    });
    expect(booker.loadAt(laneKey("M", "T"), 2)).toBe(10);
    expect(booker.loadAt(laneKey("M", "T"), 1)).toBe(0);

    const h = hauler(booker);

    // D2's route reaches the shared lane in window 2 — already saturated by the seed.
    const bookingD2 = h.routeAndBook("D2", "T", 5);
    expect(bookingD2?.placements).toEqual([]);
    expect(bookingD2?.blocked).toEqual([{ laneKey: laneKey("M", "T"), quantity: 5, foreignShare: 0 }]);

    // D1's route reaches the SAME lane in window 1 — untouched, so it places.
    const bookingD1 = h.routeAndBook("D1", "T", 5);
    expect(bookingD1?.placements).toHaveLength(1);
    expect(bookingD1?.placements[0].quantity).toBe(5);
    expect(booker.loadAt(laneKey("M", "T"), 1)).toBe(5);
  });

  it("(d) a crossing straddling a window boundary is charged to the window it STARTS in only", () => {
    // Single edge S-T, fuel 15, freightSpeed 1, windowTicks 10: the crossing starts at offset 0
    // (window 0) and would "end" at offset 15 (window 1's territory) — it is charged once, to
    // window 0, never split or double-counted into window 1.
    const lanes = [buildFixtureLane("S", "T", 0)];
    const connections: ConnectionInfo[] = [
      { fromSystemId: "S", toSystemId: "T", fuelCost: 15 },
      { fromSystemId: "T", toSystemId: "S", fuelCost: 15 },
    ];
    const network = buildLaneNetwork(connections, lanes, () => 1000);
    const booker = createRouteBooker(network, {
      congestionMax: CONGESTION_MAX,
      catchUp: 1,
      windowTicks: 10,
      now: 0,
      freightSpeed: 1,
    });
    const h = hauler(booker);
    h.routeAndBook("S", "T", 5);

    expect(booker.loadAt(laneKey("S", "T"), 0)).toBe(5);
    expect(booker.loadAt(laneKey("S", "T"), 1)).toBe(0);
  });

  it("(e) zero-latency equivalence: a very large freightSpeed reproduces the single-ledger booker's loads exactly", () => {
    const network = buildFixtureNetwork();
    const booker = createRouteBooker(network, {
      congestionMax: CONGESTION_MAX,
      catchUp: 1,
      windowTicks: 24,
      now: 100,
      freightSpeed: 1_000_000,
    });
    const h = hauler(booker);

    // Same scenario as the "partial fill, reroute, blocked volume" test above: 15 units over a
    // cheap path capacity 10 and a pricey alternate capacity 100.
    const booking = h.routeAndBook("S", "T", 15);
    expect(booking?.placements).toHaveLength(2);
    expect(booking?.placements[0]).toMatchObject({ quantity: 10, edges: [laneKey("S", "A"), laneKey("A", "T")] });
    expect(booking?.placements[1]).toMatchObject({ quantity: 5, edges: [laneKey("S", "B"), laneKey("B", "T")] });
    expect(booking?.blocked).toEqual([{ laneKey: laneKey("S", "A"), quantity: 5, foreignShare: 0 }]);

    // Hand-computed expected loads — identical to the pre-windowing booker's own reading of the
    // same scenario, since every crossing collapses into window 0 at this speed.
    const loads = booker.loads();
    expect(loads.get(laneKey("S", "A"))).toEqual({ bookedLoad: 10, blockedVolume: 5 });
    expect(loads.get(laneKey("A", "T"))).toEqual({ bookedLoad: 10, blockedVolume: 0 });
    expect(loads.get(laneKey("S", "B"))).toEqual({ bookedLoad: 5, blockedVolume: 0 });
    expect(loads.get(laneKey("B", "T"))).toEqual({ bookedLoad: 5, blockedVolume: 0 });
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
