/**
 * Geography acceptance instruments for the calibration harness — the map-generation sub-project's
 * measure of whether the generated galaxy actually produces the geography the spec claims:
 * concentrated traffic, cost-differentiated lanes, and a real cost to settling beyond a crossing.
 *
 * The concentration read is the premise-1 instrument. Its reachability mirrors the shipped router's
 * own rule (docs/planned/logistics-lanes.md §2, `world/tick.ts`'s `bookerFor`): a haul is reachable
 * iff a path exists over the LANE NETWORK (`buildLaneNetwork`, `lib/engine/lane-routing.ts` — a
 * connection with no matching `WorldLane` row is not part of it) from donor to sink where every lane
 * crossed is open to the hauling faction (`laneOpenFor`, `lib/engine/lane-access.ts`:
 * own+unclaimed+friendly-or-allied). Ownership and relation tiers are read from the haul's own
 * per-cycle `OwnershipSnapshot` (below): `systemFactionById` as before, plus `relationScoreByPair`
 * — a pair with no row reads neutral (0), mirroring `tierBetween`'s own default in `world/tick.ts`.
 * Performance: at most one Dijkstra search per distinct (hauling faction, donor) pair per snapshot
 * window, cached (`reachabilityCache` below) — a run repeats the same few hundred donor/receiver
 * pairs thousands of times over a fixed topology and ownership/relations are constant within one
 * window, so the cache bounds the search count to distinct hauling contexts, not the flow count.
 * That reachability search is judged independently of the edge-placement path below — the modelled
 * placement path can legitimately take a different route (and can legitimately transit foreign-held
 * space a *lane* traversability check would itself forbid, see below), so the two are never
 * substituted for each other.
 *
 * The specific lane path a haul is placed onto, however, stays a MODELLING CHOICE, not a claim
 * about the router: the real matcher (`matchFactionTransfers`) only ever compares a cost number
 * between a donor and a receiver — it never records or chooses a lane sequence. This module models
 * that unrecorded path as the fuel-weighted shortest path (`buildFuelAdjacency` + Dijkstra) over the
 * same full, ownership-blind adjacency, deliberately NOT the tier-filtered one the router's own
 * booking runs over: this path exists only to attribute already-reachable volume to individual
 * lanes for the concentration and fuel-spread reads, and running it over the full graph is what lets
 * `foreignTransitHaul*` below measure how much of that reachable traffic the model would still push
 * through foreign-held space if nothing else diverted it. A haul the reachability search could not
 * route contributes to neither side of the conservation identity below; a haul it could route is
 * always placed, even when its modelled path happens to transit a foreign-held system in between —
 * that transit is measured, not excluded (`foreignTransitHaul*` below).
 *
 * Ownership basis: a haul is classified against who held each system AT HAUL TIME, not at the end
 * of the run. The runner samples ownership (and relation scores) once per cycle
 * (`ownershipSnapshots`, `runner.ts`) and this module resolves every flow through the latest
 * snapshot at or before its own tick, so a transit system that was unclaimed when the goods moved
 * and was settled later does not count as foreign transit, and a donor whose faction has since
 * abandoned it still attributes its hauls. Ownership sampled per cycle is an approximation only
 * within one cycle — ownership changes on cycle boundaries (colonisation, abandonment), so a
 * snapshot taken at each boundary is exact for every tick until the next one. The lane-cohort reads
 * below (fuel spread, cross-faction lanes, beyond-crossing cohort) stay END-OF-RUN reads: they
 * describe the map as it finished, not a haul.
 *
 * NaN rule throughout, matching `logistics-analysis.ts`: a zero denominator reports 0, never NaN —
 * `JSON.stringify` renders NaN as null, which reads as "not measured" rather than "measured, and
 * broken".
 */
import { buildFuelAdjacency, dijkstra, findShortestPath } from "@/lib/engine/pathfinding";
import { buildLaneNetwork } from "@/lib/engine/lane-routing";
import { laneOpenFor, type LaneAccessOwner } from "@/lib/engine/lane-access";
import { getRelationTier, type RelationTier } from "@/lib/constants/relations";
import { pairKey } from "@/lib/tick/world/relations-world";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { quantile } from "@/lib/utils/math";
import type { SystemControl, WorldFlowEvent, WorldLane } from "@/lib/world/types";
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
 * traffic" rather than "too small to measure". Twenty is the smallest cohort whose top decile is
 * more than one or two edges, so the share it reports is a distribution reading rather than a
 * single lane's share of its faction.
 */
