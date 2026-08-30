import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { mulberry32 } from "@/lib/engine/universe-gen";
import {
  runWorldTick, toTickSystems, applyBuildingIncreases, applyDevelopments, applyAbandonments,
  applyBuildBlockedUpdates, applyBuildOpportunityUpdates, applyColonyOpportunityUpdates,
  marketRowsBySystem, resetAbandonedMarkets, tickRng, EVENTS_RNG_STREAM,
} from "../tick";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import { serialiseWorld, deserialiseWorld } from "../save";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { unitResourceVector, yieldsOf } from "@/lib/engine/resources";
import { catchUpFactor } from "@/lib/tick/shard";
import { RELATIONS_FREQUENCY, RELATION_HISTORY_MAX } from "@/lib/constants/relations";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { computeSystemLabourSnapshot, housingPopCap, inputDemandForGood } from "@/lib/engine/industry";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import {
  BUILDING_TYPES, HOUSING_TYPE, POP_CENTRE_DENSITY, effectiveSpaceCost, labourTotal,
} from "@/lib/constants/industry";
import {
  CYCLE_LENGTH, REFERENCE_INTERVAL, LOGISTICS_INTERVAL, type TickCadence,
} from "@/lib/constants/tick-cadence";
import { CROWDING, POPULATION_PARAMS, STRIKE_PARAMS, UNREST_PARAMS } from "@/lib/constants/population";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { EXPANSION } from "@/lib/constants/expansion";
import type { TaxLevel } from "@/lib/types/game";
import type { SystemDevelopment } from "@/lib/tick/world/directed-build-world";
import type { TickSystem } from "@/lib/tick/rows";
import type {
  World, WorldBuildProject, WorldFactionTreasury, WorldMarket, WorldShip,
  WorldSystem,
} from "../types";

async function runTicks(world: World, count: number, cadence?: TickCadence) {
  let w = world;
  for (let i = 0; i < count; i++) {
    const result = await runWorldTick(w, cadence ? { cadence } : undefined);
    w = result.world;
  }
  return w;
}

/** Runs `count` ticks and returns the LAST tick's full result (world + instrumentation) — unlike
 *  `runTicks` above, which only carries the world forward. Shared by every "poisoning the input
 *  changes no other output" test in this file: each needs the final tick's instrumentation to
 *  compare, not just its world. */
async function runTicksCapturingLast(world: World, count: number) {
  let w = world;
  let last: Awaited<ReturnType<typeof runWorldTick>> | undefined;
  for (let i = 0; i < count; i++) {
    last = await runWorldTick(w);
    w = last.world;
  }
  if (!last) throw new Error("count must be > 0");
  return last;
}

describe("tickRng", () => {
  it("omitted-stream draws are bit-identical to the pre-split single-stream formula", () => {
    const seed = 7;
    const tick = 123;
    // Reproduces the original (pre-split) formula directly, independent of the current
    // implementation — a miss here would silently re-roll every seeded baseline in the repo.
    const original = mulberry32((seed ^ Math.imul(tick + 1, 0x9e3779b1)) >>> 0);
    const current = tickRng(seed, tick);
    const originalDraws = Array.from({ length: 20 }, () => original());
    const currentDraws = Array.from({ length: 20 }, () => current());
    expect(currentDraws).toEqual(originalDraws);
  });

  it("stream 0 draws bit-identically to stream omitted", () => {
    const seed = 7;
    const tick = 123;
    const omitted = tickRng(seed, tick);
    const explicitZero = tickRng(seed, tick, 0);
    const omittedDraws = Array.from({ length: 20 }, () => omitted());
    const explicitZeroDraws = Array.from({ length: 20 }, () => explicitZero());
    expect(explicitZeroDraws).toEqual(omittedDraws);
  });

  it("the events stream's sequence differs from the default stream for the same (seed, tick)", () => {
    const seed = 7;
    const tick = 123;
    const defaultStream = tickRng(seed, tick);
    const eventsStream = tickRng(seed, tick, EVENTS_RNG_STREAM);
    const defaultDraws = Array.from({ length: 10 }, () => defaultStream());
    const eventsDraws = Array.from({ length: 10 }, () => eventsStream());
    expect(eventsDraws).not.toEqual(defaultDraws);
  });

  it("draining draws from the events stream leaves the default stream's next draw unchanged — two instances, never a shared cursor", () => {
    const seed = 7;
    const tick = 123;
    const defaultStream = tickRng(seed, tick);
    const expectedFirstDraw = defaultStream();

    // A fresh default-stream instance for the same (seed, tick) — proves the events stream
    // below cannot be advancing a cursor the default stream also reads from.
    const defaultStreamAgain = tickRng(seed, tick);
    const eventsStream = tickRng(seed, tick, EVENTS_RNG_STREAM);
    for (let i = 0; i < 50; i++) eventsStream();

    expect(defaultStreamAgain()).toBe(expectedFirstDraw);
  });
});

describe("runWorldTick", () => {
  it("advances meta.currentTick by exactly one per call", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const after = await runTicks(world, 50);
    expect(after.meta.currentTick).toBe(50);
  });

  it("never produces NaN/Infinity in market stock or system population over 50 ticks", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const after = await runTicks(world, 50);

    for (const m of after.markets) {
      expect(Number.isFinite(m.stock)).toBe(true);
      expect(Number.isFinite(m.anchorMult)).toBe(true);
      expect(Number.isFinite(m.demandRate)).toBe(true);
    }
    for (const s of after.systems) {
      expect(Number.isFinite(s.population)).toBe(true);
      expect(Number.isFinite(s.unrest)).toBe(true);
      expect(Number.isFinite(s.popCap)).toBe(true);
    }
  });

  it("changes at least one market's stock over 50 ticks", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const before = new Map(world.markets.map((m) => [`${m.systemId}|${m.goodId}`, m.stock]));
    const after = await runTicks(world, 50);

    const changed = after.markets.some(
      (m) => before.get(`${m.systemId}|${m.goodId}`) !== m.stock,
    );
    expect(changed).toBe(true);
  });

  it("is deterministic — the same world run for the same tick count twice deep-equals", async () => {
    const worldA = generateWorld({ systemCount: 100, seed: 42 });
    const worldB = generateWorld({ systemCount: 100, seed: 42 });

    const afterA = await runTicks(worldA, 50);
    const afterB = await runTicks(worldB, 50);

    expect(afterA).toEqual(afterB);
  });

  it("gates the relations processor by RELATIONS_FREQUENCY — history entries reflect floor(ticks/frequency), not every tick", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const after = await runTicks(world, 50);

    const expectedRuns = Math.floor(50 / RELATIONS_FREQUENCY);
    // History is a ring buffer capped at RELATION_HISTORY_MAX entries per pair
    // (see lib/constants/relations.ts) — floor(50/3) = 16 runs exceeds the cap.
    const expectedHistoryLength = Math.min(expectedRuns, RELATION_HISTORY_MAX);
    for (const relation of after.relations) {
      // Each relations run appends exactly one history entry per pair.
      expect(relation.history.length).toBe(expectedHistoryLength);
      expect(relation.history.length).toBeLessThan(50);
    }
    // Sanity: relations actually has pairs to check (world has ≥2 factions).
    expect(after.relations.length).toBeGreaterThan(0);
  });

  it("does not mutate the input world (immutable-spread style)", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const snapshot = JSON.parse(JSON.stringify(world));
    await runWorldTick(world);
    expect(world).toEqual(snapshot);
  });

  it("returns a TickBroadcastRaw whose currentTick matches the new world's tick", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const { world: after, events } = await runWorldTick(world);
    expect(events.currentTick).toBe(after.meta.currentTick);
    expect(events.currentTick).toBe(1);
  });

  it("keeps every building count a non-negative integer across a long run (the level invariant)", async () => {
    // The whole point of the discrete-level model: seeds are integer, construction lands whole
    // levels, decay sheds whole levels — so no count is ever fractional at any tick.
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const a = base.factions[0].homeworldId;
    const b = base.factions[1].homeworldId;
    const factionId = base.factions[0].id;
    let world = {
      ...base,
      systems: base.systems.map((s) => (s.id === b ? { ...s, factionId } : s)),
      connections: [
        ...base.connections,
        { fromId: a, toId: b, fuelCost: 1 },
        { fromId: b, toId: a, fuelCost: 1 },
      ],
    };
    for (let i = 0; i < 120; i++) {
      const result = await runWorldTick(world);
      world = result.world;
      for (const bld of world.buildings) {
        expect(Number.isInteger(bld.count), `tick ${i + 1}: ${bld.systemId}/${bld.buildingType} = ${bld.count}`).toBe(true);
        expect(bld.count).toBeGreaterThan(0); // flattenBuildings drops count ≤ 0
        expect(Number.isInteger(bld.idleCycles)).toBe(true);
      }
    }
  });

  it("toTickSystems seeds buildingIdleCycles from WorldBuilding.idleCycles", () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const target = base.buildings[0].systemId;
    const world = {
      ...base,
      buildings: base.buildings.map((b) => (b.systemId === target ? { ...b, idleCycles: 4 } : b)),
    };
    const tickSystem = toTickSystems(world).find((s) => s.id === target);
    expect(tickSystem).toBeDefined();
    for (const b of world.buildings.filter((b) => b.systemId === target)) {
      expect(tickSystem?.buildingIdleCycles[b.buildingType]).toBe(4);
    }
  });

  it("toTickSystems joins each system's OWNING faction's government, not a blanket default", () => {
    // The join is the only path a faction's government takes into the tick; "frontier" is the
    // mid-write fallback for an unowned row, so a test that accepts it everywhere would pass with the
    // faction lookup gone entirely.
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const governmentById = new Map(base.factions.map((f) => [f.id, f.governmentType]));
    const owned = toTickSystems(base).filter((s) => s.factionId !== null);
    expect(owned.length).toBeGreaterThan(0);
    for (const s of owned) {
      if (s.factionId === null) continue;
      expect(s.governmentType).toBe(governmentById.get(s.factionId));
    }
    // Premise guard: the world must actually contain a non-frontier government, or the assertion
    // above is satisfied by the fallback.
    expect(owned.some((s) => s.governmentType !== "frontier")).toBe(true);
    // An unclaimed system has no faction to read one from.
    for (const s of toTickSystems(base).filter((s) => s.factionId === null)) {
      expect(s.governmentType).toBe("frontier");
    }
  });

  it("toTickSystems carries a stored collapseDebt through, and reads an absent one as 0", () => {
    // The debt is a fractional accumulator: a join that zeroed a live one would restart every
    // collapsing system's decay regime from scratch, every tick, invisibly.
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const indebted = base.systems[0].id;
    const world = {
      ...base,
      systems: base.systems.map((s) => (s.id === indebted ? { ...s, collapseDebt: 0.4 } : s)),
    };
    const rows = toTickSystems(world);
    expect(rows.find((s) => s.id === indebted)!.collapseDebt).toBe(0.4);
    for (const s of rows.filter((s) => s.id !== indebted)) expect(s.collapseDebt).toBe(0);
  });

  it("toTickSystems passes provisionExpectation through absent, not `?? 0` (departs from collapseDebt)", () => {
    // The join's contrast with collapseDebt just above: a `?? 0` here would destroy the lazy-seed
    // marker readExpectation relies on — an absent WorldSystem field must reach the row as
    // undefined, never as a coerced 0.
    const base = generateWorld({ systemCount: 60, seed: 7 });
    expect(base.systems[0].provisionExpectation).toBeUndefined(); // premise: world-gen never seeds it
    const unseeded = toTickSystems(base)[0];
    // TickSystem is a transient per-tick row, never serialised — `undefined` (whether or not the
    // key is technically own-enumerable) is the only thing that matters here; readExpectation's
    // validity guard treats both identically. The JSON-boundary key-absence guarantee below is
    // checked at the WorldSystem/save layer instead, where it is actually load-bearing.
    expect(unseeded.provisionExpectation).toBeUndefined();

    const seeded = {
      ...base,
      systems: base.systems.map((s, i) => (i === 0 ? { ...s, provisionExpectation: 0.42 } : s)),
    };
    expect(toTickSystems(seeded)[0].provisionExpectation).toBe(0.42);
  });

  it("mergeSystemsIntoWorld keeps a never-seeded system's provisionExpectation truly key-absent, not present-as-undefined", async () => {
    // An unclaimed system never enters the economy shard, so the population processor never
    // touches it — mergeSystemsIntoWorld must not leave the key present with value undefined
    // (which would still serialise identically, but would diverge from a system that never had
    // the key at all under a strict structural comparison).
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const unclaimed = base.systems.find((s) => s.control === "unclaimed");
    expect(unclaimed).toBeDefined();
    if (!unclaimed) return;
    const { world: after } = await runWorldTick(base);
    const stillUnclaimed = after.systems.find((s) => s.id === unclaimed.id)!;
    expect(stillUnclaimed.provisionExpectation).toBeUndefined();
    expect("provisionExpectation" in stillUnclaimed).toBe(false);
  });

  it("InMemoryPopulationWorld.applyPopulationUpdates clamps provisionExpectation and never writes NaN", async () => {
    // The write-path guarantee: a non-finite value never lands as NaN (⇒ null on serialise) or as
    // an invented 0 (0 is a real, false memory — "resigned to total collapse"). It falls back to
    // the row's own prior stored value if one exists, else the key stays absent.
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const target = base.systems[0].id;
    const rows = toTickSystems(base);

    // No prior stored value: a non-finite write is omitted entirely, never invented as 0.
    const fresh = new InMemoryPopulationWorld({ systems: rows, markets: base.markets });
    await fresh.applyPopulationUpdates([
      { systemId: target, population: 100, unrest: 0, provisionExpectation: Number.NaN },
    ]);
    const freshAfter = fresh.systems.find((s) => s.id === target)!;
    expect(freshAfter.provisionExpectation).toBeUndefined();
    expect("provisionExpectation" in freshAfter).toBe(false);

    // A prior stored value survives a non-finite write (the safe fallback).
    const priorSeeded = rows.map((s) => (s.id === target ? { ...s, provisionExpectation: 0.37 } : s));
    const carried = new InMemoryPopulationWorld({ systems: priorSeeded, markets: base.markets });
    await carried.applyPopulationUpdates([
      { systemId: target, population: 100, unrest: 0, provisionExpectation: Number.POSITIVE_INFINITY },
    ]);
    expect(carried.systems.find((s) => s.id === target)!.provisionExpectation).toBe(0.37);

    // An out-of-range but finite value clamps into [0, 1] — never serialises as null.
    const clamped = new InMemoryPopulationWorld({ systems: rows, markets: base.markets });
    await clamped.applyPopulationUpdates([
      { systemId: target, population: 100, unrest: 0, provisionExpectation: 7 },
    ]);
    const clampedAfter = clamped.systems.find((s) => s.id === target)!;
    expect(clampedAfter.provisionExpectation).toBe(1);
    expect(Number.isFinite(clampedAfter.provisionExpectation)).toBe(true);
    expect(JSON.stringify({ provisionExpectation: clampedAfter.provisionExpectation })).not.toContain("null");
  });

  it("accumulates construction projects and lands whole integer building levels over many ticks", async () => {
    // A single-faction developed corridor drives construction: connect two developed homeworlds so
    // logistics makes them fed-and-calm, then run long enough for committed projects to land.
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const a = base.factions[0].homeworldId;
    const b = base.factions[1].homeworldId;
    const factionId = base.factions[0].id;
    const world = {
      ...base,
      systems: base.systems.map((s) => (s.id === b ? { ...s, factionId } : s)),
      connections: [
        ...base.connections,
        { fromId: a, toId: b, fuelCost: 1 },
        { fromId: b, toId: a, fuelCost: 1 },
      ],
    };
    const after = await runTicks(world, 120);

    // Construction projects exist (committed, in-flight) and every one is well-formed.
    expect(after.constructionProjects.length).toBeGreaterThan(0);
    for (const p of after.constructionProjects) {
      if (p.kind === "build") {
        expect(p.levels).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(p.levels)).toBe(true);
      }
      expect(p.workDone).toBeGreaterThanOrEqual(0);
      expect(p.workDone).toBeLessThanOrEqual(p.workTotal);
    }
    // Project ids are unique (minted from the world's monotonic counter).
    const ids = after.constructionProjects.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Landed levels are whole integers when they land (the full integer invariant, once decay is
    // whole-level too, is asserted separately).
    for (const u of after.constructionProjects) if (u.kind === "build") expect(Number.isInteger(u.levels)).toBe(true);
  });

  it("issues every id from one monotonic counter threaded across the tick's stages", async () => {
    // Construction projects and relations-spawned events (border_conflict, pact_under_negotiation,
    // alliance_dissolved) draw ids from the same World.nextId counter, threaded stage by stage:
    // directed-build mints "construction-" ids, then the relations adapter takes the counter next
    // and mints "event-" ids. The id prefix does not disambiguate them — the threading is what keeps
    // them distinct — so a stage that failed to read the counter back would silently reissue a value
    // that is already live.
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const a = base.factions[0].homeworldId;
    const b = base.factions[1].homeworldId;
    const factionId = base.factions[0].id;
    const world = {
      ...base,
      systems: base.systems.map((s) => (s.id === b ? { ...s, factionId } : s)),
      connections: [
        ...base.connections,
        { fromId: a, toId: b, fuelCost: 1 },
        { fromId: b, toId: a, fuelCost: 1 },
      ],
    };
    // 120 ticks was enough while random spawning also minted "event-" ids; with only relations
    // creating events, this seed's first faction pair crosses into border conflict at tick 278 —
    // run well past it.
    const after = await runTicks(world, 320);

    const eventIds = after.events.map((e) => e.id);
    const projectIds = after.constructionProjects.map((p) => p.id);
    // Both mint sites must have actually fired, or the assertions below prove nothing.
    expect(eventIds.length).toBeGreaterThan(0);
    expect(projectIds.length).toBeGreaterThan(0);

    const counterValue = (id: string) => Number(id.slice(id.indexOf("-") + 1));
    const issued = [...eventIds, ...projectIds].map(counterValue);
    for (const n of issued) expect(Number.isInteger(n)).toBe(true);
    // No two live ids share a counter value, across both prefixes.
    expect(new Set(issued).size).toBe(issued.length);
    // The counter leads everything it has issued — a stage that dropped its read-back would leave
    // nextId behind a live id and reissue it on the next tick.
    for (const n of issued) expect(n).toBeLessThan(after.nextId);
  });

  it("round-trips building idleCycles across a non-decay tick (the field survives the row/World serialise round-trip)", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const world = { ...base, buildings: base.buildings.map((b) => ({ ...b, idleCycles: 7 })) };
    const seeded = new Set(world.buildings.map((b) => `${b.systemId}|${b.buildingType}`));
    const { world: after } = await runWorldTick(world);
    // Infrastructure decay consumes idleCycles, but only on an economy-update tick (it is gated
    // behind economySignals); this single tick from a fresh world is not one, so every building
    // that existed at seed round-trips its idleCycles unchanged through the tick. Newly-built rows
    // are excluded — they start at 0.
    for (const b of after.buildings) {
      if (seeded.has(`${b.systemId}|${b.buildingType}`)) {
        expect(b.idleCycles, `${b.systemId}|${b.buildingType}`).toBe(7);
      }
    }
  });


  it("persists economy assessment signals through the world tick", async () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const result = await runWorldTick(world, {
      cadence: { cycle: 1, construction: 24, logistics: 24 },
    });
    const developedIds = new Set(result.world.systems
      .filter((system) => system.control === "developed")
      .map((system) => system.id));
    const assessed = result.world.markets.filter((market) => developedIds.has(market.systemId));
    expect(assessed.length).toBeGreaterThan(0);
    for (const market of assessed) {
      expect(Number.isFinite(market.realisedProductionRate)).toBe(true);
      expect(typeof market.productionSuppressed).toBe("boolean");
      expect(market.squeezeCycles).toBeGreaterThanOrEqual(0);
      expect(market.squeezeCycles).toBeLessThanOrEqual(2);
    }
  });

  it("advances the construction and economy clocks on their own cadences (divergent-cycle persistence)", async () => {
    // The construction proposal-pressure counter and the economy squeeze counter are DISTINCT clocks
    // written by different stages on independently-tunable cadences. Engineer a persistent food deficit
    // at a developed homeworld (no food capacity, empty stock), seed BOTH counters at 1, then cycle the
    // two cadences apart: each clock advances only on its own cycle, and the stale mid-cycle read of the
    // other clock is never counted.
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const home = base.factions[0].homeworldId;
    const prepared = {
      ...base,
      buildings: base.buildings.filter((b) => !(b.systemId === home && b.buildingType === "food")),
      markets: base.markets.map((m) =>
        m.systemId === home && m.goodId === "food"
          ? { ...m, stock: 0, squeezeCycles: 1, proposalCycles: 1 }
          : m,
      ),
    };
    const foodOf = (w: typeof prepared) =>
      w.markets.find((m) => m.systemId === home && m.goodId === "food");

    // Construction-only cycle: directed-build resolves at a finer-than-reference cadence, economy (cycle)
    // does NOT. The build assessment advances proposalCycles by that cycle's reference-time
    // (catchUpFactor(1)); the stale economy read leaves squeezeCycles untouched.
    const buildOnly = (await runWorldTick(prepared, { cadence: { cycle: 999, construction: 1, logistics: 999 } })).world;
    expect(foodOf(buildOnly)?.proposalCycles).toBeCloseTo(1 + catchUpFactor(1), 10); // 1 → 1 + reference-time
    expect(foodOf(buildOnly)?.squeezeCycles).toBe(1);  // unchanged — economy did not run

    // Economy-only cycle: economy resolves and rations the empty deficit → squeezeCycles advances by the
    // same reference-time; the stale build read (construction mid-cycle) leaves proposalCycles untouched.
    const econOnly = (await runWorldTick(prepared, { cadence: { cycle: 1, construction: 999, logistics: 999 } })).world;
    expect(foodOf(econOnly)?.squeezeCycles).toBeCloseTo(1 + catchUpFactor(1), 10);  // 1 → 1 + reference-time
    expect(foodOf(econOnly)?.proposalCycles).toBe(1); // unchanged — directed-build did not run

    // The divergent-cadence result serialises and deserialises intact (the fractional proposalCycles
    // survives the save byte-for-byte).
    const roundTrip = deserialiseWorld(serialiseWorld(buildOnly));
    expect(roundTrip.ok).toBe(true);
    if (roundTrip.ok) {
      expect(foodOf(roundTrip.world)?.proposalCycles).toBe(foodOf(buildOnly)?.proposalCycles);
      expect(foodOf(roundTrip.world)?.squeezeCycles).toBe(1);
    }
  });

});
// ── Per-stage wiring — each of these fails if `runWorldTick` ever drops the
// named stage from the pipeline (dropping a stage silently no-ops it instead
// of erroring, so only an effect assertion like these catches it). ─────────

