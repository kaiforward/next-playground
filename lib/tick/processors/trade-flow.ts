import type { TickContext, TickProcessor, TickProcessorResult } from "../types";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { ECONOMY_CONSTANTS, PROSPERITY_TARGET_VOLUME } from "@/lib/constants/economy";
import { PrismaTradeFlowWorld } from "@/lib/tick/adapters/prisma/trade-flow";
import type {
  EdgeView, FlowEventInsert, MarketSnapshot, MarketUpdate,
  TradeFlowProcessorParams, TradeFlowWorld, VolumeIncrement,
} from "@/lib/tick/world/trade-flow-world";

let invariantWarned = false;

/**
 * Pure processor body. Same logic runs against the Prisma adapter (live game)
 * or the in-memory adapter (simulator + unit tests).
 *
 * Topology: flow only crosses OPEN edges (both endpoints share a faction; two
 * independents trade via null===null). Cross-faction edges are excluded by the
 * adapter's getOpenEdges(). Scheduling: a work-budget slice of `edgesPerTick`
 * edges per tick, advancing a cursor over the stable edge order, so per-tick
 * DB work is bounded independently of faction-territory size.
 */
export async function runTradeFlowProcessor(
  world: TradeFlowWorld,
  ctx: TickContext,
  params: TradeFlowProcessorParams,
): Promise<TickProcessorResult> {
  const edges = await world.getOpenEdges();
  if (edges.length === 0) return {};

  const total = edges.length;
  const sweepTicks = Math.ceil(total / params.edgesPerTick);
  if (!invariantWarned && sweepTicks >= params.flowHistoryTicks) {
    invariantWarned = true;
    console.warn(
      `[tradeFlow] INVARIANT: sweep (${sweepTicks} ticks = ceil(${total} edges / ${params.edgesPerTick} per tick)) ≥ FLOW_HISTORY_TICKS (${params.flowHistoryTicks}). ` +
        `Flow events prune before the sweep returns — overlay will show gaps. Raise EDGES_PER_TICK or FLOW_HISTORY_TICKS.`,
    );
  }

  // Work-budget slice: consecutive window advancing edgesPerTick per tick, wrapping.
  const count = Math.min(params.edgesPerTick, total);
  const start = (ctx.tick * params.edgesPerTick) % total;
  const slice: EdgeView[] = [];
  for (let i = 0; i < count; i++) slice.push(edges[(start + i) % total]);

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

  const playerVol = await world.getRecentPlayerVolumeBySystem(sliceSystems);

  const flowEvents: FlowEventInsert[] = [];
  const updatesByMarketId = new Map<string, MarketUpdate>();
  const volumeBySystem = new Map<string, number>();

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

    // Per-edge player displacement from endpoint volumes (replaces per-region throttle).
    const edgeVolume =
      (playerVol.get(edge.aSystemId) ?? 0) + (playerVol.get(edge.bSystemId) ?? 0);
    const pressure =
      params.prosperityTargetVolume > 0 ? edgeVolume / params.prosperityTargetVolume : 0;
    const displacement = Math.max(0, Math.min(1, pressure * params.playerDisplacementFactor));
    const edgeBudget = params.flowBudget * (1 - displacement);
    if (edgeBudget < 1) continue;

    // Distance attenuation (1 when distanceDecay = 0).
    const distanceFactor = 1 / (1 + params.distanceDecay * edge.fuelCost);

    const stockHeadroom = Math.max(0, mFrom.stock - params.minLevel);
    const stockCapacity = Math.max(0, params.maxLevel - mTo.stock);
    const gradientFraction = Math.min(1, Math.abs(bestGradient) * params.gradientSensitivity);
    const rawQty =
      Math.min(edgeBudget, stockHeadroom, stockCapacity) * gradientFraction * distanceFactor;
    const quantity = Math.floor(rawQty);
    if (quantity <= 0) continue;

    const newFromStock = clamp(mFrom.stock - quantity, params.minLevel, params.maxLevel);
    const newToStock = clamp(mTo.stock + quantity, params.minLevel, params.maxLevel);
    mFrom.stock = newFromStock;
    mTo.stock = newToStock;
    updatesByMarketId.set(mFrom.id, { id: mFrom.id, stock: newFromStock });
    updatesByMarketId.set(mTo.id, { id: mTo.id, stock: newToStock });
    volumeBySystem.set(fromSystemId, (volumeBySystem.get(fromSystemId) ?? 0) + quantity);
    volumeBySystem.set(toSystemId, (volumeBySystem.get(toSystemId) ?? 0) + quantity);
    flowEvents.push({ tick: ctx.tick, fromSystemId, toSystemId, goodId: bestGoodId, quantity });
  }

  if (updatesByMarketId.size > 0) {
    await world.applyMarketUpdates([...updatesByMarketId.values()]);
  }
  if (volumeBySystem.size > 0) {
    const increments: VolumeIncrement[] = [];
    for (const [systemId, amount] of volumeBySystem) increments.push({ systemId, amount });
    await world.applyVolumeIncrements(increments);
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

// ── Live-game wiring ──────────────────────────────────────────────

export const tradeFlowProcessor: TickProcessor = {
  name: "tradeFlow",
  frequency: 1,
  dependsOn: ["economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaTradeFlowWorld(ctx.tx);
    return runTradeFlowProcessor(world, ctx, {
      edgesPerTick: TRADE_SIMULATION.EDGES_PER_TICK,
      flowBudget: TRADE_SIMULATION.FLOW_BUDGET,
      gradientThreshold: TRADE_SIMULATION.GRADIENT_THRESHOLD,
      gradientSensitivity: TRADE_SIMULATION.GRADIENT_SENSITIVITY,
      flowHistoryTicks: TRADE_SIMULATION.FLOW_HISTORY_TICKS,
      playerDisplacementFactor: TRADE_SIMULATION.PLAYER_DISPLACEMENT_FACTOR,
      prosperityTargetVolume: PROSPERITY_TARGET_VOLUME,
      minLevel: ECONOMY_CONSTANTS.MIN_LEVEL,
      maxLevel: ECONOMY_CONSTANTS.MAX_LEVEL,
      distanceDecay: TRADE_SIMULATION.DISTANCE_DECAY,
    });
  },
};
