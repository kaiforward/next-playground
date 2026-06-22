/**
 * Trade-missions processor unit tests (stub-world, DB-free).
 *
 * Covers:
 *   1. Economy generation sharded: over `interval` ticks the union of ids
 *      passed to `getMarketPricesForSystems` covers all N systems each once.
 *   2. Event path responsive: `getActiveEvents()` is called on EVERY tick,
 *      not just the tick whose economy slice contains the event's system.
 *   3. Expiry every tick: `expireUnclaimedMissions` called every tick.
 */

import { describe, it, expect, vi } from "vitest";
import { runTradeMissionsProcessor } from "../trade-missions";
import { shardRange } from "@/lib/tick/shard";
import type { TradeMissionsWorld } from "@/lib/tick/world/trade-missions-world";
import type { TickContext } from "@/lib/tick/types";

// loadHopDistances reaches the database; stub it to return an empty map so
// selectEconomyCandidates yields nothing (the stub world also returns [] markets,
// so candidates are empty regardless — this avoids the DATABASE_URL requirement).
vi.mock("@/lib/services/hop-distances", () => ({
  loadHopDistances: vi.fn().mockResolvedValue(new Map()),
}));

function makeCtx(tick: number): TickContext {
  return { tx: undefined as never, tick, results: new Map() };
}

/** Build N system ids: ["s0", "s1", ..., "sN-1"]. */
function makeSystemIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i}`);
}

/**
 * Build a minimal stub TradeMissionsWorld.
 * - `getSystemIds()` returns the provided system ids.
 * - `getMarketPricesForSystems(ids)` records the call and returns [].
 * - `getActiveEvents()` increments a call counter and returns [].
 * - Expiry / insert methods are counted / nooped.
 */
function makeStubWorld(systemIds: string[]) {
  let expireCallCount = 0;
  let activeEventsCallCount = 0;
  const marketSystemIdsByTick: string[][] = [];

  const world: TradeMissionsWorld = {
    async expireUnclaimedMissions(_currentTick: number): Promise<number> {
      expireCallCount++;
      return 0;
    },
    async getExpiredAcceptedMissions(_currentTick) {
      return [];
    },
    async deleteMissions(_ids) {},
    async getSystemIds(): Promise<string[]> {
      return systemIds;
    },
    async getMarketPricesForSystems(ids: string[]) {
      marketSystemIdsByTick.push([...ids]);
      return [];
    },
    async getActiveEvents() {
      activeEventsCallCount++;
      return [];
    },
    async getAvailableMissionCountsByStation() {
      return new Map();
    },
    async resolveGoodIds() {
      return new Map();
    },
    async createMissions(_rows) {},
    async persistNotifications(_events, _tick) {},
  };

  return {
    world,
    expireCallCount: () => expireCallCount,
    activeEventsCallCount: () => activeEventsCallCount,
    marketSystemIdsByTick,
  };
}

describe("runTradeMissionsProcessor — economy shard coverage", () => {
  it("covers every system exactly once across interval consecutive ticks", async () => {
    const N = 10;
    const interval = 4;
    const systemIds = makeSystemIds(N);
    const { world, marketSystemIdsByTick } = makeStubWorld(systemIds);

    for (let tick = 0; tick < interval; tick++) {
      await runTradeMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5, interval });
    }

    const allRequested = marketSystemIdsByTick.flat();
    // Every system id appears exactly once across the interval.
    expect(allRequested.sort()).toEqual([...systemIds].sort());

    // Cross-check each tick's slice against shardRange.
    for (let tick = 0; tick < interval; tick++) {
      const { start, end } = shardRange(N, tick, interval);
      const expected = systemIds.slice(start, end);
      expect(marketSystemIdsByTick[tick]).toEqual(expected);
    }
  });

  it("wraps coverage correctly over a second interval window", async () => {
    const N = 6;
    const interval = 3;
    const systemIds = makeSystemIds(N);
    const { world, marketSystemIdsByTick } = makeStubWorld(systemIds);

    for (let tick = 0; tick < 2 * interval; tick++) {
      await runTradeMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5, interval });
    }

    const firstWindow = marketSystemIdsByTick.slice(0, interval).flat().sort();
    const secondWindow = marketSystemIdsByTick.slice(interval, 2 * interval).flat().sort();
    expect(firstWindow).toEqual([...systemIds].sort());
    expect(secondWindow).toEqual([...systemIds].sort());
  });
});

describe("runTradeMissionsProcessor — event path responsive (every tick)", () => {
  it("calls getActiveEvents on every tick regardless of which slice is active", async () => {
    // N=10, interval=4 — event path must fire all 4 ticks even though the
    // economy shard only covers a different slice each tick.
    const N = 10;
    const interval = 4;
    const systemIds = makeSystemIds(N);
    const { world, activeEventsCallCount } = makeStubWorld(systemIds);

    for (let tick = 0; tick < interval; tick++) {
      await runTradeMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5, interval });
    }

    expect(activeEventsCallCount()).toBe(interval);
  });

  it("calls getActiveEvents on empty-slice ticks too", async () => {
    // N=2, interval=5 — some ticks yield empty economy slices but event path
    // must still fire on all ticks.
    const N = 2;
    const interval = 5;
    const systemIds = makeSystemIds(N);
    const { world, activeEventsCallCount } = makeStubWorld(systemIds);

    // Confirm some ticks produce empty economy slices.
    const emptyTicks = [0, 1, 2, 3, 4].filter((t) => {
      const { start, end } = shardRange(N, t, interval);
      return start === end;
    });
    expect(emptyTicks.length).toBeGreaterThan(0);

    for (let tick = 0; tick < interval; tick++) {
      await runTradeMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5, interval });
    }

    expect(activeEventsCallCount()).toBe(interval);
  });
});

describe("runTradeMissionsProcessor — expiry every tick", () => {
  it("calls expireUnclaimedMissions on every tick, including empty-slice ticks", async () => {
    const N = 2;
    const interval = 5;
    const systemIds = makeSystemIds(N);
    const { world, expireCallCount } = makeStubWorld(systemIds);

    for (let tick = 0; tick < interval; tick++) {
      await runTradeMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5, interval });
    }

    expect(expireCallCount()).toBe(interval);
  });
});