function makeInTransitShip(overrides: Partial<WorldShip> & { id: string }): WorldShip {
  return {
    name: overrides.id,
    shipType: "shuttle",
    fuel: 100,
    maxFuel: 100,
    speed: 5,
    hullMax: 40,
    hullCurrent: 40,
    shieldMax: 10,
    shieldCurrent: 10,
    firepower: 2,
    evasion: 6,
    stealth: 3,
    sensors: 4,
    crewCapacity: 2,
    disabled: false,
    status: "in_transit",
    systemId: "origin",
    destinationSystemId: "destination",
    departureTick: 0,
    arrivalTick: 5,
    ...overrides,
  };
}

describe("runWorldTick — per-stage wiring", () => {
  it("ship-arrivals: docks an in-transit ship at its destination once arrivalTick passes (worlds seed zero ships)", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const origin = world.systems[0].id;
    const destination = world.systems[1].id;
    const ship = makeInTransitShip({
      id: "test-ship-1",
      systemId: origin,
      destinationSystemId: destination,
      arrivalTick: 5,
    });
    const seeded = { ...world, ships: [...world.ships, ship] };

    const after = await runTicks(seeded, 10);

    const docked = after.ships.find((s) => s.id === "test-ship-1");
    expect(docked).toBeDefined();
    expect(docked?.status).toBe("docked");
    expect(docked?.systemId).toBe(destination);
    expect(docked?.destinationSystemId).toBeNull();
    expect(docked?.departureTick).toBeNull();
    expect(docked?.arrivalTick).toBeNull();
  });

  it("population/migration: changes at least one system's population over 50 ticks", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const before = new Map(world.systems.map((s) => [s.id, s.population]));
    const after = await runTicks(world, 50);

    const changed = after.systems.some((s) => before.get(s.id) !== s.population);
    expect(changed).toBe(true);
  });

  it("infrastructure-decay/directed-build: changes the buildings roster over 50 ticks (decay reduces / build adds)", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const after = await runTicks(world, 50);

    expect(after.buildings).not.toEqual(world.buildings);
  });

  it("directed-logistics: produces flow events once developed territory is connected", async () => {
    // A homeworld-only galaxy has no same-faction adjacencies, so no cross-system flows arise until a
    // faction connects developed territory with a production gradient. Put two developed homeworlds in
    // one faction, link them, and force an explicit water gradient — strip B's water production so it
    // structurally imports, and give A a large water buffer so it structurally donates. (The flow math
    // itself is covered by the directed-logistics processor tests; this asserts the tick wires it.)
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const a = base.factions[0].homeworldId;
    const b = base.factions[1].homeworldId;
    const factionId = base.factions[0].id;
    const world = {
      ...base,
      systems: base.systems.map((s) => (s.id === b ? { ...s, factionId } : s)),
      // B loses its water extractors AND starts empty of water → a persistent water deficit (it can't
      // self-refill, so it stays below its cycles-of-supply anchor and must import).
      buildings: base.buildings.filter((bl) => !(bl.systemId === b && bl.buildingType === "water")),
      // A holds a large water reserve → a surplus donor above its anchor.
      markets: base.markets.map((m) => {
        if (m.systemId === a && m.goodId === "water") return { ...m, stock: 1_000_000 };
        if (m.systemId === b && m.goodId === "water") return { ...m, stock: 0 };
        return m;
      }),
      connections: [
        ...base.connections,
        { fromId: a, toId: b, fuelCost: 1 },
        { fromId: b, toId: a, fuelCost: 1 },
      ],
    };
    const after = await runTicks(world, 50);

    expect(after.flowEvents.length).toBeGreaterThan(0);
  });

  it("persists and clears funding-bound markers on both logistics endpoints", async () => {
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const a = base.factions[0].homeworldId;
    const b = base.factions[1].homeworldId;
    const factionId = base.factions[0].id;
    const prepared = {
      ...base,
      systems: base.systems.map((system) =>
        system.id === b ? { ...system, factionId } : system,
      ),
      buildings: base.buildings.filter(
        (building) => !(building.systemId === b && building.buildingType === "water"),
      ),
      markets: base.markets.map((market) => {
        if (market.systemId === a && market.goodId === "water") {
          return { ...market, stock: 1_000_000 };
        }
        if (market.systemId === b && market.goodId === "water") {
          return { ...market, stock: 0 };
        }
        return market;
      }),
      connections: [
        ...base.connections,
        { fromId: a, toId: b, fuelCost: 1 },
        { fromId: b, toId: a, fuelCost: 1 },
      ],
      treasuries: base.treasuries.map((treasury) =>
        treasury.factionId === factionId
          ? { ...treasury, funded: { ...treasury.funded, logistics: 0 } }
          : treasury,
      ),
    };
    const cadence = { cycle: 1, logistics: 1, construction: 99 };
    const fundingBound = (await runWorldTick(prepared, { cadence })).world;
    expect(fundingBound.markets.find((market) => market.systemId === a && market.goodId === "water")?.logisticsFundingBound).toBe(true);
    expect(fundingBound.markets.find((market) => market.systemId === b && market.goodId === "water")?.logisticsFundingBound).toBe(true);

    const recovered = {
      ...fundingBound,
      markets: fundingBound.markets.map((market) =>
        market.systemId === b && market.goodId === "water"
          ? { ...market, stock: 1_000_000 }
          : market,
      ),
      treasuries: fundingBound.treasuries.map((treasury) =>
        treasury.factionId === factionId
          ? { ...treasury, funded: { ...treasury.funded, logistics: 1 } }
          : treasury,
      ),
    };
    const cleared = (await runWorldTick(recovered, { cadence })).world;
    expect(cleared.markets.find((market) => market.systemId === a && market.goodId === "water")?.logisticsFundingBound).toBe(false);
    expect(cleared.markets.find((market) => market.systemId === b && market.goodId === "water")?.logisticsFundingBound).toBe(false);
  });

  it("decay consumes the prior funding assessment before logistics clears it", async () => {
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const systemId = base.factions[0].homeworldId;
    const producer = base.buildings.find((building) => {
      const definition = BUILDING_TYPES[building.buildingType];
      return building.systemId === systemId && definition?.resource !== undefined;
    })!;
    const definition = BUILDING_TYPES[producer.buildingType];
    const labour = definition?.labour;
    if (definition?.outputGood === undefined || labour === undefined) {
      throw new Error("Expected the homeworld producer fixture to have output and labour");
    }
    const goodId = definition.outputGood;
    const count = 10;
    const prepared = {
      ...base,
      systems: base.systems.map((system) =>
        system.id === systemId
          ? { ...system, population: count * labourTotal(labour), popCap: 1_000_000, unrest: 0 }
          : system,
      ),
      buildings: [
        ...base.buildings.filter((building) => building.systemId !== systemId),
        { ...producer, count, idleCycles: 11 },
      ],
      markets: base.markets.map((market) =>
        market.systemId === systemId && market.goodId === goodId
          ? { ...market, stock: 1_000_000, logisticsFundingBound: true }
          : market,
      ),
    };
    const cadence = { cycle: 1, logistics: 1, construction: 99 };
    const protectedCycle = (await runWorldTick(prepared, { cadence })).world;
    const protectedBuilding = protectedCycle.buildings.find(
      (building) => building.systemId === systemId && building.buildingType === producer.buildingType,
    )!;
    expect(protectedBuilding.count).toBe(count);
    expect(protectedBuilding.idleCycles).toBe(0);
    expect(protectedCycle.markets.find(
      (market) => market.systemId === systemId && market.goodId === goodId,
    )?.logisticsFundingBound).toBe(false);

    const ordinaryCycle = (await runWorldTick(protectedCycle, { cadence })).world;
    const ordinaryBuilding = ordinaryCycle.buildings.find(
      (building) => building.systemId === systemId && building.buildingType === producer.buildingType,
    )!;
    expect(ordinaryBuilding.count).toBe(count);
    expect(ordinaryBuilding.idleCycles).toBeCloseTo(1 / 24);
  });

  it("directed-logistics: prunes flow events older than FLOW_HISTORY_TICKS from the log each tick", async () => {
    // The tick body prunes flowEvents unconditionally after directed-logistics writes,
    // keeping only ticks >= currentTick - FLOW_HISTORY_TICKS.
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const T = 300;
    const staleTick = T - TRADE_SIMULATION.FLOW_HISTORY_TICKS - 5; // below the post-tick retention floor
    const freshTick = T; // within the window
    const [s0, s1] = base.systems;
    const world = {
      ...base,
      meta: { ...base.meta, currentTick: T },
      flowEvents: [
        { tick: staleTick, fromSystemId: s0.id, toSystemId: s1.id, goodId: "water", quantity: 5 },
        { tick: freshTick, fromSystemId: s0.id, toSystemId: s1.id, goodId: "water", quantity: 5 },
      ],
    };

    const { world: after } = await runWorldTick(world);

    expect(after.flowEvents.some((f) => f.tick === staleTick)).toBe(false);
    expect(after.flowEvents.some((f) => f.tick === freshTick)).toBe(true);
  });

  it("keeps a flow event sitting exactly on the retention floor, and drops the one a tick below it", async () => {
    // The window is inclusive of its floor: FLOW_HISTORY_TICKS is how many ticks of history are kept,
    // so an exclusive comparison would silently shorten every retention window by one tick.
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const T = 300;
    const floorTick = T + 1 - TRADE_SIMULATION.FLOW_HISTORY_TICKS; // the post-tick floor itself
    const [s0, s1] = base.systems;
    const flow = (tick: number) => ({
      tick, fromSystemId: s0.id, toSystemId: s1.id, goodId: "water", quantity: 5,
    });
    const world = {
      ...base,
      meta: { ...base.meta, currentTick: T },
      flowEvents: [flow(floorTick - 1), flow(floorTick)],
    };

    const { world: after } = await runWorldTick(world);

    expect(after.flowEvents.some((f) => f.tick === floorTick)).toBe(true);
    expect(after.flowEvents.some((f) => f.tick === floorTick - 1)).toBe(false);
  });
});

// ── logistics ↔ economy assessment ordering ──────────────────────────
// The tick runs economy BEFORE directed-logistics, so a cycle measures satisfaction/squeeze/unrest on
// the recipient's PRE-import stock; the import lands afterward and never rewrites an already-measured
// assessment. Same-tick logistics stock changes DO patch into build rows, but the persisted economy
// fields wait for the NEXT economy cycle. These pin exactly that ordering end to end.

/**
 * Two developed same-faction systems linked both ways, with a water gradient: the recipient (B) strips
 * its water producers and empties its water stock (a deficit sink that cannot self-supply), the donor
 * (A) holds a large water reserve above its anchor and keeps its producers. `prepareRecipientWater`
 * seeds the recipient's water assessment fields on top of the empty stock. Mirrors the water-gradient
 * fixture the directed-logistics wiring tests above use.
 */
function twoSystemWaterGradient(prepareRecipientWater: (market: WorldMarket) => WorldMarket) {
  const base = generateWorld({ systemCount: 100, seed: 42 });
  const a = base.factions[0].homeworldId;
  const b = base.factions[1].homeworldId;
  const factionId = base.factions[0].id;
  const world: World = {
    ...base,
    systems: base.systems.map((system) =>
      system.id === b ? { ...system, factionId, unrest: 0 } : system,
    ),
    // B loses its water producers → it cannot refill and stays a structural water deficit.
    buildings: base.buildings.filter(
      (building) => !(building.systemId === b && building.buildingType === "water"),
    ),
    markets: base.markets.map((market) => {
      if (market.systemId === a && market.goodId === "water") {
        return { ...market, stock: 1_000_000 };
      }
      if (market.systemId === b && market.goodId === "water") {
        return prepareRecipientWater({ ...market, stock: 0 });
      }
      return market;
    }),
    connections: [
      ...base.connections,
      { fromId: a, toId: b, fuelCost: 1 },
      { fromId: b, toId: a, fuelCost: 1 },
    ],
  };
  return { a, b, factionId, world };
}

