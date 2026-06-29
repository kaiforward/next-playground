"use client";

import { Clock } from "lucide-react";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { useSystemCadence } from "@/lib/hooks/use-system-cadence";
import { ticksUntilShard } from "@/lib/tick/shard";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

function label(ticks: number): string {
  return ticks === 0 ? "now" : `${ticks}t`;
}

/**
 * Compact "next update in N ticks" countdowns for the two player-meaningful system
 * cadences, shown in the system-panel header beside the title. Pure clock math off
 * the live tick + the system's static shard groups — counts down without refetching.
 *  - Economy (~{ECONOMY_UPDATE_INTERVAL}t): this system's market / production / consumption refresh.
 *  - Logistics (~{DIRECTED_LOGISTICS.INTERVAL}t): this faction's surplus→deficit redistribution + build.
 */
export function SystemCadenceCountdown({ systemId }: { systemId: string }) {
  const cadence = useSystemCadence(systemId);
  const { currentTick } = useTickContext();
  if (!cadence) return null;

  const economy = ticksUntilShard(cadence.economyShardGroup, currentTick, ECONOMY_UPDATE_INTERVAL);
  const logistics = ticksUntilShard(cadence.logisticsShardGroup, currentTick, DIRECTED_LOGISTICS.INTERVAL);

  return (
    <div className="hidden items-center gap-2.5 font-mono text-xs text-text-tertiary sm:flex">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span title="Next economy update — this system's markets, production & consumption refresh">
        <span className="text-text-secondary">economy</span> <span className="text-accent">{label(economy)}</span>
      </span>
      <span className="text-border" aria-hidden>·</span>
      <span title="Next logistics sweep — this faction redistributes its surplus to deficits and builds">
        <span className="text-text-secondary">logistics</span> <span className="text-accent">{label(logistics)}</span>
      </span>
    </div>
  );
}
