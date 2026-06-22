"use client";

import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ticksUntilShard } from "@/lib/tick/shard";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

/**
 * "Per economy cycle · next update in N ticks" — the cadence framing for a
 * system's production/consumption rates. The economy refreshes each system once
 * per {@link ECONOMY_UPDATE_INTERVAL} ticks (its shard), so the displayed rates
 * are per-cycle, not per-tick. The countdown is pure clock math off the live tick
 * and the system's static shard group — it ticks down without refetching.
 */
export function EconomyCycleCaption({ shardGroup }: { shardGroup: number }) {
  const { currentTick } = useTickContext();
  const ticks = ticksUntilShard(shardGroup, currentTick, ECONOMY_UPDATE_INTERVAL);
  const next = ticks === 0 ? "updating now" : `next update in ${ticks} tick${ticks === 1 ? "" : "s"}`;

  return (
    <p className="mb-3 text-xs text-text-tertiary">
      Rates are <span className="text-text-secondary">per economy cycle</span>{" "}
      (~{ECONOMY_UPDATE_INTERVAL} ticks) · <span className="font-mono">{next}</span>
    </p>
  );
}
