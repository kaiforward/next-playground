/**
 * Geography acceptance instruments for the calibration harness — the map-generation sub-project's
 * measure of whether the generated galaxy actually produces the geography the spec claims:
 * concentrated traffic, cost-differentiated lanes, and a real cost to settling beyond a crossing.
 *
 * The concentration read is the premise-1 instrument, corrected: the shipped router travels over
 * own-plus-unclaimed adjacency with fuel-weighted shortest paths (`buildFuelAdjacency` + the
 * Dijkstra, `lib/engine/pathfinding.ts`), not the old same-faction-only hop-BFS — so this module
 * projects every recorded haul onto the path the real router would choose and places its quantity
 * on each traversed lane. That projection is this module's first job; everything else (fuel-cost
 * spread, cross-faction lane count, the beyond-crossing cohort) reads off the same connection
 * graph, which is why this is the first harness module to touch it at all.
 *
 * NaN rule throughout, matching `logistics-analysis.ts`: a zero denominator reports 0, never NaN —
 * `JSON.stringify` renders NaN as null, which reads as "not measured" rather than "measured, and
 * broken".
 */
import { buildFuelAdjacency, findShortestPath } from "@/lib/engine/pathfinding";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { quantile } from "@/lib/utils/math";
import type { SystemControl, WorldFlowEvent } from "@/lib/world/types";
import type {
  BeyondCrossingCohortEntry, FactionTopDecileShareEntry, GeographySummary,
} from "./types";

/** One system's fields this module reads — a `TickSystem` or `WorldSystem` both satisfy it. */
export interface GeographySystemInput {
  id: string;
  factionId: string | null;
  control: SystemControl;
  regionId: string;
  populationTrend?: number;
}

/** One faction's fields this module reads. */
export interface GeographyFactionInput {
  id: string;
  homeworldId: string;
}

/**
 * Trafficked-edge floor below which a per-faction top-decile share is omitted, not zero-filled —
 * a handful of edges cannot carry a meaningful decile, and a printed 0 there would read as "flat
 * traffic" rather than "too small to measure". Matches the premise-1 attribution run's own
 * cross-check line ("gated at >=20 trafficked edges", `docs/build-plans/logistics-lanes.md`).
 */
export const GEOGRAPHY_MIN_TRAFFICKED_EDGES = 20;

// ── Edge keying ──────────────────────────────────────────────────

/** Canonical undirected key for a lane — connections are stored as one directed row per
 *  declared direction, but every lane-level read here (volume, fuel cost, cross-faction count)
 *  is over the undirected physical lane. */
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ── Flow projection ──────────────────────────────────────────────

/**
 * The corrected projection's raw output — exported so the conservation identity (Proves: "Σ
 * placed edge volume = Σ haul quantity × path length") can be checked directly against two
 * independently-computed sides: `totalHaulPathProduct` is accumulated once per haul as it is
 * placed; `totalPlacedVolume` is read back afterward by summing the very map the placement wrote,
 * a separate traversal that would not agree with the first if a placement bug mis-keyed or
 * dropped an edge.
 */
export interface GeographyProjection {
  /** edgeKey -> volume, summed across every faction's own placements. */
  aggregateEdgeVolume: Map<string, number>;
  /** factionId -> edgeKey -> volume, the hauling faction's own placements only. Because a lane
   *  between two same-faction systems can only appear in ITS OWN faction's own+unclaimed graph
   *  (no other faction's graph admits either endpoint), same-faction edges attribute cleanly to
   *  one faction. */
  perFactionEdgeVolume: Map<string, Map<string, number>>;
  /** Σ (haul quantity × path edge count), accumulated during placement. */
  totalHaulPathProduct: number;
  /** Σ over `aggregateEdgeVolume`'s final values — the independent re-read side of the identity. */
  totalPlacedVolume: number;
  /** Hauls with no faction to route within (donor system unclaimed/independent) or no path at all
   *  under own+unclaimed adjacency (foreign space blocks the route this pass) — never placed, so
   *  they contribute 0 to both sides of the conservation identity above. Reported so a projection
   *  that silently drops most hauls is visible rather than reading as low traffic. */
  unreachableHaulCount: number;
  unreachableHaulVolume: number;
}

