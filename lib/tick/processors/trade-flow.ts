import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
} from "../types";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import {
  ECONOMY_CONSTANTS,
  PROSPERITY_TARGET_VOLUME,
} from "@/lib/constants/economy";
import { PrismaTradeFlowWorld } from "@/lib/tick/adapters/prisma/trade-flow";
import type {
  FlowEventInsert,
  MarketSnapshot,
  MarketUpdate,
  TradeFlowProcessorParams,
  TradeFlowWorld,
  VolumeIncrement,
} from "@/lib/tick/world/trade-flow-world";

const DEBUG = process.env.DEBUG_TRADE_FLOW === "1";

/**
 * Tracks whether the invariant warning has fired this process so the log
 * stays a single line. The invariant: `regions × PROCESS_EVERY_N_TICKS <
 * FLOW_HISTORY_TICKS`. If it fails, the round-robin can't refill a region's
 * data before pruning evicts it, so the overlay shows permanent gaps.
 */
let invariantWarned = false;

/**
 * Pure processor body. Same logic runs against the Prisma adapter (live game)
 * or the in-memory adapter (simulator + unit tests).
 *
 * Gating is internal so live and sim share the same cadence rules:
 *   - Skip non-active ticks (`tick % processEveryNTicks !== 0`).
 *   - On active ticks, pick exactly one region via floor(tick / N) % regions.length.
 *     The floor form avoids GCD pathologies where (tick % N) and (tick % R) lock
 *     out regions for any pairing of N and R that share a common factor.
 */
