import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getUniverse, getSystemDetail, getSystemSubstrate } from "@/lib/services/universe";
import { ServiceError } from "@/lib/services/errors";
import { regionInfos } from "@/lib/services/world-index";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import type { World } from "@/lib/world/types";
import type { ResourceVector } from "@/lib/types/game";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 14 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getUniverse", () => {
  it("returns systems/connections/factions/regions in the expected shape", () => {
    const universe = getUniverse();

    expect(universe.regions.length).toBe(world.regions.length);
    expect(universe.systems.length).toBe(world.systems.length);
    expect(universe.connections.length).toBe(world.connections.length);
    expect(universe.factions.length).toBe(world.factions.length);

    const system = world.systems[0];
    const uniSystem = universe.systems.find((s) => s.id === system.id)!;
    expect(uniSystem).toMatchObject({
      id: system.id,
      name: system.name,
      economyType: system.economyType,
      sunClass: system.sunClass,
      x: system.x,
      y: system.y,
      description: system.description,
      regionId: system.regionId,
      factionId: system.factionId,
      isGateway: system.isGateway,
    });

    const faction = world.factions[0];
    const uniFaction = universe.factions.find((f) => f.id === faction.id)!;
    expect(uniFaction).toEqual({
      id: faction.id,
      name: faction.name,
      color: faction.color,
      governmentType: faction.governmentType,
    });
  });

  it("derives connection ids as `${fromId}:${toId}`", () => {
    const universe = getUniverse();
    expect(universe.connections.length).toBeGreaterThan(0);
    for (const c of universe.connections) {
      expect(c.id).toBe(`${c.fromSystemId}:${c.toSystemId}`);
    }
  });

  // The dominant-faction/government derivation is asserted at its owner
  // (world-index.test.ts → regionInfos); this is the wiring — the universe serves that
  // derivation rather than a second one of its own.
  it("serves the shared region index rather than re-deriving regions", () => {
    expect(getUniverse().regions).toEqual(regionInfos());
  });
});

describe("getSystemDetail", () => {
  it("returns system facts, visibility, and station", () => {
    const system = world.systems[0];
    const data = getSystemDetail(system.id);

    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.station).toBeNull();
    expect(data).toMatchObject({
      id: system.id,
      name: system.name,
      economyType: system.economyType,
      sunClass: system.sunClass,
      regionId: system.regionId,
      factionId: system.factionId,
      isGateway: system.isGateway,
    });
  });

  it('throws ServiceError("not_found") for an unknown system', () => {
    expect(() => getSystemDetail("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemDetail("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ kind: "not_found" });
    }
  });
});

describe("getSystemSubstrate", () => {
  it("maps bodies with archetype display data and round-trips slot/quality vectors", () => {
    const body = world.bodies[0];
    const data = getSystemSubstrate(body.systemId);

    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    const bodyView = data.bodies.find((b) => b.id === body.id)!;
    expect(bodyView.archetypeName).toBe(BODY_ARCHETYPES[body.bodyType].name);
    expect(bodyView.habitable).toBe(body.habitable);
    expect(bodyView.size).toBe(body.size);

    const expectedSlots: ResourceVector = {
      gas: body.slotGas,
      minerals: body.slotMinerals,
      ore: body.slotOre,
      biomass: body.slotBiomass,
      arable: body.slotArable,
      water: body.slotWater,
      radioactive: body.slotRadioactive,
    };
    const expectedQuality: ResourceVector = {
      gas: body.qualGas,
      minerals: body.qualMinerals,
      ore: body.qualOre,
      biomass: body.qualBiomass,
      arable: body.qualArable,
      water: body.qualWater,
      radioactive: body.qualRadioactive,
    };
    expect(bodyView.slots).toEqual(expectedSlots);
    expect(bodyView.quality).toEqual(expectedQuality);
  });

  it('throws ServiceError("not_found") for an unknown system', () => {
    expect(() => getSystemSubstrate("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemSubstrate("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ kind: "not_found" });
    }
  });
});
