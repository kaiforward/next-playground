import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import {
  runWorldTick, toTickSystems, applyBuildingIncreases, applyDevelopments, applyAbandonments,
  marketRowsBySystem, resetAbandonedMarkets,
} from "../tick";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import { serializeWorld, deserializeWorld } from "../save";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { unitResourceVector } from "@/lib/engine/resources";
import { catchUpFactor } from "@/lib/tick/shard";
import { RELATIONS_FREQUENCY, RELATION_HISTORY_MAX } from "@/lib/constants/relations";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { computeSystemLabourSnapshot, housingPopCap, inputDemandForGood } from "@/lib/engine/industry";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import {
  BUILDING_TYPES, HOUSING_TYPE, POP_CENTRE_DENSITY, effectiveSpaceCost, labourTotal,
} from "@/lib/constants/industry";
import { CYCLE_LENGTH, REFERENCE_INTERVAL, type TickCadence } from "@/lib/constants/tick-cadence";
import { CROWDING, POPULATION_PARAMS, STRIKE_PARAMS, UNREST_PARAMS } from "@/lib/constants/population";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import type { TaxLevel } from "@/lib/types/game";
import type { SystemDevelopment } from "@/lib/tick/world/directed-build-world";
import type { TickSystem } from "@/lib/tick/rows";
import type {
  World, WorldBuildProject, WorldFactionTreasury, WorldMarket, WorldShip, WorldSystem,
} from "../types";

