/**
 * Metrics tracking and summary computation for simulator bots.
 */

import type {
  TickMetrics,
  PlayerSummary,
  SimPlayer,
  GoodTradeRecord,
  GoodBreakdownEntry,
  GovernmentSellEntry,
} from "./types";

/** Record metrics for a single tick. */
export function recordTickMetrics(
  player: SimPlayer,
  tick: number,
  tradeCount: number,
  tradeProfitSum: number,
  fuelSpent: number,
  goodsTraded: GoodTradeRecord[],
  systemVisited: string | null,
  idle: boolean,
): TickMetrics {
  return {
    tick,
    credits: player.credits,
    tradeCount,
    tradeProfitSum,
    fuelSpent,
    goodsTraded,
    systemVisited,
    idle,
  };
}

/** Aggregate per-good trade records into a breakdown summary. */
function aggregateGoodsBreakdown(metrics: TickMetrics[]): GoodBreakdownEntry[] {
  const map = new Map<string, GoodBreakdownEntry>();

  for (const m of metrics) {
    for (const rec of m.goodsTraded) {
      let entry = map.get(rec.goodId);
      if (!entry) {
        entry = {
          goodId: rec.goodId,
          timesBought: 0,
          timesSold: 0,
          totalQuantityBought: 0,
          totalQuantitySold: 0,
          totalSpent: 0,
          totalRevenue: 0,
          netProfit: 0,
        };
        map.set(rec.goodId, entry);
      }
      if (rec.bought > 0) {
        entry.timesBought++;
        entry.totalQuantityBought += rec.bought;
        entry.totalSpent += rec.buyCost;
      }
      if (rec.sold > 0) {
        entry.timesSold++;
        entry.totalQuantitySold += rec.sold;
        entry.totalRevenue += rec.sellRevenue;
      }
    }
  }

  // Compute net profit
  for (const entry of map.values()) {
    entry.netProfit = entry.totalRevenue - entry.totalSpent;
  }

  return [...map.values()].sort((a, b) => b.netProfit - a.netProfit);
}

/** Compute route diversity stats from system visit history. */
function computeRouteDiversity(
  metrics: TickMetrics[],
  totalSystems: number,
  systemNames: Map<string, string>,
): Pick<PlayerSummary, "uniqueSystemsVisited" | "topSystems" | "explorationRate"> {
  const visitCounts = new Map<string, number>();

  for (const m of metrics) {
    if (m.systemVisited) {
      visitCounts.set(m.systemVisited, (visitCounts.get(m.systemVisited) ?? 0) + 1);
    }
  }

  const uniqueSystemsVisited = visitCounts.size;
  const explorationRate = totalSystems > 0 ? uniqueSystemsVisited / totalSystems : 0;

  const topSystems = [...visitCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([systemId, visits]) => ({
      systemId,
      systemName: systemNames.get(systemId) ?? systemId,
      visits,
    }));

  return { uniqueSystemsVisited, topSystems, explorationRate };
}

/** Aggregate sell trades by destination government type. */
function aggregateGovernmentSellBreakdown(metrics: TickMetrics[]): GovernmentSellEntry[] {
  const map = new Map<string, { totalSold: number; totalRevenue: number }>();

  for (const m of metrics) {
    for (const rec of m.goodsTraded) {
      if (rec.sold > 0 && rec.sellGovernmentType) {
        let entry = map.get(rec.sellGovernmentType);
        if (!entry) {
          entry = { totalSold: 0, totalRevenue: 0 };
          map.set(rec.sellGovernmentType, entry);
        }
        entry.totalSold += rec.sold;
        entry.totalRevenue += rec.sellRevenue;
      }
    }
  }

  return [...map.entries()]
    .map(([governmentType, data]) => ({ governmentType, ...data }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

/** Compute a player summary from their full metrics history. */
export function computeSummary(
  player: SimPlayer,
  metrics: TickMetrics[],
  totalSystems: number,
  systemNames: Map<string, string>,
): PlayerSummary {
  const totalTrades = metrics.reduce((sum, m) => sum + m.tradeCount, 0);
  const totalProfit = metrics.reduce((sum, m) => sum + m.tradeProfitSum, 0);
  const totalFuelSpent = metrics.reduce((sum, m) => sum + m.fuelSpent, 0);
  const creditsCurve = metrics.map((m) => m.credits);

  const finalCredits = metrics.length > 0
    ? metrics[metrics.length - 1].credits
    : player.credits;

  const initialCredits = metrics.length > 0 ? metrics[0].credits : player.credits;
  const tickCount = metrics.length || 1;
  const creditsPerTick = (finalCredits - initialCredits) / tickCount;

  // Find the first tick where credits >= 5000
  const freighterTick = metrics.find((m) => m.credits >= 5000)?.tick ?? null;

  const avgProfitPerTrade = totalTrades > 0 ? totalProfit / totalTrades : 0;
  const profitPerFuel = totalFuelSpent > 0 ? totalProfit / totalFuelSpent : 0;

  const diversity = computeRouteDiversity(metrics, totalSystems, systemNames);

  // Idle analysis — count ticks where bot was docked but found no trade
  const idleTicks = metrics.filter((m) => m.idle).length;
  const dockedTicks = metrics.filter((m) => m.systemVisited !== null).length;
  const idleRate = dockedTicks > 0 ? idleTicks / dockedTicks : 0;

  // Earning rate curve — rolling window average of credits delta per tick
  const WINDOW_SIZE = 50;
  const earningRateCurve = creditsCurve.map((credits, i) => {
    const windowStart = Math.max(0, i - WINDOW_SIZE);
    const delta = credits - creditsCurve[windowStart];
    const windowLen = i - windowStart || 1;
    return delta / windowLen;
  });

  return {
    playerId: player.id,
    playerName: player.name,
    strategy: player.strategy,
    finalCredits,
    totalTrades,
    avgProfitPerTrade,
    creditsPerTick,
    freighterTick,
    totalFuelSpent,
    profitPerFuel,
    creditsCurve,
    goodBreakdown: aggregateGoodsBreakdown(metrics),
    ...diversity,
    idleTicks,
    idleRate,
    earningRateCurve,
    governmentSellBreakdown: aggregateGovernmentSellBreakdown(metrics),
  };
}
