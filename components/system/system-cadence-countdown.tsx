"use client";

import { Clock } from "lucide-react";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { useSystemCadence } from "@/lib/hooks/use-system-cadence";
import { ticksUntilShard } from "@/lib/tick/shard";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";

function label(ticks: number): string {
  return ticks === 0 ? "now" : `${ticks}t`;
}

/**
 * Compact "next update in N ticks" countdown for the system panel header. Under
 * the monthly resolution pulse the whole galaxy — every system's economy,
 * population and infrastructure plus its faction's logistics and build — resolves
 * together on the month boundary, so it is one countdown. Pure clock math off the
 * live tick; no refetch.
 */
export function SystemCadenceCountdown({ systemId }: { systemId: string }) {
  const cadence = useSystemCadence(systemId);
  const { currentTick } = useTickContext();
  if (!cadence) return null;

  const next = ticksUntilShard(cadence.pulseGroup, currentTick, MONTH_LENGTH);

  return (
    <div className="hidden items-center gap-2.5 font-mono text-xs text-text-tertiary sm:flex">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span title="Next monthly update — the whole galaxy resolves for the month (economy, population, logistics & construction)">
        <span className="text-text-secondary">next update</span> <span className="text-accent">{label(next)}</span>
      </span>
    </div>
  );
}
