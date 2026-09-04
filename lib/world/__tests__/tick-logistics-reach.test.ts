import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import type { World } from "../types";
import { laneKey } from "@/lib/engine/lanes";
import { LANES } from "@/lib/constants/lanes";
import type { TickCadence } from "@/lib/constants/tick-cadence";

/**
 * How far a directed-logistics haul may reach.
 *
 * Directed-logistics dropped its own hop cap when it moved onto lane-network routing
 * (docs/active/gameplay/logistics-lanes.md §2): there is no longer a MAX_HOPS to test a haul against.
 * Reach is now whatever the lane graph and `laneOpenFor` traversability carry a placement over —
 * arbitrarily far, so long as every edge on some path carries an open lane row. `OLD_MAX_HOPS`
 * below is the retired directed-logistics hop cap's value, kept only as a distance comfortably
 * beyond what the pre-migration router could ever have served, to show the new router serves it.
 */
const OLD_MAX_HOPS = 4;

const NEVER = 1_000_000;
const CYCLE_AND_LOGISTICS: TickCadence = { cycle: 1, construction: NEVER, logistics: 1 };

/**
 * A water-rich donor and a water-starved sink of the same faction, joined by a private corridor of
 * `hops` jumps through UNCLAIMED relay systems. The relays are graph distance and nothing else: they
 * hold no markets and take no part in the cycle, so the only haul the galaxy can make here is the
 * full-length one. Every corridor edge carries both a connection AND a lane row — `dropLaneAt`
 * (0-indexed into the chain's edge list) omits the lane row for one edge, so the connection alone
 * exists there: the router should refuse to route across it regardless of length.
 */
function corridorWorld(hops: number, dropLaneAt?: number): { world: World; donorId: string; sinkId: string } {
  const base = generateWorld({ systemCount: 100, seed: 42 });
  const factionId = base.factions[0].id;
  const donor = base.systems.find((s) => s.factionId === factionId && s.control === "developed");
  const sink = base.systems.find((s) => s.control === "developed" && s.id !== donor?.id);
  const relays = base.systems.filter((s) => s.control === "unclaimed").slice(0, hops - 1);
  if (!donor || !sink || relays.length !== hops - 1) {
    throw new Error("fixture premise: the generated galaxy lacks a donor, a sink and enough relays");
  }
  const chain = [donor.id, ...relays.map((s) => s.id), sink.id];
  const onChain = new Set(chain);

  const chainLaneKeys = chain.slice(0, -1).map((from, i) => laneKey(from, chain[i + 1]));
  const droppedKey = dropLaneAt !== undefined ? chainLaneKeys[dropLaneAt] : undefined;

  const world: World = {
    ...base,
    meta: { ...base.meta, currentTick: 0 },
    // The sink joins the donor's faction — logistics is faction-bounded.
    systems: base.systems.map((s) => (s.id === sink.id ? { ...s, factionId } : s)),
    // …and loses its water extractors, so it can only ever import.
    buildings: base.buildings.filter((b) => !(b.systemId === sink.id && b.buildingType === "water")),
    markets: base.markets.map((m) => {
      if (m.goodId !== "water") return m;
      if (m.systemId === donor.id) return { ...m, stock: 1_000_000 };
      if (m.systemId === sink.id) return { ...m, stock: 0 };
      return m;
    }),
    connections: [
      ...base.connections.filter((c) => !onChain.has(c.fromId) && !onChain.has(c.toId)),
      ...chain.slice(0, -1).flatMap((from, i) => [
        { fromId: from, toId: chain[i + 1], fuelCost: 1 },
        { fromId: chain[i + 1], toId: from, fuelCost: 1 },
      ]),
    ],
    // Every chain edge gets a lane row except `droppedKey` — a connection with no lane row carries
    // no capacity or key at all (`buildLaneNetwork`), so the router cannot cross it regardless of
    // `laneOpenFor`.
    lanes: [
      ...base.lanes.filter((l) => !onChain.has(l.aId) && !onChain.has(l.bId)),
      ...chainLaneKeys
        .filter((key) => key !== droppedKey)
        .map((key) => {
          const [aId, bId] = key.split("|");
          return { key, aId, bId, level: 0, bookedLoad: 0, blockedVolume: 0, idleCycles: 0 };
        }),
    ],
  };
  return { world, donorId: donor.id, sinkId: sink.id };
}

/** Runs `n` sequential ticks — dispatch and credit are two different stages a tick apart
 *  (docs/active/gameplay/logistics-lanes.md §3: a dispatched haul is drained by the NEXT tick's
 *  unconditional goods-arrivals stage at the earliest, never the tick that dispatched it). */
async function runTicks(world: World, n: number): Promise<World> {
  let w = world;
  for (let i = 0; i < n; i++) {
    w = (await runWorldTick(w, { cadence: CYCLE_AND_LOGISTICS })).world;
  }
  return w;
}

async function haulCredited(world: World, donorId: string, sinkId: string, ticks: number): Promise<number> {
  const after = await runTicks(world, ticks);
  return after.flowEvents
    .filter((f) => f.goodId === "water" && f.fromSystemId === donorId && f.toSystemId === sinkId)
    .reduce((n, f) => n + f.quantity, 0);
}

// Generous upper bound on the dispatch-to-credit delay for the corridor lengths below (fuel cost 1
// per hop at the shipped `FREIGHT_SPEED`), plus slack for the dispatch itself to land on a cycle
// boundary and the arrivals stage to drain it the tick after.
const AMPLE_TICKS = Math.ceil((OLD_MAX_HOPS + 3) / LANES.FREIGHT_SPEED) + 3;

describe("runWorldTick — the reach of a directed-logistics haul", () => {
  it("serves a same-faction partner well beyond the retired hop-cap radius, over an unbroken lane path", async () => {
    const { world, donorId, sinkId } = corridorWorld(OLD_MAX_HOPS + 3);
    expect(await haulCredited(world, donorId, sinkId, AMPLE_TICKS)).toBeGreaterThan(0);
  });

  it("refuses a corridor missing a single lane, however short and however starved the sink is", async () => {
    // Same short corridor as a haul the router could trivially serve — except one edge in the
    // middle carries a connection but no lane row, so there is no lane-network path at all.
    const { world, donorId, sinkId } = corridorWorld(3, 1);
    expect(await haulCredited(world, donorId, sinkId, AMPLE_TICKS)).toBe(0);
  });
});
