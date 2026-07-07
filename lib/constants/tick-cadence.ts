/** Calibration-reference interval — the cadence the economy was tuned at (default-scale region count). `catchUpFactor` is 1 here, so the reference config is behavior-identical and needs no re-tune. */
export const REFERENCE_INTERVAL = 24;
/** Ticks for the economy cluster (economy / trade-flow / migration) to refresh every system once. Fixed gameplay constant → scale-invariant cadence. */
export const ECONOMY_UPDATE_INTERVAL = 24;

/**
 * One "month" = the resolution-pulse period, in ticks. All faction-scale
 * accounting (economy, infrastructure decay, population, migration, directed
 * logistics, directed build) resolves for the whole galaxy on ticks where
 * `tick % MONTH_LENGTH === 0`. Equal to the economy interval, so each system's
 * magnitude-per-resolution is unchanged from the old rolling shard — only
 * staggered → synchronized changes.
 */
export const MONTH_LENGTH = ECONOMY_UPDATE_INTERVAL;
