/**
 * Op-missions processor unit tests (stub-world, DB-free).
 *
 * Covers:
 *   1. Generation coverage: over `interval` consecutive ticks the union of
 *      system ids passed to `getSystemsByIds` equals all N systems, each once.
 *   2. Housekeeping every tick: `expireUnclaimedMissions` is called on EVERY
 *      tick, including ticks whose generation slice is empty.
 */

import { describe, it, expect } from "vitest";
import { runOpMissionsProcessor } from "../missions";
import { shardRange } from "@/lib/tick/shard";
import type { OpMissionsWorld, SystemTraitView } from "@/lib/tick/world/op-missions-world";
import type { TickContext } from "@/lib/tick/types";

function makeCtx(tick: number): TickContext {
  return { tx: undefined as never, tick, results: new Map() };
}

/** Build N system ids: ["s0", "s1", ..., "sN-1"]. */
function makeSystemIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i}`);
}

/** Minimal SystemTraitView for any id. */
function stubSystemView(id: string): SystemTraitView {
  return {
    id,
    name: id,
    governmentType: "federation",
    traits: [],
    bodyDanger: 0,
  };
}

/**
 * Build a minimal stub OpMissionsWorld.
 * - `getSystemIds()` returns the provided system ids.
 * - `getSystemsByIds(ids)` records the call and returns stubbed views.
 * - Housekeeping methods are counted / nooped.
 * - All other required methods return empty / noop.
 */
function makeStubWorld(systemIds: string[]) {
  let expireCallCount = 0;
  let completableCallCount = 0;
  const requestedIdsByTick: string[][] = [];

  const world: OpMissionsWorld = {
    async expireUnclaimedMissions(_currentTick: number): Promise<number> {
      expireCallCount++;
      return 0;
    },
    async getCompletableTimedMissions(_currentTick: number) {
      completableCallCount++;
      return [];
    },
    async completeMissions(_ids, _tick) {},
    async creditPlayers(_map) {},
    async getFailedAcceptedMissions(_currentTick) {
      return [];
    },
    async failMissions(_ids) {},
    async getSystemIds(): Promise<string[]> {
      return systemIds;
    },
    async getSystemsByIds(ids: string[]): Promise<SystemTraitView[]> {
      requestedIdsByTick.push([...ids]);
      return ids.map(stubSystemView);
    },
    async getNavModifiersForSystems(_ids) {
      return [];
    },
    async getActiveEventsForSystems(_ids) {
      return [];
    },
    async getMissionCountsBySystem(_ids) {
      return new Map();
    },
    async createMissions(_rows) {},
    async persistNotifications(_events, _tick) {},
  };

  return { world, expireCallCount: () => expireCallCount, completableCallCount: () => completableCallCount, requestedIdsByTick };
}

describe("runOpMissionsProcessor — shard coverage", () => {
  it("covers every system exactly once across interval consecutive ticks", async () => {
    // N=10 systems, interval=4 — some ticks get a bigger slice, some smaller.
    // Over any interval consecutive ticks every system is requested exactly once.
    const N = 10;
    const interval = 4;
    const systemIds = makeSystemIds(N);
    const { world, requestedIdsByTick } = makeStubWorld(systemIds);

    for (let tick = 0; tick < interval; tick++) {
      await runOpMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5, interval });
    }

    const allRequested = requestedIdsByTick.flat();
    // Every system id appears exactly once across the interval.
    expect(allRequested.sort()).toEqual([...systemIds].sort());

    // Cross-check that each tick's slice matches shardRange.
    for (let tick = 0; tick < interval; tick++) {
      const { start, end } = shardRange(N, tick, interval);
      const expected = systemIds.slice(start, end);
      expect(requestedIdsByTick[tick]).toEqual(expected);
    }
  });

  it("wraps coverage correctly over a second interval window", async () => {
    const N = 6;
    const interval = 3;
    const systemIds = makeSystemIds(N);
    const { world, requestedIdsByTick } = makeStubWorld(systemIds);

    // Run two full intervals (ticks 0..5); first interval is ticks 0-2, second 3-5.
    for (let tick = 0; tick < 2 * interval; tick++) {
      await runOpMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5, interval });
    }

    // Each interval window independently covers every system once.
    const firstWindow = requestedIdsByTick.slice(0, interval).flat().sort();
    const secondWindow = requestedIdsByTick.slice(interval, 2 * interval).flat().sort();
    expect(firstWindow).toEqual([...systemIds].sort());
    expect(secondWindow).toEqual([...systemIds].sort());
  });
});

describe("runOpMissionsProcessor — housekeeping on every tick", () => {
  it("calls expireUnclaimedMissions on every tick, including empty-slice ticks", async () => {
    // N=2 systems, interval=5: ticks 0, 1, 3 have empty slices (shardRange
    // gives start===end). Housekeeping must still fire on those ticks.
    const N = 2;
    const interval = 5;
    const systemIds = makeSystemIds(N);
    const { world, expireCallCount } = makeStubWorld(systemIds);

    // Confirm some ticks produce empty slices.
    const emptyTicks = [0, 1, 2, 3, 4].filter((t) => {
      const { start, end } = shardRange(N, t, interval);
      return start === end;
    });
    expect(emptyTicks.length).toBeGreaterThan(0);

    for (let tick = 0; tick < interval; tick++) {
      await runOpMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5, interval });
    }

    // expireUnclaimedMissions must be called on all `interval` ticks.
    expect(expireCallCount()).toBe(interval);
  });

  it("calls getCompletableTimedMissions on every tick", async () => {
    const N = 2;
    const interval = 5;
    const systemIds = makeSystemIds(N);
    const { world, completableCallCount } = makeStubWorld(systemIds);

    for (let tick = 0; tick < interval; tick++) {
      await runOpMissionsProcessor(world, makeCtx(tick), { rng: () => 0.5, interval });
    }

    expect(completableCallCount()).toBe(interval);
  });
});
