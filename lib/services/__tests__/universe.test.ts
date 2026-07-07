import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getUniverse, getSystemDetail, getSystemSubstrate } from "@/lib/services/universe";
import { ServiceError } from "@/lib/services/errors";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import type { World, WorldSystem } from "@/lib/world/types";
import type { ResourceVector } from "@/lib/types/game";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 14 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

/** Group systems by regionId, preserving world.systems order within each region. */
function groupSystemsByRegion(systems: WorldSystem[]): Map<string, WorldSystem[]> {
  const byRegion = new Map<string, WorldSystem[]>();
  for (const s of systems) {
    const list = byRegion.get(s.regionId) ?? [];
    list.push(s);
    byRegion.set(s.regionId, list);
  }
  return byRegion;
}

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

  it("attaches traits to the right system only", () => {
    expect(world.traits.length).toBeGreaterThan(0);
    const trait = world.traits[0];
    const universe = getUniverse();

    const owner = universe.systems.find((s) => s.id === trait.systemId)!;
    const expectedForOwner = world.traits
      .filter((t) => t.systemId === trait.systemId)
      .map((t) => ({ traitId: t.traitId, quality: t.quality }));
    expect(owner.traits).toEqual(expectedForOwner);

    // A system that doesn't carry this trait row shouldn't have it leak in.
    const other = universe.systems.find(
      (s) => s.id !== trait.systemId && !world.traits.some((t) => t.systemId === s.id && t.traitId === trait.traitId),
    )!;
    expect(other.traits).not.toContainEqual({ traitId: trait.traitId, quality: trait.quality });
  });

  it("derives connection ids as `${fromId}:${toId}`", () => {
    const universe = getUniverse();
    expect(universe.connections.length).toBeGreaterThan(0);
    for (const c of universe.connections) {
      expect(c.id).toBe(`${c.fromSystemId}:${c.toSystemId}`);
    }
  });

  it("derives a region's dominant faction from its most-represented owning faction", () => {
    const byRegion = groupSystemsByRegion(world.systems);
    // A region with >=3 systems lets us give one faction a strict majority
    // (2 systems) over a second faction (1 system) without a tie.
    const [majorityRegionId, majoritySystems] = [...byRegion.entries()].find(
      ([, list]) => list.length >= 3,
    )!;

    const factionA = world.factions[0].id;
    const factionB = world.factions[1].id;
    const overrides = new Map<string, string>();
    majoritySystems.forEach((s, i) => {
      overrides.set(s.id, i < majoritySystems.length - 1 ? factionA : factionB);
    });

    const systems = world.systems.map((s) => {
      const factionId = overrides.get(s.id);
      return factionId === undefined ? s : { ...s, factionId };
    });
    setWorld({ ...world, systems });

    const region = getUniverse().regions.find((r) => r.id === majorityRegionId)!;
    expect(region.dominantFactionId).toBe(factionA);
    expect(region.dominantGovernmentType).toBe(
      world.factions.find((f) => f.id === factionA)!.governmentType,
    );
  });

  it("falls back to 'frontier' for a region with no faction-owned systems", () => {
    const byRegion = groupSystemsByRegion(world.systems);
    const [frontierRegionId, frontierSystems] = [...byRegion.entries()].find(
      ([, list]) => list.length >= 1,
    )!;
    const frontierIds = new Set(frontierSystems.map((s) => s.id));

    const systems = world.systems.map((s) =>
      frontierIds.has(s.id) ? { ...s, factionId: null } : s,
    );
    setWorld({ ...world, systems });

    const region = getUniverse().regions.find((r) => r.id === frontierRegionId)!;
    expect(region.dominantFactionId).toBeNull();
    expect(region.dominantGovernmentType).toBe("frontier");
  });
});

describe("getSystemDetail", () => {
  it("returns trait facts, visibility, and station", () => {
    expect(world.traits.length).toBeGreaterThan(0);
    const trait = world.traits[0];
    const data = getSystemDetail(trait.systemId);

    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.station).toBeNull();

    // Display data (name/category/description) is enriched client-side from
    // the TRAITS catalog — the API carries only the facts.
    const resolved = data.traits?.find((t) => t.traitId === trait.traitId);
    expect(resolved).toEqual({ traitId: trait.traitId, quality: trait.quality });
  });

  it("throws ServiceError(404) for an unknown system", () => {
    expect(() => getSystemDetail("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemDetail("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
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

  it("throws ServiceError(404) for an unknown system", () => {
    expect(() => getSystemSubstrate("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemSubstrate("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});