describe("runWorldTick — logistics/assessment ordering", () => {
  it("assesses the pre-import state on a coincident cycle start, then recovers at the next economy cycle", async () => {
    const { b, world } = twoSystemWaterGradient((market) => market);
    const bWater = (w: World) => w.markets.find((m) => m.systemId === b && m.goodId === "water")!;
    const bSystem = (w: World) => w.systems.find((s) => s.id === b)!;

    // Coincident cycle start: economy (on CYCLE_LENGTH) AND logistics both resolve this tick. Construction stays off so
    // directed-build contributes no noise. Economy runs first — it measures B's empty water market — and
    // logistics moves the import in afterward.
    const cadence = { cycle: 1, logistics: 1, construction: 999 };
    const afterImport = (await runWorldTick(world, { cadence })).world;

    // The import happened this same tick: a water flow into B, and its stock rose off the empty floor.
    expect(afterImport.flowEvents.some((f) => f.toSystemId === b && f.goodId === "water")).toBe(true);
    expect(bWater(afterImport).stock).toBeGreaterThan(0);

    // …but the persisted assessment still describes the PRE-import (empty) state: satisfaction measured
    // zero delivery, the squeeze clock advanced by one reference-time from zero, and unrest rose off its
    // clean seed. A same-tick re-measure after the import would instead read satisfaction ≈ 1 and reset
    // the squeeze clock — this is the assertion that catches that regression.
    expect(bWater(afterImport).satisfaction).toBeCloseTo(0, 6);
    expect(bWater(afterImport).squeezeCycles).toBeCloseTo(catchUpFactor(1), 10);
    expect(bSystem(afterImport).unrest).toBeGreaterThan(0);

    // Next economy cycle: B now holds the imported water, so satisfaction recovers and the squeeze clock
    // resets. Direction of recovery only — magnitude calibration is out of scope here. (Missing ⇒ 1 is
    // the documented default; both reads are written by an economy cycle, so neither is actually absent.)
    const importSatisfaction = bWater(afterImport).satisfaction ?? 1;
    const afterRecovery = (await runWorldTick(afterImport, { cadence })).world;
    const recoverySatisfaction = bWater(afterRecovery).satisfaction ?? 1;
    expect(recoverySatisfaction).toBeGreaterThan(importSatisfaction);
    expect(bWater(afterRecovery).squeezeCycles).toBe(0);
  });

  it("retains the persisted assessment across a logistics-only tick until the next economy cycle", async () => {
    // Seed a distinctive rationed assessment the economy would NOT reproduce for this state (an empty,
    // productionless market would assess satisfaction 0 and realised rate 0), so retention is provable:
    // if any stage re-measured it, these exact values would move.
    const { b, world } = twoSystemWaterGradient((market) => ({
      ...market,
      satisfaction: 0.4,
      squeezeCycles: 0.5,
      realisedProductionRate: 5,
    }));
    const bWater = (w: World) => w.markets.find((m) => m.systemId === b && m.goodId === "water")!;

    // Logistics resolves; economy and construction do not.
    const afterLogistics = (
      await runWorldTick(world, { cadence: { cycle: 999, logistics: 1, construction: 999 } })
    ).world;

    // The import moved water in — stock changed.
    expect(afterLogistics.flowEvents.some((f) => f.toSystemId === b && f.goodId === "water")).toBe(true);
    expect(bWater(afterLogistics).stock).toBeGreaterThan(0);

    // …but the seeded assessment is carried through untouched: no economy cycle ran to re-measure it, and
    // logistics never writes these fields. A mid-cycle economy run, or a logistics-side re-measure, would
    // move at least one of them.
    expect(bWater(afterLogistics).satisfaction).toBe(0.4);
    expect(bWater(afterLogistics).squeezeCycles).toBe(0.5);
    expect(bWater(afterLogistics).realisedProductionRate).toBe(5);
  });
});

// ── applyBuildingIncreases: popCap's sole rise path ──────────────────
// popCap is stored and rises ONLY here — Math.max(s.popCap, housingPopCap(buildings)) when housing
// is among the landed types (mirrors the develop-transition seed). Infrastructure decay is
// downward-only and never repairs it, so a refactor that lands housing by another path, or drops the
// Math.max, silently welds a colony's cap to its seed level: it builds housing and never grows into
// it, with nothing else failing. These pin that one line.
describe("applyBuildingIncreases — popCap", () => {
  const firstSystem = () => toTickSystems(generateWorld({ systemCount: 100, seed: 42 }))[0];

  it("raises popCap when a completed housing project lands", () => {
    const base = { ...firstSystem(), popCap: 0 };
    const housingLevels = (base.buildings[HOUSING_TYPE] ?? 0) + 5;
    const [after] = applyBuildingIncreases(
      [base],
      [{ systemId: base.id, buildingType: HOUSING_TYPE, count: housingLevels }],
    );
    expect(after.popCap).toBe(housingPopCap({ ...base.buildings, [HOUSING_TYPE]: housingLevels }));
    expect(after.popCap).toBeGreaterThan(0);
  });

  it("leaves popCap unchanged when a non-housing project lands", () => {
    const base = { ...firstSystem(), popCap: 12_345 };
    const [after] = applyBuildingIncreases(
      [base],
      [{ systemId: base.id, buildingType: "food", count: (base.buildings["food"] ?? 0) + 3 }],
    );
    expect(after.popCap).toBe(12_345);
  });

  it("never lowers popCap — housing below the stored cap leaves it (the Math.max guard)", () => {
    const s = firstSystem();
    const housingLevels = (s.buildings[HOUSING_TYPE] ?? 0) + 1;
    // A stored cap deliberately above the landed housing's capacity: the guard must keep it.
    const capAbove = housingPopCap({ ...s.buildings, [HOUSING_TYPE]: housingLevels }) + 5_000;
    const base = { ...s, popCap: capAbove };
    const [after] = applyBuildingIncreases(
      [base],
      [{ systemId: base.id, buildingType: HOUSING_TYPE, count: housingLevels }],
    );
    expect(after.popCap).toBe(capAbove);
  });
});

// ── population, unrest and housing relief composed through the real tick ──
// Each mechanic below is covered in isolation by engine and processor tests. These drive the whole
// pipeline — economy assessment → infrastructure decay → population → directed-build — and assert on
// committed World state, because the failures worth catching live in the wiring: an unrest floor read
// from the wrong stage, a regime signal that never reaches the integrator, a relief valve reading a
// stale occupancy. Every expectation is derived from the constants and the stated formulas.

/** Housing levels the fixture homeworld stands on; popCap follows from it. */
const FIXTURE_HOUSING_LEVELS = 250;
const FIXTURE_POP_CAP = FIXTURE_HOUSING_LEVELS * POP_CENTRE_DENSITY;
/** The heaviest tax band, so the standing unrest floor is the largest a calm system can carry. */
const FIXTURE_TAX_LEVEL: TaxLevel = "very_high";
const TAX_FLOOR = TAX_LEVEL_UNREST_PRESSURE[FIXTURE_TAX_LEVEL];
/** Cover deep enough that delivery stays full for the whole run (the cycle clamps it to maxStock). */
const AMPLE_STOCK = 1e7;
/** An interval no fixture tick is a resolution cycle of — parks a stage for the run. */
const NEVER = 1_000_000;
/** Reference cycle, with construction and logistics parked: unrest and growth resolve at their
 *  calibrated per-cycle magnitudes (catchUpFactor = 1) and nothing else touches the fixture. */
const POPULATION_CADENCE: TickCadence = { cycle: CYCLE_LENGTH, construction: NEVER, logistics: NEVER };
/** A construction-only cycle: the build planner resolves against a world the economy has not moved. */
const CONSTRUCTION_CADENCE: TickCadence = { cycle: NEVER, construction: 1, logistics: NEVER };
/** Occupancy past CROWDING.BRAKE_END, where the growth brake is fully shut and crowding pressure maxes. */
const OVERSHOOT_OCCUPANCY = 1.16;
/** Stored unrest for the relief fixture — earned unrest, well past any standing floor. */
const RESTIVE_UNREST = 0.5;

/**
 * A developed homeworld reduced to housing alone, at a chosen occupancy r = population ÷ popCap and
 * stored unrest, owned by a faction taxed at the heaviest band. Stripping the producers is what makes
 * the supply regime a property of the fixture rather than of the galaxy: with no local output, every
 * consumed good is served purely from the seeded stock, so ample stock reads Supplied and an emptied
 * market reads famine-grade satisfaction on every demanded good at once. Its faction owns no other developed system, so
 * migration has no open edge and colonist delivery nets to zero — population moves only by growth.
 */
function populationFixture(occupancy: number, unrest: number): { world: World; systemId: string } {
  const base = generateWorld({ systemCount: 60, seed: 7 });
  const systemId = base.factions[0].homeworldId;
  const factionId = base.factions[0].id;
  const world: World = {
    ...base,
    systems: base.systems.map((s): WorldSystem =>
      s.id === systemId
        ? { ...s, population: occupancy * FIXTURE_POP_CAP, popCap: FIXTURE_POP_CAP, unrest }
        : s,
    ),
    buildings: [
      ...base.buildings.filter((b) => b.systemId !== systemId),
      { systemId, buildingType: HOUSING_TYPE, count: FIXTURE_HOUSING_LEVELS, idleCycles: 0 },
    ],
    markets: base.markets.map((m) =>
      m.systemId === systemId ? { ...m, stock: AMPLE_STOCK, satisfaction: 1 } : m,
    ),
    treasuries: base.treasuries.map((t): WorldFactionTreasury =>
      t.factionId === factionId ? { ...t, taxLevel: FIXTURE_TAX_LEVEL } : t,
    ),
  };
  return { world, systemId };
}

function fixtureSystem(world: World, systemId: string): WorldSystem {
  return world.systems.find((s) => s.id === systemId)!;
}

/**
 * Per-good satisfaction at the fixture system, restricted to the goods the economy actually folds
 * into D and the regime. A non-consumer is written satisfaction 1 and never enters either fold, so
 * sweeping every market would quietly require that every good at this homeworld carry civilian
 * demand. The filter mirrors the economy adapter's own predicate: civilian consumption > 0 at the
 * system's labour basis.
 */
function demandedSatisfactions(world: World, systemId: string): number[] {
  const system = fixtureSystem(world, systemId);
  const buildings: Record<string, number> = {};
  for (const b of world.buildings) if (b.systemId === systemId) buildings[b.buildingType] = b.count;
  const { basis } = computeSystemLabourSnapshot(buildings, system.population);
  return world.markets
    .filter((m) => m.systemId === systemId && consumptionRate(m.goodId, basis) > 0)
    .map((m) => m.satisfaction ?? 1);
}

/**
 * The D premise, asserted non-vacuously: every demanded good reads `expected`, AND the system has
 * demanded goods at all — a system with no consumers folds to D = 0 whatever its markets say, so
 * without the length check "all satisfied" could hold over an empty set.
 */
function expectDemandedSatisfaction(world: World, systemId: string, expected: number): void {
  const satisfactions = demandedSatisfactions(world, systemId);
  expect(satisfactions.length).toBeGreaterThan(0);
  for (const satisfaction of satisfactions) expect(satisfaction).toBe(expected);
}

/**
 * Whole housing levels the fixture system could still build — the people-land clamp on relief
 * sizing. Mirrors `habitableHousingHeadroom`: housing bills people land alone, never industry land
 * (deleted entirely — habitability-seeding, Task 15).
 */
function fixtureLandHeadroom(system: WorldSystem): number {
  const cost = effectiveSpaceCost(HOUSING_TYPE);
  const used = FIXTURE_HOUSING_LEVELS * cost;
  return Math.floor((system.peopleLand - used) / cost);
}

/**
 * The fixture population whose relief want is exactly `levels` whole housing levels — the inverse of
 * the planner's own sizing formula, `ceil((population ÷ RELIEF_TARGET − popCap) ÷ POP_CENTRE_DENSITY)`.
 * Lets a fixture be placed a chosen distance below a whole-level boundary, which is the only way a
 * per-cycle population change smaller than one level's worth of want (POP_CENTRE_DENSITY ×
 * RELIEF_TARGET) is observable in the committed level count at all.
 */
function populationForReliefWant(levels: number): number {
  return (FIXTURE_POP_CAP + levels * POP_CENTRE_DENSITY) * DIRECTED_BUILD.RELIEF_TARGET;
}

function withStock(world: World, systemId: string, stock: number): World {
  return {
    ...world,
    markets: world.markets.map((m) => (m.systemId === systemId ? { ...m, stock } : m)),
  };
}