export async function runTradeFlowProcessor(
  world: TradeFlowWorld,
  ctx: TickContext,
  params: TradeFlowProcessorParams,
): Promise<TickProcessorResult> {
  if (ctx.tick % params.processEveryNTicks !== 0) {
    return {};
  }

  const regions = await world.getRegions();
  if (regions.length === 0) return {};

  if (
    !invariantWarned &&
    regions.length * params.processEveryNTicks >= params.flowHistoryTicks
  ) {
    invariantWarned = true;
    console.warn(
      `[tradeFlow] INVARIANT: regions (${regions.length}) × PROCESS_EVERY_N_TICKS (${params.processEveryNTicks}) = ${regions.length * params.processEveryNTicks} ≥ FLOW_HISTORY_TICKS (${params.flowHistoryTicks}). ` +
        `Each region's events will be pruned before the round-robin returns — overlay will show permanent gaps. ` +
        `Either lower PROCESS_EVERY_N_TICKS or raise FLOW_HISTORY_TICKS.`,
    );
  }

  const regionIndex =
    Math.floor(ctx.tick / params.processEveryNTicks) % regions.length;
  const targetRegion = regions[regionIndex];

  const edges = await world.getEdgesForRegion(targetRegion.id);
  if (edges.length === 0) {
    await world.pruneFlowEvents(ctx.tick - params.flowHistoryTicks);
    return {};
  }

  const snapshots = await world.getMarketSnapshotsForRegion(targetRegion.id);

  // Index by composite key for direct lookup, and by system for common-goods enumeration.
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

  const playerVolume = await world.getRecentPlayerVolume(targetRegion.id);
  const playerPressure =
    params.prosperityTargetVolume > 0
      ? playerVolume / params.prosperityTargetVolume
      : 0;
  const displacement = Math.max(
    0,
    Math.min(1, playerPressure * params.playerDisplacementFactor),
  );
  const effectiveBudget = params.flowBudget * (1 - displacement);

  // Below 1 unit nothing can flow this run — still prune so the rolling window stays bounded.
  if (effectiveBudget < 1) {
    await world.pruneFlowEvents(ctx.tick - params.flowHistoryTicks);
    if (DEBUG) {
      console.log(
        `[tradeFlow] Region "${targetRegion.name}": displaced by player pressure (volume=${playerVolume}); no flow`,
      );
    }
    return {};
  }

  const flowEvents: FlowEventInsert[] = [];
  const updatesByMarketId = new Map<string, MarketUpdate>();
  const volumeBySystem = new Map<string, number>();

  for (const edge of edges) {
    const goodsA = goodsBySystem.get(edge.aSystemId);
    const goodsB = goodsBySystem.get(edge.bSystemId);
    if (!goodsA || !goodsB) continue;

    // Steepest gradient wins per edge per run.
    let bestGoodId: string | null = null;
    let bestGradient = 0;

    for (const goodId of goodsA) {
      if (!goodsB.has(goodId)) continue;
      const mA = marketByKey.get(`${edge.aSystemId}|${goodId}`);
      const mB = marketByKey.get(`${edge.bSystemId}|${goodId}`);
      if (!mA || !mB || mA.basePrice <= 0) continue;

      const priceA = spotPrice(
        curveForGood(goodId, mA.basePrice, mA.priceFloor, mA.priceCeiling, mA.anchorMult),
        mA.stock,
      );
      const priceB = spotPrice(
        curveForGood(goodId, mB.basePrice, mB.priceFloor, mB.priceCeiling, mB.anchorMult),
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

    const fromSystemId =
      bestGradient > 0 ? edge.aSystemId : edge.bSystemId;
    const toSystemId = bestGradient > 0 ? edge.bSystemId : edge.aSystemId;
    const mFrom = marketByKey.get(`${fromSystemId}|${bestGoodId}`);
    const mTo = marketByKey.get(`${toSystemId}|${bestGoodId}`);
    if (!mFrom || !mTo) continue;

    const stockHeadroom = Math.max(0, mFrom.stock - params.minLevel);
    const stockCapacity = Math.max(0, params.maxLevel - mTo.stock);
    const gradientFraction = Math.min(
      1,
      Math.abs(bestGradient) * params.gradientSensitivity,
    );
    const rawQty =
      Math.min(effectiveBudget, stockHeadroom, stockCapacity) * gradientFraction;
    const quantity = Math.floor(rawQty);
    if (quantity <= 0) continue;

    // Source mirrors a player buy at the cheaper end; destination a sell at the dearer end.
    const newFromStock = clamp(mFrom.stock - quantity, params.minLevel, params.maxLevel);
    const newToStock = clamp(mTo.stock + quantity, params.minLevel, params.maxLevel);

    // Mutate the in-flight snapshot so later edges see fresh state.
    mFrom.stock = newFromStock;
    mTo.stock = newToStock;

    updatesByMarketId.set(mFrom.id, { id: mFrom.id, stock: newFromStock });
    updatesByMarketId.set(mTo.id, { id: mTo.id, stock: newToStock });

    volumeBySystem.set(
      fromSystemId,
      (volumeBySystem.get(fromSystemId) ?? 0) + quantity,
    );
    volumeBySystem.set(
      toSystemId,
      (volumeBySystem.get(toSystemId) ?? 0) + quantity,
    );

    flowEvents.push({
      tick: ctx.tick,
      fromSystemId,
      toSystemId,
      goodId: bestGoodId,
      quantity,
    });
  }

  if (updatesByMarketId.size > 0) {
    await world.applyMarketUpdates([...updatesByMarketId.values()]);
  }
  if (volumeBySystem.size > 0) {
    const increments: VolumeIncrement[] = [];
    for (const [systemId, amount] of volumeBySystem) {
      increments.push({ systemId, amount });
    }
    await world.applyVolumeIncrements(increments);
  }
  if (flowEvents.length > 0) {
    await world.appendFlowEvents(flowEvents);
  }
  await world.pruneFlowEvents(ctx.tick - params.flowHistoryTicks);

  if (DEBUG) {
    console.log(
      `[tradeFlow] Region "${targetRegion.name}" (${regionIndex + 1}/${regions.length}): ${edges.length} edges, ${flowEvents.length} flow(s)`,
    );
  }

  return {};
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Live-game wiring ──────────────────────────────────────────────

export const tradeFlowProcessor: TickProcessor = {
  name: "tradeFlow",
  // Runs every tick; internal gating handles the every-N-ticks cadence so
  // live and sim observe identical scheduling rules.
  frequency: 1,
  dependsOn: ["economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaTradeFlowWorld(ctx.tx);
    return runTradeFlowProcessor(world, ctx, {
      processEveryNTicks: TRADE_SIMULATION.PROCESS_EVERY_N_TICKS,
      flowBudget: TRADE_SIMULATION.FLOW_BUDGET,
      gradientThreshold: TRADE_SIMULATION.GRADIENT_THRESHOLD,
      gradientSensitivity: TRADE_SIMULATION.GRADIENT_SENSITIVITY,
      flowHistoryTicks: TRADE_SIMULATION.FLOW_HISTORY_TICKS,
      playerDisplacementFactor: TRADE_SIMULATION.PLAYER_DISPLACEMENT_FACTOR,
      prosperityTargetVolume: PROSPERITY_TARGET_VOLUME,
      minLevel: ECONOMY_CONSTANTS.MIN_LEVEL,
      maxLevel: ECONOMY_CONSTANTS.MAX_LEVEL,
    });
  },
};
