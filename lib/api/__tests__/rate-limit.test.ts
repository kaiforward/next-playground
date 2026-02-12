import { describe, it, expect } from "vitest";
import { SlidingWindowStore, getClientIp } from "../rate-limit";
import type { RateLimitTier } from "@/lib/constants/rate-limit";

const tier: RateLimitTier = { maxRequests: 3, windowMs: 10_000 };

function makeStore(startMs = 0) {
  let now = startMs;
  const store = new SlidingWindowStore({ now: () => now });
  const advance = (ms: number) => {
    now += ms;
  };
  return { store, advance };
}

// ── SlidingWindowStore ──────────────────────────────────────────

describe("SlidingWindowStore", () => {
  it("allows requests under the limit", () => {
    const { store } = makeStore();
    expect(store.check("k", tier)).toEqual({ allowed: true });
    expect(store.check("k", tier)).toEqual({ allowed: true });
    expect(store.check("k", tier)).toEqual({ allowed: true });
  });

  it("blocks at the limit", () => {
    const { store } = makeStore();
    store.check("k", tier);
    store.check("k", tier);
    store.check("k", tier);

    const result = store.check("k", tier);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("allows again after the window expires", () => {
    const { store, advance } = makeStore();
    store.check("k", tier);
    store.check("k", tier);
    store.check("k", tier);

    // Still blocked
    expect(store.check("k", tier).allowed).toBe(false);

    // Advance past window
    advance(10_001);
    expect(store.check("k", tier)).toEqual({ allowed: true });
  });

  it("tracks keys independently", () => {
    const { store } = makeStore();
    store.check("a", tier);
    store.check("a", tier);
    store.check("a", tier);
    expect(store.check("a", tier).allowed).toBe(false);

    // Different key is unaffected
    expect(store.check("b", tier)).toEqual({ allowed: true });
  });

  it("computes retryAfterMs from oldest timestamp", () => {
    const { store, advance } = makeStore(1000);
    store.check("k", tier); // t=1000
    advance(1000);
    store.check("k", tier); // t=2000
    advance(1000);
    store.check("k", tier); // t=3000

    advance(1000); // t=4000
    const result = store.check("k", tier);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      // oldest=1000, oldest+window=11000, now=4000 → retry=7000
      expect(result.retryAfterMs).toBe(7000);
    }
  });

  it("sweeps expired keys after sweep interval", () => {
    const { store, advance } = makeStore();
    store.check("k", tier); // t=0

    // Advance past both the window and the sweep interval (60s)
    advance(70_000);

    // Trigger sweep via another check on a different key
    store.check("other", tier);

    // Original key should have been cleaned up — next check should pass fresh
    expect(store.check("k", tier)).toEqual({ allowed: true });
  });
});

// ── getClientIp ─────────────────────────────────────────────────

describe("getClientIp", () => {
  it("reads first IP from x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("reads single IP from x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("falls back to 127.0.0.1 when header is missing", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("127.0.0.1");
  });

  it("falls back to 127.0.0.1 when header is empty", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "" },
    });
    expect(getClientIp(req)).toBe("127.0.0.1");
  });
});
