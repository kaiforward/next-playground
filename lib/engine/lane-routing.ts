/**
 * Route engine — edge-keyed cheapest path with congestion pricing and capacity booking
 * (docs/active/gameplay/logistics-lanes.md §2). Pure, zero I/O: callers pass in the connection/lane rows
 * and the policy hooks (`openEdge`, `catchUp`) this module needs; it never reads world state.
 *
 * Grows from `lib/engine/pathfinding.ts`'s Dijkstra via its `edgeCost` hook rather than
 * re-implementing the search: one path engine for every mover, per the shared-substrate decision
 * (spec §6).
 */

import type { ConnectionInfo } from "./navigation";
import { dijkstra, reconstructPath, type FuelAdjacency } from "./pathfinding";
import { laneKey } from "./lanes";
import type { WorldLane } from "@/lib/world/types";

// ── Network ─────────────────────────────────────────────────────

/**
 * The lane graph a `RouteBooker` runs over: a fuel-weighted adjacency restricted to edges that
 * carry a lane row, plus each lane's raw (per-reference-cycle) capacity and the full sorted list
 * of known lane keys — the latter so `loads()` can report every lane, not just the ones a run
 * happens to touch.
 */
export interface LaneNetwork {
  adjacency: FuelAdjacency;
  /** laneKey → raw per-cycle capacity (`capacityOf(lane)`, before the booker's `catchUp` scale). */
  capacities: ReadonlyMap<string, number>;
  /** Every lane key, sorted — the deterministic iteration order `loads()` and network construction use. */
  laneKeys: readonly string[];
}

/**
 * Build a `LaneNetwork` from a flat connection list and the world's lane rows. A connection edge
 * with no matching lane row is dropped — it carries no capacity or key, so it cannot be part of
 * the booked-and-priced graph a `RouteBooker` runs over.
 */
export function buildLaneNetwork(
  connections: readonly ConnectionInfo[],
  lanes: readonly WorldLane[],
  capacityOf: (lane: WorldLane) => number,
): LaneNetwork {
  const lanesByKey = new Map<string, WorldLane>();
  for (const lane of lanes) {
    lanesByKey.set(lane.key, lane);
  }

  const adjacency: FuelAdjacency = new Map();
  for (const c of connections) {
    const key = laneKey(c.fromSystemId, c.toSystemId);
    if (!lanesByKey.has(key)) continue;
    let neighbors = adjacency.get(c.fromSystemId);
    if (!neighbors) {
      neighbors = [];
      adjacency.set(c.fromSystemId, neighbors);
    }
    neighbors.push({ toSystemId: c.toSystemId, fuelCost: c.fuelCost });
  }

  const laneKeys = [...lanesByKey.keys()].sort();
  const capacities = new Map<string, number>();
  for (const key of laneKeys) {
    const lane = lanesByKey.get(key);
    if (!lane) continue; // unreachable: laneKeys is derived from lanesByKey's own keys
    capacities.set(key, capacityOf(lane));
  }

  return { adjacency, capacities, laneKeys };
}

// ── Booker ──────────────────────────────────────────────────────

export interface RoutePlacement {
  /** Quantity carried over this placement's path. */
  quantity: number;
  /** Lane keys crossed, in path order (origin → destination). */
  edges: string[];
  /** Congestion-priced route cost per unit, frozen at the moment this placement was booked. */
  perUnit: number;
  /** Sum of the path's raw (unweighted) fuel cost — the travel-time input, not the priced cost. */
  fuelTotal: number;
}

export interface RouteBlocked {
  laneKey: string;
  /** Quantity that could not use this edge and had to detour or go unplaced. */
  quantity: number;
  /** Fraction of the edge's booked load, at the moment of blocking, placed by other factions. */
  foreignShare: number;
}

/** A `RouteBlocked` entry tagged with the hauling faction key that produced it (`null` =
 *  independents) — the shape every calibration-instrumentation consumer of blocked volume actually
 *  wants (`TickProcessorResult.logisticsBlocked`, the directed-logistics processor's own fold, and
 *  the harness's `recordLogisticsBlocked`), declared once here rather than re-declared inline at
 *  each site. */
export type LogisticsBlockedEntry = RouteBlocked & { factionKey: string | null };

