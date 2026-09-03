import { describe, it, expect } from "vitest";
import {
  summariseGeography, computeGeographyProjection, sameFactionEdgeFuelCosts,
  crossFactionLaneCount, beyondCrossingCohort, summariseRelationsScores, countBorderConflicts,
  GEOGRAPHY_MIN_TRAFFICKED_EDGES, singleOwnershipSnapshot,
} from "../geography-analysis";
import type { GeographySystemInput, GeographyFactionInput } from "../geography-analysis";
import type { WorldFlowEvent } from "@/lib/world/types";
import type { ConnectionInfo } from "@/lib/engine/navigation";

const sys = (
  id: string,
  factionId: string | null,
  regionId: string,
  populationTrend?: number,
): GeographySystemInput => ({
  id, factionId, control: factionId === null ? "unclaimed" : "developed", regionId, populationTrend,
});

const conn = (fromSystemId: string, toSystemId: string, fuelCost: number): ConnectionInfo => ({
  fromSystemId, toSystemId, fuelCost,
});

// Connections are stored one row per declared direction — mirror that so fixtures match
// production shape (buildFuelAdjacency is directional; buildHopAdjacency, which the reachability
// test now runs over, folds both directions in regardless).
const biConn = (a: string, b: string, fuelCost: number): ConnectionInfo[] => [
  conn(a, b, fuelCost), conn(b, a, fuelCost),
];

const flow = (
  fromSystemId: string, toSystemId: string, quantity: number, tick = 1, goodId = "water",
): WorldFlowEvent => ({ tick, fromSystemId, toSystemId, goodId, quantity });

const faction = (id: string, homeworldId: string): GeographyFactionInput => ({ id, homeworldId });

const factionById = (systems: GeographySystemInput[]): Map<string, string | null> =>
  new Map(systems.map((s) => [s.id, s.factionId]));

/** One ownership window covering the whole run — the fixtures below that never change hands. */
const ownershipOf = (systems: GeographySystemInput[]) => singleOwnershipSnapshot(factionById(systems));

