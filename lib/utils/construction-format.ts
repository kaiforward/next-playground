import { CONSTRUCTION_INTERVAL } from "@/lib/constants/tick-cadence";
import { formatDuration } from "./calendar";

/**
 * ETA label for a construction or colony row, as an in-world duration. `etaCycles` counts
 * construction-funding cycles (`CONSTRUCTION_INTERVAL` ticks each — see
 * `lib/engine/construction-readout.ts`), so the conversion goes through that interval, never
 * `CYCLE_LENGTH`. `null` = the funding guard tripped (stalled).
 */
export function formatEta(etaCycles: number | null): string {
  if (etaCycles === null) return "stalled";
  return formatDuration(etaCycles * CONSTRUCTION_INTERVAL);
}