export const GEOGRAPHY_MIN_TRAFFICKED_EDGES = 20;

// ── Edge keying ──────────────────────────────────────────────────

/** Canonical undirected key for a lane — connections are stored as one directed row per
 *  declared direction, but every lane-level read here (volume, fuel cost, cross-faction count)
 *  is over the undirected physical lane. */
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ── Ownership over time ──────────────────────────────────────────

/** Who held each system, and each faction pair's relation score, over one window of ticks — the
 *  reading applies from `fromTick` until the next snapshot's `fromTick`. `relationScoreByPair` is
 *  keyed exactly as `WorldFactionRelation` stores it (`pairKey`, `lib/tick/world/relations-world.ts`
 *  — the sorted-pair convention); absent entirely (a caller with no relations history) or missing a
 *  given pair both read neutral (0), matching `tierBetween`'s own default in `world/tick.ts`. */
export interface OwnershipSnapshot {
  fromTick: number;
  systemFactionById: ReadonlyMap<string, string | null>;
  relationScoreByPair?: ReadonlyMap<string, number>;
}

/** One snapshot covering the whole run — what a caller with only an end-of-run ownership map (a
 *  unit test, or a world that never changed hands) passes. `relationScoreByPair` is optional and
 *  defaults every pair to neutral, same as an omitted one on a hand-built `OwnershipSnapshot`. */
export function singleOwnershipSnapshot(
  systemFactionById: ReadonlyMap<string, string | null>,
  relationScoreByPair?: ReadonlyMap<string, number>,
): OwnershipSnapshot[] {
  return [{ fromTick: 0, systemFactionById, relationScoreByPair }];
}

/** The latest snapshot at or before `tick`, by binary search over an ascending-`fromTick` list —
 *  shared by `ownershipAt` (below, ownership-only callers) and the reachability search (which also
 *  needs `relationScoreByPair`). A tick before the first snapshot reads that first snapshot — the
 *  run's opening ownership/relations is the only reading available for it, and it is the correct
 *  one. */
function snapshotAt(
  snapshots: ReadonlyArray<OwnershipSnapshot>, tick: number,
): OwnershipSnapshot {
  let lo = 0;
  let hi = snapshots.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snapshots[mid].fromTick <= tick) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return snapshots[best];
}

/** The latest snapshot at or before `tick`, by binary search over an ascending-`fromTick` list.
 *  A tick before the first snapshot reads that first snapshot — the run's opening ownership is the
 *  only reading available for it, and it is the correct one. */
export function ownershipAt(
  snapshots: ReadonlyArray<OwnershipSnapshot>, tick: number,
): ReadonlyMap<string, string | null> {
  return snapshotAt(snapshots, tick).systemFactionById;
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
  /** edgeKey -> volume, summed across every faction's own placements (plus independent/unclaimed
   *  hauls, which have no faction to attribute to — see `perFactionEdgeVolume`). */
  aggregateEdgeVolume: Map<string, number>;
  /** factionId -> edgeKey -> volume, one hauling faction's own placements only. Independent hauls
   *  (donor system unclaimed) still land in `aggregateEdgeVolume` above but have no faction bucket
   *  here — there is no faction to attribute them to. */
  perFactionEdgeVolume: Map<string, Map<string, number>>;
  /** Σ (haul quantity × modelled-path edge count), accumulated during placement. */
  totalHaulPathProduct: number;
  /** Σ over `aggregateEdgeVolume`'s final values — the independent re-read side of the identity. */
  totalPlacedVolume: number;
  /** Σ haul quantity for every PLACED haul (not edge-multiplied) — the denominator for
   *  `foreignTransitHaulVolumeShare` below; distinct from `totalPlacedVolume`, which double-counts
   *  a multi-hop haul once per traversed edge. */
  placedHaulVolume: number;
  /** Hauls the router's own reachability rule could not have routed: no path over the lane network
   *  from donor to sink where every lane crossed is open to the hauling faction (own+unclaimed+
   *  friendly-or-allied, see module docstring). Never placed, so they contribute 0 to both sides of
   *  the conservation identity above. Reported so a projection that silently drops most hauls is
   *  visible rather than reading as low traffic. */
  unreachableHaulCount: number;
  unreachableHaulVolume: number;
  /** Placed hauls whose MODELLED path (see module docstring) transits at least one intermediate
   *  system owned by a faction that is neither the hauling faction nor null — i.e. the router
   *  routed this haul through foreign-held space, which the projection now places rather than
   *  excludes. Volume-weighted so a few large diversions aren't buried by many small direct ones. */
  foreignTransitHaulCount: number;
  foreignTransitHaulVolume: number;
}

