import type { TickContext, TickProcessorResult, LogisticsBudgetLedger } from "../types";
import { cycleStartShard, catchUpFactor } from "@/lib/tick/shard";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import {
  matchFactionTransfers,
  systemLogisticsGeneration,
  type SystemLogisticsState,
  type RouteBookerFor,
  type PlannedTransfer,
} from "@/lib/engine/directed-logistics";
import type { LaneLoad, LogisticsBlockedEntry } from "@/lib/engine/lane-routing";
import { toGoodMarketStates, type DrawBrakeCeiling } from "@/lib/tick/processors/good-market-state";
import { freightArrivalTick } from "@/lib/engine/freight";
import { LANES } from "@/lib/constants/lanes";
import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  MarketRowForLogistics,
  LogisticsMarketUpdate,
  LogisticsFundingBoundUpdate,
  UnservedShortfallUpdate,
  LaneLoadUpdate,
} from "@/lib/tick/world/directed-logistics-world";
import type { WorldPendingArrival } from "@/lib/world/types";

export interface DirectedLogisticsProcessorParams {
  interval: number;
  /** One `RouteBookerFor` view per hauling faction key (`null` = independents), all sharing ONE
   *  physical ledger — `RouteBooker.forHauler` (`lib/engine/lane-routing.ts`), closed over that
   *  faction's own `laneOpenFor` traversability. The processor calls this once per faction group,
   *  in the match order below. */
  bookerFor(factionKey: string | null): RouteBookerFor;
  /** The shared booker's own `loads()` — every lane in the network, read back once after every
   *  faction has matched, so an untouched lane resets to `{ bookedLoad: 0, blockedVolume: 0 }`
   *  rather than keeping a stale figure from the last run that used it. */
  laneLoads(): ReadonlyMap<string, LaneLoad>;
  /** Outbound-leg scheduled inbound, keyed `"toSystemId|goodId"` (`lib/engine/freight.ts`
   *  `scheduledInbound`) — read at the matcher's feed site (the sink test) and at the dispatch
   *  clamp; omitted only by fixtures with no ledger to speak of. */
  scheduledInbound?: ReadonlyMap<string, number>;
  /** Latched funded.logistics per faction (0–1) — scales the haul budget. Missing
   *  faction or omitted map → 1 (ungated: engine tests, independents). */
  fundingByFaction?: ReadonlyMap<string, number>;
  /** Harness-only third-arm pin for the draw figure's brake (see `DrawBrakeCeiling`);
   *  absent ⇒ "live", the only value the live game ever passes. */
  drawBrakeCeiling?: DrawBrakeCeiling;
  /** Harness-only arm: overrides `LANES.FREIGHT_SPEED` for this cycle's `freightArrivalTick`
   *  calls; absent ⇒ the live constant, the only value the live game ever passes. */
  freightSpeed?: number;
  /** Mints a fresh, globally-unique id for a dispatched haul — the same `world.nextId` counter
   *  every other tick-minted id draws from (mirrors `GoodsArrivalsProcessorParams.mintId`). */
  mintId: () => string;
}

/**
 * Build the engine's per-system state from raw rows: generation + per-good band + total demand.
 * Generation is per-cycle income and scales by the catch-up factor and funding; the per-good gap-fills
 * deliberately do NOT (see the processor doc below).
 */
function toLogisticsState(
  row: SystemLogisticsRow,
  catchUp: number,
  funded: number,
  drawBrakeCeiling: DrawBrakeCeiling | undefined,
  scheduledInbound: ReadonlyMap<string, number> | undefined,
): SystemLogisticsState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    generation: systemLogisticsGeneration(row.population) * catchUp * funded,
    // The matcher is the draw figure's (and the sink test's scheduled-inbound term's) only reader,
    // so this is the one call site that computes either.
    goods: toGoodMarketStates(row, {
      withDraw: true,
      drawBrakeCeiling,
      scheduledInboundFor: scheduledInbound
        ? (goodId) => scheduledInbound.get(`${row.systemId}|${goodId}`) ?? 0
        : undefined,
    }),
  };
}

