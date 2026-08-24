import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getUniverse, getSystemDetail, getSystemSubstrate } from "@/lib/services/universe";
import { ServiceError } from "@/lib/services/errors";
import { regionInfos } from "@/lib/services/world-index";
import { BODY_ARCHETYPES, HABITABILITY_THRESHOLD } from "@/lib/constants/bodies";
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
    expect(bodyView.score).toBe(BODY_ARCHETYPES[body.bodyType].scores.default);
    expect(bodyView.locked).toBe(BODY_ARCHETYPES[body.bodyType].techLocked);

    const expectedSlots: ResourceVector = {
      gas: body.countGas,
      minerals: body.countMinerals,
      ore: body.countOre,
      biomass: body.countBiomass,
      arable: body.countArable,
      water: body.countWater,
      radioactive: body.countRadioactive,
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
    expect(bodyView.counts).toEqual(expectedSlots);
    expect(bodyView.quality).toEqual(expectedQuality);
    expect(bodyView.peopleLand).toBe(body.peopleLand);
    expect(bodyView.extractionModifier).toBe(BODY_ARCHETYPES[body.bodyType].extractionModifier);
  });

  it("marks occupied bodies from the cached fill-best-first fold, not every people-land body", () => {
    // A system whose EXISTING bodies are all sub-threshold/locked (no other contributor to tie
    // with), plus two above-threshold, unlocked bodies of our own and a cached fold whose
    // frontierIndex stops at the first (best-score) one — the second must read unoccupied, proving
    // the marking tracks the SPECIFIC cached prefix rather than "any habitable body" or "every body".
    const system = world.systems.find((s) => {
      const existing = world.bodies.filter((b) => b.systemId === s.id);
      return existing.length > 0
        && existing.every((b) => BODY_ARCHETYPES[b.bodyType].techLocked
          || BODY_ARCHETYPES[b.bodyType].scores.default < HABITABILITY_THRESHOLD);
    })!;
    const existing = world.bodies.filter((b) => b.systemId === system.id)[0];
    const best: World["bodies"][number] = {
      ...existing, id: "occ-best", systemId: system.id, bodyType: "gaia_world", peopleLand: 500,
    };
    const worse: World["bodies"][number] = {
      ...existing, id: "occ-worse", systemId: system.id, bodyType: "boreal_world", peopleLand: 500,
    };
    const patched: World = {
      ...world,
      bodies: [...world.bodies, best, worse],
      systems: world.systems.map((s) =>
        s.id === system.id ? { ...s, habitabilityQuality: { quality: 1, frontierIndex: 0 } } : s),
    };
    setWorld(patched);

    const data = getSystemSubstrate(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.bodies.find((b) => b.id === "occ-best")!.occupied).toBe(true);
    expect(data.bodies.find((b) => b.id === "occ-worse")!.occupied).toBe(false);
  });

  it("marks no body occupied when the system has never been assessed (no cached habitabilityQuality)", () => {
    const system = world.systems.find((s) => world.bodies.filter((b) => b.systemId === s.id).length > 0)!;
    const patched: World = {
      ...world,
      systems: world.systems.map((s) => (s.id === system.id ? { ...s, habitabilityQuality: undefined } : s)),
    };
    setWorld(patched);

    const data = getSystemSubstrate(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.bodies.every((b) => !b.occupied)).toBe(true);
  });

  it("reads absolute people land, 0 for a system with none — never NaN", () => {
    const zeroed: World = {
      ...world,
      systems: world.systems.map((s) => (s.id === world.systems[1].id ? { ...s, peopleLand: 0 } : s)),
    };
    setWorld(zeroed);
    const data = getSystemSubstrate(world.systems[1].id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.peopleLand).toBe(0);
    expect(Number.isNaN(data.peopleLand)).toBe(false);
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
