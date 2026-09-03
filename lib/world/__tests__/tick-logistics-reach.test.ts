import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import type { World } from "../types";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { EXPANSION } from "@/lib/constants/expansion";
import type { TickCadence } from "@/lib/constants/tick-cadence";

/**
 * How far a directed-logistics haul may reach.
 *
 * Two independent things have to agree for a partner at the limit to be served: the shared hop BFS
 * has to be run at a radius wide enough for the LARGEST of the three consumers' limits, and the
 * logistics route cost has to treat its own limit as inclusive. Get either wrong and the galaxy still
 * trades happily — just never at full range, which no aggregate reading distinguishes from "no one
 * needed to".
 */

const NEVER = 1_000_000;
const CYCLE_AND_LOGISTICS: TickCadence = { cycle: 1, construction: NEVER, logistics: 1 };

/**
 * A water-rich donor and a water-starved sink of the same faction, joined by a private corridor of
 * `hops` jumps through UNCLAIMED relay systems. The relays are graph distance and nothing else: they
 * hold no markets and take no part in the cycle, so the only haul the galaxy can make here is the
 * full-length one.
 */
function corridorWorld(hops: number): { world: World; donorId: string; sinkId: string } {
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
  };
  return { world, donorId: donor.id, sinkId: sink.id };
}

async function haulBetween(world: World, donorId: string, sinkId: string): Promise<number> {
  const after = (await runWorldTick(world, { cadence: CYCLE_AND_LOGISTICS })).world;
  return after.flowEvents
    .filter((f) => f.goodId === "water" && f.fromSystemId === donorId && f.toSystemId === sinkId)
    .reduce((n, f) => n + f.quantity, 0);
}

describe("runWorldTick — the reach of a directed-logistics haul", () => {
  it("serves a partner sitting exactly on MAX_HOPS", async () => {
    // The premise the whole test rests on: the shared BFS is run at the widest of the three limits,
    // so logistics' own limit is the binding one here rather than the BFS radius.
    expect(
      Math.max(DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS, EXPANSION.REACH_JUMPS),
    ).toBe(DIRECTED_LOGISTICS.MAX_HOPS);

    const { world, donorId, sinkId } = corridorWorld(DIRECTED_LOGISTICS.MAX_HOPS);
    expect(await haulBetween(world, donorId, sinkId)).toBeGreaterThan(0);
  });

  it("refuses a partner one hop past MAX_HOPS, however starved it is", async () => {
    const { world, donorId, sinkId } = corridorWorld(DIRECTED_LOGISTICS.MAX_HOPS + 1);
    expect(await haulBetween(world, donorId, sinkId)).toBe(0);
  });

  it("writes a funding-bound marker onto the haul's own rows and no others", async () => {
    // The marker is an optional field: a row that was never part of a haul must come out of the tick
    // WITHOUT the key, not carrying it set to undefined. `World` is written to disk as JSON, and a
    // rewrite that touches every row in the galaxy to say nothing is both the wrong shape and the
    // wrong amount of work.
    const { world, donorId, sinkId } = corridorWorld(DIRECTED_LOGISTICS.MAX_HOPS);
    const after = (await runWorldTick(world, { cadence: CYCLE_AND_LOGISTICS })).world;

    // The haul is only real once it is in the sink's warehouse — the flow log is a record of the
    // decision, the stock write is the delivery.
    const sinkWater = after.markets.find((m) => m.systemId === sinkId && m.goodId === "water");
    expect(sinkWater?.stock ?? 0).toBeGreaterThan(0);

    const marked = after.markets.filter((m) => "logisticsFundingBound" in m);
    expect(marked.length).toBeGreaterThan(0); // premise: a haul happened and marked its endpoints
    expect(marked.every((m) => m.systemId === donorId || m.systemId === sinkId)).toBe(true);
    expect(marked.length).toBeLessThan(after.markets.length);
  });
});
