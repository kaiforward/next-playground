/** Coarse ETA label for a construction row. `null` = the funding guard tripped (stalled). */
export function formatEta(etaPulses: number | null): string {
  if (etaPulses === null) return "stalled";
  return `≈${etaPulses} pulse${etaPulses === 1 ? "" : "s"}`;
}