describe("computeGeographyProjection", () => {
  it("reports a flow-less world as zeroes, never NaN", () => {
    const projection = computeGeographyProjection([], [], singleOwnershipSnapshot(new Map()));
    expect(projection.aggregateEdgeVolume.size).toBe(0);
    expect(projection.totalPlacedVolume).toBe(0);
    expect(projection.totalHaulPathProduct).toBe(0);
    expect(projection.placedHaulVolume).toBe(0);
    expect(projection.unreachableHaulCount).toBe(0);
    expect(projection.unreachableHaulVolume).toBe(0);
    expect(projection.foreignTransitHaulCount).toBe(0);
    expect(projection.foreignTransitHaulVolume).toBe(0);
  });

  it("conserves exactly: Σ placed edge volume = Σ haul quantity × path length", () => {
    // h1 -c1 (1 hop); h1 -u1 -c2 (2 hops, crossing unclaimed space) — both same hauling faction.
    const systems = [sys("h1", "f1", "r1"), sys("c1", "f1", "r1"), sys("u1", null, "r2"), sys("c2", "f1", "r2")];
    const connections = [
      ...biConn("h1", "c1", 8),
      ...biConn("h1", "u1", 10),
      ...biConn("u1", "c2", 12),
    ];
    const flows = [flow("h1", "c1", 10), flow("h1", "c2", 5)];

    const projection = computeGeographyProjection(flows, connections, ownershipOf(systems));

    // Independently computed sides: one accumulated during placement, the other by re-summing
    // the map placement wrote — a mis-keyed edge would make these disagree.
    expect(projection.totalHaulPathProduct).toBe(10 * 1 + 5 * 2);
    expect(projection.totalPlacedVolume).toBe(projection.totalHaulPathProduct);
    expect(projection.placedHaulVolume).toBe(15);
    expect(projection.unreachableHaulCount).toBe(0);
    // The h1->c2 path transits u1, which is unclaimed (null), not foreign — no foreign transit.
    expect(projection.foreignTransitHaulCount).toBe(0);
  });

  it("counts a haul with no reachable path at all as unreachable, placing nothing", () => {
    // c2 sits in a disconnected component — no connections in this world at all.
    const systems = [sys("h1", "f1", "r1"), sys("c2", "f1", "r2")];
    const connections: ConnectionInfo[] = [];
    const flows = [flow("h1", "c2", 7)];

    const projection = computeGeographyProjection(flows, connections, ownershipOf(systems));

    expect(projection.unreachableHaulCount).toBe(1);
    expect(projection.unreachableHaulVolume).toBe(7);
    expect(projection.totalPlacedVolume).toBe(0);
    expect(projection.totalHaulPathProduct).toBe(0);
  });

  it("routes a haul from an unowned (independent) donor — the shipped router hauls for independents too", () => {
    // world/tick.ts groups directed-logistics rows by faction key including null and matches that
    // group with funded=1 — an independent donor is not special-cased out of routing.
    const systems = [sys("u1", null, "r1"), sys("c1", "f1", "r1")];
    const connections = biConn("u1", "c1", 5);
    const flows = [flow("u1", "c1", 4)];

    const projection = computeGeographyProjection(flows, connections, ownershipOf(systems));

    expect(projection.unreachableHaulCount).toBe(0);
    expect(projection.totalPlacedVolume).toBe(4);
    expect(projection.aggregateEdgeVolume.get("c1|u1")).toBe(4);
    // No faction to attribute an independent haul's lane volume to.
    expect(projection.perFactionEdgeVolume.size).toBe(0);
  });

  it("marks a haul unreachable when hop-minimal distance exceeds MAX_HOPS, even though a path exists", () => {
    // Five-edge chain, no shortcut — hop-minimal distance is 5, over DIRECTED_LOGISTICS.MAX_HOPS (4).
    const systems = [
      sys("h1", "f1", "r1"), sys("a", null, "r1"), sys("b", null, "r1"), sys("c", null, "r1"),
      sys("d", null, "r1"), sys("h2", "f1", "r1"),
    ];
    const connections = [
      ...biConn("h1", "a", 1), ...biConn("a", "b", 1), ...biConn("b", "c", 1),
      ...biConn("c", "d", 1), ...biConn("d", "h2", 1),
    ];
    const flows = [flow("h1", "h2", 3)];

    const projection = computeGeographyProjection(flows, connections, ownershipOf(systems));

    expect(projection.unreachableHaulCount).toBe(1);
    expect(projection.unreachableHaulVolume).toBe(3);
    expect(projection.totalPlacedVolume).toBe(0);
  });

  it("gates reachability on hop-minimal distance, not the fuel-weighted model path's own edge count", () => {
    // Route A (direct, high fuel): h1-a-b-c-h2, 4 hops — at exactly MAX_HOPS.
    // Route B (roundabout, cheap fuel): h1-x1..x5-h2, 6 hops — over MAX_HOPS.
    // Dijkstra (fuel-weighted) prefers route B (total fuel 6) over route A (total fuel 40), so the
    // MODELLED placement path is 6 edges long — but the router itself only cares about hop-minimal
    // distance (4, via route A), which is within the cap. If reachability were judged off the
    // modelled path's own edge count instead, this haul would be wrongly marked unreachable.
    const systems = [
      sys("h1", "f1", "r1"), sys("a", null, "r1"), sys("b", null, "r1"), sys("c", null, "r1"),
      sys("x1", null, "r1"), sys("x2", null, "r1"), sys("x3", null, "r1"), sys("x4", null, "r1"),
      sys("x5", null, "r1"), sys("h2", "f1", "r1"),
    ];
    const connections = [
      ...biConn("h1", "a", 10), ...biConn("a", "b", 10), ...biConn("b", "c", 10), ...biConn("c", "h2", 10),
      ...biConn("h1", "x1", 1), ...biConn("x1", "x2", 1), ...biConn("x2", "x3", 1),
      ...biConn("x3", "x4", 1), ...biConn("x4", "x5", 1), ...biConn("x5", "h2", 1),
    ];
    const flows = [flow("h1", "h2", 5)];

    const projection = computeGeographyProjection(flows, connections, ownershipOf(systems));

    expect(projection.unreachableHaulCount).toBe(0);
    // Placed onto the cheaper 6-edge route, proving the model path (6 edges, over MAX_HOPS) was NOT
    // what gated reachability.
    expect(projection.totalHaulPathProduct).toBe(5 * 6);
  });

  it("counts a placed haul whose modelled path transits a foreign-held system", () => {
    // h1 (f1) can only reach h2 (f1) via m, held by a different faction f2.
    const systems = [sys("h1", "f1", "r1"), sys("m", "f2", "r1"), sys("h2", "f1", "r1")];
    const connections = [...biConn("h1", "m", 5), ...biConn("m", "h2", 5)];
    const flows = [flow("h1", "h2", 6)];

    const projection = computeGeographyProjection(flows, connections, ownershipOf(systems));

    expect(projection.unreachableHaulCount).toBe(0);
    expect(projection.foreignTransitHaulCount).toBe(1);
    expect(projection.foreignTransitHaulVolume).toBe(6);
  });

  // Ownership at HAUL time, not at run end: a transit system settled after the goods moved was
  // not foreign space when they moved through it, and a donor whose faction later abandoned it
  // still hauled for that faction at the time.
  it("classifies each haul against the ownership window covering its own tick", () => {
    const unclaimedMid = [sys("h1", "f1", "r1"), sys("m", null, "r1"), sys("h2", "f1", "r1")];
    const foreignMid = [sys("h1", "f1", "r1"), sys("m", "f2", "r1"), sys("h2", "f1", "r1")];
    const connections = [...biConn("h1", "m", 5), ...biConn("m", "h2", 5)];
    const snapshots = [
      { fromTick: 0, systemFactionById: factionById(unclaimedMid) },
      { fromTick: 100, systemFactionById: factionById(foreignMid) },
    ];
    // One haul before m was settled, one after.
    const flows = [flow("h1", "h2", 6, 50), flow("h1", "h2", 4, 150)];

    const projection = computeGeographyProjection(flows, connections, snapshots);

    expect(projection.foreignTransitHaulCount).toBe(1);
    expect(projection.foreignTransitHaulVolume).toBe(4);

    // Read against the END-OF-RUN map alone, both hauls would count — the anachronism this fixes.
    const endOfRunOnly = computeGeographyProjection(flows, connections, ownershipOf(foreignMid));
    expect(endOfRunOnly.foreignTransitHaulCount).toBe(2);
    expect(endOfRunOnly.foreignTransitHaulVolume).toBe(10);
  });

  it("attributes a haul to the faction that held the donor at haul time, not to whoever holds it at run end", () => {
    const held = [sys("h1", "f1", "r1"), sys("c1", "f1", "r1")];
    const abandoned = [sys("h1", null, "r1"), sys("c1", "f1", "r1")];
    const connections = biConn("h1", "c1", 5);
    const snapshots = [
      { fromTick: 0, systemFactionById: factionById(held) },
      { fromTick: 100, systemFactionById: factionById(abandoned) },
    ];
    const flows = [flow("h1", "c1", 9, 50)];

    const projection = computeGeographyProjection(flows, connections, snapshots);

    expect(projection.perFactionEdgeVolume.get("f1")?.get("c1|h1")).toBe(9);
    // The end-of-run reading loses the haul entirely — an unclaimed donor has no faction bucket.
    expect(
      computeGeographyProjection(flows, connections, ownershipOf(abandoned)).perFactionEdgeVolume.size,
    ).toBe(0);
  });

  it("does not count an all-own-space path as a foreign transit", () => {
    const systems = [sys("h1", "f1", "r1"), sys("m", "f1", "r1"), sys("h2", "f1", "r1")];
    const connections = [...biConn("h1", "m", 5), ...biConn("m", "h2", 5)];
    const flows = [flow("h1", "h2", 4)];

    const projection = computeGeographyProjection(flows, connections, ownershipOf(systems));

    expect(projection.foreignTransitHaulCount).toBe(0);
    expect(projection.foreignTransitHaulVolume).toBe(0);
  });
});