function emptyProjection(): GeographyProjection {
  return {
    aggregateEdgeVolume: new Map(),
    perFactionEdgeVolume: new Map(),
    totalHaulPathProduct: 0,
    totalPlacedVolume: 0,
    unreachableHaulCount: 0,
    unreachableHaulVolume: 0,
  };
}

/**
 * Project every flow event onto the path the shipped router would have chosen for it: adjacency
 * restricted to the hauling faction's own systems plus unclaimed ones (foreign space is closed to
 * routing this pass, spec §2), fuel-weighted shortest path. The hauling faction is read off the
 * haul's donor system (`fromSystemId`) — goods only ever depart a system their own faction holds.
 */
export function computeGeographyProjection(
  flowEvents: ReadonlyArray<WorldFlowEvent>,
  connections: ReadonlyArray<ConnectionInfo>,
  systemFactionById: ReadonlyMap<string, string | null>,
): GeographyProjection {
  if (flowEvents.length === 0) return emptyProjection();

  const projection = emptyProjection();
  const adjacencyByFaction = new Map<string, ReturnType<typeof buildFuelAdjacency>>();

  const adjacencyFor = (factionId: string): ReturnType<typeof buildFuelAdjacency> => {
    let adj = adjacencyByFaction.get(factionId);
    if (adj) return adj;
    const filtered = connections.filter((c) => {
      const a = systemFactionById.get(c.fromSystemId) ?? null;
      const b = systemFactionById.get(c.toSystemId) ?? null;
      return (a === factionId || a === null) && (b === factionId || b === null);
    });
    adj = buildFuelAdjacency(filtered);
    adjacencyByFaction.set(factionId, adj);
    return adj;
  };

  for (const flow of flowEvents) {
    const factionId = systemFactionById.get(flow.fromSystemId) ?? null;
    if (factionId === null) {
      projection.unreachableHaulCount++;
      projection.unreachableHaulVolume += flow.quantity;
      continue;
    }

    const adj = adjacencyFor(factionId);
    const result = findShortestPath(flow.fromSystemId, flow.toSystemId, [], undefined, adj);
    if (result === null) {
      projection.unreachableHaulCount++;
      projection.unreachableHaulVolume += flow.quantity;
      continue;
    }

    const pathEdgeCount = result.path.length - 1;
    projection.totalHaulPathProduct += flow.quantity * pathEdgeCount;

    let perFaction = projection.perFactionEdgeVolume.get(factionId);
    if (!perFaction) {
      perFaction = new Map();
      projection.perFactionEdgeVolume.set(factionId, perFaction);
    }

    for (let i = 0; i < pathEdgeCount; i++) {
      const key = edgeKey(result.path[i], result.path[i + 1]);
      projection.aggregateEdgeVolume.set(key, (projection.aggregateEdgeVolume.get(key) ?? 0) + flow.quantity);
      perFaction.set(key, (perFaction.get(key) ?? 0) + flow.quantity);
    }
  }

  for (const v of projection.aggregateEdgeVolume.values()) projection.totalPlacedVolume += v;

  return projection;
}

// ── Top-decile concentration ──────────────────────────────────────

/** Share of total volume the top decile of trafficked (nonzero-volume) edges carries. 0 when no
 *  edge carries any volume (never NaN — no decile is defined over an empty cohort). Trafficked
 *  count reported alongside so a caller can gate a per-faction row on it. */
function topDecileConcentration(volumes: Iterable<number>): { share: number; trafficked: number } {
  const trafficked = [...volumes].filter((v) => v > 0).sort((a, b) => b - a);
  const n = trafficked.length;
  if (n === 0) return { share: 0, trafficked: 0 };
  const total = trafficked.reduce((a, b) => a + b, 0);
  if (total === 0) return { share: 0, trafficked: n };
  const topCount = Math.max(1, Math.ceil(n * 0.1));
  const topSum = trafficked.slice(0, topCount).reduce((a, b) => a + b, 0);
  return { share: topSum / total, trafficked: n };
}

// ── Fuel-cost spread ───────────────────────────────────────────────

/** p90/p10 ratio over a value list. 0 when the cohort is empty or its p10 is 0 (division would
 *  never actually hit 0 given fuelCost's floor of 1, but the guard keeps the NaN rule absolute). */
