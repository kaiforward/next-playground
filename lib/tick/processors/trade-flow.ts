import type { TickContext, TickProcessorResult } from "../types";
import { spotPrice, curveForGood, marketBandForRow } from "@/lib/engine/market-pricing";
import { shardRange, catchUpFactor } from "@/lib/tick/shard";
import type {
  EdgeView, FlowEventInsert, MarketSnapshot, MarketUpdate,
  TradeFlowProcessorParams, TradeFlowWorld,
} from "@/lib/tick/world/trade-flow-world";

let invariantWarned = false;

/**
 * Pure processor body. Same logic runs against the Prisma adapter (live game)
 * or the in-memory adapter (simulator + unit tests).
 *
 * Topology: flow only crosses OPEN edges (both endpoints share a faction; two
 * independents trade via null===null). Cross-faction edges are excluded by the
 * adapter's getOpenEdges(). Scheduling: a fixed-interval shard over the stable
 * edge order — every edge sweeps once per `interval` ticks at any scale, sharing
 * one clock with the economy. The per-edge moved amount is scaled by
 * `catchUpFactor(interval)` so the wall-clock flow rate is interval-invariant.
 */
export async function runTradeFlowProcessor(
  world: TradeFlowWorld,
  ctx: TickContext,
  params: TradeFlowProcessorParams,
): Promise<TickProcessorResult> {
  const edges = await world.getOpenEdges();
  if (edges.length === 0) return {};

  const total = edges.length;
  if (!invariantWarned && params.interval >= params.flowHistoryTicks) {
    invariantWarned = true;
    console.warn(
      `[tradeFlow] INVARIANT: sweep (${params.interval} ticks) ≥ FLOW_HISTORY_TICKS (${params.flowHistoryTicks}). ` +
        `Flow events prune before the sweep returns — overlay will show gaps. Lower the update interval or raise FLOW_HISTORY_TICKS.`,
    );
  }

  // Fixed-interval edge shard: a contiguous window of the stable edge order.
  const { start, end } = shardRange(total, ctx.tick, params.interval);
  const slice: EdgeView[] = edges.slice(start, end);
  if (slice.length === 0) {
    await world.pruneFlowEvents(ctx.tick - params.flowHistoryTicks);
    return {};
  }
  const catchUp = catchUpFactor(params.interval);

  const systemIds = new Set<string>();
  for (const e of slice) {
    systemIds.add(e.aSystemId);
    systemIds.add(e.bSystemId);
  }
  const sliceSystems = [...systemIds];

  const snapshots = await world.getMarketSnapshotsForSystems(sliceSystems);
  const marketByKey = new Map<string, MarketSnapshot>();
  const goodsBySystem = new Map<string, Set<string>>();
  for (const s of snapshots) {
    marketByKey.set(`${s.systemId}|${s.goodId}`, s);
    let goods = goodsBySystem.get(s.systemId);
    if (!goods) {
      goods = new Set();
      goodsBySystem.set(s.systemId, goods);
    }
    goods.add(s.goodId);
  }

  const flowEvents: FlowEventInsert[] = [];
  const updatesByMarketId = new Map<string, MarketUpdate>();

  for (const edge of slice) {
    const goodsA = goodsBySystem.get(edge.aSystemId);
    const goodsB = goodsBySystem.get(edge.bSystemId);
    if (!goodsA || !goodsB) continue;

    let bestGoodId: string | null = null;
    let bestGradient = 0;
    for (const goodId of goodsA) {
      if (!goodsB.has(goodId)) continue;
      const mA = marketByKey.get(`${edge.aSystemId}|${goodId}`);
      const mB = marketByKey.get(`${edge.bSystemId}|${goodId}`);
      if (!mA || !mB || mA.basePrice <= 0) continue;
      const priceA = spotPrice(
        curveForGood(mA.basePrice, mA.priceFloor, mA.priceCeiling, mA.demandRate, mA.anchorMult),
        mA.stock,
      );
      const priceB = spotPrice(
        curveForGood(mB.basePrice, mB.priceFloor, mB.priceCeiling, mB.demandRate, mB.anchorMult),
        mB.stock,
      );
      const gradient = (priceB - priceA) / mA.basePrice;
      if (!isFinite(gradient)) continue;
      if (Math.abs(gradient) > Math.abs(bestGradient)) {
        bestGradient = gradient;
        bestGoodId = goodId;
      }
    }
    if (!bestGoodId) continue;
    if (Math.abs(bestGradient) < params.gradientThreshold) continue;

    const fromSystemId = bestGradient > 0 ? edge.aSystemId : edge.bSystemId;
    const toSystemId = bestGradient > 0 ? edge.bSystemId : edge.aSystemId;
    const mFrom = marketByKey.get(`${fromSystemId}|${bestGoodId}`);
    const mTo = marketByKey.get(`${toSystemId}|${bestGoodId}`);
    if (!mFrom || !mTo) continue;

    const edgeBudget = params.flowBudget;
    if (edgeBudget < 1) continue;

    // Distance attenuation (1 when distanceDecay = 0).
    const distanceFactor = 1 / (1 + params.distanceDecay * edge.fuelCost);

    const bandFrom = marketBandForRow(mFrom, mFrom);
    const bandTo = marketBandForRow(mTo, mTo);
    const stockHeadroom = Math.max(0, mFrom.stock - bandFrom.minStock);
    const stockCapacity = Math.max(0, bandTo.maxStock - mTo.stock);
    const gradientFraction = Math.min(1, Math.abs(bestGradient) * params.gradientSensitivity);
    const rawQty =
      Math.min(edgeBudget, stockHeadroom, stockCapacity) * gradientFraction * distanceFactor;
    // Catch-up: one shard run represents `interval / REFERENCE_INTERVAL` reference
    // periods of flow (1 at the reference interval). The band clamps below keep
    // both endpoints inside their bands when a scaled move overshoots.
    const quantity = Math.floor(rawQty * catchUp);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const newFromStock = clamp(mFrom.stock - quantity, bandFrom.minStock, bandFrom.maxStock);
    const newToStock = clamp(mTo.stock + quantity, bandTo.minStock, bandTo.maxStock);
    mFrom.stock = newFromStock;
    mTo.stock = newToStock;
    updatesByMarketId.set(mFrom.id, { id: mFrom.id, stock: newFromStock });
    updatesByMarketId.set(mTo.id, { id: mTo.id, stock: newToStock });
    flowEvents.push({ tick: ctx.tick, fromSystemId, toSystemId, goodId: bestGoodId, quantity, flowType: "market" });
  }

  if (updatesByMarketId.size > 0) {
    await world.applyMarketUpdates([...updatesByMarketId.values()]);
  }
  if (flowEvents.length > 0) {
    await world.appendFlowEvents(flowEvents);
  }
  await world.pruneFlowEvents(ctx.tick - params.flowHistoryTicks);

  return {};
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