describe("runWorldTick — population growth, unrest recovery and housing relief", () => {
  it("grows a fed, taxed system at the full rate at r = 0.97 and holds unrest at the tax floor", async () => {
    const { world, systemId } = populationFixture(0.97, TAX_FLOOR);
    const before = fixtureSystem(world, systemId);
    const after = await runTicks(world, CYCLE_LENGTH, POPULATION_CADENCE);
    const grown = fixtureSystem(after, systemId);

    // Premise: the cycle delivered every demanded good in full, so D folds to 0 and the regime is
    // Supplied whatever the demand weights.
    expectDemandedSatisfaction(after, systemId, 1);
    // Housing is untouched, so occupancy here is a pure population story — and it stays under the
    // cap, which is what leaves both the crowd brake open and the crowding term out of the floor.
    expect(grown.popCap).toBe(FIXTURE_POP_CAP);
    expect(grown.population).toBeLessThan(grown.popCap);

    // At D = 0 the integrator relaxes toward the standing floor, and this system starts exactly on
    // it: tax pressure alone (r ≤ 1 contributes no crowding), so unrest holds.
    expect(grown.unrest).toBeCloseTo(TAX_FLOOR, 12);

    // Growth runs at the FULL rate below the cap — crowdFactor is 1 for r ≤ 1 and the satisfaction
    // factor is 1 — against the standing floor's decline bite.
    const catchUp = catchUpFactor(CYCLE_LENGTH);
    const growth = POPULATION_PARAMS.growthRate * before.population;
    const decline = POPULATION_PARAMS.declineRate * before.population * TAX_FLOOR;
    expect(grown.population).toBeCloseTo(before.population + (growth - decline) * catchUp, 6);

    // Discrimination: a headroom-scaled growth term would leave only 3% of the rate at r = 0.97 —
    // not merely slower, but a net DECLINE against the same tax floor.
    const headroomScaled = growth * (1 - before.population / before.popCap);
    expect(headroomScaled - decline).toBeLessThan(0);
    expect(grown.population).toBeGreaterThan(before.population);
  }, 60_000);

  it("brakes growth to zero past the crowd-brake end without taking overshoot death below the gate", async () => {
    expect(OVERSHOOT_OCCUPANCY).toBeGreaterThan(CROWDING.BRAKE_END);
    // Standing floor at full overcrowding: tax plus the capped crowding pressure.
    const floor = TAX_FLOOR + CROWDING.PRESSURE_MAX;
    const { world, systemId } = populationFixture(OVERSHOOT_OCCUPANCY, floor);
    const before = fixtureSystem(world, systemId);
    const after = await runTicks(world, CYCLE_LENGTH, POPULATION_CADENCE);
    const crowded = fixtureSystem(after, systemId);

    expectDemandedSatisfaction(after, systemId, 1);
    // Still overcrowded, and housing never rose to meet it (the cap only moves by construction/decay).
    expect(crowded.popCap).toBe(FIXTURE_POP_CAP);
    expect(crowded.population).toBeGreaterThan(crowded.popCap);
    // Crowding pressure saturates past the brake end, so unrest settles on that floor and stays there.
    expect(crowded.unrest).toBeCloseTo(floor, 12);
    // The whole point: even fully overcrowded, the standing floor is nowhere near the collapse gate.
    expect(crowded.unrest).toBeLessThan(POPULATION_PARAMS.overshootDeathUnrestGate);

    // Growth is braked to exactly zero, so the cycle's only population term is the unrest decline —
    // no overshoot death, though the overshoot itself is large.
    const catchUp = catchUpFactor(CYCLE_LENGTH);
    const decline = POPULATION_PARAMS.declineRate * before.population * floor;
    expect(crowded.population).toBeCloseTo(before.population - decline * catchUp, 6);

    // Discrimination: an ungated death term would have removed a further large slice of the overshoot.
    const ungatedDeath =
      POPULATION_PARAMS.overshootDeathRate * (before.population - before.popCap) * floor;
    expect(ungatedDeath).toBeGreaterThan(0);
    expect(crowded.population).toBeGreaterThan(before.population - (decline + ungatedDeath) * catchUp);
  }, 60_000);

  it("drains stored unrest geometrically at the single relaxation rate after one full-shortage cycle", async () => {
    const { world, systemId } = populationFixture(0.92, TAX_FLOOR);
    // Empty the fixture system on the tick before the assessment, so the cycle measures a market
    // that cannot deliver — and nothing else has had a chance to move it.
    const drained = withStock(
      await runTicks(world, CYCLE_LENGTH - 1, POPULATION_CADENCE),
      systemId,
      0,
    );
    const shortageCycle = await runTicks(drained, 1, POPULATION_CADENCE);

    // Premise: every demanded good delivered nothing, so D folds to exactly 1 and the supply state
    // reads Famine — both independent of the necessity weights.
    expectDemandedSatisfaction(shortageCycle, systemId, 0);
    // The system entered on its floor, so the relaxation term is zero and the whole rise is the
    // shortage gain integrating D = 1. Gain is slope x relaxation rate, derived here rather than
    // named, so the assertion follows a slope retune instead of going stale against one.
    const shortageGain = UNREST_PARAMS.slopeShortage * UNREST_PARAMS.decay;
    const shortageUnrest = fixtureSystem(shortageCycle, systemId).unrest;
    expect(shortageUnrest).toBeCloseTo(TAX_FLOOR + shortageGain, 12);
    // One bad cycle from the floor is recoverable — it does not reach the strike regime.
    expect(shortageUnrest).toBeLessThan(STRIKE_PARAMS.threshold);

    // Restock: the next assessment finds the market able to deliver again.
    let recovering = withStock(shortageCycle, systemId, AMPLE_STOCK);
    const unrestByCycle: number[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      recovering = await runTicks(recovering, CYCLE_LENGTH, POPULATION_CADENCE);
      // Supply is restored immediately — the regime flips back the very first assessment, and the
      // recovery below is the memory draining, not the shortage still being measured.
      expectDemandedSatisfaction(recovering, systemId, 1);
      unrestByCycle.push(fixtureSystem(recovering, systemId).unrest);
    }

    // The stored excess above the floor decays geometrically at the single relaxation rate — the
    // same rate the shortage cycle above integrated its gain at. There is no second, faster rate
    // for the now-Supplied label to fall back on.
    const excess = shortageGain;
    const retained = 1 - UNREST_PARAMS.decay;
    unrestByCycle.forEach((unrest, index) => {
      expect(unrest).toBeCloseTo(TAX_FLOOR + excess * retained ** (index + 1), 12);
    });

    // Stated as the law rather than the values: each cycle keeps exactly (1 - decay) of the
    // previous excess, whatever the label. A relaxation that snaps straight to the floor, or that
    // ran at a second rate for the Supplied label, breaks this ratio while still "going down".
    const excessByCycle = [shortageUnrest, ...unrestByCycle].map((u) => u - TAX_FLOOR);
    for (let i = 1; i < excessByCycle.length; i++) {
      expect(excessByCycle[i]).toBeGreaterThan(0);
      expect(excessByCycle[i]).toBeLessThan(excessByCycle[i - 1]);
      expect(excessByCycle[i] / excessByCycle[i - 1]).toBeCloseTo(retained, 10);
    }
    // Housing never moved and occupancy stayed under the cap, so the floor was pure tax pressure —
    // with no crowding term drifting into it — across the whole recovery.
    const recovered = fixtureSystem(recovering, systemId);
    expect(recovered.popCap).toBe(FIXTURE_POP_CAP);
    expect(recovered.population).toBeLessThan(recovered.popCap);
  }, 120_000);

  it("commits relief housing sized back to the relief target on a fed but deeply restive system", async () => {
    const { world, systemId } = populationFixture(0.97, RESTIVE_UNREST);
    const before = fixtureSystem(world, systemId);

    // Fed: the persisted satisfactions the planner folds are full, so supply-dissatisfaction is 0.
    expectDemandedSatisfaction(world, systemId, 1);
    // Restive: unrest sits above the largest standing floor a system can carry (tax + full crowding),
    // so this is earned unrest, not baseline. The valve reads supply alone and opens anyway —
    // crowding is itself an unrest source, so a calm gate would starve the world that needs relief.
    expect(before.unrest).toBeGreaterThan(TAX_FLOOR + CROWDING.PRESSURE_MAX);
    // Armed: occupancy is past the relief trigger.
    expect(before.population).toBeGreaterThan(DIRECTED_BUILD.RELIEF_TRIGGER * FIXTURE_POP_CAP);

    const after = (await runWorldTick(world, { cadence: CONSTRUCTION_CADENCE })).world;

    // Sized to bring occupancy back to the relief target, rounded up to whole levels:
    // (4850 / 0.92 - 5000) / 20 = 13.59 → 14.
    const reliefLevels = Math.ceil(
      (before.population / DIRECTED_BUILD.RELIEF_TARGET - FIXTURE_POP_CAP) / POP_CENTRE_DENSITY,
    );
    expect(reliefLevels).toBe(14);
    // The want is what sizes the build: relief is also clamped to the land, and this homeworld has
    // ~688 whole housing levels of headroom left after its 250, so the clamp is nowhere near binding.
    expect(fixtureLandHeadroom(before)).toBeGreaterThanOrEqual(reliefLevels);

    const reliefProjects = after.constructionProjects.filter(
      (p): p is WorldBuildProject =>
        p.kind === "build" && p.systemId === systemId && p.buildingType === HOUSING_TYPE,
    );
    expect(reliefProjects).toHaveLength(1);
    expect(reliefProjects[0].levels).toBe(reliefLevels);
    // Once it lands, occupancy is at or under the relief target.
    const relievedCap = (FIXTURE_HOUSING_LEVELS + reliefProjects[0].levels) * POP_CENTRE_DENSITY;
    expect(before.population / relievedCap).toBeLessThanOrEqual(DIRECTED_BUILD.RELIEF_TARGET);

    // It is a commitment, not an instant build: no level has landed and the cap has not moved.
    expect(reliefProjects[0].workDone).toBeLessThan(reliefProjects[0].workTotal);
    expect(
      after.buildings.find((b) => b.systemId === systemId && b.buildingType === HOUSING_TYPE)?.count,
    ).toBe(FIXTURE_HOUSING_LEVELS);
    expect(fixtureSystem(after, systemId).popCap).toBe(FIXTURE_POP_CAP);
  }, 60_000);

  it("sizes relief housing to the population the same cycle just grew, at the shipped cadence", async () => {
    // CYCLE_LENGTH and CONSTRUCTION_INTERVAL are equal as shipped, so the relief valve's real cycle
    // always coincides with the economy and population stages and the planner reads the POST-growth
    // population. The fixture above parks the economy to buy an exact closed form; this one runs the
    // DEFAULT cadence and pins the stage ordering instead, on ranges rather than a level count, so it
    // does not re-encode world-gen incidentals.
    //
    // The observable is discrete — one whole housing level is POP_CENTRE_DENSITY × RELIEF_TARGET =
    // 18.4 pop of relief want — while one cycle's net growth here is ~1.5 pop, so the fixture is placed
    // deliberately rather than at a round occupancy: the PRE-growth want sits BOUNDARY_SLACK below a
    // whole level. A post-population-stage read then commits exactly one more level than a
    // start-of-tick read would, for any per-cycle growth between 0.18 and 18.6 pop — an ~8x slowdown or
    // a ~12x speed-up of the growth rate either side of what this fixture actually grows.
    const BOUNDARY_LEVELS = 14;
    const BOUNDARY_SLACK = 0.01; // levels — 0.18 pop, far above float noise, far below one cycle's growth
    const { world, systemId } = populationFixture(
      populationForReliefWant(BOUNDARY_LEVELS - BOUNDARY_SLACK) / FIXTURE_POP_CAP,
      RESTIVE_UNREST,
    );
    const before = fixtureSystem(world, systemId);
    const after = await runTicks(world, CYCLE_LENGTH);
    const grown = fixtureSystem(after, systemId);

    expectDemandedSatisfaction(after, systemId, 1);
    // The cycle grew the system and shed some of its unrest, and it is still both restive and armed.
    expect(grown.population).toBeGreaterThan(before.population);
    expect(grown.unrest).toBeGreaterThan(TAX_FLOOR + CROWDING.PRESSURE_MAX);
    expect(grown.population).toBeGreaterThan(DIRECTED_BUILD.RELIEF_TRIGGER * FIXTURE_POP_CAP);

    const reliefProjects = after.constructionProjects.filter(
      (p): p is WorldBuildProject =>
        p.kind === "build" && p.systemId === systemId && p.buildingType === HOUSING_TYPE,
    );
    expect(reliefProjects).toHaveLength(1);
    const reliefLevels = reliefProjects[0].levels;
    expect(reliefLevels).toBeGreaterThanOrEqual(1);
    expect(reliefProjects[0].workDone).toBeLessThan(reliefProjects[0].workTotal);
    // Land is not the binding constraint, so the relief want is what sized this.
    expect(fixtureLandHeadroom(grown)).toBeGreaterThanOrEqual(reliefLevels);
    // Sized to bring the GROWN occupancy back to the relief target.
    const relievedCap = (FIXTURE_HOUSING_LEVELS + reliefLevels) * POP_CENTRE_DENSITY;
    expect(grown.population / relievedCap).toBeLessThanOrEqual(DIRECTED_BUILD.RELIEF_TARGET);

    // The ordering itself: sizing against the population as it stood BEFORE the cycle would have
    // committed strictly fewer levels, so this pins that directed-build read population after the
    // population stage rather than from the start-of-tick snapshot.
    const preGrowthLevels = Math.ceil(
      (before.population / DIRECTED_BUILD.RELIEF_TARGET - FIXTURE_POP_CAP) / POP_CENTRE_DENSITY,
    );
    // Premise: the fixture really is parked just under the boundary, so the discrimination below is
    // one level of growth crossing it — not a fixture that was already a level clear either way.
    expect(preGrowthLevels).toBe(BOUNDARY_LEVELS);
    expect(reliefLevels).toBe(BOUNDARY_LEVELS + 1);
    expect(reliefLevels).toBeGreaterThan(preGrowthLevels);
  }, 60_000);
});

// ── the realised per-cycle population change ─────────────────────────
// `WorldSystem.populationChange` is written by the tick body itself, after directed-build's
// `applyDevelopments` — not by the population processor, which never sees migration's or
// colony-founding's effect. These pin the write's migration inclusion, its colony-founding-donor
// inclusion, its absence convention and its reference-cycle denomination. Whether anything inside
// the tick reads it back is proven separately (the poisoning test below) rather than by `npm run
// simulate`'s before/after comparison, which is a broader, owner-run gate.

/** Reads `populationChange` off a system row, failing with a clear message rather than silently
 *  treating an unassessed system as 0 — the exact distinction these tests exist to pin. */
function requirePopulationChange(world: World, systemId: string): number {
  const value = fixtureSystem(world, systemId).populationChange;
  if (value === undefined) throw new Error(`expected populationChange to be assessed for ${systemId}`);
  return value;
}

/** One (donor, recipient) colony-founding pair, plus the pre-tick world states the founding tests
 *  below diverge from — derived by running the fixture forward and watching every colony_establish
 *  project that appears, rather than hardcoding which pair forms and when: that pacing, AND which
 *  donor (if any) ever has a spare survival-good surplus to ship, are both functions of the
 *  archetype/sun-class tables, not constants these tests own.
 *
 *  The completion pair and the staging pair are tracked independently and may be different
 *  projects: a donor can be a net-neutral producer of one survival good (production ≈ its own
 *  consumption, stock sitting under `donorReserve × SURPLUS_MARGIN` — `surplusDrawable`,
 *  `lib/engine/directed-logistics.ts:87`) for its entire founding, in which case that colony's
 *  manifest never carries both goods in one cycle though it completes normally — real economics,
 *  not a bug, so the completion premise and the staging premise each search across every project
 *  the run produces rather than assuming the first one satisfies both. */
interface FoundingFixture {
  sourceSystemId: string;
  targetSystemId: string;
  /** World state one tick before the (first-found) project's establish work completes (target
   *  still `controlled`). */
  completionPreWorld: World;
  /** Tick at which the completion pair's project actually completes — `runWorldTick(base)` run
   *  this many times lands on `completionPreWorld`'s successor, target `developed`. */
  completionTick: number;
  /** The world the completion tick itself produced — `runWorldTick(completionPreWorld).world`,
   *  cached rather than recomputed, since callers that need the post-completion state (not just
   *  the pre/post pair around it) would otherwise have to re-run the whole fixture from `base`. */
  completionWorld: World;
  /** The donor of whichever project (possibly a different one) is first observed shipping both
   *  survival goods in one staging cycle. */
  stagingSourceSystemId: string;
  stagingTargetSystemId: string;
  /** World state one tick before that staging cycle. */
  stagingPreWorld: World;
}

async function deriveFoundingFixture(base: World, maxTicks = 20_000): Promise<FoundingFixture> {
  interface ProjectTrack {
    sourceSystemId: string;
    targetSystemId: string;
    goodsSeen: Set<string>;
    stagingPreWorld?: World;
  }
  const tracked = new Map<string, ProjectTrack>(); // keyed by targetSystemId

  let world = base;
  let completion:
    | { sourceSystemId: string; targetSystemId: string; completionPreWorld: World; completionTick: number }
    | undefined;
  let completionWorld: World | undefined;
  let staging: { sourceSystemId: string; targetSystemId: string; stagingPreWorld: World } | undefined;

  for (let t = 1; t <= maxTicks; t++) {
    const preTickWorld = world;
    const result = await runWorldTick(world);
    world = result.world;

    for (const p of world.constructionProjects) {
      if (p.kind !== "colony_establish") continue;
      if (!tracked.has(p.systemId)) {
        tracked.set(p.systemId, { sourceSystemId: p.sourceSystemId, targetSystemId: p.systemId, goodsSeen: new Set() });
      }
    }

    if (!staging) {
      for (const m of result.instrumentation.foundingManifests ?? []) {
        const track = tracked.get(m.systemId);
        if (!track || track.stagingPreWorld) continue;
        for (const g of m.goodIds) track.goodsSeen.add(g);
        if (SURVIVAL_GOODS.every((g) => track.goodsSeen.has(g))) track.stagingPreWorld = preTickWorld;
      }
      const ready = [...tracked.values()].find((tr) => tr.stagingPreWorld);
      if (ready) {
        staging = {
          sourceSystemId: ready.sourceSystemId,
          targetSystemId: ready.targetSystemId,
          stagingPreWorld: ready.stagingPreWorld!,
        };
      }
    }

    if (!completion) {
      for (const track of tracked.values()) {
        const targetNow = world.systems.find((s) => s.id === track.targetSystemId);
        const targetBefore = preTickWorld.systems.find((s) => s.id === track.targetSystemId);
        if (targetNow?.control === "developed" && targetBefore?.control !== "developed") {
          completion = {
            sourceSystemId: track.sourceSystemId,
            targetSystemId: track.targetSystemId,
            completionPreWorld: preTickWorld,
            completionTick: t,
          };
          completionWorld = world;
          break;
        }
      }
    }

    if (completion && staging) {
      return {
        sourceSystemId: completion.sourceSystemId,
        targetSystemId: completion.targetSystemId,
        completionPreWorld: completion.completionPreWorld,
        completionTick: completion.completionTick,
        completionWorld: completionWorld!,
        stagingSourceSystemId: staging.sourceSystemId,
        stagingTargetSystemId: staging.targetSystemId,
        stagingPreWorld: staging.stagingPreWorld,
      };
    }
  }
  throw new Error(
    `did not observe both a completed colony_establish project and a donor staging both survival ` +
    `goods in one cycle within ${maxTicks} ticks`,
  );
}

/** All three founding-fixture tests below derive from the identical seed-11/90-system galaxy, and
 *  `deriveFoundingFixture` is deterministic given that base — so the walk-forward (thousands of real
 *  ticks) only needs to run once per test-file invocation, not once per test. Memoized rather than
 *  computed at module load so it still only pays the cost when a test actually needs it. */
let foundingFixtureCache: Promise<FoundingFixture> | null = null;
function foundingFixture(): Promise<FoundingFixture> {
  foundingFixtureCache ??= deriveFoundingFixture(generateWorld({ systemCount: 90, seed: 11 }));
  return foundingFixtureCache;
}

/** A developed homeworld reduced to housing alone (mirrors `populationFixture`), at a chosen
 *  occupancy and unrest, with no treasury override — used where the test needs the source system's
 *  starting row to be byte-identical across two worlds that only then diverge elsewhere. */
function overshotHomeworld(base: World, systemId: string, occupancy: number, unrest: number): World {
  return {
    ...base,
    systems: base.systems.map((s): WorldSystem =>
      s.id === systemId
        ? { ...s, population: occupancy * FIXTURE_POP_CAP, popCap: FIXTURE_POP_CAP, unrest }
        : s,
    ),
    buildings: [
      ...base.buildings.filter((b) => b.systemId !== systemId),
      { systemId, buildingType: HOUSING_TYPE, count: FIXTURE_HOUSING_LEVELS, idleCycles: 0 },
    ],
    markets: base.markets.map((m) =>
      m.systemId === systemId ? { ...m, stock: AMPLE_STOCK, satisfaction: 1 } : m,
    ),
  };
}