/** Ascending faction id, `null` (independents) always last — the shared-ledger match order the
 *  Proves entry on booking priority depends on: whichever faction is matched first books first on
 *  a lane both want. `Map` iteration order is insertion (row) order, which carries no such
 *  guarantee, so the keys are explicitly sorted here rather than trusted to `byFaction`'s own order. */
function orderedFactionKeys(keys: Iterable<string | null>): Array<string | null> {
  return [...keys].sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : 1;
  });
}

/**
 * Pure processor body. Cycle resolution: on the boundary tick
 * (`tick % interval === 0`) every faction is matched at once via `cycleStartShard`;
 * every other tick is a no-op.
 *
 * A matched placement is DISPATCHED, not delivered: the donor is debited immediately (this run's
 * absolute stock write), but the destination is credited only when the unconditional per-tick
 * goods-arrivals stage drains the `WorldPendingArrival` row this run appends
 * (docs/planned/logistics-lanes.md §3). No flow row is written here — the flow log records goods
 * actually delivered, which goods-arrivals writes on credit.
 *
 * Catch-up scaling is split down the middle of the mechanic:
 *  - Deliveries are NOT scaled. A transfer is an absolute *level-fill* toward the
 *    cycles-of-supply target (shortfall = logisticsTarget − stock). Multiplying a gap-fill
 *    by the interval ratio overshoots the target — it pushes recipients past the
 *    surplus margin (≈2× target), wasting hauls and flipping fresh recipients into
 *    donors / cheap re-export targets. The target (40 economy-runs of cover) already
 *    vastly exceeds one cycle's draw, so a single fill-to-anchor over-provisions on its own.
 *  - The haul *budget* IS scaled (`generation × catchUp` in `toLogisticsState`). It is
 *    per-cycle income (Σ pop × generation) — a capacity ceiling, not a target; paid
 *    unscaled but more often, it would silently inflate wall-clock haul capacity
 *    whenever the budget binds.
 */
