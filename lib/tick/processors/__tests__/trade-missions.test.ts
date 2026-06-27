/**
 * Trade-missions processor unit tests (stub-world, DB-free).
 *
 * Covers:
 *   1. Event path responsive: `getActiveEvents()` is called on EVERY tick.
 *   2. Expiry every tick: `expireUnclaimedMissions` called every tick.
 */

import { describe, it, expect } from "vitest";
import { runTradeMissionsProcessor } from "../trade-missions";
import type { TradeMissionsWorld } from "@/lib/tick/world/trade-missions-world";
import type { TickContext } from "@/lib/tick/types";

function makeCtx(tick: number): TickContext {
  return { tx: undefined as never, tick, results: new Map() };
}

/**
 * Build a minimal stub TradeMissionsWorld.
 * - `getActiveEvents()` increments a call counter and returns [].
 * - Expiry / insert methods are counted / nooped.
 */
function makeStubWorld() {
  let expireCallCount = 0;
  let activeEventsCallCount = 0;

  const world: TradeMissionsWorld = {
    async expireUnclaimedMissions(_currentTick: number): Promise<number> {
      expireCallCount++;
      return 0;
    },
    async getExpiredAcceptedMissions(_currentTick) {
      return [];
    },
    async deleteMissions(_ids) {},
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
  };
}

describe("runTradeMissionsProcessor — event path responsive (every tick)", () => {
  it("calls getActiveEvents on every tick", async () => {
    const ticks = 4;
    const { world, activeEventsCallCount } = makeStubWorld();

    for (let tick = 0; tick < ticks; tick++) {
      await runTradeMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5 });
    }

    expect(activeEventsCallCount()).toBe(ticks);
  });
});

describe("runTradeMissionsProcessor — expiry every tick", () => {
  it("calls expireUnclaimedMissions on every tick", async () => {
    const ticks = 5;
    const { world, expireCallCount } = makeStubWorld();

    for (let tick = 0; tick < ticks; tick++) {
      await runTradeMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5 });
    }

    expect(expireCallCount()).toBe(ticks);
  });
});