describe("runWorldTick — the realised per-cycle population change (WorldSystem.populationChange)", () => {
  it("includes migration: a system whose population falls only through outflow reports a negative change, not the near-0 a pre-migration read would give", async () => {
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const source = base.factions[0].homeworldId;
    const destination = base.factions[1].homeworldId;
    const factionId = base.factions[0].id;

    // Isolated: the source alone, fully crowd-braked (growth pinned to 0) and past its cap
    // (repulsive), well-fed so d = 0 — its faction owns no other developed system, so migration has
    // no open edge to move anyone. Its populationChange is therefore exactly the pre-migration
    // engine read: growth(0) minus a tiny standing-crowding decline.
    const isolatedWorld = overshotHomeworld(base, source, OVERSHOOT_OCCUPANCY, 0);
    const isolatedAfter = await runTicks(isolatedWorld, CYCLE_LENGTH, POPULATION_CADENCE);
    const isolatedChange = requirePopulationChange(isolatedAfter, source);

    // Connected: the same source row (byte-identical starting state), plus a calm, mostly-empty
    // same-faction destination linked by one hop. The attractiveness gradient (calmer, far roomier)
    // pulls a real share of the source's population out this cycle.
    const connectedWorld: World = {
      ...isolatedWorld,
      systems: isolatedWorld.systems.map((s): WorldSystem =>
        s.id === destination
          ? { ...s, factionId, population: 0.05 * FIXTURE_POP_CAP, popCap: FIXTURE_POP_CAP, unrest: 0 }
          : s,
      ),
      connections: [
        ...isolatedWorld.connections,
        { fromId: source, toId: destination, fuelCost: 1 },
        { fromId: destination, toId: source, fuelCost: 1 },
      ],
    };
    const connectedAfter = await runTicks(connectedWorld, CYCLE_LENGTH, POPULATION_CADENCE);
    const connectedChange = requirePopulationChange(connectedAfter, source);

    // The isolated run is near-flat (only the tiny standing-crowding decline term); the connected
    // run is clearly, substantially more negative — the gap is migration's own contribution, which
    // a write of the pre-migration delta alone could never show.
    // Thresholds re-derived for `maxOutflowFraction` 0.01 → 0.0003 (÷33.3, timescale change): outflow
    // itself shrinks by the same factor, so a bound sized for the old rate (isolated < 20, connected
    // < −50) no longer holds — measured isolated ≈ −0.017, connected ≈ −14.6, still a ~840× gap. −5
    // sits well below the isolated near-zero read and comfortably inside the measured connected
    // magnitude, preserving the same qualitative claim (migration's contribution is real and large
    // relative to the pre-migration read) without pinning to the exact measured figure.
    expect(Math.abs(isolatedChange)).toBeLessThan(20);
    expect(connectedChange).toBeLessThan(-5);
    expect(connectedChange - isolatedChange).toBeLessThan(-5);
  }, 30_000);

  it("clears on abandonment and again on redevelopment, so a re-founded colony never inherits its predecessor's reading", () => {
    const base = toTickSystems(generateWorld({ systemCount: 100, seed: 42 }))[0];
    const stale: TickSystem = { ...base, populationChange: -42 };

    const [abandoned] = applyAbandonments([stale], [stale.id]);
    expect(abandoned.populationChange).toBeUndefined();

    // Redevelopment: a fresh establishment lands on the now-unclaimed system, sourced from a
    // co-located donor with population to spare. Re-staled deliberately before this step — feeding
    // applyAbandonments' own (already-verified) absence through would let applyDevelopments' clear
    // go untested vacuously; this isolates that this function clears the field on its own contract,
    // not merely because the row already happened to arrive absent.
    const restaled: TickSystem = { ...abandoned, populationChange: -99 };
    const donor: TickSystem = {
      ...abandoned, id: `${abandoned.id}-donor`, population: 1000, populationChange: -7,
    };
    const development: SystemDevelopment = {
      systemId: restaled.id, sourceSystemId: donor.id, seedPop: 10, housingLevels: 1, stockManifest: [],
    };
    const [redeveloped] = applyDevelopments([restaled, donor], [development]);
    expect(redeveloped.populationChange).toBeUndefined();
  });

  it("a never-assessed system reports populationChange absent, and it survives a save round-trip as absent, not 0", async () => {
    const generated = generateWorld({ systemCount: 100, seed: 42 });
    const developed = generated.systems.find((s) => s.control === "developed");
    if (!developed) throw new Error("expected at least one developed system in a freshly generated world");
    expect(developed.populationChange).toBeUndefined();
    expect("populationChange" in developed).toBe(false);

    // One real tick — day 1, not a cycle boundary — so the economy/population stages never resolve
    // and this system is never assessed, but `toTickSystems`/`mergeSystemsIntoWorld` (the join/merge
    // pair the field's absence has to survive, `lib/world/tick.ts`) still run, unconditionally, on
    // every tick. This exercises that pair rather than only the type declaration.
    const after = (await runWorldTick(generated)).world;
    const untouched = after.systems.find((s) => s.id === developed.id);
    if (!untouched) throw new Error("expected the ticked world to still carry this system");
    expect(untouched.populationChange).toBeUndefined();
    expect("populationChange" in untouched).toBe(false);

    const result = deserialiseWorld(serialiseWorld(after));
    if (!result.ok) throw new Error(`expected the save round-trip to succeed: ${result.error}`);
    const reloaded = result.world.systems.find((s) => s.id === developed.id);
    if (!reloaded) throw new Error("expected the reloaded world to still carry this system");
    expect(reloaded.populationChange).toBeUndefined();
    expect("populationChange" in reloaded).toBe(false);
  });

  it("a stored populationChange of exactly 0 survives the tick's join/merge pair, distinguishably from absent", async () => {
    // The hazard is representational: 0 is falsy, so a merge written as `value || undefined`
    // (or a truthiness-guarded copy) would silently turn a legitimate steady-cycle reading into
    // "absent". There is no world state that deterministically produces an exact-zero realised
    // change under the live constants (every zero-growth arrangement raises unrest, making the
    // decline term nonzero; a zero-population system abandons at ABANDON_POP_FLOOR instead), so
    // the 0 is planted directly and carried through a real non-cycle tick — the same
    // `toTickSystems`/`mergeSystemsIntoWorld` pair the absence test above drives, exercised on
    // every tick. The write-site arithmetic itself is pinned by the definitional test below.
    const { world, systemId } = populationFixture(0.5, 0);
    const planted: World = {
      ...world,
      systems: world.systems.map((s) => (s.id === systemId ? { ...s, populationChange: 0 } : s)),
    };
    const after = (await runWorldTick(planted)).world;

    const change = fixtureSystem(after, systemId).populationChange;
    expect(change).not.toBeUndefined();
    expect(change).toBe(0);
  });

  it("IS the realised change: the figure equals (population after − population before) ÷ catchUpFactor, at both cadences", async () => {
    // The definitional test. Every other assertion in this describe is directional (a threshold, or
    // one run against another), so a regression that moved the snapshot to the wrong side of a
    // stage — measuring migration alone, say, or growth alone — would keep its sign and its rough
    // size and survive all of them. This one computes the figure from world state the tick itself
    // committed and admits no other answer.
    for (const cycle of [CYCLE_LENGTH, CYCLE_LENGTH * 2]) {
      const { world, systemId } = populationFixture(0.97, TAX_FLOOR);
      const before = fixtureSystem(world, systemId).population;
      // One tick, fast-forwarded to its own cycle boundary — the same device the cadence test below
      // uses, so the two cadences differ in catchUpFactor and nothing else.
      const cadence: TickCadence = { cycle, construction: NEVER, logistics: NEVER };
      const atBoundary: World = { ...world, meta: { ...world.meta, currentTick: cycle - 1 } };
      const after = (await runWorldTick(atBoundary, { cadence })).world;

      const realised = fixtureSystem(after, systemId).population - before;
      // Non-vacuous: the cycle actually moved population, so the identity is not 0 === 0.
      expect(Math.abs(realised), `cycle ${cycle}`).toBeGreaterThan(1);
      expect(requirePopulationChange(after, systemId), `cycle ${cycle}`)
        .toBeCloseTo(realised / catchUpFactor(cycle), 6);
    }
    // …and the two cadences really did denominate differently, or the loop above proved one case
    // twice: catchUpFactor is 1 at the reference cycle and 2 at twice it.
    expect(catchUpFactor(CYCLE_LENGTH)).toBe(1);
    expect(catchUpFactor(CYCLE_LENGTH * 2)).toBe(2);
  }, 30_000);

  it("denominates per reference cycle: retuning CYCLE_LENGTH away from REFERENCE_INTERVAL leaves the figure unchanged", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const systemId = base.factions[0].homeworldId;
    const factionId = base.factions[0].id;
    // Calm, uncrowded, tax-free growth: d = 0 (ample stock), unrest held at exactly 0 by a zero
    // standing floor (no tax, no crowding at r < 1) — the one scenario where the population
    // processor's own relaxation-rate scaling (itself catchUp-dependent) can't introduce a
    // cadence-dependent difference this test isn't about.
    const world: World = {
      ...base,
      systems: base.systems.map((s): WorldSystem =>
        s.id === systemId
          ? { ...s, population: 0.9 * FIXTURE_POP_CAP, popCap: FIXTURE_POP_CAP, unrest: 0 }
          : s,
      ),
      buildings: [
        ...base.buildings.filter((b) => b.systemId !== systemId),
        { systemId, buildingType: HOUSING_TYPE, count: FIXTURE_HOUSING_LEVELS, idleCycles: 0 },
      ],
      markets: base.markets.map((m) =>
        m.systemId === systemId ? { ...m, stock: AMPLE_STOCK, satisfaction: 1 } : m,
      ),
      treasuries: base.treasuries.map((t): WorldFactionTreasury =>
        t.factionId === factionId ? { ...t, taxLevel: "very_low" } : t,
      ),
    };

    // One real tick each, fast-forwarded to its own cycle boundary via meta.currentTick — avoids
    // running dozens of intervening ticks (and their independent stochastic event draws) that a
    // longer cadence would otherwise need, which would confound the comparison this test is about.
    const referenceCadence: TickCadence = { cycle: REFERENCE_INTERVAL, logistics: NEVER, construction: NEVER };
    const referenceWorld: World = { ...world, meta: { ...world.meta, currentTick: REFERENCE_INTERVAL - 1 } };
    const referenceAfter = (await runWorldTick(referenceWorld, { cadence: referenceCadence })).world;

    const retunedCycle = REFERENCE_INTERVAL * 2;
    const retunedCadence: TickCadence = { cycle: retunedCycle, logistics: NEVER, construction: NEVER };
    const retunedWorld: World = { ...world, meta: { ...world.meta, currentTick: retunedCycle - 1 } };
    const retunedAfter = (await runWorldTick(retunedWorld, { cadence: retunedCadence })).world;

    const reference = requirePopulationChange(referenceAfter, systemId);
    const retuned = requirePopulationChange(retunedAfter, systemId);

    expect(reference).toBeGreaterThan(0); // non-vacuous: real growth happened, not two zeros agreeing
    expect(retuned).toBeCloseTo(reference, 6);
  });

  it("nothing inside the tick reads populationChange — poisoning the input changes no other output", async () => {
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const poisoned: World = {
      ...base,
      systems: base.systems.map((s): WorldSystem => ({ ...s, populationChange: -999_999 })),
    };

    const clean = await runTicksCapturingLast(base, 50);
    const dirty = await runTicksCapturingLast(poisoned, 50);

    // populationChange itself legitimately differs run to run (each is a fresh per-cycle read over
    // the same underlying dynamics) — stripped before comparing; everything else, including every
    // harness/instrumentation figure, must be byte-identical.
    const strip = (w: World): World => ({
      ...w,
      systems: w.systems.map((s): WorldSystem => ({ ...s, populationChange: undefined })),
    });
    expect(strip(dirty.world)).toEqual(strip(clean.world));
    expect(dirty.markets).toEqual(clean.markets);
    expect(dirty.events).toEqual(clean.events);
    expect(dirty.instrumentation).toEqual(clean.instrumentation);
  }, 30_000);

  // ── colony-founding donation, driven through runWorldTick, not applyDevelopments directly ──
  // A galaxy (seed 11, 90 systems) funds and completes a real colony-establish project — which
  // donor seeds which recipient, and on what tick, is derived programmatically by
  // `deriveFoundingFixture` rather than hardcoded, since that pacing is a function of the
  // archetype/sun-class tables. `EXPANSION.COLONY_SEED_POP` fixes the donation at exactly 2
  // regardless of fixture size, so "unmistakably different" comes from a same-tick counterfactual
  // rather than a huge donor: two clones of the identical pre-tick world (same `meta.currentTick`,
  // so `tickRng(seed, tick)` draws identically in both — `lib/world/tick.ts:154`) diverge ONLY in
  // whether directed-build resolves this tick, isolating the donation's contribution to the
  // donor's populationChange exactly, with no other system's dynamics free to differ between the
  // two branches.
  it("includes a colony-founding donation: the donor's populationChange is NOT short by the seed it gave away", async () => {
    const { sourceSystemId, targetSystemId, completionPreWorld: preWorld } = await foundingFixture();

    const withDonation = (await runWorldTick(preWorld)).world;
    const withoutDonation = (await runWorldTick(preWorld, {
      cadence: { cycle: CYCLE_LENGTH, logistics: LOGISTICS_INTERVAL, construction: NEVER },
    })).world;

    // Premise: the two branches genuinely diverge on founding this exact tick, not on some
    // unrelated effect — the fixture's colony completes only when directed-build is allowed to run.
    expect(fixtureSystem(withDonation, targetSystemId).control).toBe("developed");
    expect(fixtureSystem(withoutDonation, targetSystemId).control).toBe("controlled");

    const donationInclusive = requirePopulationChange(withDonation, sourceSystemId);
    const migrationOnly = requirePopulationChange(withoutDonation, sourceSystemId);

    expect(donationInclusive).toBeLessThan(migrationOnly);
    // The gap is exactly the seed transfer, denominated per reference cycle (catchUpFactor
    // (CYCLE_LENGTH) = 1 here, since CYCLE_LENGTH === REFERENCE_INTERVAL) — not a coincidental
    // drift, since both branches share identical migration/economy/logistics rng draws this tick.
    expect(migrationOnly - donationInclusive).toBeCloseTo(
      EXPANSION.COLONY_SEED_POP / catchUpFactor(CYCLE_LENGTH), 6,
    );
  }, 120_000);

  it("a system that donates nothing is unaffected by the move — its figure is identical whether or not directed-build resolves this tick", async () => {
    const base = generateWorld({ systemCount: 90, seed: 11 });
    const preWorld = await runTicks(base, 431);

    const withDonation = (await runWorldTick(preWorld)).world;
    const withoutDonation = (await runWorldTick(preWorld, {
      cadence: { cycle: CYCLE_LENGTH, logistics: LOGISTICS_INTERVAL, construction: NEVER },
    })).world;

    // Two colonies complete simultaneously in this fixture (system-50→system-40 and
    // system-85→system-77, both verified above/empirically) — excluded so the bystander really is
    // uninvolved in either branch's founding.
    const donors = new Set(["system-50", "system-85"]);
    const bystander = withDonation.systems.find(
      (s) => s.control === "developed" && !donors.has(s.id) && s.populationChange !== undefined,
    );
    if (!bystander) {
      throw new Error("expected an uninvolved developed system with an assessed populationChange this cycle");
    }

    const withDonationValue = requirePopulationChange(withDonation, bystander.id);
    const withoutDonationValue = requirePopulationChange(withoutDonation, bystander.id);
    expect(withDonationValue).toBe(withoutDonationValue);
  }, 30_000);

  it("a system founded, abandoned and later redeveloped reports populationChange absent, not its predecessor's value — driven through runWorldTick across real cycles", async () => {
    // Same programmatic derivation the donation test above uses, rather than a hardcoded colony/tick
    // pair — which project completes first, and when, shifts with the archetype/sun-class tables.
    const fixture = await foundingFixture();
    let world = fixture.completionWorld; // the colony above completes here

    const colonyId = fixture.targetSystemId;
    expect(fixtureSystem(world, colonyId).control).toBe("developed"); // premise: really founded first

    // Force a real famine/abandonment: cut the colony off from any donor haul (no logistics rescue),
    // drive population and stock to the death line, and let the REAL population processor call it
    // via runWorldTick — the same technique the stockChange suite uses to reach the death line.
    // The famine is TOTAL — every producer stripped and every market emptied, not just the two
    // survival goods — because the descent rate is what has to fit the loop budget below: at full
    // dissatisfaction the growth term is exactly zero and decline runs at the whole declineRate
    // against a unrest pinned at 1, so crossing ABANDON_POP_FLOOR (1) takes ln(population) ÷
    // declineRate ≈ 40 reference cycles from 1.02 (measured: abandoned at tick 952). Leave any good
    // satisfied and growth claws back ~3/4 of the decline, stretching the same descent past the
    // budget. Cadence buys nothing: reference cycles per tick are interval-invariant by construction,
    // so 3,000 ticks is ~125 reference cycles at ANY cadence.
    const savedConnections = world.connections;
    // Plant a habitabilityQuality reading before the death line — a fixture value, since the real
    // fold wouldn't have crossed a body boundary yet at this population, and the point here is only
    // to prove `applyAbandonments` clears whatever the row is carrying, not to derive an honest one.
    const PLANTED_QUALITY = { quality: 0.42, frontierIndex: 0, partial: true };
    world = {
      ...world,
      systems: world.systems.map((s): WorldSystem =>
        s.id === colonyId
          ? { ...s, unrest: 0.9, population: 1.02, popCap: 20, habitabilityQuality: PLANTED_QUALITY }
          : s,
      ),
      buildings: world.buildings.filter((b) => b.systemId !== colonyId),
      markets: world.markets.map((m): WorldMarket =>
        m.systemId === colonyId ? { ...m, stock: 0 } : m,
      ),
      connections: world.connections.filter((c) => c.fromId !== colonyId && c.toId !== colonyId),
    };

    const KILL_CADENCE: TickCadence = { cycle: 1, logistics: 1, construction: NEVER };
    let abandoned = false;
    for (let i = 0; i < 3000 && !abandoned; i++) {
      world = (await runWorldTick(world, { cadence: KILL_CADENCE })).world;
      abandoned = fixtureSystem(world, colonyId).control !== "developed";
    }
    expect(abandoned).toBe(true); // non-vacuous: the fixture actually reaches the death line
    expect(fixtureSystem(world, colonyId).control).toBe("unclaimed");
    expect(fixtureSystem(world, colonyId).populationChange).toBeUndefined();
    // applyAbandonments' clear (lib/world/tick.ts:845): the planted reading does not survive the
    // reset — a re-founded colony must never inherit its predecessor's habitability quality.
    expect(fixtureSystem(world, colonyId).habitabilityQuality).toBeUndefined();

    // Reclaim: restore connectivity to the original seed source and flip control back to
    // `controlled` under the same faction, so the real develop provider considers it again — the
    // claim mechanic itself is not under test here, only the write ordering once redevelopment fires.
    const sourceFactionId = fixtureSystem(world, fixture.sourceSystemId).factionId;
    world = {
      ...world,
      connections: savedConnections,
      systems: world.systems.map((s): WorldSystem =>
        // Plant a SECOND reading while the system is merely `controlled` — the population processor
        // never touches a controlled (not-yet-developed) system (`isEconomicallyActive`), so this can
        // only be a fixture value, exercising `applyDevelopments`' clear (lib/world/tick.ts:792)
        // when this same reclaim later completes into `developed`.
        s.id === colonyId
          ? { ...s, control: "controlled", factionId: sourceFactionId, habitabilityQuality: PLANTED_QUALITY }
          : s,
      ),
      treasuries: world.treasuries.map((t): WorldFactionTreasury =>
        t.factionId === sourceFactionId ? { ...t, balance: t.balance + 1_000_000, pendingFounding: 0 } : t,
      ),
    };

    // Re-founding is a whole establish over again — ~170 construction cycles at the absorption cap,
    // so ~4,100 ticks, the same duration the first founding above took. The budget is that plus room
    // for the establish to be proposed and priced, not a round number.
    let redeveloped = false;
    for (let i = 0; i < 5_000 && !redeveloped; i++) {
      world = (await runWorldTick(world)).world;
      redeveloped = fixtureSystem(world, colonyId).control === "developed";
    }
    expect(redeveloped).toBe(true); // non-vacuous: the fixture actually re-founds

    const refounded = fixtureSystem(world, colonyId);
    expect(refounded.populationChange).toBeUndefined();
    expect("populationChange" in refounded).toBe(false);
    // applyDevelopments' clear (lib/world/tick.ts:792): the second planted reading, carried on the
    // row while merely `controlled`, does not survive into the newly `developed` colony either.
    expect(refounded.habitabilityQuality).toBeUndefined();
    expect("habitabilityQuality" in refounded).toBe(false);
  }, 300_000);
});

