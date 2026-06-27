import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { PrismaDirectedLogisticsWorld } from "@/lib/tick/adapters/prisma/directed-logistics";
import { loadHopDistances } from "@/lib/services/hop-distances";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { shardRange, catchUpFactor } from "@/lib/tick/shard";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import {
  matchFactionTransfers,
  splitContractTransfers,
  systemLogisticsGeneration,
  type SystemLogisticsState,
  type RouteCost,
} from "@/lib/engine/directed-logistics";
import { calculateReward } from "@/lib/engine/missions";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  MarketRowForLogistics,
  LogisticsMarketUpdate,
  LogisticsFlowInsert,
  LogisticsContractCreate,
} from "@/lib/tick/world/directed-logistics-world";

/**
 * Reward + deadline for a candidate Contract; null = skip (e.g. unroutable). Injected so the body
 * stays free of hop-distance / reward specifics — the live wiring builds it from the cached hop map +
 * the pure calculateReward; the simulator and unit tests pass a stub.
 */
export type LogisticsContractTerms = (input: {
  goodId: string;
  quantity: number;
  fromSystemId: string;
  toSystemId: string;
}) => { reward: number; deadlineTick: number } | null;

export interface DirectedLogisticsProcessorParams {
  interval: number;
  /** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
  routeCost: RouteCost;
  /** Top-K transfers per faction exposed as player Contracts; 0 = all silent (the simulator). */
  contractCount: number;
  /** Reward/deadline for a candidate Contract. */
  contractTerms: LogisticsContractTerms;
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
 * `interval` ticks. Two phases run on the due shard:
 *   1. Resolve this shard's expired UNCLAIMED Contracts — the faction hauls them
 *      itself (an unfilled Contract still does real work), mutating stock first.
 *   2. Match each faction's surplus→deficit on the POST-resolve stock, then split
 *      into a top-K most-valuable slice exposed as player Contracts (no stock move
 *      at creation) and a silent remainder moved here (stock deltas + flow rows).
 * The catch-up factor scales moved volume to wall-clock at any interval.
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

  const catchUp = catchUpFactor(params.interval);

  // Market lookup by (systemId|goodId): id + band floor/ceiling for clamping.
  type MarketEntry = MarketRowForLogistics & { systemId: string; min: number; max: number };
  const marketByKey = new Map<string, MarketEntry>();
  for (const r of rows) {
    for (const m of r.markets) {
      const band = marketBandForRow(m, m);
      marketByKey.set(`${r.systemId}|${m.goodId}`, {
        ...m, systemId: r.systemId, min: band.minStock, max: band.maxStock,
      });
    }
  }

  const updates = new Map<string, number>();
  const flows: LogisticsFlowInsert[] = [];

  // Move `qty` of `goodId` from→to, clamped against current (post-prior-write) stock and the
  // band floor/ceiling. Composes successive moves via `updates`. Returns the amount actually moved.
  const applyHaul = (
    goodId: string, fromSystemId: string, toSystemId: string, qty: number,
  ): number => {
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    const from = marketByKey.get(`${fromSystemId}|${goodId}`);
    const to = marketByKey.get(`${toSystemId}|${goodId}`);
    if (!from || !to) return 0;
    const fromCur = updates.get(from.id) ?? from.stock;
    const toCur = updates.get(to.id) ?? to.stock;
    const moved = Math.min(qty, Math.max(0, fromCur - from.min), Math.max(0, to.max - toCur));
    if (moved <= 0) return 0;
    updates.set(from.id, fromCur - moved);
    updates.set(to.id, toCur + moved);
    flows.push({ tick: ctx.tick, fromSystemId, toSystemId, goodId, quantity: moved });
    return moved;
  };

  // 1. Resolve this shard's expired UNCLAIMED Contracts — the faction hauls them itself (an unfilled
  //    Contract still does real work). A severed route (routeCost null) drops the haul but still closes.
  const expired = await world.takeExpiredLogisticsContracts(ctx.tick, dueKeys);
  const closeIds: string[] = [];
  for (const ec of expired) {
    if (params.routeCost(ec.fromSystemId, ec.toSystemId) !== null) {
      applyHaul(ec.goodId, ec.fromSystemId, ec.toSystemId, ec.quantity);
    }
    closeIds.push(ec.id);
  }

  // 2. Match per faction on POST-resolve stock (a just-filled deficit is no longer a sink), then split.
  const byFaction = new Map<string | null, SystemLogisticsRow[]>();
  for (const r of rows) {
    const list = byFaction.get(r.factionId) ?? [];
    list.push(r);
    byFaction.set(r.factionId, list);
  }

  const contractCreates: LogisticsContractCreate[] = [];
  for (const [factionKey, group] of byFaction) {
    const adjusted = group.map((r) => ({
      ...r,
      markets: r.markets.map((m) => ({ ...m, stock: updates.get(m.id) ?? m.stock })),
    }));
    const transfers = matchFactionTransfers(adjusted.map(toLogisticsState), params.routeCost);
    const { contracts, silent } = splitContractTransfers(transfers, params.contractCount);

    for (const t of silent) {
      applyHaul(t.goodId, t.fromSystemId, t.toSystemId, Math.floor(t.quantity * catchUp));
    }
    for (const t of contracts) {
      const qty = Math.floor(t.quantity * catchUp);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const terms = params.contractTerms({
        goodId: t.goodId, quantity: qty, fromSystemId: t.fromSystemId, toSystemId: t.toSystemId,
      });
      if (!terms) continue;
      contractCreates.push({
        fromSystemId: t.fromSystemId,
        toSystemId: t.toSystemId,
        goodId: t.goodId,
        quantity: qty,
        reward: terms.reward,
        deadlineTick: terms.deadlineTick,
        factionId: factionKey,
        createdAtTick: ctx.tick,
      });
    }
  }

  // 3. Persist.
  if (updates.size > 0) {
    const marketUpdates: LogisticsMarketUpdate[] = [...updates.entries()].map(
      ([id, stock]) => ({ id, stock }),
    );
    await world.applyMarketUpdates(marketUpdates);
  }
  if (flows.length > 0) await world.appendLogisticsFlows(flows);
  if (contractCreates.length > 0) await world.createLogisticsContracts(contractCreates);
  if (closeIds.length > 0) await world.closeLogisticsContracts(closeIds);

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
    const contractTerms: LogisticsContractTerms = ({ goodId, quantity, fromSystemId, toSystemId }) => {
      const h = hops.get(fromSystemId)?.get(toSystemId);
      if (h === undefined) return null;
      const tier = GOOD_TIER_BY_KEY[goodId] ?? 0;
      return {
        reward: calculateReward(quantity, h, tier, false),
        deadlineTick: ctx.tick + DIRECTED_LOGISTICS.CONTRACT_DEADLINE_TICKS,
      };
    };
    return runDirectedLogisticsProcessor(world, ctx, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost,
      contractCount: DIRECTED_LOGISTICS.CONTRACTS_PER_CYCLE,
      contractTerms,
    });
  },
};
