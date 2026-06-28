import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { PrismaDirectedLogisticsWorld } from "@/lib/tick/adapters/prisma/directed-logistics";
import { loadHopDistances } from "@/lib/services/hop-distances";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { shardRange } from "@/lib/tick/shard";
import { marketBandForRow } from "@/lib/engine/market-pricing";
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
 * Pure processor body. PER-FACTION shard: a contiguous window of the stable
 * faction-key order runs each tick, so every faction is matched once per
 * `interval` ticks. Matched volume is moved silently (stock deltas + logistics
 * flow rows).
 *
 * No catch-up scaling: unlike trade-flow (a per-tick *rate* that must scale with
 * the shard interval), a logistics transfer is an absolute *level-fill* toward the
 * days-of-supply anchor (shortfall = targetStock − stock). Multiplying a gap-fill
 * by the interval ratio overshoots the anchor — at INTERVAL = 2× the economy it
 * doubled deliveries, pushing recipients past the surplus margin (≈2× anchor),
 * which both wasted hauls and flipped fresh recipients into donors / cheap
 * re-export targets. The anchor (40 economy-runs of cover) already vastly exceeds
 * one inter-cycle draw, so a single fill-to-anchor over-provisions on its own.
 */
export async function runDirectedLogisticsProcessor(
  world: DirectedLogisticsWorld,
  ctx: Pick<TickContext, "tick">,
  params: DirectedLogisticsProcessorParams,
): Promise<TickProcessorResult> {
  const factionKeys = await world.getFactionShardKeys();
  if (factionKeys.length === 0) return {};

  const { start, end } = shardRange(factionKeys.length, ctx.tick, params.interval);
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
      const band = marketBandForRow(m, m);
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
    const qty = Math.floor(t.quantity);
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

// ── Live-game wiring ──────────────────────────────────────────────

export const directedLogisticsProcessor: TickProcessor = {
  name: "directed-logistics",
  frequency: 1, // per-faction shard handled inside the body
  dependsOn: ["economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaDirectedLogisticsWorld(ctx.tx);
    const hops = await loadHopDistances();
    const routeCost: RouteCost = (fromId, toId) => {
      const h = hops.get(fromId)?.get(toId);
      if (h === undefined || h > DIRECTED_LOGISTICS.MAX_HOPS) return null;
      return h * DIRECTED_LOGISTICS.HOP_WEIGHT;
    };
    return runDirectedLogisticsProcessor(world, ctx, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost,
    });
  },
};