// ── the smoothed, founding-excluded population trend ──────────────────
// `WorldSystem.populationTrend` is written by the tick body alongside `populationChange`, at the
// same write site — an EMA over the fractional realised change per reference cycle, with this
// cycle's founding debit added back out before it feeds the average. These pin the founding
// exclusion (the premise the whole alert-bar change rests on), the EMA update itself, and the same
// absence/clear contract `populationChange` already carries.

/** Reads `populationTrend` off a system row, failing with a clear message rather than silently
 *  treating an unassessed system as 0 — the exact distinction these tests exist to pin. */
function requirePopulationTrend(world: World, systemId: string): number {
  const value = fixtureSystem(world, systemId).populationTrend;
  if (value === undefined) throw new Error(`expected populationTrend to be assessed for ${systemId}`);
  return value;
}

describe("runWorldTick — the smoothed population trend (WorldSystem.populationTrend)", () => {
  it("excludes a colony-founding donation: the donor's trend is NOT dragged down by the seed it gave away", async () => {
    // Same fixture and same-tick counterfactual technique as populationChange's own founding test
    // above — two clones of the identical pre-tick world diverge ONLY in whether directed-build
    // resolves this tick, isolating the donation's contribution.
    const { sourceSystemId, completionPreWorld: preWorld } = await foundingFixture();

    const withDonation = (await runWorldTick(preWorld)).world;
    const withoutDonation = (await runWorldTick(preWorld, {
      cadence: { cycle: CYCLE_LENGTH, logistics: LOGISTICS_INTERVAL, construction: NEVER },
    })).world;

    // populationChange still shows the donation (the founding debit is real realised change) — the
    // premise that the two branches genuinely diverge on the donor's raw figure.
    const changeWithDonation = requirePopulationChange(withDonation, sourceSystemId);
    const changeWithoutDonation = requirePopulationChange(withoutDonation, sourceSystemId);
    expect(changeWithDonation).toBeLessThan(changeWithoutDonation);

    // populationTrend, by contrast, must read the SAME (within floating-point tolerance) whether or
    // not the donation happened this cycle — the founding exclusion's whole point.
    const trendWithDonation = requirePopulationTrend(withDonation, sourceSystemId);
    const trendWithoutDonation = requirePopulationTrend(withoutDonation, sourceSystemId);
    expect(trendWithDonation).toBeCloseTo(trendWithoutDonation, 9);
  }, 120_000);

  it("IS the founding-excluded fractional change on first assessment: with no prior trend, it equals the sample exactly, at both cadences", async () => {
    // No prior populationTrend means the EMA seeds from the first sample (prevTrend undefined), so
    // this pins the sample's own formula: (realisedChange ÷ catchUpFactor) ÷ population-at-cycle-start,
    // with no founding this cycle to back out. Both cadences, like populationChange's own definitional
    // test above — CYCLE_LENGTH alone can't tell a `÷ cycleCatchUp` mistake apart from a correct
    // formula, since catchUpFactor(CYCLE_LENGTH) is 1.
    for (const cycle of [CYCLE_LENGTH, CYCLE_LENGTH * 2]) {
      const { world, systemId } = populationFixture(0.5, 0);
      const before = fixtureSystem(world, systemId).population;
      const cadence: TickCadence = { cycle, construction: NEVER, logistics: NEVER };
      const atBoundary: World = { ...world, meta: { ...world.meta, currentTick: cycle - 1 } };
      const after = (await runWorldTick(atBoundary, { cadence })).world;

      const realisedChange = fixtureSystem(after, systemId).population - before;
      const expectedSample = realisedChange / catchUpFactor(cycle) / before;
      expect(requirePopulationTrend(after, systemId), `cycle ${cycle}`).toBeCloseTo(expectedSample, 9);
      // Non-vacuous: growth actually moved population, so the sample isn't 0 ÷ before.
      expect(Math.abs(realisedChange), `cycle ${cycle}`).toBeGreaterThan(0);
    }
  });

  it("smooths a second cycle's sample toward it by the authored EMA weight — half-life ~3 reference cycles", async () => {
    // alpha = 1 − 2^(−1/3), the exact derivation the write site uses — restated here, not imported,
    // so this test would fail if the write site's formula ever silently drifted from its own
    // docstring.
    const alpha = 1 - 2 ** (-1 / 3);
    const { world, systemId } = populationFixture(0.5, 0);

    const afterFirstCycle = await runTicks(world, CYCLE_LENGTH, POPULATION_CADENCE);
    const firstTrend = requirePopulationTrend(afterFirstCycle, systemId);

    const beforeSecond = fixtureSystem(afterFirstCycle, systemId).population;
    const afterSecondCycle = await runTicks(afterFirstCycle, CYCLE_LENGTH, POPULATION_CADENCE);
    const realisedSecond = fixtureSystem(afterSecondCycle, systemId).population - beforeSecond;
    const secondSample = realisedSecond / catchUpFactor(CYCLE_LENGTH) / beforeSecond;

    const expectedSecondTrend = firstTrend + alpha * (secondSample - firstTrend);
    expect(requirePopulationTrend(afterSecondCycle, systemId)).toBeCloseTo(expectedSecondTrend, 9);
    // Non-vacuous: the second trend actually moved from the first, i.e. the sample and the prior
    // trend genuinely differ enough for the EMA weighting to be visible.
    expect(Math.abs(secondSample - firstTrend)).toBeGreaterThan(1e-6);
  });

  it("clears on abandonment and again on redevelopment, so a re-founded colony never inherits its predecessor's reading", () => {
    const base = toTickSystems(generateWorld({ systemCount: 100, seed: 42 }))[0];
    const stale: TickSystem = { ...base, populationTrend: -0.42 };

    const [abandoned] = applyAbandonments([stale], [stale.id]);
    expect(abandoned.populationTrend).toBeUndefined();

    const restaled: TickSystem = { ...abandoned, populationTrend: -0.09 };
    const donor: TickSystem = {
      ...abandoned, id: `${abandoned.id}-donor`, population: 1000, populationTrend: -0.01,
    };
    const development: SystemDevelopment = {
      systemId: restaled.id, sourceSystemId: donor.id, seedPop: 10, housingLevels: 1, stockManifest: [],
    };
    const [redeveloped] = applyDevelopments([restaled, donor], [development]);
    expect(redeveloped.populationTrend).toBeUndefined();
  });

  it("a never-assessed system reports populationTrend absent, and it survives a save round-trip as absent, not 0", async () => {
    const generated = generateWorld({ systemCount: 100, seed: 42 });
    const developed = generated.systems.find((s) => s.control === "developed");
    if (!developed) throw new Error("expected at least one developed system in a freshly generated world");
    expect(developed.populationTrend).toBeUndefined();
    expect("populationTrend" in developed).toBe(false);

    // One real tick — day 1, not a cycle boundary — so the population processor never resolves and
    // this system is never assessed, but the join/merge pair still runs unconditionally every tick.
    const after = (await runWorldTick(generated)).world;
    const untouched = after.systems.find((s) => s.id === developed.id);
    if (!untouched) throw new Error("expected the ticked world to still carry this system");
    expect(untouched.populationTrend).toBeUndefined();
    expect("populationTrend" in untouched).toBe(false);

    const result = deserialiseWorld(serialiseWorld(after));
    if (!result.ok) throw new Error(`expected the save round-trip to succeed: ${result.error}`);
    const reloaded = result.world.systems.find((s) => s.id === developed.id);
    if (!reloaded) throw new Error("expected the reloaded world to still carry this system");
    expect(reloaded.populationTrend).toBeUndefined();
    expect("populationTrend" in reloaded).toBe(false);
  });

  it("nothing inside the tick reads populationTrend — poisoning the input changes no other output", async () => {
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const poisoned: World = {
      ...base,
      systems: base.systems.map((s): WorldSystem => ({ ...s, populationTrend: 999 })),
    };

    const clean = await runTicksCapturingLast(base, 50);
    const dirty = await runTicksCapturingLast(poisoned, 50);

    const strip = (w: World): World => ({
      ...w,
      systems: w.systems.map((s): WorldSystem => ({ ...s, populationTrend: undefined })),
    });
    expect(strip(dirty.world)).toEqual(strip(clean.world));
    expect(dirty.markets).toEqual(clean.markets);
    expect(dirty.events).toEqual(clean.events);
    expect(dirty.instrumentation).toEqual(clean.instrumentation);
  }, 30_000);
});

// ── the realised per-cycle survival-good stock change ─────────────────
// `WorldMarket.stockChange` is written by the tick body itself, after directed logistics has
// applied its own stock updates — not by the directed-logistics engine or processor, neither of
// which sees the economy processor's earlier production/consumption write. These pin the write's
// inclusion of the same-tick logistics haul, its survival-goods-only scope, its absence convention
// and the abandonment clear. Whether anything inside the tick reads it back is proven separately
// (the poisoning test below).

/** Reads `stockChange` off a market row, failing with a clear message rather than silently
 *  treating an unassessed row as 0 — the exact distinction these tests exist to pin. */
function requireStockChange(world: World, systemId: string, goodId: string): number {
  const market = world.markets.find((m) => m.systemId === systemId && m.goodId === goodId);
  if (!market) throw new Error(`expected a market row for ${systemId}/${goodId}`);
  if (market.stockChange === undefined) {
    throw new Error(`expected stockChange to be assessed for ${systemId}/${goodId}`);
  }
  return market.stockChange;
}

/** The market row itself, failing loudly rather than letting an absent row read as a silent skip. */
function marketRow(world: World, systemId: string, goodId: string): WorldMarket {
  const market = world.markets.find((m) => m.systemId === systemId && m.goodId === goodId);
  if (!market) throw new Error(`expected a market row for ${systemId}/${goodId}`);
  return market;
}

/** Coincident cadence: economy AND directed logistics both resolve on tick 1, construction parked
 *  so directed-build contributes no noise. */
const STOCK_CADENCE: TickCadence = { cycle: 1, logistics: 1, construction: 999 };
/** Same economy cadence, logistics parked — isolates the economy-only (pre-import) figure. */
const NO_LOGISTICS_CADENCE: TickCadence = { cycle: 1, logistics: NEVER, construction: 999 };

describe("runWorldTick — the realised per-cycle survival-good stock change (WorldMarket.stockChange)", () => {
  it("includes the import: the same starting deficit reports a materially smaller drain with logistics resolving than with it parked", async () => {
    const { b, world } = twoSystemWaterGradient((market) => ({ ...market, stock: 500 }));

    // Same starting world, only whether directed logistics resolves this tick differs.
    const localOnlyAfter = (await runWorldTick(world, { cadence: NO_LOGISTICS_CADENCE })).world;
    const withHaulAfter = (await runWorldTick(world, { cadence: STOCK_CADENCE })).world;

    const localOnly = requireStockChange(localOnlyAfter, b, "water");
    const withHaul = requireStockChange(withHaulAfter, b, "water");

    // B has no water producers: a purely local read (no logistics stage to see) is a real drain.
    expect(localOnly).toBeLessThan(0);
    // The donor's haul lands before the write on the coincident tick, so the SAME starting deficit
    // reports a materially smaller drain — the import is inside the figure, not a channel the write
    // never sees. A write anchored to the economy processor's OWN output alone (before logistics)
    // would report `localOnly` in both cases.
    expect(withHaul).toBeGreaterThan(localOnly);
  });

  it("a system whose local production trails consumption with no reachable donor reports a negative change", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const systemId = base.factions[0].homeworldId;
    const world: World = {
      ...base,
      // Strips the homeworld's own water producers: nothing local replaces what's consumed.
      buildings: base.buildings.filter(
        (bl) => !(bl.systemId === systemId && bl.buildingType === "water"),
      ),
      markets: base.markets.map((m) =>
        m.systemId === systemId && m.goodId === "water" ? { ...m, stock: 500 } : m,
      ),
    };
    // This faction's only developed system in a 60-system galaxy at seed 7 has no same-faction
    // developed neighbour to reach — directed logistics resolves (cadence coincident) but finds no
    // donor, same as an unfunded deficit with nothing reachable.
    const after = (await runWorldTick(world, { cadence: STOCK_CADENCE })).world;

    expect(requireStockChange(after, systemId, "water")).toBeLessThan(0);
  });

  it("carries stockChange on no market row for a non-survival good", async () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const after = (await runWorldTick(world, { cadence: STOCK_CADENCE })).world;

    const nonSurvival = after.markets.filter((m) => !SURVIVAL_GOODS.includes(m.goodId));
    expect(nonSurvival.length).toBeGreaterThan(0); // non-vacuous: real non-survival rows exist
    for (const m of nonSurvival) expect("stockChange" in m).toBe(false);
  });

  it("clears on abandonment while `stock` itself is retained — the warehouse survives, the reading does not", () => {
    const base = generateWorld({ systemCount: 60, seed: 7 }).markets[0];
    const stale: WorldMarket = { ...base, stockChange: -42, stock: 777 };

    const [reset] = resetAbandonedMarkets([stale], [stale.systemId]);

    expect(reset.stockChange).toBeUndefined();
    expect(reset.stock).toBe(777);
  });

  it("excludes a system this SAME cycle abandoned from the write — the write site's own guard, distinct from resetAbandonedMarkets' earlier clear", async () => {
    // Tiny population with every market emptied and every local producer stripped: total famine,
    // every cycle. Starting population and unrest sit close enough to the death line (famine AND
    // post-delta population below ABANDON_POP_FLOOR) that unrest-driven decline crosses it partway
    // through this run — at full dissatisfaction the growth term is exactly zero and unrest pins at
    // 1, so ln(1.02) ÷ declineRate is ~40 reference cycles (measured: abandoned at tick 952), inside
    // the ~125 reference cycles 3,000 ticks buys at any cadence. The exact tick the population
    // processor reports this system in
    // `abandonedSystemIds` is the same tick `stockAtCycleStart` snapshotted its water row while the
    // system was still developed, so without the write site's own guard that snapshot would be
    // recomputed against and written back over `resetAbandonedMarkets`' clear, further up this same
    // tick.
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const systemId = base.factions[0].homeworldId;
    let world: World = {
      ...base,
      systems: base.systems.map((s): WorldSystem =>
        s.id === systemId ? { ...s, population: 1.02, popCap: 20, unrest: 0.87 } : s,
      ),
      buildings: base.buildings.filter((b) => b.systemId !== systemId),
      markets: base.markets.map((m) => (m.systemId === systemId ? { ...m, stock: 0 } : m)),
    };

    let abandoned = false;
    for (let i = 0; i < 3000 && !abandoned; i++) {
      world = (await runWorldTick(world, { cadence: STOCK_CADENCE })).world;
      abandoned = fixtureSystem(world, systemId).control !== "developed";
    }
    expect(abandoned).toBe(true); // non-vacuous: the fixture actually reaches the death line
    expect(fixtureSystem(world, systemId).control).toBe("unclaimed");

    const water = world.markets.find((m) => m.systemId === systemId && m.goodId === "water");
    if (!water) throw new Error("expected the water market row to survive abandonment");
    expect(water.stockChange).toBeUndefined();
    expect("stockChange" in water).toBe(false);
  }, 60_000);

  it("a never-assessed survival-good market row reports stockChange absent, and it survives a save round-trip as absent, not 0", async () => {
    const generated = generateWorld({ systemCount: 60, seed: 7 });
    const developed = generated.systems.find((s) => s.control === "developed");
    if (!developed) throw new Error("expected at least one developed system in a freshly generated world");
    const water = generated.markets.find((m) => m.systemId === developed.id && m.goodId === "water");
    if (!water) throw new Error("expected a water market row for the developed system");
    expect(water.stockChange).toBeUndefined();
    expect("stockChange" in water).toBe(false);

    // One real tick — day 1, not a cycle boundary at the default cadence — so the economy/directed-
    // logistics stages never resolve and this row is never assessed, but the array still passes
    // through the tick body unconditionally on every tick.
    const after = (await runWorldTick(generated)).world;
    const untouched = after.markets.find((m) => m.systemId === developed.id && m.goodId === "water");
    if (!untouched) throw new Error("expected the ticked world to still carry this market row");
    expect(untouched.stockChange).toBeUndefined();
    expect("stockChange" in untouched).toBe(false);

    const result = deserialiseWorld(serialiseWorld(after));
    if (!result.ok) throw new Error(`expected the save round-trip to succeed: ${result.error}`);
    const reloaded = result.world.markets.find((m) => m.systemId === developed.id && m.goodId === "water");
    if (!reloaded) throw new Error("expected the reloaded world to still carry this market row");
    expect(reloaded.stockChange).toBeUndefined();
    expect("stockChange" in reloaded).toBe(false);
  });

  it("carries stockChange forward, unchanged, on a survival-good row belonging to a system the economy skipped this cycle", async () => {
    // The third set-and-clear case, distinct from the two above: not a non-survival good (never gets
    // the field at all) and not a never-assessed row (never touched at all), but a row that WAS
    // assessed on a real cycle and then sits through a mid-cycle tick where the economy stage bails
    // internally — `stockAtCycleStart` is never built, so the write further down this function never
    // runs at all, and the row's prior reading survives verbatim.
    const generated = generateWorld({ systemCount: 60, seed: 7 });
    const developed = generated.systems.find((s) => s.control === "developed");
    if (!developed) throw new Error("expected at least one developed system in a freshly generated world");

    const afterCycle = await runTicks(generated, CYCLE_LENGTH);
    const assessed = requireStockChange(afterCycle, developed.id, "water");
    expect(assessed).not.toBe(0); // non-vacuous: a real reading, not a coincidental zero

    const afterMidCycle = (await runWorldTick(afterCycle)).world;
    const midCycle = afterMidCycle.markets.find((m) => m.systemId === developed.id && m.goodId === "water");
    if (!midCycle) throw new Error("expected the water market row to survive the tick");
    expect(midCycle.stockChange).toBe(assessed);
  });

  it("denominates per reference cycle: retuning CYCLE_LENGTH away from REFERENCE_INTERVAL leaves the figure unchanged", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const systemId = base.factions[0].homeworldId;
    // Net-positive production without moving stock: the default seeded water market already sits
    // well inside the production brake's knee (lib/engine/tick.ts, brakeKnee/productionCeiling) and
    // well above the emergency-ration floor, so tripling the building count alone (leaving stock
    // untouched) keeps the read linear in the interval on both sides — the same floor-avoidance
    // the population denomination test uses, but avoiding the OPPOSITE clamp here: an
    // actually "ample" stock (well above the knee) collapses production to 0 via that same brake,
    // which would make both readings 0 in vacuous agreement rather than proving anything.
    const world: World = {
      ...base,
      buildings: base.buildings.map((b) =>
        b.systemId === systemId && b.buildingType === "water" ? { ...b, count: b.count * 3 } : b,
      ),
    };

    // One real tick each, fast-forwarded to its own cycle boundary via meta.currentTick, mirroring
    // the population denomination test. Logistics and construction stay parked so only the economy
    // cycle's own production/consumption feeds the figure.
    const referenceCadence: TickCadence = { cycle: REFERENCE_INTERVAL, logistics: NEVER, construction: NEVER };
    const referenceWorld: World = { ...world, meta: { ...world.meta, currentTick: REFERENCE_INTERVAL - 1 } };
    const referenceAfter = (await runWorldTick(referenceWorld, { cadence: referenceCadence })).world;

    const retunedCycle = REFERENCE_INTERVAL * 2;
    const retunedCadence: TickCadence = { cycle: retunedCycle, logistics: NEVER, construction: NEVER };
    const retunedWorld: World = { ...world, meta: { ...world.meta, currentTick: retunedCycle - 1 } };
    const retunedAfter = (await runWorldTick(retunedWorld, { cadence: retunedCadence })).world;

    const reference = requireStockChange(referenceAfter, systemId, "water");
    const retuned = requireStockChange(retunedAfter, systemId, "water");

    expect(reference).toBeGreaterThan(0); // non-vacuous: real net production, not two zeros agreeing
    expect(retuned).toBeCloseTo(reference, 6);
  });

  // ── colony-founding staging draw, driven through runWorldTick, not applyFoundingStagingDraws ──
  // The same seed-11/90-system galaxy the populationChange suite above uses, but caught on a STAGING
  // cycle rather than the completion tick: a colony's manifest is staged cycle by cycle as its founder
  // can spare the goods, and the completion tick itself draws nothing at all, so it is the wrong tick
  // to measure a draw on. `deriveFoundingFixture` walks the fixture forward and records the pre-tick
  // world of the FIRST staging cycle — across EVERY colony_establish project the run produces, not
  // just the first one founded — that carries both survival goods for the donor it finds, rather than
  // a hardcoded tick or a hardcoded project: a donor whose own production of one survival good just
  // covers its own consumption never clears `surplusDrawable`'s reserve margin for that good and so
  // never ships it at all, which the population-change suite's completion-only fixture never notices
  // but this one would hang against forever if it only ever looked at the first project found.
  //
  // Two clones of one identical pre-tick world, diverging ONLY in whether directed-build resolves this
  // tick, so the staging draw's contribution to a founder's own survival-good rows is isolated exactly.
  // A donor ships food and water out of its warehouse to stand up a colony (`planStagingDraw` sizes the
  // manifest on the seed's own basket, which at a 2-pop seed is mostly those two), and that is as
  // real a drain as consumption — the field's one reader divides `stock` by `−stockChange` for a
  // cycles-to-empty countdown, so a drain outside the figure would quote the donor a longer runway
  // than it has, on the cycle it can least afford one.
  it("includes a colony-founding staging draw: the donor's stockChange covers the survival goods it shipped out", async () => {
    const { stagingSourceSystemId: donorId, stagingPreWorld: preWorld } = await foundingFixture();

    const staged = await runWorldTick(preWorld);
    const withStaging = staged.world;
    const withoutStaging = (await runWorldTick(preWorld, {
      cadence: { cycle: CYCLE_LENGTH, logistics: LOGISTICS_INTERVAL, construction: NEVER },
    })).world;

    // Premise: the two branches genuinely diverge on a staging draw this exact tick, and the draw
    // really carries the two survival goods asserted below. Read off the tick's own manifest record —
    // the colony is still `controlled` on both branches here, so control cannot be the premise.
    const donorManifests = (staged.instrumentation.foundingManifests ?? [])
      .filter((m) => m.sourceSystemId === donorId);
    expect(donorManifests.length).toBeGreaterThan(0);
    for (const goodId of ["water", "food"]) {
      expect(donorManifests.some((m) => m.goodIds.includes(goodId))).toBe(true);
    }

    for (const goodId of ["water", "food"]) {
      const drawn = marketRow(withStaging, donorId, goodId);
      const undrawn = marketRow(withoutStaging, donorId, goodId);
      // Premise: the draw really left the donor's warehouse on the staging branch.
      expect(drawn.stock).toBeLessThan(undrawn.stock);

      // Both branches share one pre-tick world, so both figures are diffed against the SAME
      // cycle-start baseline. The whole stock gap between them therefore has to appear in the gap
      // between their reported changes, scaled by the one denominator — which is only true if the
      // draw lands INSIDE the figure. Computed before the draw, the two changes would be equal
      // while the stocks differ, and this identity is what catches that.
      const stockGap = undrawn.stock - drawn.stock;
      const reportedGap =
        (requireStockChange(withoutStaging, donorId, goodId) - requireStockChange(withStaging, donorId, goodId))
        * catchUpFactor(CYCLE_LENGTH);
      expect(reportedGap).toBeCloseTo(stockGap, 9);
      // …and the donor reads more drained for it, never less.
      expect(requireStockChange(withStaging, donorId, goodId))
        .toBeLessThan(requireStockChange(withoutStaging, donorId, goodId));
    }
  }, 30_000);

  it("nothing inside the tick reads stockChange — poisoning the input changes no other output", async () => {
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const poisoned: World = {
      ...base,
      markets: base.markets.map((m): WorldMarket => ({ ...m, stockChange: -999_999 })),
    };

    const clean = await runTicksCapturingLast(base, 50);
    const dirty = await runTicksCapturingLast(poisoned, 50);

    // stockChange itself legitimately differs run to run for any market row the runs never both
    // visit identically (each is a fresh per-cycle read) — stripped before comparing; everything
    // else, including every harness/instrumentation figure, must be byte-identical.
    const stripMarkets = (markets: WorldMarket[]): WorldMarket[] =>
      markets.map((m): WorldMarket => ({ ...m, stockChange: undefined }));
    const strip = (w: World): World => ({ ...w, markets: stripMarkets(w.markets) });
    expect(strip(dirty.world)).toEqual(strip(clean.world));
    expect(stripMarkets(dirty.markets)).toEqual(stripMarkets(clean.markets));
    expect(dirty.events).toEqual(clean.events);
    expect(dirty.instrumentation).toEqual(clean.instrumentation);
  }, 30_000);
});

