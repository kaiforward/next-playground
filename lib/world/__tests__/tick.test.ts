import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick, toTickSystems, applyBuildingIncreases } from "../tick";
import { serializeWorld, deserializeWorld } from "../save";
import { catchUpFactor } from "@/lib/tick/shard";
import { RELATIONS_FREQUENCY, RELATION_HISTORY_MAX } from "@/lib/constants/relations";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { housingPopCap } from "@/lib/engine/industry";
import { BUILDING_TYPES, HOUSING_TYPE, POP_CENTRE_DENSITY, labourTotal } from "@/lib/constants/industry";
import { MONTH_LENGTH, type TickCadence } from "@/lib/constants/tick-cadence";
import { CROWDING, POPULATION_PARAMS, STRIKE_PARAMS, UNREST_PARAMS } from "@/lib/constants/population";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import type { TaxLevel } from "@/lib/types/game";
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
        expect(Number.isInteger(bld.idleMonths)).toBe(true);
      }
    }
  });

  it("toTickSystems seeds buildingIdleMonths from WorldBuilding.idleMonths", () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const target = base.buildings[0].systemId;
    const world = {
      ...base,
      buildings: base.buildings.map((b) => (b.systemId === target ? { ...b, idleMonths: 4 } : b)),
    };
    const tickSystem = toTickSystems(world).find((s) => s.id === target);
    expect(tickSystem).toBeDefined();
    for (const b of world.buildings.filter((b) => b.systemId === target)) {
      expect(tickSystem?.buildingIdleMonths[b.buildingType]).toBe(4);
    }
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

  it("round-trips building idleMonths across a non-decay tick (the field survives the row/World serialize round-trip)", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const world = { ...base, buildings: base.buildings.map((b) => ({ ...b, idleMonths: 7 })) };
    const seeded = new Set(world.buildings.map((b) => `${b.systemId}|${b.buildingType}`));
    const { world: after } = await runWorldTick(world);
    // Infrastructure decay consumes idleMonths, but only on an economy-update tick (it is gated
    // behind economySignals); this single tick from a fresh world is not one, so every building
    // that existed at seed round-trips its idleMonths unchanged through the tick. Newly-built rows
    // are excluded — they start at 0.
    for (const b of after.buildings) {
      if (seeded.has(`${b.systemId}|${b.buildingType}`)) {
        expect(b.idleMonths, `${b.systemId}|${b.buildingType}`).toBe(7);
      }
    }
  });


  it("persists economy assessment signals through the world tick", async () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const result = await runWorldTick(world, {
      cadence: { month: 1, construction: 24, logistics: 24 },
    });
    const developedIds = new Set(result.world.systems
      .filter((system) => system.control === "developed")
      .map((system) => system.id));
    const assessed = result.world.markets.filter((market) => developedIds.has(market.systemId));
    expect(assessed.length).toBeGreaterThan(0);
    for (const market of assessed) {
      expect(Number.isFinite(market.realizedProductionRate)).toBe(true);
      expect(typeof market.productionSuppressed).toBe("boolean");
      expect(market.squeezePulses).toBeGreaterThanOrEqual(0);
      expect(market.squeezePulses).toBeLessThanOrEqual(2);
    }
  });

  it("advances the construction and economy clocks on their own cadences (divergent-pulse persistence)", async () => {
    // The construction proposal-pressure counter and the economy squeeze counter are DISTINCT clocks
    // written by different stages on independently-tunable cadences. Engineer a persistent food deficit
    // at a developed homeworld (no food capacity, empty stock), seed BOTH counters at 1, then pulse the
    // two cadences apart: each clock advances only on its own pulse, and the stale off-pulse read of the
    // other clock is never counted.
    const base = generateWorld({ systemCount: 100, seed: 42 });
    const home = base.factions[0].homeworldId;
    const prepared = {
      ...base,
      buildings: base.buildings.filter((b) => !(b.systemId === home && b.buildingType === "food")),
      markets: base.markets.map((m) =>
        m.systemId === home && m.goodId === "food"
          ? { ...m, stock: 0, squeezePulses: 1, proposalPulses: 1 }
          : m,
      ),
    };
    const foodOf = (w: typeof prepared) =>
      w.markets.find((m) => m.systemId === home && m.goodId === "food");

    // Construction-only pulse: directed-build resolves at a finer-than-reference cadence, economy (month)
    // does NOT. The build assessment advances proposalPulses by that pulse's reference-time
    // (catchUpFactor(1)); the stale economy read leaves squeezePulses untouched.
    const buildOnly = (await runWorldTick(prepared, { cadence: { month: 999, construction: 1, logistics: 999 } })).world;
    expect(foodOf(buildOnly)?.proposalPulses).toBeCloseTo(1 + catchUpFactor(1), 10); // 1 → 1 + reference-time
    expect(foodOf(buildOnly)?.squeezePulses).toBe(1);  // unchanged — economy did not run

    // Economy-only pulse: economy resolves and rations the empty deficit → squeezePulses advances by the
    // same reference-time; the stale build read (construction off-pulse) leaves proposalPulses untouched.
    const econOnly = (await runWorldTick(prepared, { cadence: { month: 1, construction: 999, logistics: 999 } })).world;
    expect(foodOf(econOnly)?.squeezePulses).toBeCloseTo(1 + catchUpFactor(1), 10);  // 1 → 1 + reference-time
    expect(foodOf(econOnly)?.proposalPulses).toBe(1); // unchanged — directed-build did not run

    // The divergent-cadence result serializes and deserializes intact (the fractional proposalPulses
    // survives the save byte-for-byte).
    const roundTrip = deserializeWorld(serializeWorld(buildOnly));
    expect(roundTrip.ok).toBe(true);
    if (roundTrip.ok) {
      expect(foodOf(roundTrip.world)?.proposalPulses).toBe(foodOf(buildOnly)?.proposalPulses);
      expect(foodOf(roundTrip.world)?.squeezePulses).toBe(1);
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
      // self-refill, so it stays below its days-of-supply anchor and must import).
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
    const cadence = { month: 1, logistics: 1, construction: 99 };
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
        { ...producer, count, idleMonths: 11 },
      ],
      markets: base.markets.map((market) =>
        market.systemId === systemId && market.goodId === goodId
          ? { ...market, stock: 1_000_000, logisticsFundingBound: true }
          : market,
      ),
    };
    const cadence = { month: 1, logistics: 1, construction: 99 };
    const protectedPulse = (await runWorldTick(prepared, { cadence })).world;
    const protectedBuilding = protectedPulse.buildings.find(
      (building) => building.systemId === systemId && building.buildingType === producer.buildingType,
    )!;
    expect(protectedBuilding.count).toBe(count);
    expect(protectedBuilding.idleMonths).toBe(0);
    expect(protectedPulse.markets.find(
      (market) => market.systemId === systemId && market.goodId === goodId,
    )?.logisticsFundingBound).toBe(false);

    const ordinaryPulse = (await runWorldTick(protectedPulse, { cadence })).world;
    const ordinaryBuilding = ordinaryPulse.buildings.find(
      (building) => building.systemId === systemId && building.buildingType === producer.buildingType,
    )!;
    expect(ordinaryBuilding.count).toBe(count);
    expect(ordinaryBuilding.idleMonths).toBeCloseTo(1 / 24);
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
});

