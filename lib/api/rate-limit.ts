import { NextResponse } from "next/server";
import type { ApiResponse } from "@/lib/types/api";
import {
  type RateLimitTier,
  RATE_LIMIT_TIERS,
  RATE_LIMIT_SWEEP_INTERVAL_MS,
} from "@/lib/constants/rate-limit";

// ── Sliding window store ────────────────────────────────────────

type CheckResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export class SlidingWindowStore {
  private buckets = new Map<string, number[]>();
  private lastSweep: number;
  private now: () => number;

  constructor(opts?: { now?: () => number }) {
    this.now = opts?.now ?? (() => Date.now());
    this.lastSweep = this.now();
  }

  check(key: string, tier: RateLimitTier): CheckResult {
    const now = this.now();
    this.sweepIfDue(now);

    const windowStart = now - tier.windowMs;
    let timestamps = this.buckets.get(key);

    if (timestamps) {
      // Remove expired entries
      timestamps = timestamps.filter((t) => t > windowStart);
      this.buckets.set(key, timestamps);
    } else {
      timestamps = [];
    }

    if (timestamps.length >= tier.maxRequests) {
      const oldestInWindow = timestamps[0]!;
      const retryAfterMs = oldestInWindow + tier.windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1) };
    }

    timestamps.push(now);
    this.buckets.set(key, timestamps);
    return { allowed: true };
  }

  private sweepIfDue(now: number): void {
    if (now - this.lastSweep < RATE_LIMIT_SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;

    // Find the longest window across all tiers
    const maxWindow = Math.max(
      ...Object.values(RATE_LIMIT_TIERS).map((t) => t.windowMs),
    );
    const cutoff = now - maxWindow;

    for (const [key, timestamps] of this.buckets) {
      const live = timestamps.filter((t) => t > cutoff);
      if (live.length === 0) {
        this.buckets.delete(key);
      } else {
        this.buckets.set(key, live);
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "127.0.0.1";
}

// ── Module singleton ────────────────────────────────────────────

const store = new SlidingWindowStore();

export interface RateLimitCheck {
  key: string;
  tier: RateLimitTier;
}

/**
 * Run one or more rate-limit checks. Returns a 429 NextResponse if any check
 * fails, or `null` if all checks pass.
 */
export function rateLimit(
  ...checks: RateLimitCheck[]
): NextResponse<ApiResponse<never>> | null {
  for (const { key, tier } of checks) {
    const result = store.check(key, tier);
    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      return NextResponse.json<ApiResponse<never>>(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSec) },
        },
      );
    }
  }
  return null;
}