describe("sameFactionEdgeFuelCosts / trafficked subset", () => {
  it("the trafficked-flow cohort is a strict subset of the all-edges same-faction cohort", () => {
    const systems = [sys("h1", "f1", "r1"), sys("c1", "f1", "r1"), sys("c2", "f1", "r1")];
    // Two same-faction edges; only one ever carries a haul.
    const connections = [...biConn("h1", "c1", 6), ...biConn("h1", "c2", 9)];
    const flows = [flow("h1", "c1", 3)];

    const fuelById = factionById(systems);
    const allEdges = sameFactionEdgeFuelCosts(connections, fuelById);
    const projection = computeGeographyProjection(flows, connections, singleOwnershipSnapshot(fuelById));
    const traffickedKeys = [...allEdges.keys()].filter((k) => (projection.aggregateEdgeVolume.get(k) ?? 0) > 0);

    expect(allEdges.size).toBe(2);
    expect(traffickedKeys.length).toBe(1);
    expect(traffickedKeys.length).toBeLessThan(allEdges.size);
    // Every trafficked key is drawn from the all-edges cohort (subset, not a disjoint set).
    for (const key of traffickedKeys) expect(allEdges.has(key)).toBe(true);
  });

  it("excludes cross-faction and unclaimed-endpoint edges from the same-faction cohort", () => {
    const systems = [sys("h1", "f1", "r1"), sys("h2", "f2", "r2"), sys("u1", null, "r1")];
    const connections = [...biConn("h1", "h2", 6), ...biConn("h1", "u1", 4)];

    const edges = sameFactionEdgeFuelCosts(connections, factionById(systems));

    expect(edges.size).toBe(0);
  });
});

