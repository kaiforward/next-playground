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
import type { SystemControl, WorldFlowEvent } from "@/lib/world/types";
import type { LogisticsActivitySummary } from "./types";

/**
 * Ticks below which a run's logistics counters read as colonisation warm-up, not economy health.
 * Directed-logistics moves nothing until a faction has two same-faction developed systems within
 * MAX_HOPS, which is colonisation-paced: at the default system count / seed nothing transfers before
 * ~tick 456, so a sub-window run reports a pre-logistics galaxy — one of the three economy pillars
 * essentially outside its window. Measured at 600 systems / seed 42: 500 ticks → 30 transfers over
 * 2 cycles; 1500 ticks → 14,200 over 44. This is a legibility bound, not a correctness one — below it,
 * low activity means "too early", not "broken" (which the block's own NOTHING-MOVED line still flags).
 */
export const LOGISTICS_WARMUP_TICKS = 600;

/** Haul-budget ledger totals, accumulated by the runner from `LOGISTICS_WARMUP_TICKS` onward —
 *  before that, budget is granted every cycle while nothing can transfer (see the constant's
 *  docstring), and the warm-up grants would only dilute the spend fraction's denominator.
 *  Faction-owned groups only; independents haul but are not ledgered. */
export interface LogisticsBudgetTotals {
  /** Σ budget granted (post catch-up and funding). */
  total: number;
  /** Σ transfer cost actually paid. */
  spent: number;
  /** Deficits recorded funding-bound. */
  fundingBoundEvents: number;
}

/** Funding-bound flag census over developed-system markets in the final world. */
export interface FundingBoundFlagCensus {
  flagged: number;
  marketCount: number;
}

/**
 * Count the funding-bound flags over developed-system markets only — undeveloped systems never
 * enter the logistics assessment, so counting them would dilute the rate. An absent flag reads
 * unflagged, never flagged.
 */
export function fundingBoundCensus(
  systems: ReadonlyArray<{ id: string; control: SystemControl }>,
  markets: ReadonlyArray<{ systemId: string; logisticsFundingBound?: boolean }>,
): FundingBoundFlagCensus {
  const developedIds = new Set(
    systems.filter((s) => s.control === "developed").map((s) => s.id),
  );
  const developedMarkets = markets.filter((m) => developedIds.has(m.systemId));
  return {
    flagged: developedMarkets.filter((m) => m.logisticsFundingBound ?? false).length,
    marketCount: developedMarkets.length,
  };
}

export function summarizeLogistics(
  flows: WorldFlowEvent[],
  budget: LogisticsBudgetTotals,
  flags: FundingBoundFlagCensus,
): LogisticsActivitySummary {
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
    // Finite-and-positive, not just non-zero: a poisoned accumulator must also report 0, per
    // the NaN contract above — for a merge-gate metric, "not measured" must never look "healthy".
    budgetSpentFrac:
      Number.isFinite(budget.total) && budget.total > 0 ? budget.spent / budget.total : 0,
    fundingBoundEvents: budget.fundingBoundEvents,
    fundingBoundFlaggedMarkets: flags.flagged,
    fundingBoundMarketCount: flags.marketCount,
    fundingBoundFlagSetRate:
      Number.isFinite(flags.marketCount) && flags.marketCount > 0
        ? flags.flagged / flags.marketCount
        : 0,
    flowRowsPerCycle: activeTicks.size === 0 ? 0 : flows.length / activeTicks.size,
  };
}
