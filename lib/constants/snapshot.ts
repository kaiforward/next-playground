/** Snapshot every 20 ticks (100s at 5s/tick). Captures ~2.5 economy cycles. */
export const SNAPSHOT_INTERVAL = 20;

/** Keep last 50 snapshots per system (1,000 ticks ≈ 83 min). */
export const MAX_SNAPSHOTS = 50;