export async function runDirectedLogisticsProcessor(
  world: DirectedLogisticsWorld,
  ctx: Pick<TickContext, "tick">,
  params: DirectedLogisticsProcessorParams,
): Promise<TickProcessorResult> {
  const factionKeys = await world.getFactionShardKeys();
  if (factionKeys.length === 0) return {};

  const { start, end } = cycleStartShard(factionKeys.length, ctx.tick, params.interval);
  const dueKeys = factionKeys.slice(start, end);
  if (dueKeys.length === 0) return {};

  // Per-cycle haul budget is reference-denominated; scale it so wall-clock haul capacity is
  // interval-invariant. Deliveries (level-fills toward the anchor) are not scaled.
  const catchUp = catchUpFactor(params.interval);

  const rows = await world.getSystemsForFactions(dueKeys);
  if (rows.length === 0) return {};

  // Group rows by faction key, build engine state, match each group.
  const byFaction = new Map<string | null, SystemLogisticsRow[]>();
  for (const r of rows) {
    const list = byFaction.get(r.factionId) ?? [];
    list.push(r);
    byFaction.set(r.factionId, list);
  }

  // Market lookup by (systemId|goodId) so we can clamp stock per transfer.
  type MarketEntry = MarketRowForLogistics & { systemId: string; max: number };
  const marketByKey = new Map<string, MarketEntry>();
  for (const r of rows) {
    for (const m of r.markets) {
      const band = marketBandForRow(m, GOODS[m.goodId]);
      marketByKey.set(`${r.systemId}|${m.goodId}`, {
        ...m,
        systemId: r.systemId,
        max: band.maxStock,
      });
    }
  }

  const workPerformedByFaction = new Map<string, number>();
  const logisticsBudget = new Map<string, LogisticsBudgetLedger>();
  const allTransfers: Array<PlannedTransfer & { factionId: string | null }> = [];
  const fundingBoundMarketIds = new Set<string>();
  // Market id → the unclosed part of the deficit (its want less the capacity its reachable donors
  // still held), for the deficits this run found structurally unservable. The level IS the
  // classification — the engine only records an entry where that residue is strictly positive — so
  // there is no separate bit to keep in step with it.
  const unservedShortfallByMarketId = new Map<string, number>();
  // Calibration instrumentation only: every faction's `RouteBlocked` entries this cycle, tagged with
  // the hauling faction key — the harness's `contentionShortfallByFaction` reading.
  const logisticsBlocked: LogisticsBlockedEntry[] = [];
  for (const factionId of orderedFactionKeys(byFaction.keys())) {
    const group = byFaction.get(factionId);
    if (!group) continue; // unreachable: factionId is drawn from byFaction's own keys
    const funded = factionId === null ? 1 : params.fundingByFaction?.get(factionId) ?? 1;
    const states = group.map((r) =>
      toLogisticsState(r, catchUp, funded, params.drawBrakeCeiling, params.scheduledInbound),
    );
    const booker = params.bookerFor(factionId);
    const match = matchFactionTransfers(states, booker);
    for (const t of match.transfers) allTransfers.push({ ...t, factionId });
    for (const b of match.blocked) {
      logisticsBlocked.push({ factionKey: factionId, laneKey: b.laneKey, quantity: b.quantity, foreignShare: b.foreignShare });
    }
    for (const bound of match.fundingBound) {
      const from = marketByKey.get(`${bound.fromSystemId}|${bound.goodId}`);
      const to = marketByKey.get(`${bound.toSystemId}|${bound.goodId}`);
      if (from) fundingBoundMarketIds.add(from.id);
      if (to) fundingBoundMarketIds.add(to.id);
    }
    // Deficit endpoint only — never the donor a funding-bound match above may also have named.
    for (const deficit of match.unservable) {
      const at = marketByKey.get(`${deficit.systemId}|${deficit.goodId}`);
      if (at) unservedShortfallByMarketId.set(at.id, deficit.shortfall);
    }
    if (factionId === null) continue;
    // Spent is summed over per-donor draws, so a fan-out is billed once — it must stay equal
    // to the treasury's work figure, never a per-flow-row recount. Billed on the PLANNED cost,
    // not on what the dispatch clamp below actually placed: the matcher already sized against
    // physical + in-flight stock, and the clamp is belt-and-braces, not a routine haircut.
    let work = 0;
    for (const t of match.transfers) work += t.cost;
    if (work > 0) workPerformedByFaction.set(factionId, work);
    let total = 0;
    for (const s of states) total += s.generation;
    logisticsBudget.set(factionId, {
      total,
      spent: work,
      fundingBoundCount: match.fundingBound.length,
      budgetSkipped: match.budgetSkipped,
    });
  }

  // Dispatch: clamp against the donor's stock and the destination's remaining room (its band cap
  // less current physical stock less everything already inbound — the baseline ledger plus
  // whatever this very run has already dispatched toward it), debit the donor, and append a
  // pending-arrival row. No destination credit and no flow row here — see the processor docstring.
  const donorStock = new Map<string, number>();
  const dispatchedThisRun = new Map<string, number>();
  const pendingArrivals: WorldPendingArrival[] = [];
  // Calibration instrumentation only: Σ quantity actually debited from a donor this cycle — the
  // fifth conservation identity's LEFT side, from this processor's own dispatch record (never the
  // matcher's planned `quantity`, which the clamp below may still shave).
  let dispatchedTotal = 0;

  for (const t of allTransfers) {
    // Stock is a continuous float balance — do NOT quantize the transfer. Flooring here
    // would re-break the goods-side scale-invariance the engine matcher preserves (losing
    // up to one unit per transfer, a large fraction at low ECONOMY_SCALE, negligible high).
    const qty = t.quantity;
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const from = marketByKey.get(`${t.fromSystemId}|${t.goodId}`);
    const to = marketByKey.get(`${t.toSystemId}|${t.goodId}`);
    if (!from || !to) continue;

    const fromCur = donorStock.get(from.id) ?? from.stock;
    const priorInbound = params.scheduledInbound?.get(`${t.toSystemId}|${t.goodId}`) ?? 0;
    const dispatchedSoFar = dispatchedThisRun.get(to.id) ?? 0;
    // The matcher already applies the donor's policy reserve (strategic exporters may
    // draw below their anchor) and the sink test's own scheduled-inbound term. This is only
    // physical belt-and-braces against same-run concurrent dispatches, so its floor stays zero.
    const moved = Math.min(
      qty,
      Math.max(0, fromCur),
      Math.max(0, to.max - to.stock - priorInbound - dispatchedSoFar),
    );
    if (moved <= 0) continue;

    donorStock.set(from.id, fromCur - moved);
    dispatchedThisRun.set(to.id, dispatchedSoFar + moved);
    dispatchedTotal += moved;

    pendingArrivals.push({
      id: params.mintId(),
      factionId: t.factionId,
      fromSystemId: t.fromSystemId,
      toSystemId: t.toSystemId,
      goodId: t.goodId,
      quantity: moved,
      dispatchTick: ctx.tick,
      arrivalTick: freightArrivalTick(ctx.tick, t.fuelTotal, params.freightSpeed ?? LANES.FREIGHT_SPEED),
      routeEdges: t.edges,
      leg: "outbound",
    });
  }

  if (donorStock.size > 0) {
    const marketUpdates: LogisticsMarketUpdate[] = [...donorStock.entries()].map(
      ([id, stock]) => ({ id, stock }),
    );
    await world.applyMarketUpdates(marketUpdates);
  }
  if (pendingArrivals.length > 0) await world.appendPendingArrivals(pendingArrivals);

  // Lane load write-back: every lane in the network, zero for one nothing booked this run — the
  // reset a lane loaded on a prior run needs (docs/planned/logistics-lanes.md §1's decay reads
  // "attempted load", so a stale nonzero figure would misread as still-loaded).
  const laneLoadUpdates: LaneLoadUpdate[] = [...params.laneLoads().entries()].map(
    ([key, { bookedLoad, blockedVolume }]) => ({ key, bookedLoad, blockedVolume }),
  );
  if (laneLoadUpdates.length > 0) await world.applyLaneLoadUpdates(laneLoadUpdates);

  // One pass over the visited rows for both per-market assessments — they read the same two rows'
  // worth of state and would otherwise walk the identical nested collection twice.
  const fundingUpdates: LogisticsFundingBoundUpdate[] = [];
  const unservedShortfallUpdates: UnservedShortfallUpdate[] = [];
  for (const row of rows) {
    for (const market of row.markets) {
      const logisticsFundingBound = fundingBoundMarketIds.has(market.id);
      if ((market.logisticsFundingBound ?? false) !== logisticsFundingBound) {
        fundingUpdates.push({ id: market.id, logisticsFundingBound });
      }
      // 0 for every row this run did NOT classify unservable — the level is the whole assessment, so
      // a widening or narrowing shortfall emits an update just as a newly-servable row does, and a
      // row whose level is unchanged emits nothing.
      const unservedShortfall = unservedShortfallByMarketId.get(market.id) ?? 0;
      if ((market.unservedShortfall ?? 0) !== unservedShortfall) {
        unservedShortfallUpdates.push({ id: market.id, unservedShortfall });
      }
    }
  }
  if (fundingUpdates.length > 0) await world.applyFundingBoundUpdates(fundingUpdates);
  if (unservedShortfallUpdates.length > 0) await world.applyUnservedShortfallUpdates(unservedShortfallUpdates);

  return {
    workPerformedByFaction, logisticsBudget, logisticsDispatched: dispatchedTotal, logisticsBlocked,
  };
}