function p90p10Ratio(values: number[]): number {
  const p10 = quantile(values, 0.1);
  if (p10 === 0) return 0;
  return quantile(values, 0.9) / p10;
}

/**
 * The premise-4 cohort: undirected same-faction edges (both endpoints owned by the same faction),
 * every control state — deduplicated to one fuelCost reading per physical lane. Exported for the
 * subset test: `fuelP90P10Trafficked`'s cohort must be a strict subset of this one's keys.
 */
export function sameFactionEdgeFuelCosts(
  connections: ReadonlyArray<ConnectionInfo>,
  systemFactionById: ReadonlyMap<string, string | null>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of connections) {
    const a = systemFactionById.get(c.fromSystemId) ?? null;
    const b = systemFactionById.get(c.toSystemId) ?? null;
    if (a === null || b === null || a !== b) continue;
    const key = edgeKey(c.fromSystemId, c.toSystemId);
    if (!out.has(key)) out.set(key, c.fuelCost);
  }
  return out;
}

// ── Cross-faction lanes ────────────────────────────────────────────

/** Lanes (undirected, deduplicated) whose two endpoints are controlled by different, non-null
 *  factions — mirrors `getBorderLengthsBetween`'s own admission rule (`lib/tick/adapters/memory/
 *  relations.ts`), summed rather than split per pair. */
export function crossFactionLaneCount(
  connections: ReadonlyArray<ConnectionInfo>,
  systemFactionById: ReadonlyMap<string, string | null>,
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const c of connections) {
    const key = edgeKey(c.fromSystemId, c.toSystemId);
    if (seen.has(key)) continue;
    seen.add(key);
    const a = systemFactionById.get(c.fromSystemId) ?? null;
    const b = systemFactionById.get(c.toSystemId) ?? null;
    if (a === null || b === null || a === b) continue;
    count++;
  }
  return count;
}

// ── Beyond-crossing cohort ──────────────────────────────────────────

/**
 * Colonies whose cluster (region — region IS the cluster under the map-gen rework, spec §5)
 * differs from their own faction's homeworld cluster, folded against cluster-interior colonies:
 * mean migrant inflow and mean population trajectory (`populationTrend`) per side. A colony whose
 * faction cannot be resolved to a homeworld (should not occur — every faction row carries one) is
 * excluded from both cohorts rather than guessed into one.
 */
export function beyondCrossingCohort(
  systems: ReadonlyArray<GeographySystemInput>,
  factions: ReadonlyArray<GeographyFactionInput>,
  migrantInflowBySystem: ReadonlyMap<string, number>,
): BeyondCrossingCohortEntry[] {
  const systemById = new Map(systems.map((s) => [s.id, s]));
  const homeworldClusterByFaction = new Map<string, string>();
  for (const f of factions) {
    const hw = systemById.get(f.homeworldId);
    if (hw) homeworldClusterByFaction.set(f.id, hw.regionId);
  }

  const totals: Record<
    "interior" | "beyond-crossing",
    { n: number; inflowSum: number; trendSum: number; trendCount: number }
  > = {
    interior: { n: 0, inflowSum: 0, trendSum: 0, trendCount: 0 },
    "beyond-crossing": { n: 0, inflowSum: 0, trendSum: 0, trendCount: 0 },
  };

  for (const s of systems) {
    if (s.control !== "developed" || s.factionId === null) continue;
    const homeCluster = homeworldClusterByFaction.get(s.factionId);
    if (homeCluster === undefined) continue;
    const cohort = s.regionId === homeCluster ? "interior" : "beyond-crossing";
    const bucket = totals[cohort];
    bucket.n++;
    bucket.inflowSum += migrantInflowBySystem.get(s.id) ?? 0;
    if (s.populationTrend !== undefined) {
      bucket.trendSum += s.populationTrend;
      bucket.trendCount++;
    }
  }

  return (["interior", "beyond-crossing"] as const).map((cohort) => {
    const bucket = totals[cohort];
    return {
      cohort,
      n: bucket.n,
      meanMigrantInflow: bucket.n === 0 ? 0 : bucket.inflowSum / bucket.n,
      meanPopulationTrend: bucket.trendCount === 0 ? 0 : bucket.trendSum / bucket.trendCount,
    };
  });
}

