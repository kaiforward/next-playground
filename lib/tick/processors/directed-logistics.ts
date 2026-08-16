import type { TickContext, TickProcessorResult, LogisticsBudgetLedger } from "../types";
import { cycleStartShard, catchUpFactor } from "@/lib/tick/shard";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import {
  matchFactionTransfers,
  systemLogisticsGeneration,
  type SystemLogisticsState,
  type RouteCost,
  type ReachableSystemIds,
  type PlannedTransfer,
} from "@/lib/engine/directed-logistics";
import { toGoodMarketStates, type DrawBrakeCeiling } from "@/lib/tick/processors/good-market-state";
import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  MarketRowForLogistics,
  LogisticsMarketUpdate,
  LogisticsFlowInsert,
  LogisticsFundingBoundUpdate,
  DemandUnservableUpdate,
} from "@/lib/tick/world/directed-logistics-world";

export interface DirectedLogisticsProcessorParams {
  interval: number;
  /** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
  routeCost: RouteCost;
  /** Enumerates only the bounded route neighbourhood; avoids all-faction scans after exhaustion. */
  reachableSystemIds: ReachableSystemIds;
  /** Latched funded.logistics per faction (0–1) — scales the haul budget. Missing
   *  faction or omitted map → 1 (ungated: engine tests, independents). */
  fundingByFaction?: ReadonlyMap<string, number>;
  /** Harness-only third-arm pin for the draw figure's brake (see `DrawBrakeCeiling`);
   *  absent ⇒ "live", the only value the live game ever passes. */
  drawBrakeCeiling?: DrawBrakeCeiling;
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
  drawBrakeCeiling?: DrawBrakeCeiling,
): SystemLogisticsState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    generation: systemLogisticsGeneration(row.population) * catchUp * funded,
    // The matcher is the draw figure's only reader, so this is the one call site that computes it.
    goods: toGoodMarketStates(row, { withDraw: true, drawBrakeCeiling }),
  };
}

/**
 * Pure processor body. Cycle resolution: on the boundary tick
 * (`tick % interval === 0`) every faction is matched at once via `cycleStartShard`;
 * every other tick is a no-op. Matched volume is moved silently (stock deltas +
 * logistics flow rows).
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
  const allTransfers: PlannedTransfer[] = [];
  const fundingBoundMarketIds = new Set<string>();
  // Market id → the unclosed deficit's own shortfall level. Presence in this map IS the
  // demand-unservable classification — a Set<string> would lose the level the world layer needs to
  // persist alongside the bit, so this map is the single source for both.
  const demandUnservableShortfallByMarketId = new Map<string, number>();
  for (const [factionId, group] of byFaction) {
    const funded = factionId === null ? 1 : params.fundingByFaction?.get(factionId) ?? 1;
    const states = group.map((r) => toLogisticsState(r, catchUp, funded, params.drawBrakeCeiling));
    const match = matchFactionTransfers(states, params.routeCost, params.reachableSystemIds);
    allTransfers.push(...match.transfers);
    for (const bound of match.fundingBound) {
      const from = marketByKey.get(`${bound.fromSystemId}|${bound.goodId}`);
      const to = marketByKey.get(`${bound.toSystemId}|${bound.goodId}`);
      if (from) fundingBoundMarketIds.add(from.id);
      if (to) fundingBoundMarketIds.add(to.id);
    }
    // Deficit endpoint only — never the donor a funding-bound match above may also have named.
    for (const deficit of match.unservable) {
      const at = marketByKey.get(`${deficit.systemId}|${deficit.goodId}`);
      if (at) demandUnservableShortfallByMarketId.set(at.id, deficit.shortfall);
    }
    if (factionId === null) continue;
    // Spent is summed over per-donor draws, so a fan-out is billed once — it must stay equal
    // to the treasury's work figure, never a per-flow-row recount.
    let work = 0;
    for (const t of match.transfers) work += t.cost;
    if (work > 0) workPerformedByFaction.set(factionId, work);
    let total = 0;
    for (const s of states) total += s.generation;
    logisticsBudget.set(factionId, {
      total,
      spent: work,
      fundingBoundCount: match.fundingBound.length,
    });
  }

  // Apply: clamp both endpoints, accumulate absolute writes, record flow rows.
  const updates = new Map<string, number>();
  const flows: LogisticsFlowInsert[] = [];

  for (const t of allTransfers) {
    // Stock is a continuous float balance — do NOT quantize the transfer. Flooring here
    // would re-break the goods-side scale-invariance the engine matcher preserves (losing
    // up to one unit per transfer, a large fraction at low ECONOMY_SCALE, negligible high).
    const qty = t.quantity;
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const from = marketByKey.get(`${t.fromSystemId}|${t.goodId}`);
    const to = marketByKey.get(`${t.toSystemId}|${t.goodId}`);
    if (!from || !to) continue;

    const fromCur = updates.get(from.id) ?? from.stock;
    const toCur = updates.get(to.id) ?? to.stock;
    // The matcher already applies the donor's policy reserve (strategic exporters may
    // draw below their anchor). This is only physical belt-and-braces against same-cycle
    // concurrent writes, so its floor remains zero.
    const moved = Math.min(
      qty,
      Math.max(0, fromCur),
      Math.max(0, to.max - toCur),
    );
    if (moved <= 0) continue;

    updates.set(from.id, fromCur - moved);
    updates.set(to.id, toCur + moved);

    // t.goodId is already the good KEY — write it directly, matching trade-flow convention.
    flows.push({
      tick: ctx.tick,
      fromSystemId: t.fromSystemId,
      toSystemId: t.toSystemId,
      goodId: t.goodId,
      quantity: moved,
    });
  }

  if (updates.size > 0) {
    const marketUpdates: LogisticsMarketUpdate[] = [...updates.entries()].map(
      ([id, stock]) => ({ id, stock }),
    );
    await world.applyMarketUpdates(marketUpdates);
  }
  const fundingUpdates: LogisticsFundingBoundUpdate[] = [];
  for (const row of rows) {
    for (const market of row.markets) {
      const logisticsFundingBound = fundingBoundMarketIds.has(market.id);
      if ((market.logisticsFundingBound ?? false) === logisticsFundingBound) continue;
      fundingUpdates.push({
        id: market.id,
        logisticsFundingBound,
      });
    }
  }
  if (fundingUpdates.length > 0) await world.applyFundingBoundUpdates(fundingUpdates);
  const demandUnservableUpdates: DemandUnservableUpdate[] = [];
  for (const row of rows) {
    for (const market of row.markets) {
      const unservedShortfall = demandUnservableShortfallByMarketId.get(market.id);
      const demandUnservable = unservedShortfall !== undefined;
      // Written together, from the same read of this run's classification, so the bit and the level
      // can never diverge: a market whose ONLY change this run is the shortfall widening/narrowing
      // (the bit stays true either way) still emits an update, which is why the shortfall — not just
      // the bit — is part of the skip condition below.
      if ((market.demandUnservable ?? false) === demandUnservable && market.unservedShortfall === unservedShortfall) {
        continue;
      }
      demandUnservableUpdates.push({
        id: market.id,
        demandUnservable,
        unservedShortfall,
      });
    }
  }
  if (demandUnservableUpdates.length > 0) await world.applyDemandUnservableUpdates(demandUnservableUpdates);
  if (flows.length > 0) await world.appendLogisticsFlows(flows);

  return { workPerformedByFaction, logisticsBudget };
}