export interface RouteBooking {
  placements: RoutePlacement[];
  blocked: RouteBlocked[];
}

/** One lane's booked/blocked load — `RouteBooker.loads()`'s own value shape, and the fields
 *  `LaneLoadUpdate` (`lib/tick/world/directed-logistics-world.ts`) persists them under, so the
 *  engine's in-memory reading and the persisted write-back share one name for each quantity rather
 *  than a third spelling (`booked`/`blocked`) appearing only at this boundary. */
export interface LaneLoad {
  bookedLoad: number;
  blockedVolume: number;
}

/**
 * The matcher's (and any other caller's) view of a `RouteBooker` for ONE hauler — a structural
 * subset any real booker satisfies and a test can hand-roll without constructing a lane network.
 * `priceFrom` freezes one sink's prices to every donor for that deficit's whole fan-out
 * (`docs/active/gameplay/logistics-lanes.md` §2: "prices are frozen at the moment the severity queue
 * reaches that deficit"); `routeAndBook` is consulted inside the fill loop with the quantity being
 * drawn, and places it onto the shared network, so a later deficit's `priceFrom` reflects prior
 * bookings.
 */
export interface RouteBookerFor {
  priceFrom(sinkId: string): (donorId: string) => number | null;
  /**
   * One search from `sinkId` over the graph IGNORING saturation (only `openEdge` can close an edge
   * here, exactly like `priceFrom`'s frozen snapshot but never excluding a donor for lack of
   * capacity) — frozen the same way, for the caller's whole fan-out. A donor congestion has
   * currently priced out of `priceFrom` (a saturated path returns `null` there) still reads
   * reachable here: reachability is a structural question (does a path exist at all), congestion is
   * a this-run contention question, and `unservable`'s own structural test needs the former without
   * the latter (`docs/active/gameplay/logistics-lanes.md` §2, "a blocked haul is not an unservable one").
   */
  reachableFrom(sinkId: string): (donorId: string) => boolean;
  routeAndBook(from: string, to: string, quantity: number): RouteBooking | null;
}

export interface RouteBooker {
  /** Booked and blocked totals for every lane in the network (0 for an untouched lane). */
  loads(): ReadonlyMap<string, LaneLoad>;
  /**
   * A per-hauler view over this SAME physical ledger — `openEdge` is the per-client traversability
   * policy (spec §6: goods route over own+unclaimed+friendly-or-allied, a future migration client
   * would pass a narrower predicate); a closed edge is never traversed, full stop, independent of
   * capacity. Everything else (booked/blocked load, congestion pricing) is shared, so two haulers
   * with different traversability (e.g. different factions' `laneOpenFor`) still see each other's
   * bookings and congestion on a shared edge. `factionKey` (null for unclaimed/no faction) is bound
   * into every `routeAndBook` call this view makes, for `foreignShare` attribution; it does not
   * affect routing or pricing. This is the booker's whole public surface: there is no traversal-open
   * top-level view, so a caller cannot reach for `routeAndBook`/`priceFrom` without first choosing a
   * traversability policy through `forHauler`.
   */
  forHauler(openEdge: (laneKey: string) => boolean, factionKey: string | null): RouteBookerFor;
}

/**
 * Build a `RouteBooker` over `network` — one physical ledger meant to be shared by every faction
 * routing in a run, so two factions booking the same edge see each other's load and congestion.
 * Traversability is supplied per view, via `forHauler` — this booker itself carries no
 * traversability policy of its own.
 *
 * `congestionMax` bounds the per-edge multiplier; `catchUp` scales each lane's raw per-cycle
 * `capacityOf` into this run's actual capacity, applied here so callers pass the same raw number
 * regardless of catch-up factor.
 *
 * Congestion curve: `multiplier(load, capacity) = 1 + (congestionMax - 1) * min(load / capacity, 1)`
 * — linear in load, 1 at zero load, `congestionMax` exactly at load === capacity. An edge is
 * excluded from live routing once its booked load REACHES capacity (`load >= capacity` closes it,
 * cost `null`), so a live-routed edge's multiplier is always strictly below `congestionMax`; the
 * bound is reached only by the saturation-ignoring search used solely to name a choke edge (and, at
 * `reachableFrom`, to test reachability without congestion at all).
 */
