/** Calibration-reference interval — the cadence the economy was tuned at (default-scale region count). `catchUpFactor` is 1 here, so the reference config is behavior-identical and needs no re-tune. */
export const REFERENCE_INTERVAL = 24;
/** Ticks for the economy cluster (economy / trade-flow / migration) to refresh every system once. Fixed gameplay constant → scale-invariant cadence. */
export const ECONOMY_UPDATE_INTERVAL = 24;