// ── Unserved shortfall (WorldMarket.unservedShortfall) ────────────────
// The classification itself — structural vs. funding-bound, the deficit-endpoint-only rule, and the
// level (one figure per (system, good), computed from `Deficit.shortfall`) — is pinned directly
// against `matchFactionTransfers` in `lib/engine/__tests__/directed-logistics.test.ts`, and the
// write-back skip/clear mechanics against `runDirectedLogisticsProcessor` in
// `lib/tick/processors/__tests__/directed-logistics.test.ts`. These pin the world layer's half: the
// market-join / merge-path plumbing, the abandonment clear, the cadence-invariance of a level (as
// distinct from `stockChange`'s per-cycle denomination), and that nothing inside the tick reads it.
// A positive level IS the structural reading and absence is servable — there is no separate bit, so
// nothing here can assert the two agree; what it asserts instead is that a served row's key is
// DELETED rather than left holding a stale figure.

describe("marketRowsBySystem carries unservedShortfall through the market join", () => {
  it("carries a present value onto the projected row", () => {
    const base = generateWorld({ systemCount: 20, seed: 3 }).markets[0];
    const flagged: WorldMarket = { ...base, unservedShortfall: 38 };
    const rows = marketRowsBySystem([flagged]).get(flagged.systemId);
    expect(rows?.find((r) => r.goodId === flagged.goodId)?.unservedShortfall).toBe(38);
  });

  it("carries absence through as undefined, matching logisticsFundingBound's own projection", () => {
    // marketRowsBySystem is a plain per-tick projection, not the persisted WorldMarket row — like
    // every other optional field on it, an absent source reads undefined here rather than a truly
    // absent key. The true-absence guarantee belongs to WorldMarket itself and is pinned separately
    // (resetAbandonedMarkets, the poisoning tests).
    const base = generateWorld({ systemCount: 20, seed: 3 }).markets[0];
    const untouched: WorldMarket = { ...base };
    delete untouched.unservedShortfall;
    const rows = marketRowsBySystem([untouched]).get(untouched.systemId);
    const row = rows?.find((r) => r.goodId === untouched.goodId);
    expect(row?.unservedShortfall).toBeUndefined();
  });
});

describe("resetAbandonedMarkets clears unservedShortfall", () => {
  it("deletes a stale level on abandonment, leaving stock untouched", () => {
    const base = generateWorld({ systemCount: 20, seed: 3 }).markets[0];
    const stale: WorldMarket = { ...base, unservedShortfall: 38, stock: 777 };

    const [reset] = resetAbandonedMarkets([stale], [stale.systemId]);

    expect(reset.unservedShortfall).toBeUndefined();
    expect("unservedShortfall" in reset).toBe(false);
    expect(reset.stock).toBe(777);
  });
});

describe("runWorldTick — the unserved shortfall level end to end", () => {
  /**
   * The warehousing target one system's market row is measured against, rebuilt from committed world
   * state through the same `marketRowsBySystem` → `toGoodMarketStates` seam the logistics processor
   * itself reads — `DIRECTED_LOGISTICS.WAREHOUSE_COVER × demand × anchorMult`, where `demand` is the
   * system's USE figure, not its `demandRate` column. Sound to read off the POST-tick world: every
   * stage that moves the inputs (economy, decay, population, migration) runs before directed
   * logistics, and construction is parked in the fixtures below.
   */
  function logisticsTargetOf(world: World, systemId: string, goodId: string): number {
    const system = world.systems.find((s) => s.id === systemId);
    if (!system) throw new Error(`no system ${systemId}`);
    const buildings: Record<string, number> = {};
    for (const b of world.buildings) if (b.systemId === systemId) buildings[b.buildingType] = b.count;
    const rows = marketRowsBySystem(world.markets.filter((m) => m.systemId === systemId)).get(systemId);
    if (!rows) throw new Error(`no market rows for ${systemId}`);
    const state = toGoodMarketStates({
      buildings,
      population: system.population,
      yields: yieldsOf(system),
      markets: rows,
    }).find((g) => g.goodId === goodId);
    if (!state) throw new Error(`no ${goodId} state at ${systemId}`);
    return state.logisticsTarget;
  }

  it("carries the deficit's own shortfall while isolated, and clears the LEVEL along with the bit once a donor becomes reachable — never a stale figure behind a false bit", async () => {
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const a = base.factions[0].homeworldId;
    const b = base.factions[1].homeworldId;
    const factionId = base.factions[0].id;
    const prepared: World = {
      ...base,
      systems: base.systems.map((s) => (s.id === b ? { ...s, factionId } : s)),
      buildings: base.buildings.filter((bl) => !(bl.systemId === b && bl.buildingType === "water")),
      markets: base.markets.map((m) =>
        m.systemId === b && m.goodId === "water" ? { ...m, stock: 0 } : m,
      ),
      connections: base.connections.filter((c) => c.fromId !== b && c.toId !== b),
    };
    const cadence = { cycle: 1, logistics: 1, construction: 99 };
    const unservable = (await runWorldTick(prepared, { cadence })).world;
    const bWaterBefore = unservable.markets.find((m) => m.systemId === b && m.goodId === "water");
    // Stock is forced to exactly 0 above, so the level (target − stock) must equal the full
    // warehousing target — a real, finite, positive figure. It is also the entire classification:
    // a positive reading here is what "structurally unservable" means on a market row.
    expect(bWaterBefore?.stock).toBe(0);
    expect(bWaterBefore?.logisticsFundingBound ?? false).toBe(false); // structural, not budget-stopped
    // The level is `max(0, logisticsTarget − stock)` and stock is exactly 0 here, so the figure is
    // computable rather than merely finite-and-positive — the whole warehousing target, rebuilt
    // independently from committed world state.
    const expectedShortfall = logisticsTargetOf(unservable, b, "water");
    expect(expectedShortfall).toBeGreaterThan(0); // premise: this system really does want water
    expect(bWaterBefore?.unservedShortfall).toBeCloseTo(expectedShortfall, 9);

    const recovered: World = {
      ...unservable,
      markets: unservable.markets.map((m) =>
        m.systemId === a && m.goodId === "water" ? { ...m, stock: 1_000_000 } : m,
      ),
      connections: [
        ...unservable.connections,
        { fromId: a, toId: b, fuelCost: 1 },
        { fromId: b, toId: a, fuelCost: 1 },
      ],
    };
    const cleared = (await runWorldTick(recovered, { cadence })).world;
    const bWaterAfter = cleared.markets.find((m) => m.systemId === b && m.goodId === "water");
    expect(bWaterAfter?.unservedShortfall).toBeUndefined();
    expect("unservedShortfall" in bWaterAfter!).toBe(false);
  });

  it("is a level, not a rate: doubling the logistics cadence interval does not move the figure", async () => {
    // logisticsTarget (WAREHOUSE_COVER × demand × anchorMult) and shortfall (target − stock) are both
    // read straight off demand and stock — neither is denominated by the interval the way the haul
    // BUDGET (generation × catchUpFactor) is. B is cut off from every donor, so logistics never moves
    // its stock either way; the only variable between the two runs is which tick(s) logistics itself
    // resolved on, which a level must not affect.
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const b = base.factions[1].homeworldId;
    const factionId = base.factions[0].id;
    const prepared: World = {
      ...base,
      systems: base.systems.map((s) => (s.id === b ? { ...s, factionId } : s)),
      buildings: base.buildings.filter((bl) => !(bl.systemId === b && bl.buildingType === "water")),
      markets: base.markets.map((m) =>
        m.systemId === b && m.goodId === "water" ? { ...m, stock: 0 } : m,
      ),
      connections: base.connections.filter((c) => c.fromId !== b && c.toId !== b),
    };
    const shortfallAt = (w: World) =>
      w.markets.find((m) => m.systemId === b && m.goodId === "water")?.unservedShortfall;

    // Interval 1 resolves logistics on every tick; two ticks in, it has assessed twice.
    const everyTick = await runTicks(prepared, 2, { cycle: 1, logistics: 1, construction: 99 });
    // Interval 2 resolves logistics only on the second tick (tick 2 % 2 === 0) — economy/population
    // still run every tick (cycle: 1) in both branches, so B's demand and stock evolve identically;
    // logistics itself never touches B's stock either way (no reachable donor).
    const everyOtherTick = await runTicks(prepared, 2, { cycle: 1, logistics: 2, construction: 99 });

    expect(shortfallAt(everyTick)).toBeGreaterThan(0);
    expect(shortfallAt(everyTick)).toBeCloseTo(shortfallAt(everyOtherTick)!, 6);
  });

  /**
   * Re-poisons every market EVERY tick rather than once at the start. A one-shot poisoning cannot
   * hold the premise for 50 ticks: the first directed-logistics run assesses every market row it
   * visits and clears the level on the servable ones, so within one logistics cycle the poisoned
   * world has scrubbed itself clean and the remaining ticks compare two identical worlds. Re-applying
   * it each tick keeps a live 999_999 in front of every processor for the whole run, which is what
   * gives "nothing reads it" any teeth.
   */
  async function runTicksCapturingLast(world: World, count: number, poison: boolean) {
    let w = world;
    let last: Awaited<ReturnType<typeof runWorldTick>> | undefined;
    for (let i = 0; i < count; i++) {
      if (poison) {
        w = { ...w, markets: w.markets.map((m): WorldMarket => ({ ...m, unservedShortfall: 999_999 })) };
      }
      last = await runWorldTick(w);
      w = last.world;
    }
    if (!last) throw new Error("count must be > 0");
    return last;
  }

  // The field itself legitimately differs between the two runs (one is being poisoned) — stripped
  // before comparing; everything else must be byte-identical.
  const stripMarkets = (markets: WorldMarket[]): WorldMarket[] =>
    markets.map((m): WorldMarket => ({ ...m, unservedShortfall: undefined }));
  const strip = (w: World): World => ({ ...w, markets: stripMarkets(w.markets) });

  it("nothing inside the tick reads unservedShortfall — poisoning the input changes no other output, checked on a fixture that actually hauls", async () => {
    // The galaxy-wide poisoning test below has a blind spot this one covers: `generateWorld({
    // systemCount: 100, seed: 42 })` produces zero directed-logistics flow events at that horizon, so
    // a leak that only surfaces through the matcher would be invisible in it. twoSystemWaterGradient
    // guarantees a real haul every cycle logistics runs.
    const { world: base } = twoSystemWaterGradient((market) => market);

    const clean = await runTicksCapturingLast(base, 50, false);
    const dirty = await runTicksCapturingLast(base, 50, true);

    expect(clean.world.flowEvents.length).toBeGreaterThan(0); // premise: this fixture DOES haul

    // This also pins the matcher's own decisions — which hauls it plans, in what order — since
    // `markets` carries those decisions' downstream effects (stock moved, funding-bound assessments)
    // and it strips down to identical here.
    expect(strip(dirty.world)).toEqual(strip(clean.world));
    expect(stripMarkets(dirty.markets)).toEqual(stripMarkets(clean.markets));
  }, 60_000);

  it("nothing inside the tick reads unservedShortfall on a whole galaxy either — abandonment, migration and construction all run over 50 ticks and no other output moves", async () => {
    // The hauling fixture above is the one that can catch a matcher leak; this one covers the breadth
    // the two-system fixture cannot — every other processor, over a galaxy that actually abandons,
    // migrates and builds, plus the harness instrumentation. Both are needed: neither subsumes the
    // other.
    const base = generateWorld({ systemCount: 100, seed: 42 });

    const clean = await runTicksCapturingLast(base, 50, false);
    const dirty = await runTicksCapturingLast(base, 50, true);

    expect(strip(dirty.world)).toEqual(strip(clean.world));
    expect(stripMarkets(dirty.markets)).toEqual(stripMarkets(clean.markets));
    expect(dirty.events).toEqual(clean.events);
    expect(dirty.instrumentation).toEqual(clean.instrumentation);
  }, 60_000);
});