function emptyProjection(): GeographyProjection {
  return {
    aggregateEdgeVolume: new Map(),
    perFactionEdgeVolume: new Map(),
    totalHaulPathProduct: 0,
    totalPlacedVolume: 0,
    placedHaulVolume: 0,
    unreachableHaulCount: 0,
    unreachableHaulVolume: 0,
    foreignTransitHaulCount: 0,
    foreignTransitHaulVolume: 0,
  };
}

/**
 * Project every flow event the shipped router could have routed onto a modelled lane path (see
 * module docstring for the reachability/placement split). The hauling faction is read off the
 * haul's donor system (`fromSystemId`) — goods only ever depart a system their own faction holds,
 * or `null` for an independent/unclaimed donor. Independent hauls are NOT treated as unreachable:
 * `world/tick.ts` groups directed-logistics rows by faction key including `null` and runs that
 * group through the identical matcher with `funded = 1` (uncapped) — the router hauls for
 * independents exactly as it does for factions, so this projection must too.
 */
export function computeGeographyProjection(
  flowEvents: ReadonlyArray<WorldFlowEvent>,
  connections: ReadonlyArray<ConnectionInfo>,
  lanes: ReadonlyArray<WorldLane>,
  ownershipSnapshots: ReadonlyArray<OwnershipSnapshot>,
): GeographyProjection {
  if (flowEvents.length === 0 || ownershipSnapshots.length === 0) return emptyProjection();

  const projection = emptyProjection();
  // The placement model's graph: ownership-blind, fuel-weighted, over every declared connection
  // (see module docstring for why this deliberately does NOT match the reachability graph below).
  const adjacency = buildFuelAdjacency([...connections]);
  // The reachability graph: only connections carrying a lane row, exactly what the shipped router's
  // own booker routes over (`buildLaneNetwork`, `lib/engine/lane-routing.ts`). `capacityOf` is
  // irrelevant here — only `.adjacency` is read, never `.capacities` — so it's a constant stub.
  const laneNetwork = buildLaneNetwork([...connections], [...lanes], () => 0);
  // A run's hauls repeat the same few hundred donor/receiver pairs thousands of times over a fixed
  // topology. Pathing reads only `adjacency`, which is ownership-blind — ownership decides how a
  // haul is CLASSIFIED, never where it routes — so one cache serves every snapshot window.
  const pathCache = new Map<string, string[] | null>();
  // One Dijkstra per distinct (hauling faction, donor) pair per snapshot window at most — traversal
  // is gated by `laneOpenFor`, which depends only on ownership/relations (constant within a window)
  // and the hauling faction, never on the sink, so a single search from the donor answers every
  // sink at once. Keyed by the window's own `fromTick`, which uniquely identifies it.
  const reachabilityCache = new Map<string, ReadonlyMap<string, number>>();
  function reachableFrom(snapshot: OwnershipSnapshot, factionId: string | null, donorId: string): ReadonlyMap<string, number> {
    const cacheKey = `${snapshot.fromTick}|${factionId ?? " "}|${donorId}`;
    const cached = reachabilityCache.get(cacheKey);
    if (cached) return cached;
    const systemFactionById = snapshot.systemFactionById;
    const ownerOf = (systemId: string): LaneAccessOwner => ({ factionId: systemFactionById.get(systemId) ?? null });
    const relationScoreByPair = snapshot.relationScoreByPair;
    const tierBetween = (a: string, b: string): RelationTier =>
      getRelationTier(relationScoreByPair?.get(pairKey(a, b)) ?? 0);
    const { dist } = dijkstra(donorId, laneNetwork.adjacency, {
      edgeCost: (from, to, fuelCost) =>
        (laneOpenFor(factionId, { aId: from, bId: to }, ownerOf, tierBetween) ? fuelCost : null),
    });
    reachabilityCache.set(cacheKey, dist);
    return dist;
  }

  for (const flow of flowEvents) {
    const snapshot = snapshotAt(ownershipSnapshots, flow.tick);
    const systemFactionById = snapshot.systemFactionById;
    const factionId = systemFactionById.get(flow.fromSystemId) ?? null;

    const reachable = reachableFrom(snapshot, factionId, flow.fromSystemId);
    if (!reachable.has(flow.toSystemId)) {
      projection.unreachableHaulCount++;
      projection.unreachableHaulVolume += flow.quantity;
      continue;
    }

    const cacheKey = `${flow.fromSystemId}>${flow.toSystemId}`;
    let path = pathCache.get(cacheKey);
    if (path === undefined) {
      const computed = findShortestPath(flow.fromSystemId, flow.toSystemId, [], undefined, adjacency);
      path = computed === null ? null : computed.path;
      pathCache.set(cacheKey, path);
    }
    if (path === null) {
      // Reachable over the (tier-filtered) lane network but the full ownership-blind placement
      // model finds no path — should not occur, since the lane network's edges are a subset of
      // the full connection graph's (adding edges never removes reachability), but if it does this
      // haul is router-routable and must not be double-counted as unreachable; it simply has no
      // modelled path to place volume onto.
      continue;
    }

    const pathEdgeCount = path.length - 1;
    projection.totalHaulPathProduct += flow.quantity * pathEdgeCount;
    projection.placedHaulVolume += flow.quantity;

    let transitsForeign = false;
    for (let i = 1; i < path.length - 1; i++) {
      const owner = systemFactionById.get(path[i]) ?? null;
      if (owner !== null && owner !== factionId) transitsForeign = true;
    }
    if (transitsForeign) {
      projection.foreignTransitHaulCount++;
      projection.foreignTransitHaulVolume += flow.quantity;
    }

    let perFaction: Map<string, number> | undefined;
    if (factionId !== null) {
      perFaction = projection.perFactionEdgeVolume.get(factionId);
      if (!perFaction) {
        perFaction = new Map();
        projection.perFactionEdgeVolume.set(factionId, perFaction);
      }
    }

    for (let i = 0; i < pathEdgeCount; i++) {
      const key = edgeKey(path[i], path[i + 1]);
      projection.aggregateEdgeVolume.set(key, (projection.aggregateEdgeVolume.get(key) ?? 0) + flow.quantity);
      if (perFaction) perFaction.set(key, (perFaction.get(key) ?? 0) + flow.quantity);
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
 * The map-generation acceptance instruments, spec §5: flow concentration (aggregate + per-faction,
 * gated) read against router-true reachability, fuel-cost spread over both the premise-4 cohort and
 * its trafficked sub-cohort, cross-faction lane count, and the beyond-crossing migration/population
 * cohort. `migrantInflowBySystem` is the runner's own accumulated colonist-delivery total per
 * system (`TickInstrumentation.colonistDeliveryBySystem`, folded across the run) — absent (e.g. a
 * unit test with no run to accumulate) reads every system's inflow as 0, not unmeasured, since
 * "no colonists delivered" and "not tracked" are the same reading for a cohort mean.
 *
 * `systems` is the END-OF-RUN world, which is the right basis for every lane cohort here. Haul
 * classification is not a lane cohort: it reads `ownershipSnapshots` instead (see the module
 * docstring), defaulting to the end-of-run reading when a caller has no history to give.
 */
export function summariseGeography(
  systems: ReadonlyArray<GeographySystemInput>,
  connections: ReadonlyArray<ConnectionInfo>,
  lanes: ReadonlyArray<WorldLane>,
  factions: ReadonlyArray<GeographyFactionInput>,
  flowEvents: ReadonlyArray<WorldFlowEvent>,
  migrantInflowBySystem: ReadonlyMap<string, number> = new Map(),
  ownershipSnapshots?: ReadonlyArray<OwnershipSnapshot>,
): GeographySummary {
  const systemFactionById = new Map(systems.map((s) => [s.id, s.factionId]));
  const projection = computeGeographyProjection(
    flowEvents,
    connections,
    lanes,
    ownershipSnapshots && ownershipSnapshots.length > 0
      ? ownershipSnapshots
      : singleOwnershipSnapshot(systemFactionById),
  );

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
    foreignTransitHaulCount: projection.foreignTransitHaulCount,
    foreignTransitHaulVolume: projection.foreignTransitHaulVolume,
    foreignTransitHaulVolumeShare: projection.placedHaulVolume === 0
      ? 0
      : projection.foreignTransitHaulVolume / projection.placedHaulVolume,
  };
}
