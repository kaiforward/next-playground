export interface RateLimitTier {
  maxRequests: number;
  windowMs: number;
}

export const RATE_LIMIT_TIERS = {
  /** Applied to all API routes by IP. */
  global: { maxRequests: 100, windowMs: 60_000 } satisfies RateLimitTier,
  /** Applied to trade/navigate by player ID. */
  mutation: { maxRequests: 20, windowMs: 60_000 } satisfies RateLimitTier,
  /** Applied to register/login by IP. */
  auth: { maxRequests: 5, windowMs: 60_000 } satisfies RateLimitTier,
} as const;

/** How often the store sweeps fully-expired keys (ms). */
export const RATE_LIMIT_SWEEP_INTERVAL_MS = 60_000;
