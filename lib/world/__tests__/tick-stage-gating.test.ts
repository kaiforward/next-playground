import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import type { World } from "../types";
import { type TickCadence } from "@/lib/constants/tick-cadence";
import { RELATIONS_FREQUENCY } from "@/lib/constants/relations";

/**
 * What each stage of `runWorldTick` is gated ON — asserted through the broadcast's `processors`
 * list, which is the only outside view of which stages actually resolved on a tick.
 *
 * These are exact-array assertions on purpose. A gate that opens too wide costs a full galaxy-sized
 * adapter build (and, for treasury, a settlement) on a tick that was supposed to resolve nothing —
 * and every one of those over-runs is invisible to a "the world still looks sane" assertion.
 */

/** An interval no tick in these tests is a multiple of, so that cadence never resolves. */
const NEVER = 1_000_000;
const NOTHING_RESOLVES: TickCadence = { cycle: NEVER, construction: NEVER, logistics: NEVER };
const ONLY_THE_CYCLE_RESOLVES: TickCadence = { cycle: 1, construction: NEVER, logistics: NEVER };

/** Tick 1 is a multiple of no cadence here, and `1 % RELATIONS_FREQUENCY !== 0`. */
const QUIET_TICK = 1;

function atTick(world: World, currentTick: number): World {
  return { ...world, meta: { ...world.meta, currentTick } };
}

/** Keep only `count` factions, dropping the relation rows that referenced the rest. */
function withFactionCount(world: World, count: number): World {
  const factions = world.factions.slice(0, count);
  const kept = new Set(factions.map((f) => f.id));
  return {
    ...world,
    factions,
    relations: world.relations.filter((r) => kept.has(r.factionAId) && kept.has(r.factionBId)),
    treasuries: world.treasuries.filter((t) => kept.has(t.factionId)),
  };
}

describe("runWorldTick — stage gating", () => {
  const world = generateWorld({ systemCount: 40, seed: 7 });

  it("runs only the three unconditional stages on a tick where no cadence resolves", async () => {
    expect(QUIET_TICK % RELATIONS_FREQUENCY).not.toBe(0); // premise: relations is off too
    const result = await runWorldTick(atTick(world, QUIET_TICK - 1), { cadence: NOTHING_RESOLVES });
    expect(result.events.processors).toEqual(["ship-arrivals", "goods-arrivals", "events"]);
  });

  it("drains a due arrival on a non-boundary (mid-cycle) tick — goods-arrivals is unconditional", async () => {
    // A market row that already exists, forced to 0 stock so the tiny quantity below is
    // guaranteed to sit under its band cap and credit in full — isolates "the ledger drains" from
    // the credit-cap rule, which is a different test's job.
    const market = world.markets[0];
    const arrivalTick = QUIET_TICK - 1;
    const withArrival: World = {
      ...world,
      markets: world.markets.map((m) => (m === market ? { ...m, stock: 0 } : m)),
      pendingArrivals: [
        {
          id: "arrival-gate-test",
          factionId: null,
          fromSystemId: market.systemId,
          toSystemId: market.systemId,
          goodId: market.goodId,
          quantity: 1,
          dispatchTick: arrivalTick - 1,
          arrivalTick,
          routeEdges: [],
          leg: "outbound",
        },
      ],
    };
    const result = await runWorldTick(atTick(withArrival, arrivalTick - 1), {
      cadence: NOTHING_RESOLVES,
    });
    expect(result.world.pendingArrivals).toEqual([]);
  });

  it("never runs treasury for a world with no treasuries, even on a full cycle start", async () => {
    // Every other stage still resolves — the assertion is that an empty treasury list alone keeps
    // the settlement stage out, rather than the cadence doing it.
    const noTreasuries: World = { ...world, treasuries: [] };
    const result = await runWorldTick(atTick(noTreasuries, 0), { cadence: ONLY_THE_CYCLE_RESOLVES });
    expect(result.events.processors).toContain("economy");
    expect(result.events.processors).not.toContain("treasury");
    expect(result.world.treasuries).toEqual([]);
  });

  it("runs treasury on a cycle start once treasuries exist", async () => {
    const result = await runWorldTick(atTick(world, 0), { cadence: ONLY_THE_CYCLE_RESOLVES });
    expect(result.events.processors).toContain("treasury");
  });

  it("runs relations at exactly two factions — the minimum a relation needs two of", async () => {
    const twoFactions = withFactionCount(world, 2);
    const result = await runWorldTick(atTick(twoFactions, RELATIONS_FREQUENCY - 1), {
      cadence: NOTHING_RESOLVES,
    });
    expect(result.events.processors).toContain("relations");
  });

  it("skips relations for a single-faction world on a relations tick", async () => {
    const oneFaction = withFactionCount(world, 1);
    const result = await runWorldTick(atTick(oneFaction, RELATIONS_FREQUENCY - 1), {
      cadence: NOTHING_RESOLVES,
    });
    expect(result.events.processors).not.toContain("relations");
  });
});