async function runTicks(world: World, count: number, cadence?: TickCadence) {
  let w = world;
  for (let i = 0; i < count; i++) {
    const result = await runWorldTick(w, cadence ? { cadence } : undefined);
    w = result.world;
  }
  return w;
}

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
    // TickSystem is a transient per-tick row, never serialized — `undefined` (whether or not the
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
    // (which would still serialize identically, but would diverge from a system that never had
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
    // The write-path guarantee: a non-finite value never lands as NaN (⇒ null on serialize) or as
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

    // An out-of-range but finite value clamps into [0, 1] — never serializes as null.
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
    // Events and construction projects draw ids from the same World.nextId counter, threaded stage
    // by stage: the events adapter mints, hands the advanced counter back, directed-build mints from
    // there, and the relations adapter takes it next. The id prefix does not disambiguate them — the
    // threading is what keeps them distinct — so a stage that failed to read the counter back would
    // silently reissue a value that is already live.
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

  it("round-trips building idleCycles across a non-decay tick (the field survives the row/World serialize round-trip)", async () => {
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
      expect(Number.isFinite(market.realizedProductionRate)).toBe(true);
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

    // The divergent-cadence result serializes and deserializes intact (the fractional proposalCycles
    // survives the save byte-for-byte).
    const roundTrip = deserializeWorld(serializeWorld(buildOnly));
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
    // productionless market would assess satisfaction 0 and realized rate 0), so retention is provable:
    // if any stage re-measured it, these exact values would move.
    const { b, world } = twoSystemWaterGradient((market) => ({
      ...market,
      satisfaction: 0.4,
      squeezeCycles: 0.5,
      realizedProductionRate: 5,
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
    expect(bWater(afterLogistics).realizedProductionRate).toBe(5);
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
 * Whole housing levels the fixture system could still build — the land clamp on relief sizing.
 * Mirrors `habitableHousingHeadroom` for a site whose only general-space user is its own housing.
 */
function fixtureLandHeadroom(system: WorldSystem): number {
  const cost = effectiveSpaceCost(HOUSING_TYPE);
  const used = FIXTURE_HOUSING_LEVELS * cost;
  return Math.floor(Math.min(system.habitableSpace - used, system.generalSpace - used) / cost);
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
    const { world, systemId } = populationFixture(0.97, RESTIVE_UNREST);
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
    expect(reliefLevels).toBeGreaterThan(preGrowthLevels);
  }, 60_000);
});

// ── the realised per-cycle population change ─────────────────────────
// `WorldSystem.populationChange` is written by the tick body itself, after the migration stage —
// not by the population processor, which never sees migration's effect. These pin the write's
// migration inclusion, its absence convention and its reference-cycle denomination. Whether
// anything inside the tick reads it back is proven separately (the poisoning test below) rather
// than by `npm run simulate`'s before/after comparison, which is a broader, owner-run gate.

/** Reads `populationChange` off a system row, failing with a clear message rather than silently
 *  treating an unassessed system as 0 — the exact distinction these tests exist to pin. */
function requirePopulationChange(world: World, systemId: string): number {
  const value = fixtureSystem(world, systemId).populationChange;
  if (value === undefined) throw new Error(`expected populationChange to be assessed for ${systemId}`);
  return value;
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
    expect(Math.abs(isolatedChange)).toBeLessThan(20);
    expect(connectedChange).toBeLessThan(-50);
    expect(connectedChange - isolatedChange).toBeLessThan(-50);
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

    const result = deserializeWorld(serializeWorld(after));
    if (!result.ok) throw new Error(`expected the save round-trip to succeed: ${result.error}`);
    const reloaded = result.world.systems.find((s) => s.id === developed.id);
    if (!reloaded) throw new Error("expected the reloaded world to still carry this system");
    expect(reloaded.populationChange).toBeUndefined();
    expect("populationChange" in reloaded).toBe(false);
  });

  it("a cycle in which population holds steady reports 0, distinguishably from absent", async () => {
    // occupancy 0 ⇒ population 0 throughout: growth, decline and death all scale with population,
    // so the pre-migration delta is EXACTLY 0 regardless of d/unrest — and a well-fed (ample-stock)
    // system never enters famine, so this never risks the abandonment branch despite population
    // sitting below ABANDON_POP_FLOOR.
    const { world, systemId } = populationFixture(0, 0);
    const after = await runTicks(world, CYCLE_LENGTH, POPULATION_CADENCE);

    const change = fixtureSystem(after, systemId).populationChange;
    expect(change).not.toBeUndefined();
    expect(change).toBe(0);
  });

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
    // Tiny population with both survival goods cut to zero stock and no local producers: famine
    // every cycle. Starting population and unrest sit close enough to the death line (famine AND
    // post-delta population below ABANDON_POP_FLOOR) that unrest-driven decline crosses it partway
    // through this run — the exact tick the population processor reports this system in
    // `abandonedSystemIds` is the same tick `stockAtCycleStart` snapshotted its water row while the
    // system was still developed, so without the write site's own guard that snapshot would be
    // recomputed against and written back over `resetAbandonedMarkets`' clear, further up this same
    // tick.
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const systemId = base.factions[0].homeworldId;
    let world: World = {
      ...base,
      systems: base.systems.map((s): WorldSystem =>
        s.id === systemId ? { ...s, population: 1.3, popCap: 20, unrest: 0.87 } : s,
      ),
      buildings: base.buildings.filter(
        (b) => !(b.systemId === systemId && (b.buildingType === "water" || b.buildingType === "food")),
      ),
      markets: base.markets.map((m) =>
        m.systemId === systemId && (m.goodId === "water" || m.goodId === "food") ? { ...m, stock: 0 } : m,
      ),
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

    const result = deserializeWorld(serializeWorld(after));
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
    // Task 1's own denomination test uses for population, but avoiding the OPPOSITE clamp here: an
    // actually "ample" stock (well above the knee) collapses production to 0 via that same brake,
    // which would make both readings 0 in vacuous agreement rather than proving anything.
    const world: World = {
      ...base,
      buildings: base.buildings.map((b) =>
        b.systemId === systemId && b.buildingType === "water" ? { ...b, count: b.count * 3 } : b,
      ),
    };

    // One real tick each, fast-forwarded to its own cycle boundary via meta.currentTick, mirroring
    // Task 1's own denomination test. Logistics and construction stay parked so only the economy
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

  it("nothing inside the tick reads stockChange — poisoning the input changes no other output", async () => {
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const poisoned: World = {
      ...base,
      markets: base.markets.map((m): WorldMarket => ({ ...m, stockChange: -999_999 })),
    };

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