// ── logistics ↔ economy assessment ordering ──────────────────────────
// The tick runs economy BEFORE directed-logistics, so a pulse measures satisfaction/squeeze/unrest on
// the recipient's PRE-import stock; the import lands afterward and never rewrites an already-measured
// assessment. Same-tick logistics stock changes DO patch into build rows, but the persisted economy
// fields wait for the NEXT economy pulse. These pin exactly that ordering end to end.

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
  it("assesses the pre-import state on a coincident pulse, then recovers at the next economy pulse", async () => {
    const { b, world } = twoSystemWaterGradient((market) => market);
    const bWater = (w: World) => w.markets.find((m) => m.systemId === b && m.goodId === "water")!;
    const bSystem = (w: World) => w.systems.find((s) => s.id === b)!;

    // Coincident pulse: economy (month) AND logistics both resolve this tick. Construction stays off so
    // directed-build contributes no noise. Economy runs first — it measures B's empty water market — and
    // logistics moves the import in afterward.
    const cadence = { month: 1, logistics: 1, construction: 999 };
    const afterImport = (await runWorldTick(world, { cadence })).world;

    // The import happened this same tick: a water flow into B, and its stock rose off the empty floor.
    expect(afterImport.flowEvents.some((f) => f.toSystemId === b && f.goodId === "water")).toBe(true);
    expect(bWater(afterImport).stock).toBeGreaterThan(0);

    // …but the persisted assessment still describes the PRE-import (empty) state: satisfaction measured
    // zero delivery, the squeeze clock advanced by one reference-time from zero, and unrest rose off its
    // clean seed. A same-tick re-measure after the import would instead read satisfaction ≈ 1 and reset
    // the squeeze clock — this is the assertion that catches that regression.
    expect(bWater(afterImport).satisfaction).toBeCloseTo(0, 6);
    expect(bWater(afterImport).squeezePulses).toBeCloseTo(catchUpFactor(1), 10);
    expect(bSystem(afterImport).unrest).toBeGreaterThan(0);

    // Next economy pulse: B now holds the imported water, so satisfaction recovers and the squeeze clock
    // resets. Direction of recovery only — magnitude calibration is out of scope here. (Missing ⇒ 1 is
    // the documented default; both reads are written by an economy pulse, so neither is actually absent.)
    const importSatisfaction = bWater(afterImport).satisfaction ?? 1;
    const afterRecovery = (await runWorldTick(afterImport, { cadence })).world;
    const recoverySatisfaction = bWater(afterRecovery).satisfaction ?? 1;
    expect(recoverySatisfaction).toBeGreaterThan(importSatisfaction);
    expect(bWater(afterRecovery).squeezePulses).toBe(0);
  });

  it("retains the persisted assessment across a logistics-only tick until the next economy pulse", async () => {
    // Seed a distinctive rationed assessment the economy would NOT reproduce for this state (an empty,
    // productionless market would assess satisfaction 0 and realized rate 0), so retention is provable:
    // if any stage re-measured it, these exact values would move.
    const { b, world } = twoSystemWaterGradient((market) => ({
      ...market,
      satisfaction: 0.4,
      squeezePulses: 0.5,
      realizedProductionRate: 5,
    }));
    const bWater = (w: World) => w.markets.find((m) => m.systemId === b && m.goodId === "water")!;

    // Logistics resolves; economy and construction do not.
    const afterLogistics = (
      await runWorldTick(world, { cadence: { month: 999, logistics: 1, construction: 999 } })
    ).world;

    // The import moved water in — stock changed.
    expect(afterLogistics.flowEvents.some((f) => f.toSystemId === b && f.goodId === "water")).toBe(true);
    expect(bWater(afterLogistics).stock).toBeGreaterThan(0);

    // …but the seeded assessment is carried through untouched: no economy pulse ran to re-measure it, and
    // logistics never writes these fields. An off-pulse economy run, or a logistics-side re-measure, would
    // move at least one of them.
    expect(bWater(afterLogistics).satisfaction).toBe(0.4);
    expect(bWater(afterLogistics).squeezePulses).toBe(0.5);
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
/** Cover deep enough that delivery stays full for the whole run (the pulse clamps it to maxStock). */
const AMPLE_STOCK = 1e7;
/** An interval no fixture tick is a resolution pulse of — parks a stage for the run. */
const NEVER = 1_000_000;
/** Reference month, with construction and logistics parked: unrest and growth resolve at their
 *  calibrated per-month magnitudes (catchUpFactor = 1) and nothing else touches the fixture. */
const POPULATION_CADENCE: TickCadence = { month: MONTH_LENGTH, construction: NEVER, logistics: NEVER };
/** A construction-only pulse: the build planner resolves against a world the economy has not moved. */
const CONSTRUCTION_CADENCE: TickCadence = { month: NEVER, construction: 1, logistics: NEVER };
/** Occupancy past CROWDING.BRAKE_END, where the growth brake is fully shut and crowding pressure maxes. */
const OVERSHOOT_OCCUPANCY = 1.16;
/** Stored unrest for the relief fixture — earned unrest, well past any standing floor. */
const RESTIVE_UNREST = 0.5;

/**
 * A developed homeworld reduced to housing alone, at a chosen occupancy r = population ÷ popCap and
 * stored unrest, owned by a faction taxed at the heaviest band. Stripping the producers is what makes
 * the supply regime a property of the fixture rather than of the galaxy: with no local output, every
 * consumed good is served purely from the seeded stock, so ample stock reads Supplied and an emptied
 * market reads Shortage on every demanded good at once. Its faction owns no other developed system, so
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
      { systemId, buildingType: HOUSING_TYPE, count: FIXTURE_HOUSING_LEVELS, idleMonths: 0, collapseDebt: 0 },
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

/** Every persisted per-good satisfaction at the fixture system — the D and regime premise. */
function fixtureSatisfactions(world: World, systemId: string): number[] {
  return world.markets.filter((m) => m.systemId === systemId).map((m) => m.satisfaction ?? 1);
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
    const after = await runTicks(world, MONTH_LENGTH, POPULATION_CADENCE);
    const grown = fixtureSystem(after, systemId);

    // Premise: the pulse delivered every demanded good in full, so D folds to 0 and the regime is
    // Supplied whatever the demand weights.
    for (const satisfaction of fixtureSatisfactions(after, systemId)) expect(satisfaction).toBe(1);
    // Housing is untouched, so occupancy here is a pure population story — and it stays under the
    // cap, which is what leaves both the crowd brake open and the crowding term out of the floor.
    expect(grown.popCap).toBe(FIXTURE_POP_CAP);
    expect(grown.population).toBeLessThan(grown.popCap);

    // At D = 0 the integrator relaxes toward the standing floor, and this system starts exactly on
    // it: tax pressure alone (r ≤ 1 contributes no crowding), so unrest holds.
    expect(grown.unrest).toBeCloseTo(TAX_FLOOR, 12);

    // Growth runs at the FULL rate below the cap — crowdFactor is 1 for r ≤ 1 and the satisfaction
    // factor is 1 — against the standing floor's decline bite.
    const catchUp = catchUpFactor(MONTH_LENGTH);
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
    const after = await runTicks(world, MONTH_LENGTH, POPULATION_CADENCE);
    const crowded = fixtureSystem(after, systemId);

    for (const satisfaction of fixtureSatisfactions(after, systemId)) expect(satisfaction).toBe(1);
    // Still overcrowded, and housing never rose to meet it (the cap only moves by construction/decay).
    expect(crowded.popCap).toBe(FIXTURE_POP_CAP);
    expect(crowded.population).toBeGreaterThan(crowded.popCap);
    // Crowding pressure saturates past the brake end, so unrest settles on that floor and stays there.
    expect(crowded.unrest).toBeCloseTo(floor, 12);
    // The whole point: even fully overcrowded, the standing floor is nowhere near the collapse gate.
    expect(crowded.unrest).toBeLessThan(POPULATION_PARAMS.overshootDeathUnrestGate);

    // Growth is braked to exactly zero, so the pulse's only population term is the unrest decline —
    // no overshoot death, though the overshoot itself is large.
    const catchUp = catchUpFactor(MONTH_LENGTH);
    const decline = POPULATION_PARAMS.declineRate * before.population * floor;
    expect(crowded.population).toBeCloseTo(before.population - decline * catchUp, 6);

    // Discrimination: an ungated death term would have removed a further large slice of the overshoot.
    const ungatedDeath =
      POPULATION_PARAMS.overshootDeathRate * (before.population - before.popCap) * floor;
    expect(ungatedDeath).toBeGreaterThan(0);
    expect(crowded.population).toBeGreaterThan(before.population - (decline + ungatedDeath) * catchUp);
  }, 60_000);

  it("drains stored unrest geometrically at recoveryDecay after one full-shortage pulse", async () => {
    const { world, systemId } = populationFixture(0.92, TAX_FLOOR);
    // Empty the fixture system on the tick before the assessment, so the pulse measures a market
    // that cannot deliver — and nothing else has had a chance to move it.
    const drained = withStock(
      await runTicks(world, MONTH_LENGTH - 1, POPULATION_CADENCE),
      systemId,
      0,
    );
    const shortagePulse = await runTicks(drained, 1, POPULATION_CADENCE);

    // Premise: every demanded good delivered nothing, so D folds to exactly 1 and the worst-good
    // fold reads Shortage — both independent of the demand weights.
    for (const satisfaction of fixtureSatisfactions(shortagePulse, systemId)) {
      expect(satisfaction).toBe(0);
    }
    // The system entered on its floor, so the relaxation term is zero and the whole rise is the
    // shortage gain integrating D = 1.
    const shortageUnrest = fixtureSystem(shortagePulse, systemId).unrest;
    expect(shortageUnrest).toBeCloseTo(TAX_FLOOR + UNREST_PARAMS.gainShortage, 12);
    // One bad pulse from the floor is recoverable — it does not reach the strike regime.
    expect(shortageUnrest).toBeLessThan(STRIKE_PARAMS.threshold);

    // Restock: the next assessment finds the market able to deliver again.
    let recovering = withStock(shortagePulse, systemId, AMPLE_STOCK);
    const unrestByPulse: number[] = [];
    for (let pulse = 0; pulse < 4; pulse++) {
      recovering = await runTicks(recovering, MONTH_LENGTH, POPULATION_CADENCE);
      // Supply is restored immediately — the regime flips back the very first assessment, and the
      // recovery below is the memory draining, not the shortage still being measured.
      for (const satisfaction of fixtureSatisfactions(recovering, systemId)) {
        expect(satisfaction).toBe(1);
      }
      unrestByPulse.push(fixtureSystem(recovering, systemId).unrest);
    }

    // The stored excess above the floor decays geometrically at the Supplied relaxation rate.
    const excess = UNREST_PARAMS.gainShortage;
    const retained = 1 - UNREST_PARAMS.recoveryDecay;
    unrestByPulse.forEach((unrest, index) => {
      expect(unrest).toBeCloseTo(TAX_FLOOR + excess * retained ** (index + 1), 12);
    });

    // Stated as the law rather than the values: each supplied pulse keeps exactly (1 - recoveryDecay)
    // of the previous excess. A rate-agnostic snap to the floor, or a relaxation at the Rationing
    // rate, breaks this ratio while still "going down".
    const excessByPulse = [shortageUnrest, ...unrestByPulse].map((u) => u - TAX_FLOOR);
    for (let i = 1; i < excessByPulse.length; i++) {
      expect(excessByPulse[i]).toBeGreaterThan(0);
      expect(excessByPulse[i]).toBeLessThan(excessByPulse[i - 1]);
      expect(excessByPulse[i] / excessByPulse[i - 1]).toBeCloseTo(retained, 10);
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
    for (const satisfaction of fixtureSatisfactions(world, systemId)) expect(satisfaction).toBe(1);
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
});