export function createRouteBooker(
  network: LaneNetwork,
  opts: { congestionMax: number; catchUp: number },
): RouteBooker {
  const booked = new Map<string, number>();
  const blockedVolume = new Map<string, number>();
  const bookedByFaction = new Map<string, Map<string | null, number>>();

  for (const key of network.laneKeys) {
    booked.set(key, 0);
    blockedVolume.set(key, 0);
  }

  function capacityFor(key: string): number {
    return (network.capacities.get(key) ?? 0) * opts.catchUp;
  }

  function congestionMultiplier(load: number, capacity: number): number {
    if (capacity <= 0) return opts.congestionMax;
    const ratio = Math.min(load / capacity, 1);
    return 1 + (opts.congestionMax - 1) * ratio;
  }

  /** Live route cost: excludes any edge whose booked load has reached capacity. `openEdge` is
   *  always supplied by the caller — every real path runs through `forHauler`'s bound view. */
  function liveEdgeCost(
    from: string,
    to: string,
    fuelCost: number,
    openEdge: (laneKey: string) => boolean,
  ): number | null {
    const key = laneKey(from, to);
    if (!openEdge(key)) return null;
    const capacity = capacityFor(key);
    const load = booked.get(key) ?? 0;
    if (load >= capacity) return null;
    return fuelCost * congestionMultiplier(load, capacity);
  }

  /**
   * Route cost ignoring saturation entirely (only `openEdge` can close an edge here) — used solely
   * to name the choke edge of "the cheapest path" the spec's blocked-volume rule refers to, never
   * to place a booking.
   */
  function edgeCostIgnoringSaturation(
    from: string,
    to: string,
    fuelCost: number,
    openEdge: (laneKey: string) => boolean,
  ): number | null {
    const key = laneKey(from, to);
    if (!openEdge(key)) return null;
    const capacity = capacityFor(key);
    const load = booked.get(key) ?? 0;
    return fuelCost * congestionMultiplier(load, capacity);
  }

  function pathToLaneKeys(path: string[]): string[] {
    const keys: string[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      keys.push(laneKey(path[i], path[i + 1]));
    }
    return keys;
  }

  function sumRawFuel(path: string[]): number {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const neighbors = network.adjacency.get(path[i]) ?? [];
      const edge = neighbors.find((n) => n.toSystemId === path[i + 1]);
      if (edge) total += edge.fuelCost;
    }
    return total;
  }

  function addFactionBooking(key: string, factionKey: string | null, quantity: number): void {
    let byFaction = bookedByFaction.get(key);
    if (!byFaction) {
      byFaction = new Map<string | null, number>();
      bookedByFaction.set(key, byFaction);
    }
    byFaction.set(factionKey, (byFaction.get(factionKey) ?? 0) + quantity);
  }

  function foreignShareAt(key: string, factionKey: string | null): number {
    const total = booked.get(key) ?? 0;
    if (total <= 0) return 0;
    const own = bookedByFaction.get(key)?.get(factionKey) ?? 0;
    return Math.max(total - own, 0) / total;
  }

  function recordBlocked(entries: RouteBlocked[], key: string, quantity: number, factionKey: string | null): void {
    if (quantity <= 0) return;
    blockedVolume.set(key, (blockedVolume.get(key) ?? 0) + quantity);
    entries.push({ laneKey: key, quantity, foreignShare: foreignShareAt(key, factionKey) });
  }

  function routeAndBook(
    from: string,
    to: string,
    quantity: number,
    factionKey: string | null,
    openEdge: (laneKey: string) => boolean,
  ): RouteBooking | null {
    if (from === to || quantity <= 0) return null;

    const placements: RoutePlacement[] = [];
    const blocked: RouteBlocked[] = [];
    let remaining = quantity;

    while (remaining > 0) {
      const live = dijkstra(from, network.adjacency, {
        stopAt: to,
        edgeCost: (f, t, fuelCost) => liveEdgeCost(f, t, fuelCost, openEdge),
      });
      const liveCost = live.dist.get(to);

      if (liveCost === undefined) {
        // No path remains with any capacity left anywhere feasible. Name the choke edge from the
        // cheapest path ignoring saturation, if one exists at all — otherwise this is a reachability
        // gap, not congestion, and nothing is blocked.
        const ideal = dijkstra(from, network.adjacency, {
          stopAt: to,
          edgeCost: (f, t, fuelCost) => edgeCostIgnoringSaturation(f, t, fuelCost, openEdge),
        });
        if (ideal.dist.get(to) !== undefined) {
          const idealPath = reconstructPath(ideal.prev, to);
          const idealLaneKeys = pathToLaneKeys(idealPath);
          const choke = idealLaneKeys.find((key) => (booked.get(key) ?? 0) >= capacityFor(key));
          if (choke) recordBlocked(blocked, choke, remaining, factionKey);
        }
        break;
      }

      const path = reconstructPath(live.prev, to);
      const laneKeysOnPath = pathToLaneKeys(path);

      // The live search already excludes any edge at capacity, so every edge on this path has
      // strictly positive room — `placeable` is always > 0 here.
      let placeable = remaining;
      let chokeLaneKey: string | null = null;
      for (const key of laneKeysOnPath) {
        const room = capacityFor(key) - (booked.get(key) ?? 0);
        if (room < placeable) {
          placeable = room;
          chokeLaneKey = key;
        }
      }

      // If this ever fires, `liveEdgeCost` returned a path containing an edge with zero or
      // negative room — the exclusion it's supposed to enforce (`load >= capacity` closes an
      // edge) is broken. Silently `break`-ing here would leave `remaining` stuck and either
      // return a wrong partial booking or, if some caller loops on a nonzero remainder, spin
      // forever with no visible fault — the OOM a broken exclusion actually produces. Throwing
      // surfaces the impossible state immediately, matching this project's convention that a
      // broken invariant hard-pauses rather than degrading silently (AGENTS.md: "a failing tick
      // hard-pauses the loop").
      if (placeable <= 0) {
        throw new Error(
          `lane-routing: liveEdgeCost returned a path with a non-positive-room edge (${chokeLaneKey ?? "unknown"}) — capacity exclusion invariant broken`,
        );
      }

      for (const key of laneKeysOnPath) {
        booked.set(key, (booked.get(key) ?? 0) + placeable);
        addFactionBooking(key, factionKey, placeable);
      }

      placements.push({
        quantity: placeable,
        edges: laneKeysOnPath,
        perUnit: liveCost,
        fuelTotal: sumRawFuel(path),
      });

      const shortfall = remaining - placeable;
      if (shortfall > 0 && chokeLaneKey) {
        recordBlocked(blocked, chokeLaneKey, shortfall, factionKey);
      }
      remaining = shortfall;
    }

    return { placements, blocked };
  }

  function loads(): ReadonlyMap<string, LaneLoad> {
    const result = new Map<string, LaneLoad>();
    for (const key of network.laneKeys) {
      result.set(key, { bookedLoad: booked.get(key) ?? 0, blockedVolume: blockedVolume.get(key) ?? 0 });
    }
    return result;
  }

  function priceFrom(
    sinkId: string,
    openEdge: (laneKey: string) => boolean,
  ): (donorId: string) => number | null {
    const { dist } = dijkstra(sinkId, network.adjacency, {
      edgeCost: (f, t, fuelCost) => liveEdgeCost(f, t, fuelCost, openEdge),
    });
    return (donorId: string) => dist.get(donorId) ?? null;
  }

  /** `reachableFrom`'s search, ignoring saturation entirely — see `RouteBookerFor.reachableFrom`'s
   *  own docstring for why congestion must not remove a donor from this reading. */
  function reachableFrom(
    sinkId: string,
    openEdge: (laneKey: string) => boolean,
  ): (donorId: string) => boolean {
    const { dist } = dijkstra(sinkId, network.adjacency, {
      edgeCost: (f, t, fuelCost) => edgeCostIgnoringSaturation(f, t, fuelCost, openEdge),
    });
    return (donorId: string) => dist.has(donorId);
  }

  function forHauler(openEdge: (laneKey: string) => boolean, factionKey: string | null): RouteBookerFor {
    return {
      priceFrom: (sinkId: string) => priceFrom(sinkId, openEdge),
      reachableFrom: (sinkId: string) => reachableFrom(sinkId, openEdge),
      routeAndBook: (from: string, to: string, quantity: number) =>
        routeAndBook(from, to, quantity, factionKey, openEdge),
    };
  }

  return { loads, forHauler };
}