describe("summariseGeography", () => {
  it("reports a wholly empty world as zeroes, never NaN", () => {
    const summary = summariseGeography([], [], [], []);

    expect(summary.topDecileShare).toBe(0);
    expect(summary.topDecileShareByFaction).toEqual([]);
    expect(summary.fuelP90P10All).toBe(0);
    expect(summary.fuelP90P10Trafficked).toBe(0);
    expect(summary.crossFactionLaneCount).toBe(0);
    expect(summary.beyondCrossingCohort).toEqual([
      { cohort: "interior", n: 0, meanMigrantInflow: 0, meanPopulationTrend: 0 },
      { cohort: "beyond-crossing", n: 0, meanMigrantInflow: 0, meanPopulationTrend: 0 },
    ]);
    expect(summary.unreachableHaulCount).toBe(0);
    expect(summary.unreachableHaulVolume).toBe(0);
    expect(summary.unreachableHaulVolumeShare).toBe(0);
    expect(summary.foreignTransitHaulCount).toBe(0);
    expect(summary.foreignTransitHaulVolume).toBe(0);
    expect(summary.foreignTransitHaulVolumeShare).toBe(0);
  });

  it("pins the unreachable-haul pass-through against the projection it is read from", () => {
    // h2 sits five hops out — over MAX_HOPS — alongside one reachable haul so the share is a real
    // fraction, not a vacuous 1 or 0.
    const systems = [
      sys("h1", "f1", "r1"), sys("c1", "f1", "r1"), sys("a", null, "r2"), sys("b", null, "r2"),
      sys("c", null, "r2"), sys("d", null, "r2"), sys("h2", "f1", "r2"),
    ];
    const connections = [
      ...biConn("h1", "c1", 5),
      ...biConn("h1", "a", 1), ...biConn("a", "b", 1), ...biConn("b", "c", 1),
      ...biConn("c", "d", 1), ...biConn("d", "h2", 1),
    ];
    const flows = [flow("h1", "c1", 6), flow("h1", "h2", 4)];

    const projection = computeGeographyProjection(flows, connections, ownershipOf(systems));
    const summary = summariseGeography(systems, connections, [], flows);

    expect(projection.unreachableHaulCount).toBe(1);
    expect(projection.unreachableHaulVolume).toBe(4);
    expect(summary.unreachableHaulCount).toBe(projection.unreachableHaulCount);
    expect(summary.unreachableHaulVolume).toBe(projection.unreachableHaulVolume);
    expect(summary.unreachableHaulVolumeShare).toBeCloseTo(4 / 10, 9);
  });

  it("pins the foreign-transit pass-through against the projection it is read from, weighted by volume", () => {
    // One haul transits foreign space (f2's "m"), one stays entirely in f1's own space.
    const systems = [
      sys("h1", "f1", "r1"), sys("m", "f2", "r1"), sys("h2", "f1", "r1"), sys("own", "f1", "r1"),
    ];
    const connections = [...biConn("h1", "m", 5), ...biConn("m", "h2", 5), ...biConn("h1", "own", 5)];
    const flows = [flow("h1", "h2", 6), flow("h1", "own", 4)];

    const projection = computeGeographyProjection(flows, connections, ownershipOf(systems));
    const summary = summariseGeography(systems, connections, [], flows);

    expect(projection.foreignTransitHaulCount).toBe(1);
    expect(projection.foreignTransitHaulVolume).toBe(6);
    expect(summary.foreignTransitHaulCount).toBe(1);
    expect(summary.foreignTransitHaulVolume).toBe(6);
    // Denominator is placed volume (6 + 4 = 10), not total recorded volume.
    expect(summary.foreignTransitHaulVolumeShare).toBeCloseTo(6 / 10, 9);
  });

  it("gates a per-faction top-decile row on a minimum trafficked-edge count", () => {
    // fBig: a 25-system chain, one haul per edge — 24 distinct trafficked edges, clears the gate.
    // fSmall: a 4-system chain — 3 trafficked edges, well under the gate.
    const bigChain = Array.from({ length: 25 }, (_, i) => sys(`big${i}`, "fBig", "rBig"));
    const bigConnections = bigChain.slice(0, -1).flatMap((s, i) => biConn(s.id, `big${i + 1}`, 5));
    const bigFlows = bigChain.slice(0, -1).map((s, i) => flow(s.id, `big${i + 1}`, 1));
    expect(bigFlows.length).toBe(24);
    expect(bigFlows.length).toBeGreaterThanOrEqual(GEOGRAPHY_MIN_TRAFFICKED_EDGES);

    const smallChain = Array.from({ length: 4 }, (_, i) => sys(`small${i}`, "fSmall", "rSmall"));
    const smallConnections = smallChain.slice(0, -1).flatMap((s, i) => biConn(s.id, `small${i + 1}`, 5));
    const smallFlows = smallChain.slice(0, -1).map((s, i) => flow(s.id, `small${i + 1}`, 1));

    const systems = [...bigChain, ...smallChain];
    const connections = [...bigConnections, ...smallConnections];
    const flows = [...bigFlows, ...smallFlows];

    const summary = summariseGeography(systems, connections, [], flows);

    const factionIds = summary.topDecileShareByFaction.map((f) => f.factionId);
    expect(factionIds).toEqual(["fBig"]);
    expect(summary.topDecileShareByFaction[0].trafficked).toBe(24);
  });

  it("counts cross-faction lanes and leaves same/unclaimed-endpoint lanes uncounted", () => {
    const systems = [sys("h1", "f1", "r1"), sys("h2", "f2", "r2"), sys("u1", null, "r1"), sys("c1", "f1", "r1")];
    const connections = [
      ...biConn("h1", "h2", 6), // cross-faction
      ...biConn("h1", "u1", 4), // faction / unclaimed
      ...biConn("h1", "c1", 3), // same faction
    ];

    const summary = summariseGeography(systems, connections, [], []);

    expect(summary.crossFactionLaneCount).toBe(1);
  });

  it("folds the beyond-crossing cohort by colony cluster vs faction homeworld cluster", () => {
    const systems = [
      sys("h1", "f1", "r1", 0.02), // homeworld, cluster r1
      sys("c1", "f1", "r1", 0.05), // interior — same cluster as homeworld
      sys("c2", "f1", "r2", -0.03), // beyond-crossing — different cluster
    ];
    const factions = [faction("f1", "h1")];
    const migrantInflow = new Map([["c1", 12], ["c2", 4]]);

    const cohort = beyondCrossingCohort(systems, factions, migrantInflow);
    const interior = cohort.find((c) => c.cohort === "interior")!;
    const beyond = cohort.find((c) => c.cohort === "beyond-crossing")!;

    // Homeworld itself lands in "interior" (its own cluster IS its homeworld cluster).
    expect(interior.n).toBe(2);
    expect(interior.meanMigrantInflow).toBeCloseTo((0 + 12) / 2, 9);
    expect(interior.meanPopulationTrend).toBeCloseTo((0.02 + 0.05) / 2, 9);

    expect(beyond.n).toBe(1);
    expect(beyond.meanMigrantInflow).toBe(4);
    expect(beyond.meanPopulationTrend).toBeCloseTo(-0.03, 9);
  });

  it("excludes a colony whose faction cannot be resolved to a homeworld, rather than guessing a cohort", () => {
    const systems = [sys("c1", "fGhost", "r1")];
    const cohort = beyondCrossingCohort(systems, [], new Map());

    expect(cohort.find((c) => c.cohort === "interior")!.n).toBe(0);
    expect(cohort.find((c) => c.cohort === "beyond-crossing")!.n).toBe(0);
  });
});

describe("summariseRelationsScores / countBorderConflicts", () => {
  it("reads a distribution from an empty roster as zeroes, never NaN", () => {
    expect(summariseRelationsScores([])).toEqual({ n: 0, median: 0, p10: 0, p90: 0 });
  });

  it("reports the relations-score distribution as-is, no new mechanic", () => {
    const summary = summariseRelationsScores([{ score: -50 }, { score: 0 }, { score: 50 }]);
    expect(summary.n).toBe(3);
    expect(summary.median).toBe(0);
  });

  it("counts only border_conflict events", () => {
    const count = countBorderConflicts([{ type: "border_conflict" }, { type: "famine" }, { type: "border_conflict" }]);
    expect(count).toBe(2);
  });
});

describe("crossFactionLaneCount", () => {
  it("deduplicates the two directional rows one physical lane produces", () => {
    const systems = [sys("h1", "f1", "r1"), sys("h2", "f2", "r2")];
    const connections = biConn("h1", "h2", 6);

    expect(crossFactionLaneCount(connections, factionById(systems))).toBe(1);
  });
});