// ── Relations / border read (existing state, new report rows only) ──

/** Distribution of the pairwise relations score (`WorldFactionRelation.score`, [-100, +100]) —
 *  read as-is, no new mechanic. 0-filled quantiles on an empty roster (never NaN). */
export interface RelationsScoreSummary {
  n: number;
  median: number;
  p10: number;
  p90: number;
}

export function summariseRelationsScores(
  relations: ReadonlyArray<{ score: number }>,
): RelationsScoreSummary {
  const scores = relations.map((r) => r.score);
  if (scores.length === 0) return { n: 0, median: 0, p10: 0, p90: 0 };
  return {
    n: scores.length,
    median: quantile(scores, 0.5),
    p10: quantile(scores, 0.1),
    p90: quantile(scores, 0.9),
  };
}

/** Count of `border_conflict` events on the board at read time — an existing event type, no new
 *  reader logic beyond the count. */
export function countBorderConflicts(events: ReadonlyArray<{ type: string }>): number {
  return events.filter((e) => e.type === "border_conflict").length;
}

// ── Summary ──────────────────────────────────────────────────────

/**
 * The map-generation acceptance instruments, spec §5: corrected flow concentration
 * (aggregate + per-faction, gated), fuel-cost spread over both the premise-4 cohort and its
 * trafficked sub-cohort, cross-faction lane count, and the beyond-crossing migration/population
 * cohort. `migrantInflowBySystem` is the runner's own accumulated colonist-delivery total per
 * system (`TickInstrumentation.colonistDeliveryBySystem`, folded across the run) — absent (e.g. a
 * unit test with no run to accumulate) reads every system's inflow as 0, not unmeasured, since
 * "no colonists delivered" and "not tracked" are the same reading for a cohort mean.
 */
export function summariseGeography(
  systems: ReadonlyArray<GeographySystemInput>,
  connections: ReadonlyArray<ConnectionInfo>,
  factions: ReadonlyArray<GeographyFactionInput>,
  flowEvents: ReadonlyArray<WorldFlowEvent>,
  migrantInflowBySystem: ReadonlyMap<string, number> = new Map(),
): GeographySummary {
  const systemFactionById = new Map(systems.map((s) => [s.id, s.factionId]));
  const projection = computeGeographyProjection(flowEvents, connections, systemFactionById);

  const { share: topDecileShare } = topDecileConcentration(projection.aggregateEdgeVolume.values());

  const topDecileShareByFaction: FactionTopDecileShareEntry[] = [];
  for (const [factionId, volumeByEdge] of projection.perFactionEdgeVolume) {
    const { share, trafficked } = topDecileConcentration(volumeByEdge.values());
    if (trafficked >= GEOGRAPHY_MIN_TRAFFICKED_EDGES) {
      topDecileShareByFaction.push({ factionId, trafficked, topDecileShare: share });
    }
  }
  topDecileShareByFaction.sort((a, b) => a.factionId.localeCompare(b.factionId));

  const sameFactionFuel = sameFactionEdgeFuelCosts(connections, systemFactionById);
  const allFuelValues = [...sameFactionFuel.values()];
  const traffickedFuelValues = [...sameFactionFuel.entries()]
    .filter(([key]) => (projection.aggregateEdgeVolume.get(key) ?? 0) > 0)
    .map(([, fuel]) => fuel);

  // Total haul volume across every recorded flow event, placed or not — the unreachable share's
  // denominator, computed independently of the projection's own accumulators.
  const totalHaulVolume = flowEvents.reduce((sum, f) => sum + f.quantity, 0);

  return {
    topDecileShare,
    topDecileShareByFaction,
    fuelP90P10All: p90p10Ratio(allFuelValues),
    fuelP90P10Trafficked: p90p10Ratio(traffickedFuelValues),
    crossFactionLaneCount: crossFactionLaneCount(connections, systemFactionById),
    beyondCrossingCohort: beyondCrossingCohort(systems, factions, migrantInflowBySystem),
    unreachableHaulCount: projection.unreachableHaulCount,
    unreachableHaulVolume: projection.unreachableHaulVolume,
    unreachableHaulVolumeShare: totalHaulVolume === 0 ? 0 : projection.unreachableHaulVolume / totalHaulVolume,
  };
}
