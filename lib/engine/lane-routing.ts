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
import { hopCrossingTicks } from "./freight";
import type { WorldLane, WorldPendingArrival } from "@/lib/world/types";

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
  /** laneKey → fuel cost of crossing it — static (fuel costs never change once generated), so the
   *  booker recomputes a scheduled ledger row's per-hop crossing ticks (`hopCrossingTicks`) from
   *  this rather than a persisted field on `WorldPendingArrival`. */
  fuelCosts: ReadonlyMap<string, number>;
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
  const fuelCosts = new Map<string, number>();
  for (const c of connections) {
    const key = laneKey(c.fromSystemId, c.toSystemId);
    if (!lanesByKey.has(key)) continue;
    let neighbors = adjacency.get(c.fromSystemId);
    if (!neighbors) {
      neighbors = [];
      adjacency.set(c.fromSystemId, neighbors);
    }
    neighbors.push({ toSystemId: c.toSystemId, fuelCost: c.fuelCost });
    fuelCosts.set(key, c.fuelCost);
  }

  const laneKeys = [...lanesByKey.keys()].sort();
  const capacities = new Map<string, number>();
  for (const key of laneKeys) {
    const lane = lanesByKey.get(key);
    if (!lane) continue; // unreachable: laneKeys is derived from lanesByKey's own keys
    capacities.set(key, capacityOf(lane));
  }

  return { adjacency, capacities, laneKeys, fuelCosts };
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
  /** Booked and blocked totals for every lane in the network (0 for an untouched lane).
   *  `bookedLoad` is window 0 — this run's own window, seeded from in-flight crossings due now plus
   *  whatever this run has placed onto it — never a cumulative or future-window figure. */
  loads(): ReadonlyMap<string, LaneLoad>;
  /** One lane's booked load in one window (0 = this run's own window, matching `loads()`'s
   *  `bookedLoad`; a positive window is a future run's window, seeded from the ledger or booked by
   *  this run's own placements reaching that far out). Test-visible read of the per-window ledger —
   *  the processor and lane decay only ever read `loads()`. */
  loadAt(key: string, window: number): number;
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
 *
 * **Load is kept per (lane, window)**, not per lane (`docs/active/gameplay/logistics-lanes.md` §2: "a
 * lane is booked for the cycle the cargo crosses it, not the cycle it is dispatched"). Window 0 is
 * this run's own interval `[now, now + windowTicks)`; window w is `[now + w·windowTicks, now +
 * (w+1)·windowTicks)`. `routeAndBook`'s search carries the accumulated raw fuel to each node along
 * the path (`dijkstra`'s `cumRaw`, this module's only consumer of it) and reads every edge's
 * cost/exclusion/room at the window its OWN crossing would start in — so a haul's first hop prices
 * against window 0 while a hop reached three windows out prices against window 3's load, which may
 * be far less contended. `priceFrom`/`reachableFrom` deliberately do NOT do this: they keep pricing
 * every edge at window 0 (the "frozen at the moment of the fan-out" snapshot spec §2 already
 * promises), never projecting a future window's load — only a real booking is time-dependent.
 *
 * The booker seeds window occupancy from `scheduled` (the pending-arrivals ledger, both legs — a
 * return leg physically crosses lanes too) before placing anything new: every row's per-hop
 * crossing ticks are recomputed from its `routeEdges` and the network's own (static) per-lane
 * `fuelCosts` — never a persisted field on `WorldPendingArrival` — via `hopCrossingTicks`, and its
 * quantity lands on whichever window that crossing starts in, or nowhere if that window already
 * lies in the past (`window < 0`). This is what makes an earlier reservation always outrank a later
 * dispatch for the same lane and window: the ledger is read before the run's own fan-outs touch the
 * ledger at all.
 *
 * `windowTicks`, `now` and `freightSpeed` default to values that collapse every crossing into
 * window 0 (`freightSpeed: Infinity` ⇒ every hop starts at `now`) — the zero-latency fallback every
 * caller not passing lane-mechanics timing (an engine fixture with no ledger, a pre-window test)
 * gets automatically, and exactly the equivalence spec §2 calls out: "at the zero-latency freight
 * speed every crossing falls in the dispatching window and the ledger collapses to the single
 * per-run figure it replaces."
 */
export function createRouteBooker(
  network: LaneNetwork,
  opts: {
    congestionMax: number;
    catchUp: number;
    /** Ticks per logistics-run window — the interval this run's own booking resolves on
     *  (`cadence.logistics`, `lib/world/tick.ts`). Default 1 (immaterial when `freightSpeed`'s
     *  default already collapses every crossing's offset to 0). */
    windowTicks?: number;
    /** The dispatch tick THIS run is booking at — the origin every seeded and newly-booked
     *  crossing's window is computed relative to. Default 0. */
    now?: number;
    /** Fuel crossed per tick in transit (`hopCrossingTicks`, `lib/engine/freight.ts`). Default
     *  `Infinity`: every hop's crossing starts at `now` regardless of path length, the zero-latency
     *  fallback. */
    freightSpeed?: number;
    /** The scheduled-freight ledger to seed window occupancy from, both legs. Default `[]` (nothing
     *  in flight to seed — every fixture and pre-window test that never mentions the ledger). */
    scheduled?: readonly WorldPendingArrival[];
  },
): RouteBooker {
  const windowTicks = opts.windowTicks ?? 1;
  const now = opts.now ?? 0;
  const freightSpeed = opts.freightSpeed ?? Number.POSITIVE_INFINITY;
  const scheduled = opts.scheduled ?? [];

  // laneKey → window → booked quantity. Only windows actually touched (seeded or booked) get an
  // entry; `loadAt` treats a missing window as 0.
  const bookedByWindow = new Map<string, Map<number, number>>();
  const bookedByFactionByWindow = new Map<string, Map<number, Map<string | null, number>>>();
  // Blocked volume is never windowed — it is a this-run, this-moment reading (spec §2), not a
  // scheduled quantity, so it stays the flat per-lane total it always was.
  const blockedVolume = new Map<string, number>();

  for (const key of network.laneKeys) {
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

  function loadAt(key: string, window: number): number {
    return bookedByWindow.get(key)?.get(window) ?? 0;
  }

  /** The window a crossing starting at `crossingTick` falls into, relative to `now`. */
  function windowFromTick(crossingTick: number): number {
    return Math.floor((crossingTick - now) / windowTicks);
  }

  /** The window a hop starting `cumRawAtFrom` raw fuel into a fresh (dispatched-at-`now`) journey
   *  falls into — the special case of `windowFromTick` every live/ideal search edge reads. */
  function windowFor(cumRawAtFrom: number): number {
    return windowFromTick(now + Math.max(0, Math.round(cumRawAtFrom / freightSpeed)));
  }

  function addBooking(key: string, window: number, factionKey: string | null, quantity: number): void {
    let byWindow = bookedByWindow.get(key);
    if (!byWindow) {
      byWindow = new Map<number, number>();
      bookedByWindow.set(key, byWindow);
    }
    byWindow.set(window, (byWindow.get(window) ?? 0) + quantity);

    let byFactionByWindow = bookedByFactionByWindow.get(key);
    if (!byFactionByWindow) {
      byFactionByWindow = new Map<number, Map<string | null, number>>();
      bookedByFactionByWindow.set(key, byFactionByWindow);
    }
    let byFaction = byFactionByWindow.get(window);
    if (!byFaction) {
      byFaction = new Map<string | null, number>();
      byFactionByWindow.set(window, byFaction);
    }
    byFaction.set(factionKey, (byFaction.get(factionKey) ?? 0) + quantity);
  }

  // Seed every in-flight ledger row's window occupancy BEFORE any new booking is placed, so an
  // earlier reservation always outranks a later dispatch for the same lane and window.
  for (const row of scheduled) {
    const hopFuelCosts = row.routeEdges.map((key) => network.fuelCosts.get(key) ?? 0);
    const crossingTicks = hopCrossingTicks(row.dispatchTick, hopFuelCosts, freightSpeed);
    for (let i = 0; i < row.routeEdges.length; i++) {
      const window = windowFromTick(crossingTicks[i]);
      if (window >= 0) addBooking(row.routeEdges[i], window, row.factionId, row.quantity);
    }
  }

  /** Live route cost at window 0 only — `priceFrom`/`reachableFrom`'s frozen, non-time-dependent
   *  snapshot (see this function's own docstring above for why they never project a future
   *  window). `openEdge` is always supplied by the caller — every real path runs through
   *  `forHauler`'s bound view. */
  function liveEdgeCost(
    from: string,
    to: string,
    fuelCost: number,
    openEdge: (laneKey: string) => boolean,
  ): number | null {
    const key = laneKey(from, to);
    if (!openEdge(key)) return null;
    const capacity = capacityFor(key);
    const load = loadAt(key, 0);
    if (load >= capacity) return null;
    return fuelCost * congestionMultiplier(load, capacity);
  }

  /**
   * Route cost ignoring saturation entirely, at window 0 (only `openEdge` can close an edge here) —
   * used solely to name the choke edge of "the cheapest path" the spec's blocked-volume rule refers
   * to, never to place a booking.
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
    const load = loadAt(key, 0);
    return fuelCost * congestionMultiplier(load, capacity);
  }

  /** `liveEdgeCost`'s time-dependent sibling: `cumRawAtFrom` (dijkstra's own accumulated raw fuel
   *  to `from`, at a fresh dispatch from `now`) picks the window this specific edge's crossing
   *  would start in, and every read (exclusion, congestion, room) is against THAT window's load. */
  function liveEdgeCostWindowed(
    from: string,
    to: string,
    fuelCost: number,
    cumRawAtFrom: number,
    openEdge: (laneKey: string) => boolean,
  ): number | null {
    const key = laneKey(from, to);
    if (!openEdge(key)) return null;
    const capacity = capacityFor(key);
    const load = loadAt(key, windowFor(cumRawAtFrom));
    if (load >= capacity) return null;
    return fuelCost * congestionMultiplier(load, capacity);
  }

  /** `edgeCostIgnoringSaturation`'s time-dependent sibling, used only for the choke-edge fallback
   *  search when no live-windowed path remains. */
  function edgeCostIgnoringSaturationWindowed(
    from: string,
    to: string,
    fuelCost: number,
    cumRawAtFrom: number,
    openEdge: (laneKey: string) => boolean,
  ): number | null {
    const key = laneKey(from, to);
    if (!openEdge(key)) return null;
    const capacity = capacityFor(key);
    const load = loadAt(key, windowFor(cumRawAtFrom));
    return fuelCost * congestionMultiplier(load, capacity);
  }

  /** Every hop of `path`, paired with the window its own crossing starts in — read off `cumRaw`
   *  (the raw fuel accumulated to reach the hop's origin node), the same value the search itself
   *  priced that edge at. */
  function pathHopsWithWindows(path: string[], cumRaw: Map<string, number>): { key: string; window: number }[] {
    const hops: { key: string; window: number }[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      hops.push({ key: laneKey(path[i], path[i + 1]), window: windowFor(cumRaw.get(path[i]) ?? 0) });
    }
    return hops;
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

  function foreignShareAt(key: string, window: number, factionKey: string | null): number {
    const total = loadAt(key, window);
    if (total <= 0) return 0;
    const own = bookedByFactionByWindow.get(key)?.get(window)?.get(factionKey) ?? 0;
    return Math.max(total - own, 0) / total;
  }

  function recordBlocked(
    entries: RouteBlocked[],
    key: string,
    quantity: number,
    factionKey: string | null,
    window: number,
  ): void {
    if (quantity <= 0) return;
    blockedVolume.set(key, (blockedVolume.get(key) ?? 0) + quantity);
    entries.push({ laneKey: key, quantity, foreignShare: foreignShareAt(key, window, factionKey) });
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
        edgeCost: (f, t, fuelCost, cumRawAtFrom) =>
          liveEdgeCostWindowed(f, t, fuelCost, cumRawAtFrom, openEdge),
      });
      const liveCost = live.dist.get(to);

      if (liveCost === undefined) {
        // No path remains with any capacity left anywhere feasible. Name the choke edge from the
        // cheapest path ignoring saturation, if one exists at all — otherwise this is a reachability
        // gap, not congestion, and nothing is blocked.
        const ideal = dijkstra(from, network.adjacency, {
          stopAt: to,
          edgeCost: (f, t, fuelCost, cumRawAtFrom) =>
            edgeCostIgnoringSaturationWindowed(f, t, fuelCost, cumRawAtFrom, openEdge),
        });
        if (ideal.dist.get(to) !== undefined) {
          const idealPath = reconstructPath(ideal.prev, to);
          const idealHops = pathHopsWithWindows(idealPath, ideal.cumRaw);
          const choke = idealHops.find((h) => loadAt(h.key, h.window) >= capacityFor(h.key));
          if (choke) recordBlocked(blocked, choke.key, remaining, factionKey, choke.window);
        }
        break;
      }

      const path = reconstructPath(live.prev, to);
      const hops = pathHopsWithWindows(path, live.cumRaw);

      // The live search already excludes any edge at capacity (in its own window), so every hop on
      // this path has strictly positive room — `placeable` is always > 0 here.
      let placeable = remaining;
      let chokeHop: { key: string; window: number } | null = null;
      for (const hop of hops) {
        const room = capacityFor(hop.key) - loadAt(hop.key, hop.window);
        if (room < placeable) {
          placeable = room;
          chokeHop = hop;
        }
      }

      // If this ever fires, `liveEdgeCostWindowed` returned a path containing an edge with zero or
      // negative room in its own window — the exclusion it's supposed to enforce (`load >= capacity`
      // closes an edge) is broken. Silently `break`-ing here would leave `remaining` stuck and either
      // return a wrong partial booking or, if some caller loops on a nonzero remainder, spin
      // forever with no visible fault — the OOM a broken exclusion actually produces. Throwing
      // surfaces the impossible state immediately, matching this project's convention that a
      // broken invariant hard-pauses rather than degrading silently (AGENTS.md: "a failing tick
      // hard-pauses the loop").
      if (placeable <= 0) {
        throw new Error(
          `lane-routing: liveEdgeCostWindowed returned a path with a non-positive-room edge (${chokeHop?.key ?? "unknown"}) — capacity exclusion invariant broken`,
        );
      }

      for (const hop of hops) {
        addBooking(hop.key, hop.window, factionKey, placeable);
      }

      placements.push({
        quantity: placeable,
        edges: hops.map((h) => h.key),
        perUnit: liveCost,
        fuelTotal: sumRawFuel(path),
      });

      const shortfall = remaining - placeable;
      if (shortfall > 0 && chokeHop) {
        recordBlocked(blocked, chokeHop.key, shortfall, factionKey, chokeHop.window);
      }
      remaining = shortfall;
    }

    return { placements, blocked };
  }

  function loads(): ReadonlyMap<string, LaneLoad> {
    const result = new Map<string, LaneLoad>();
    for (const key of network.laneKeys) {
      result.set(key, { bookedLoad: loadAt(key, 0), blockedVolume: blockedVolume.get(key) ?? 0 });
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

  return { loads, loadAt, forHauler };
}
