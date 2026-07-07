import { describe, it, expect, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemCadence } from "@/lib/services/system-cadence";
import { ServiceError } from "@/lib/services/errors";
import { shardGroupForIndex } from "@/lib/tick/shard";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { economyShardOrder, factionShardKeys } from "@/lib/engine/shard-order";
import { InMemoryEconomyWorld } from "@/lib/tick/adapters/memory/economy";
import { MemoryDirectedLogisticsWorld } from "@/lib/tick/adapters/memory/directed-logistics";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { World, WorldSystem } from "@/lib/world/types";
import type { SimSystem } from "@/lib/engine/simulator/types";
import type { SystemLogisticsRow } from "@/lib/tick/world/directed-logistics-world";

// A realistic system template (every required field populated by the real
// generator), so tests only need to override the two fields that drive
// shard ordering: `id` and `factionId`.
const template: WorldSystem = generateWorld({ systemCount: 60, seed: 21 }).systems[0];

function makeSystem(id: string, factionId: string | null): WorldSystem {
  return { ...template, id, factionId };
}

function buildWorld(systems: WorldSystem[]): World {
  return {
    meta: {
      seed: 1,
      systemCount: systems.length,
      mapSize: 100,
      currentTick: 0,
      startingSystemId: systems[0].id,
    },
    regions: [],
    systems,
    bodies: [],
    buildings: [],
    traits: [],
    connections: [],
    markets: [],
    factions: [],
    relations: [],
    alliancePacts: [],
    events: [],
    modifiers: [],
    ships: [],
    flowEvents: [],
    nextId: 1,
  };
}

// Minimal fixtures for the tick adapters' constructor inputs (only the fields
// economyShardOrder/factionShardKeys and the adapter constructors touch).
function makeSimSystem(id: string, factionId: string | null): SimSystem {
  return {
    id,
    name: id,
    economyType: "agricultural",
    regionId: "region-1",
    factionId,
    governmentType: "federation",
    population: 100,
    popCap: 200,
    traits: [],
    unrest: 0,
    buildings: {},
    yields: emptyResourceVector(),
    slotCap: emptyResourceVector(),
    generalSpace: 100,
    habitableSpace: 50,
  };
}

function makeLogisticsRow(systemId: string, factionId: string | null): SystemLogisticsRow {
  return {
    systemId,
    factionId,
    population: 100,
    buildings: {},
    yields: emptyResourceVector(),
    markets: [],
  };
}

afterEach(() => {
  clearWorld();
});

describe("getSystemCadence — economy shard", () => {
  it("ranks systems by localeCompare id order, independent of array order", () => {
    // Deliberately NOT in sorted order.
    const ids = ["zulu", "alpha", "mike", "bravo", "yankee"];
    const systems = ids.map((id) => makeSystem(id, null));
    setWorld(buildWorld(systems));

    const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
    for (const id of ids) {
      const rank = sortedIds.indexOf(id);
      const expected = shardGroupForIndex(rank, sortedIds.length, ECONOMY_UPDATE_INTERVAL);
      expect(getSystemCadence(id).economyShardGroup).toBe(expected);
    }
  });
});

describe("shard-order helpers vs. the tick adapters (drift guard)", () => {
  it("InMemoryEconomyWorld.getSystemIds() matches economyShardOrder for the same systems", async () => {
    const ids = ["zulu", "alpha", "mike", "bravo", "yankee"];
    const systems = ids.map((id) => makeSimSystem(id, null));
    const world = new InMemoryEconomyWorld({ systems, markets: [], modifiers: [] });

    const fromAdapter = await world.getSystemIds();
    expect(fromAdapter).toEqual(economyShardOrder(systems));
  });

  it("MemoryDirectedLogisticsWorld.getFactionShardKeys() matches factionShardKeys for the same rows", async () => {
    const rows = [
      makeLogisticsRow("s1", "faction-b"),
      makeLogisticsRow("s2", "faction-a"),
      makeLogisticsRow("s3", null),
      makeLogisticsRow("s4", "faction-b"),
    ];
    const world = new MemoryDirectedLogisticsWorld(rows);

    const fromAdapter = await world.getFactionShardKeys();
    expect(fromAdapter).toEqual(factionShardKeys(rows));
  });
});

describe("getSystemCadence — logistics shard", () => {
  it("uses first-seen faction order across the systems array, independents included", () => {
    // faction-1 seen first, then faction-2, then a null (independent) system
    // planted in the middle — first-seen order must be [faction-1, faction-2, null].
    const sysA = makeSystem("sys-a", "faction-1");
    const sysB = makeSystem("sys-b", "faction-2");
    const sysC = makeSystem("sys-c", null);
    const sysD = makeSystem("sys-d", "faction-1");
    const sysE = makeSystem("sys-e", "faction-2");
    setWorld(buildWorld([sysA, sysB, sysC, sysD, sysE]));

    const total = 3; // faction-1, faction-2, null
    const expectedFor = (index: number): number =>
      shardGroupForIndex(index, total, DIRECTED_LOGISTICS.INTERVAL);

    expect(getSystemCadence(sysA.id).logisticsShardGroup).toBe(expectedFor(0));
    expect(getSystemCadence(sysD.id).logisticsShardGroup).toBe(expectedFor(0));
    expect(getSystemCadence(sysB.id).logisticsShardGroup).toBe(expectedFor(1));
    expect(getSystemCadence(sysE.id).logisticsShardGroup).toBe(expectedFor(1));
    expect(getSystemCadence(sysC.id).logisticsShardGroup).toBe(expectedFor(2));
  });
});

describe("getSystemCadence — fallbacks", () => {
  it("throws ServiceError(404) for an unknown system id", () => {
    setWorld(buildWorld([makeSystem("sys-only", null)]));

    expect(() => getSystemCadence("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemCadence("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});
