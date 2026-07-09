import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick, toSimSystems } from "../tick";
import { RELATIONS_FREQUENCY, RELATION_HISTORY_MAX } from "@/lib/constants/relations";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import type { WorldShip } from "../types";

async function runTicks(world: ReturnType<typeof generateWorld>, count: number) {
  let w = world;
  for (let i = 0; i < count; i++) {
    const result = await runWorldTick(w);
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

  it("returns a TickEventRaw whose currentTick matches the new world's tick", async () => {
    const world = generateWorld({ systemCount: 100, seed: 42 });
    const { world: after, events } = await runWorldTick(world);
    expect(events.currentTick).toBe(after.meta.currentTick);
    expect(events.currentTick).toBe(1);
  });

  it("toSimSystems seeds buildingIdleMonths from WorldBuilding.idleMonths", () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const target = base.buildings[0].systemId;
    const world = {
      ...base,
      buildings: base.buildings.map((b) => (b.systemId === target ? { ...b, idleMonths: 4 } : b)),
    };
    const sim = toSimSystems(world).find((s) => s.id === target);
    expect(sim).toBeDefined();
    for (const b of world.buildings.filter((b) => b.systemId === target)) {
      expect(sim?.buildingIdleMonths[b.buildingType]).toBe(4);
    }
  });

  it("round-trips building idleMonths across a tick (inert plumbing — decay does not yet consume it)", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const world = { ...base, buildings: base.buildings.map((b) => ({ ...b, idleMonths: 7 })) };
    const seeded = new Set(world.buildings.map((b) => `${b.systemId}|${b.buildingType}`));
    const { world: after } = await runWorldTick(world);
    // Every building that existed at seed still carries its idleMonths unchanged (nothing in
    // Phase A reads or writes it; the value merely survives the sim round-trip). Newly-built rows
    // are excluded — they start at 0.
    for (const b of after.buildings) {
      if (seeded.has(`${b.systemId}|${b.buildingType}`)) {
        expect(b.idleMonths, `${b.systemId}|${b.buildingType}`).toBe(7);
      }
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
    // A homeworld-only galaxy has no same-faction adjacencies, so no cross-system flows arise
    // until a faction connects developed territory. Put two developed homeworlds in one faction
    // and link them directly, so their differing production drives directed-logistics.
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
    const after = await runTicks(world, 50);

    expect(after.flowEvents.length).toBeGreaterThan(0);
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
