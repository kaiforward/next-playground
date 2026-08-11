/** Coarse ETA label for a construction row. `null` = the funding guard tripped (stalled). */
export function formatEta(etaCycles: number | null): string {
  if (etaCycles === null) return "stalled";
  return `≈${etaCycles} cycle${etaCycles === 1 ? "" : "s"}`;
}
