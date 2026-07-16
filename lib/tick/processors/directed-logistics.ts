import type { TickContext, TickProcessorResult } from "../types";
import { pulseShard } from "@/lib/tick/shard";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { GOODS } from "@/lib/constants/goods";
import {
  matchFactionTransfers,
  systemLogisticsGeneration,
  type SystemLogisticsState,
  type RouteCost,
} from "@/lib/engine/directed-logistics";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  MarketRowForLogistics,
  LogisticsMarketUpdate,
  LogisticsFlowInsert,
} from "@/lib/tick/world/directed-logistics-world";

export interface DirectedLogisticsProcessorParams {
  interval: number;
  /** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
  routeCost: RouteCost;
}

/** Build the engine's per-system state from raw rows: generation + per-good band + total demand. */
function toLogisticsState(row: SystemLogisticsRow): SystemLogisticsState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    generation: systemLogisticsGeneration(row.population),
    goods: toGoodMarketStates(row),
  };
}

/**
 * Pure processor body. Monthly resolution pulse: on the boundary tick
 * (`tick % interval === 0`) every faction is matched at once via `pulseShard`;
 * every other tick is a no-op. Matched volume is moved silently (stock deltas +
 * logistics flow rows).
 *
 * No catch-up scaling: unlike trade-flow (a per-tick *rate* that must scale with
 * the shard interval), a logistics transfer is an absolute *level-fill* toward the
 * days-of-supply anchor (shortfall = targetStock − stock). Multiplying a gap-fill
 * by the interval ratio overshoots the anchor — scaling deliveries by the interval
 * pushes recipients past the surplus margin (≈2× anchor), which both wastes hauls
 * and flips fresh recipients into donors / cheap re-export targets. The anchor
 * (40 economy-runs of cover) already vastly exceeds one month's draw, so a single
 * fill-to-anchor over-provisions on its own.
 */
export async function runDirectedLogisticsProcessor(
  world: DirectedLogisticsWorld,
  ctx: Pick<TickContext, "tick">,
  params: DirectedLogisticsProcessorParams,
): Promise<TickProcessorResult> {
  const factionKeys = await world.getFactionShardKeys();
  if (factionKeys.length === 0) return {};

  const { start, end } = pulseShard(factionKeys.length, ctx.tick, params.interval);
  const dueKeys = factionKeys.slice(start, end);
  if (dueKeys.length === 0) return {};

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
  type MarketEntry = MarketRowForLogistics & { systemId: string; min: number; max: number };
  const marketByKey = new Map<string, MarketEntry>();
  for (const r of rows) {
    for (const m of r.markets) {
      const band = marketBandForRow(m, GOODS[m.goodId]);
      marketByKey.set(`${r.systemId}|${m.goodId}`, {
        ...m,
        systemId: r.systemId,
        min: band.minStock,
        max: band.maxStock,
      });
    }
  }

  const allTransfers = [...byFaction.values()].flatMap((group) =>
    matchFactionTransfers(group.map(toLogisticsState), params.routeCost),
  );

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
    const moved = Math.min(
      qty,
      Math.max(0, fromCur - from.min),
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
  if (flows.length > 0) await world.appendLogisticsFlows(flows);

  return {};
}
