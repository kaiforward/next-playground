import { describe, it, expect } from "vitest";
import {
  summariseGeography, computeGeographyProjection, sameFactionEdgeFuelCosts,
  crossFactionLaneCount, beyondCrossingCohort, summariseRelationsScores, countBorderConflicts,
  GEOGRAPHY_MIN_TRAFFICKED_EDGES,
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
// production shape (buildFuelAdjacency is directional).
const biConn = (a: string, b: string, fuelCost: number): ConnectionInfo[] => [
  conn(a, b, fuelCost), conn(b, a, fuelCost),
];

const flow = (
  fromSystemId: string, toSystemId: string, quantity: number, tick = 1, goodId = "water",
): WorldFlowEvent => ({ tick, fromSystemId, toSystemId, goodId, quantity });

const faction = (id: string, homeworldId: string): GeographyFactionInput => ({ id, homeworldId });

const factionById = (systems: GeographySystemInput[]): Map<string, string | null> =>
  new Map(systems.map((s) => [s.id, s.factionId]));

describe("computeGeographyProjection", () => {
  it("reports a flow-less world as zeroes, never NaN", () => {
    const projection = computeGeographyProjection([], [], new Map());
    expect(projection.aggregateEdgeVolume.size).toBe(0);
    expect(projection.totalPlacedVolume).toBe(0);
    expect(projection.totalHaulPathProduct).toBe(0);
    expect(projection.unreachableHaulCount).toBe(0);
    expect(projection.unreachableHaulVolume).toBe(0);
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

    const projection = computeGeographyProjection(flows, connections, factionById(systems));

    // Independently computed sides: one accumulated during placement, the other by re-summing
    // the map placement wrote — a mis-keyed edge would make these disagree.
    expect(projection.totalHaulPathProduct).toBe(10 * 1 + 5 * 2);
    expect(projection.totalPlacedVolume).toBe(projection.totalHaulPathProduct);
    expect(projection.unreachableHaulCount).toBe(0);
  });

  it("counts a haul with no reachable path as unreachable, placing nothing", () => {
    // c2 sits in a disconnected component under f1's own+unclaimed graph.
    const systems = [sys("h1", "f1", "r1"), sys("c2", "f1", "r2")];
    const connections: ConnectionInfo[] = [];
    const flows = [flow("h1", "c2", 7)];

    const projection = computeGeographyProjection(flows, connections, factionById(systems));

    expect(projection.unreachableHaulCount).toBe(1);
    expect(projection.unreachableHaulVolume).toBe(7);
    expect(projection.totalPlacedVolume).toBe(0);
    expect(projection.totalHaulPathProduct).toBe(0);
  });

  it("counts a haul from an unowned donor as unreachable — no faction graph to route within", () => {
    const systems = [sys("u1", null, "r1"), sys("c1", "f1", "r1")];
    const connections = biConn("u1", "c1", 5);
    const flows = [flow("u1", "c1", 4)];

    const projection = computeGeographyProjection(flows, connections, factionById(systems));

    expect(projection.unreachableHaulCount).toBe(1);
    expect(projection.unreachableHaulVolume).toBe(4);
    expect(projection.totalPlacedVolume).toBe(0);
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
    const projection = computeGeographyProjection(flows, connections, fuelById);
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
  });

  it("pins the unreachable-haul pass-through against the projection it is read from", () => {
    // c2 sits in a disconnected component under f1's own+unclaimed graph (mirrors the
    // computeGeographyProjection unreachable-haul fixture above), alongside one reachable haul so
    // the share is a real fraction, not a vacuous 1 or 0.
    const systems = [sys("h1", "f1", "r1"), sys("c1", "f1", "r1"), sys("c2", "f1", "r2")];
    const connections = biConn("h1", "c1", 5);
    const flows = [flow("h1", "c1", 6), flow("h1", "c2", 4)];

    const projection = computeGeographyProjection(flows, connections, factionById(systems));
    const summary = summariseGeography(systems, connections, [], flows);

    expect(projection.unreachableHaulCount).toBe(1);
    expect(projection.unreachableHaulVolume).toBe(4);
    expect(summary.unreachableHaulCount).toBe(projection.unreachableHaulCount);
    expect(summary.unreachableHaulVolume).toBe(projection.unreachableHaulVolume);
    expect(summary.unreachableHaulVolumeShare).toBeCloseTo(4 / 10, 9);
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
