/**
 * Logistics-activity analysis for the calibration harness.
 *
 * Directed-logistics is the pillar the harness drives faithfully and never
 * reports on. Market cover measures whether stock sits where it should, never
 * whether a transfer happened, so a run whose matcher moves nothing reads as
 * healthy in every other metric — which is how a quantization bug that zeroed
 * every transfer for 500 ticks survived review. These counters answer what the
 * rest of the harness cannot: did goods move, how often, how much, and across
 * how many systems.
 *
 * Fed the flows accumulated per tick, not the final world's log: `flowEvents` is
 * pruned to `TRADE_SIMULATION.FLOW_HISTORY_TICKS`, so the end-of-run world holds
 * only the tail of a longer run.
 */
import type { WorldFlowEvent } from "@/lib/world/types";
import type { LogisticsActivitySummary } from "./types";

export function summarizeLogistics(flows: WorldFlowEvent[]): LogisticsActivitySummary {
  const activeTicks = new Set<number>();
  const participants = new Set<string>();
  const byGood = new Map<string, { transferCount: number; quantity: number }>();
  let totalQuantity = 0;

  for (const f of flows) {
    activeTicks.add(f.tick);
    participants.add(f.fromSystemId);
    participants.add(f.toSystemId);
    totalQuantity += f.quantity;

    const good = byGood.get(f.goodId) ?? { transferCount: 0, quantity: 0 };
    good.transferCount += 1;
    good.quantity += f.quantity;
    byGood.set(f.goodId, good);
  }

  return {
    transferCount: flows.length,
    activeTicks: activeTicks.size,
    totalQuantity,
    // A silent run must report 0, not NaN: JSON.stringify renders NaN as null,
    // which reads as "not measured" rather than "measured, and it is broken".
    meanTransferSize: flows.length === 0 ? 0 : totalQuantity / flows.length,
    participatingSystems: participants.size,
    byGood: [...byGood.entries()]
      .map(([goodId, totals]) => ({ goodId, ...totals }))
      .sort((a, b) => b.quantity - a.quantity),
  };
}
