/**
 * Metrics tracking and summary computation for simulator bots.
 */

import type { TickMetrics, PlayerSummary, SimPlayer } from "./types";

/** Record metrics for a single tick. */
export function recordTickMetrics(
  player: SimPlayer,
  tick: number,
  tradeCount: number,
  tradeProfitSum: number,
  fuelSpent: number,
): TickMetrics {
  return {
    tick,
    credits: player.credits,
    tradeCount,
    tradeProfitSum,
    fuelSpent,
  };
}

/** Compute a player summary from their full metrics history. */
export function computeSummary(
  player: SimPlayer,
  metrics: TickMetrics[],
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
  };
}