// ── Build blocked (WorldSystem.buildBlocked) ─────────────────────────
// The engine's reason mapping and what `droppedRoi` means at a ranked vs. an unranked drop are
// pinned directly against `planFactionProposals` in `lib/engine/__tests__/directed-build.test.ts`.
// These pin the world layer's half of the contract: `applyBuildBlockedUpdates`'s visited/clear/set
// behaviour (a visited system absent from the update list is CLEARED; an unvisited one is left
// alone), and that nothing inside the tick reads the field back.

describe("applyBuildBlockedUpdates — the visited/clear/set contract", () => {
  const base = toTickSystems(generateWorld({ systemCount: 20, seed: 3 }));

  it("sets buildBlocked for a visited system present in the update list", () => {
    const [sys] = base;
    const [next] = applyBuildBlockedUpdates(
      [sys], [sys.id], [{ systemId: sys.id, reason: "no-capacity", droppedRoi: 1.5 }],
    );
    expect(next.buildBlocked).toEqual({ reason: "no-capacity", droppedRoi: 1.5 });
  });

  it("clears buildBlocked for a visited system NOT present in the update list — nothing was dropped this run", () => {
    const [sys] = base;
    const stale: TickSystem = { ...sys, buildBlocked: { reason: "no-consumer", droppedRoi: 3 } };
    const [next] = applyBuildBlockedUpdates([stale], [stale.id], []);
    expect(next.buildBlocked).toBeUndefined();
    expect("buildBlocked" in next).toBe(false);
  });

  it("leaves a system the run did not visit untouched, keeping its previous value", () => {
    const [sys, other] = base;
    if (!other) throw new Error("expected at least two systems in the fixture");
    const stale: TickSystem = { ...sys, buildBlocked: { reason: "no-labour", droppedRoi: 2 } };
    // `other` carries a previous run's reading AND is deliberately absent from visitedSystemIds
    // (its faction was not due this run) — non-vacuous: were the visited guard dropped, `other`
    // would be cleared exactly like `stale` is, since it too is absent from `updates`.
    const otherStale: TickSystem = { ...other, buildBlocked: { reason: "no-whole-level", droppedRoi: 4 } };
    const [next, untouched] = applyBuildBlockedUpdates([stale, otherStale], [stale.id], []);
    expect(next.buildBlocked).toBeUndefined();       // visited, absent from updates → cleared
    expect(untouched).toBe(otherStale);               // not visited → same object, unchanged
    expect(untouched.buildBlocked).toEqual({ reason: "no-whole-level", droppedRoi: 4 });
  });

  it("guards a non-finite droppedRoi to 0 rather than writing NaN/Infinity into world state", () => {
    const [sys] = base;
    const [next] = applyBuildBlockedUpdates(
      [sys], [sys.id], [{ systemId: sys.id, reason: "no-capacity", droppedRoi: Number.POSITIVE_INFINITY }],
    );
    expect(next.buildBlocked?.droppedRoi).toBe(0);
  });
});

/**
 * A faction whose second developed system is cut off from every route: its builds have nowhere to
 * send output (the planner's `reachable` filter drops zero-cost self-routes), so the planner drops a
 * ranked-or-unranked opportunity and the run reports it. This is the whole end-to-end path — planner
 * → processor → adapter → `applyBuildBlockedUpdates` → `World.systems` — that every other test in
 * this section covers only one link of.
 */
function isolatedSecondSystemWorld(): World {
  const base = generateWorld({ systemCount: 100, seed: 42 });
  const cutOff = base.factions[1].homeworldId;
  const factionId = base.factions[0].id;
  return {
    ...base,
    systems: base.systems.map((s) => (s.id === cutOff ? { ...s, factionId } : s)),
    buildings: base.buildings.filter((b) => !(b.systemId === cutOff && b.buildingType === "water")),
    markets: base.markets.map((m) =>
      m.systemId === cutOff && m.goodId === "water" ? { ...m, stock: 0 } : m,
    ),
    connections: base.connections.filter((c) => c.fromId !== cutOff && c.toId !== cutOff),
  };
}

describe("runWorldTick — buildBlocked reaches World.systems through the whole real chain", () => {
  it("lands a reason and a droppedRoi on a system a real tick's planner actually dropped a build at", async () => {
    // Deleting the applyBuildBlockedUpdates call site leaves every other test in this file green:
    // the visited/clear/set contract above is a direct call on the fold, the processor tests assert
    // on the adapter, and the poisoning test strips the field from both worlds before comparing.
    // This is the only assertion that fails.
    const world = (await runWorldTick(isolatedSecondSystemWorld(), {
      cadence: { cycle: 1, logistics: 1, construction: 1 },
    })).world;

    const blocked = world.systems.filter((s) => s.buildBlocked !== undefined);
    expect(blocked.length).toBeGreaterThan(0);
    for (const s of blocked) {
      // A real reason off the engine's own union, and a finite ordering figure — not a shape the
      // merge could have fabricated from an absent field.
      expect(["no-capacity", "no-input-supplier", "no-consumer", "no-labour", "no-whole-level"])
        .toContain(s.buildBlocked!.reason);
      expect(Number.isFinite(s.buildBlocked!.droppedRoi)).toBe(true);
    }
  }, 30_000);
});

describe("runWorldTick — colonyOpportunity reaches World.systems through the whole real chain", () => {
  it("lands the planner's own value/work terms on a controlled candidate a real run proposed establishing", async () => {
    // Same gap as buildBlocked directly above, at the colonisation planner: nothing else proves the
    // adapter → applyColonyOpportunityUpdates → World.systems path runs inside a real tick. The
    // candidate set only fills once the claim phase has run, so this needs several cycles rather
    // than the single tick the build-side case above takes.
    let world = generateWorld({ systemCount: 100, seed: 42 });
    for (let i = 0; i < 48; i++) world = (await runWorldTick(world)).world;

    const candidates = world.systems.filter((s) => s.colonyOpportunity !== undefined);
    expect(candidates.length).toBeGreaterThan(0);
    for (const s of candidates) {
      // The field's own contract: a CONTROLLED, not-yet-developed system the planner proposed
      // establishing this run, carrying a positive ROI numerator and a positive work denominator.
      expect(s.control).toBe("controlled");
      expect(s.colonyOpportunity!.value).toBeGreaterThan(0);
      expect(s.colonyOpportunity!.work).toBeGreaterThan(0);
    }
  }, 30_000);
});

describe("runWorldTick — nothing inside the tick reads buildBlocked back", () => {
  it("poisoning the input changes no other output", async () => {
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const poisoned: World = {
      ...base,
      systems: base.systems.map((s): WorldSystem => ({
        ...s, buildBlocked: { reason: "no-capacity", droppedRoi: -999_999 },
      })),
    };

    const clean = await runTicksCapturingLast(base, 50);
    const dirty = await runTicksCapturingLast(poisoned, 50);

    // buildBlocked itself legitimately differs run to run (a fresh per-run assessment) — stripped
    // before comparing; everything else, including every harness/instrumentation figure, must be
    // byte-identical. This also pins the Proves entry that the planner's own decisions (which
    // proposals it emits, in what order) are unchanged: `systems`/`markets` carry those decisions'
    // downstream effects, and they strip down to identical here.
    const strip = (w: World): World => ({
      ...w,
      systems: w.systems.map((s): WorldSystem => ({ ...s, buildBlocked: undefined })),
    });
    expect(strip(dirty.world)).toEqual(strip(clean.world));
    expect(dirty.markets).toEqual(clean.markets);
    expect(dirty.events).toEqual(clean.events);
    expect(dirty.instrumentation).toEqual(clean.instrumentation);
  }, 30_000);
});

// ── Build opportunity / Colony opportunity (WorldSystem.buildOpportunity / .colonyOpportunity) ──
// The engine's survival-band selection and what `score`/`value`/`work` mean are pinned
// directly against `planFactionProposals`/`planFactionColonyProposals` in
// `lib/engine/__tests__/directed-build.test.ts`. These pin the world layer's half of the contract:
// `applyBuildOpportunityUpdates`/`applyColonyOpportunityUpdates`'s visited/clear/set behaviour — the
// same shape `applyBuildBlockedUpdates` above uses, over two different visited-set populations — and
// that nothing inside the tick reads either field back.

describe("applyBuildOpportunityUpdates — the visited/clear/set contract", () => {
  const base = toTickSystems(generateWorld({ systemCount: 20, seed: 3 }));

  it("sets buildOpportunity for a visited system present in the update list", () => {
    const [sys] = base;
    const [next] = applyBuildOpportunityUpdates(
      [sys], [sys.id], [{ systemId: sys.id, score: 12.5, goodId: "food" }],
    );
    expect(next.buildOpportunity).toEqual({ score: 12.5, goodId: "food" });
  });

  it("Proves 3 — clears buildOpportunity for a visited system that stopped being a candidate (absent from the update list)", () => {
    const [sys] = base;
    const stale: TickSystem = { ...sys, buildOpportunity: { score: 4, goodId: "ore" } };
    const [next] = applyBuildOpportunityUpdates([stale], [stale.id], []);
    expect(next.buildOpportunity).toBeUndefined();
    expect("buildOpportunity" in next).toBe(false);
  });

  it("Proves 4 — leaves a system the run did not visit untouched, keeping its previous value", () => {
    const [sys, other] = base;
    if (!other) throw new Error("expected at least two systems in the fixture");
    const stale: TickSystem = { ...sys, buildOpportunity: { score: 3, goodId: "food" } };
    // `other` carries a previous run's reading AND is deliberately absent from visitedSystemIds —
    // non-vacuous: were the visited guard dropped, `other` would be cleared exactly like `stale` is,
    // since it too is absent from `updates`.
    const otherStale: TickSystem = { ...other, buildOpportunity: { score: 9, goodId: "metals" } };
    const [next, untouched] = applyBuildOpportunityUpdates([stale, otherStale], [stale.id], []);
    expect(next.buildOpportunity).toBeUndefined();       // visited, absent from updates → cleared
    expect(untouched).toBe(otherStale);                   // not visited → same object, unchanged
    expect(untouched.buildOpportunity).toEqual({ score: 9, goodId: "metals" });
  });

  it("guards a non-finite score to 0 rather than writing NaN/Infinity into world state", () => {
    const [sys] = base;
    const [next] = applyBuildOpportunityUpdates(
      [sys], [sys.id], [{ systemId: sys.id, score: Number.POSITIVE_INFINITY, goodId: "food" }],
    );
    expect(next.buildOpportunity?.score).toBe(0);
  });
});

describe("applyColonyOpportunityUpdates — the visited/clear/set contract (a candidate-scoped visited set)", () => {
  const base = toTickSystems(generateWorld({ systemCount: 20, seed: 3 }));

  it("sets colonyOpportunity for a visited candidate present in the update list", () => {
    const [sys] = base;
    const [next] = applyColonyOpportunityUpdates(
      [sys], [sys.id], [{ systemId: sys.id, value: 40, work: 84 }],
    );
    expect(next.colonyOpportunity).toEqual({ value: 40, work: 84 });
  });

  it("Proves 3 — clears colonyOpportunity for a visited candidate that stopped being proposed (absent from the update list)", () => {
    const [sys] = base;
    const stale: TickSystem = { ...sys, colonyOpportunity: { value: 12, work: 20 } };
    const [next] = applyColonyOpportunityUpdates([stale], [stale.id], []);
    expect(next.colonyOpportunity).toBeUndefined();
    expect("colonyOpportunity" in next).toBe(false);
  });

  it("Proves 4 — leaves a candidate the run did not visit untouched, keeping its previous value", () => {
    const [sys, other] = base;
    if (!other) throw new Error("expected at least two systems in the fixture");
    const stale: TickSystem = { ...sys, colonyOpportunity: { value: 5, work: 10 } };
    const otherStale: TickSystem = { ...other, colonyOpportunity: { value: 99, work: 200 } };
    const [next, untouched] = applyColonyOpportunityUpdates([stale, otherStale], [stale.id], []);
    expect(next.colonyOpportunity).toBeUndefined();
    expect(untouched).toBe(otherStale);
    expect(untouched.colonyOpportunity).toEqual({ value: 99, work: 200 });
  });

  it("guards a non-finite value/work to 0 rather than writing NaN/Infinity into world state", () => {
    const [sys] = base;
    const [next] = applyColonyOpportunityUpdates(
      [sys], [sys.id], [{ systemId: sys.id, value: Number.NaN, work: Number.POSITIVE_INFINITY }],
    );
    expect(next.colonyOpportunity).toEqual({ value: 0, work: 0 });
  });
});

describe("runWorldTick — nothing inside the tick reads buildOpportunity or colonyOpportunity back", () => {
  it("Proves 6 — poisoning the input changes no other output", async () => {
    // Same fixture Build blocked's own poisoning test above uses (`systemCount: 100, seed: 42`), for
    // the same reason it works there: this is a build-side signal, not a directed-logistics one, so
    // this fixture's lack of flow events at this horizon (noted on that test) doesn't blind this test
    // to a leak — a leak would show up in `systems`/`markets`/`instrumentation`, all covered below.
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const poisoned: World = {
      ...base,
      systems: base.systems.map((s): WorldSystem => ({
        ...s,
        buildOpportunity: { score: -999_999, goodId: "food" },
        colonyOpportunity: { value: -999_999, work: -999_999 },
      })),
    };

    const clean = await runTicksCapturingLast(base, 50);
    const dirty = await runTicksCapturingLast(poisoned, 50);

    // Both fields legitimately differ run to run (a fresh per-run assessment) — stripped before
    // comparing; everything else, including every harness/instrumentation figure, must be
    // byte-identical. This also pins the Proves entry that the planner's own decisions (which
    // proposals it emits, in what order) are unchanged.
    const strip = (w: World): World => ({
      ...w,
      systems: w.systems.map((s): WorldSystem => ({
        ...s, buildOpportunity: undefined, colonyOpportunity: undefined,
      })),
    });
    expect(strip(dirty.world)).toEqual(strip(clean.world));
    expect(dirty.markets).toEqual(clean.markets);
    expect(dirty.events).toEqual(clean.events);
    expect(dirty.instrumentation).toEqual(clean.instrumentation);
  }, 30_000);
});

// ── marketRowsBySystem: the persisted-figure seam ───────────────────
// marketRowsBySystem is the single seam carrying the persisted demand-honesty fields
// (`honestUseRate`, `productionSuppressRate`, `productionMult`) from `World` rows into the
// planners' shared market derivation. Each test round-trips one field through
// marketRowsBySystem → toGoodMarketStates and asserts the derivation used the PERSISTED
// figure: dropping any one pass-through line makes the tick fall back to a live recompute
// that produces plausible, ungated numbers — the silent disconnection these exist to catch.

describe("marketRowsBySystem → toGoodMarketStates: the persisted-figure seam", () => {
  // A smelter world: metals draws ore, the vocational school licenses the technicians.
  const SEAM_BUILDINGS = { metals: 3, vocational_school: 1 };
  const SEAM_POPULATION = 100;
  const seamSnap = computeSystemLabourSnapshot(SEAM_BUILDINGS, SEAM_POPULATION);
  const seamCivilian = consumptionRate("ore", seamSnap.basis);
  const seamIndustrial = inputDemandForGood(SEAM_BUILDINGS, "ore", seamSnap.state, unitResourceVector());

  function seamMarket(goodId: string, overrides: Partial<WorldMarket> = {}): WorldMarket {
    return { systemId: "s1", goodId, stock: 10, anchorMult: 1, demandRate: 5, storageCapacity: 0, ...overrides };
  }

  const seamOreState = (markets: WorldMarket[], withDraw = false) => {
    const rows = marketRowsBySystem(markets).get("s1");
    if (rows === undefined) throw new Error("Expected rows for s1");
    const state = toGoodMarketStates(
      { buildings: SEAM_BUILDINGS, population: SEAM_POPULATION, yields: unitResourceVector(), markets: rows },
      { withDraw },
    ).find((g) => g.goodId === "ore");
    if (state === undefined) throw new Error("Expected an ore state");
    return state;
  };

  it("carries the persisted use figure through — demand is the row's, not a recompute", () => {
    // A figure no recompute at this basis would produce, proven against the recompute itself.
    expect(seamCivilian + seamIndustrial).not.toBeCloseTo(7.5, 6);
    const state = seamOreState([seamMarket("ore", { honestUseRate: 7.5 })]);
    expect(state.demand).toBe(7.5);
  });

  it("carries the strike scalar through — the recompute path is gated by the row's suppress", () => {
    expect(seamIndustrial).toBeGreaterThan(0); // or the gating assertion is vacuous
    const state = seamOreState([seamMarket("ore", { productionSuppressRate: 0.4 })]);
    expect(state.demand).toBeCloseTo(seamCivilian + seamIndustrial * 0.4, 9);
  });

  it("carries the event multiplier through — the draw figure sees the consumer's live mult", () => {
    const state = seamOreState(
      [seamMarket("ore"), seamMarket("metals", { stock: 0, productionMult: 0.25 })],
      true,
    );
    expect(state.drawDemand).toBeCloseTo(seamCivilian + seamIndustrial * 0.25, 9);
  });
});
