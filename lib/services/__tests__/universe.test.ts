import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getUniverse, getSystemDetail, getSystemSubstrate, getSystemIndustry } from "@/lib/services/universe";
import { getSystemPopulation } from "@/lib/services/system-population";
import { ServiceError } from "@/lib/services/errors";
import { regionInfos } from "@/lib/services/world-index";
import { BODY_ARCHETYPES, HABITABILITY_THRESHOLD } from "@/lib/constants/bodies";
import type { World } from "@/lib/world/types";
import type { ResourceVector } from "@/lib/types/game";
import { RESOURCE_TYPES } from "@/lib/engine/resources";

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

    // workedCounts is per-resource slot occupancy on THIS body — never more than the body's own
    // slot count, for every resource.
    for (const r of RESOURCE_TYPES) {
      expect(bodyView.workedCounts[r]).toBeGreaterThanOrEqual(0);
      expect(bodyView.workedCounts[r]).toBeLessThanOrEqual(bodyView.counts[r]);
    }
  });

  it("sums per-body workedCounts to the same worked-slot figure getSystemIndustry's deposit summary reads — one worked-prefix fold, not two", () => {
    const system = [...world.systems].sort((a, b) => b.population - a.population)[0];
    expect(system.population).toBeGreaterThan(0);

    const substrate = getSystemSubstrate(system.id);
    if (substrate.visibility !== "visible") throw new Error("expected visible");
    const industry = getSystemIndustry(system.id);
    if (industry.visibility !== "visible") throw new Error("expected visible");

    for (const d of industry.deposits) {
      const summedWorked = substrate.bodies.reduce((sum, b) => sum + b.workedCounts[d.resource], 0);
      expect(summedWorked).toBe(d.worked);
    }
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
        s.id === system.id ? { ...s, habitabilityQuality: { quality: 1, frontierIndex: 0, partial: true } } : s),
    };
    setWorld(patched);

    const data = getSystemSubstrate(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.bodies.find((b) => b.id === "occ-best")!.occupied).toBe(true);
    expect(data.bodies.find((b) => b.id === "occ-worse")!.occupied).toBe(false);
  });

  it("marks NO body occupied on an empty, never-assessed system — even one with land to occupy", () => {
    // Select a system with at least one contributing body (unlocked, above threshold) AND zero
    // population, so this genuinely exercises the resolver's population gate rather than passing
    // vacuously on a system with no contributing body at all. The fresh-compute tier of
    // `resolveEffectiveHabitabilityQuality` requires a real population: the fold's zero-occupancy
    // arm names the best body "next to fill" (frontierIndex 0), so an ungated fresh read would
    // stamp an Occupied badge on the best body of every unclaimed system in the galaxy. Nobody
    // lives here; nothing is occupied.
    const system = world.systems.find((s) => s.population === 0 && world.bodies.some((b) => b.systemId === s.id
      && !BODY_ARCHETYPES[b.bodyType].techLocked
      && BODY_ARCHETYPES[b.bodyType].scores.default >= HABITABILITY_THRESHOLD))!;
    expect(system).toBeDefined();
    const patched: World = {
      ...world,
      systems: world.systems.map((s) => (s.id === system.id ? { ...s, habitabilityQuality: undefined } : s)),
    };
    setWorld(patched);

    const data = getSystemSubstrate(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    const contributing = data.bodies.filter((b) => !b.locked
      && BODY_ARCHETYPES[b.bodyType]?.scores.default >= HABITABILITY_THRESHOLD);
    expect(contributing.length).toBeGreaterThan(0);
    expect(data.bodies.filter((b) => b.occupied)).toEqual([]);
  });

  it("shows occupancy consistent with the population panel's growth multiplier on a colonised-but-uncached system", () => {
    // A colonised system (real population, contributing bodies) whose fold hasn't run yet — the
    // exact one-cycle window MAJOR 2 found: the population panel's growthMultiplier resolves a real
    // (non-neutral) fresh quality here, so the substrate panel's occupied badges must resolve
    // through the SAME shared fold, not the raw (absent) cache, or a founding colony would show a
    // real percentage with zero bodies marked occupied.
    const system = [...world.systems]
      .filter((s) => s.population > 0 && world.bodies.some((b) => b.systemId === s.id
        && !BODY_ARCHETYPES[b.bodyType].techLocked
        && BODY_ARCHETYPES[b.bodyType].scores.default >= HABITABILITY_THRESHOLD))
      .sort((a, b) => b.population - a.population)[0];
    expect(system).toBeDefined();

    const patched: World = {
      ...world,
      systems: world.systems.map((s) => (s.id === system.id ? { ...s, habitabilityQuality: undefined } : s)),
    };
    setWorld(patched);

    const substrate = getSystemSubstrate(system.id);
    if (substrate.visibility !== "visible") throw new Error("expected visible");
    const population = getSystemPopulation(system.id);
    if (population.visibility !== "visible") throw new Error("expected visible");

    // The population panel reads a real, non-neutral quality — proving the fresh tier actually
    // fired, not the "no bodies" undefined-quality fallback.
    expect(population.fillOrder.some((row) => row.occupied)).toBe(true);
    const occupiedInSubstrate = substrate.bodies.filter((b) => b.occupied).length;
    const occupiedInFillOrder = population.fillOrder.filter((row) => row.occupied).length;
    expect(occupiedInSubstrate).toBe(occupiedInFillOrder);
    expect(occupiedInSubstrate).toBeGreaterThan(0);
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

  it("potentialYields includes a locked body's deposit slots — an 'if everything was habitable' read distinct from the worked/industry figures, which never see it", () => {
    // volcanic_world is tech-locked (`lib/constants/bodies.ts`) and authors ore/gas/minerals/
    // radioactive deposits — a real locked archetype with real deposits, not a fixture bending the
    // rule. Patch it onto a system with no pre-existing locked ore deposit so this body is the
    // ENTIRE source of any locked ore contribution — nothing else could produce this result.
    const system = world.systems.find((s) => !world.bodies.some((b) => b.systemId === s.id
      && BODY_ARCHETYPES[b.bodyType].techLocked && b.countOre > 0))!;
    expect(system).toBeDefined();
    const existing = world.bodies.find((b) => b.systemId === system.id)!;
    const lockedOre: World["bodies"][number] = {
      ...existing, id: "locked-ore-body", systemId: system.id, bodyType: "volcanic_world",
      countOre: 4, qualOre: 0.6, peopleLand: 0,
    };
    const patched: World = { ...world, bodies: [...world.bodies, lockedOre] };
    setWorld(patched);

    const data = getSystemSubstrate(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");

    const oreRow = data.potentialYields.find((r) => r.resource === "ore")!;
    expect(oreRow).toBeDefined();
    const lockedEntry = oreRow.byBody.find((b) => b.bodyId === "locked-ore-body")!;
    expect(lockedEntry).toBeDefined();
    expect(lockedEntry.locked).toBe(true);
    expect(lockedEntry.slotCount).toBe(4);
    expect(lockedEntry.archetypeName).toBe(BODY_ARCHETYPES.volcanic_world.name);

    // The locked body never appears in this body's own worked/current-yield read — it's dark, not
    // part of any workable prefix.
    const lockedBodyView = data.bodies.find((b) => b.id === "locked-ore-body")!;
    expect(lockedBodyView.workedCounts.ore).toBe(0);

    // A resource nobody deposits (neither locked nor unlocked) never renders a row at all.
    const anyOreOrRadioactive = data.bodies.some((b) => b.counts.gas > 0);
    if (!anyOreOrRadioactive) {
      expect(data.potentialYields.find((r) => r.resource === "gas")).toBeUndefined();
    }
  });

  it('throws ServiceError("not_found") for an unknown system', () => {
    expect(() => getSystemSubstrate("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemSubstrate("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ kind: "not_found" });
    }
  });

  it("falls back to array position when a system's bodies carry no stored orbitIndex, stable across repeated reads", () => {
    const system = world.systems.find((s) => world.bodies.filter((b) => b.systemId === s.id).length >= 2)!;
    expect(system).toBeDefined();
    const patched: World = {
      ...world,
      bodies: world.bodies.map((b) => (b.systemId === system.id ? { ...b, orbitIndex: undefined } : b)),
    };
    setWorld(patched);

    const systemBodyIds = world.bodies.filter((b) => b.systemId === system.id).map((b) => b.id);

    const first = getSystemSubstrate(system.id);
    if (first.visibility !== "visible") throw new Error("expected visible");
    for (const [i, id] of systemBodyIds.entries()) {
      expect(first.bodies.find((b) => b.id === id)!.orbitIndex).toBe(i + 1);
    }

    const second = getSystemSubstrate(system.id);
    if (second.visibility !== "visible") throw new Error("expected visible");
    expect(second.bodies.map((b) => b.orbitIndex)).toEqual(first.bodies.map((b) => b.orbitIndex));
  });

  it("falls back for the WHOLE system, never per body, when only some bodies carry a stored orbitIndex", () => {
    const system = world.systems.find((s) => world.bodies.filter((b) => b.systemId === s.id).length >= 2)!;
    expect(system).toBeDefined();
    const systemBodies = world.bodies.filter((b) => b.systemId === system.id);
    const [first, second, ...rest] = systemBodies;
    const mixed = [
      { ...first, orbitIndex: undefined },
      { ...second, orbitIndex: 1 },
      ...rest,
    ];
    const patched: World = {
      ...world,
      bodies: world.bodies.map((b) => {
        if (b.systemId !== system.id) return b;
        const replacement = mixed.find((m) => m.id === b.id);
        return replacement ?? b;
      }),
    };
    setWorld(patched);

    const data = getSystemSubstrate(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    const indices = data.bodies.map((b) => b.orbitIndex).sort((a, b) => a - b);
    const expectedPermutation = systemBodies.map((_, i) => i + 1);
    expect(indices).toEqual(expectedPermutation);
    for (const [i, b] of systemBodies.entries()) {
      expect(data.bodies.find((row) => row.id === b.id)!.orbitIndex).toBe(i + 1);
    }
  });

  it("keeps workedCounts aligned with its own body when the orbitIndex absence fallback is taken", () => {
    const system = [...world.systems].sort((a, b) => b.population - a.population)[0];
    expect(system.population).toBeGreaterThan(0);

    const before = getSystemSubstrate(system.id);
    if (before.visibility !== "visible") throw new Error("expected visible");
    const beforeById = new Map(before.bodies.map((b) => [b.id, b.workedCounts]));
    expect(before.bodies.some((b) => RESOURCE_TYPES.some((r) => b.workedCounts[r] > 0))).toBe(true);

    const patched: World = {
      ...world,
      bodies: world.bodies.map((b) => (b.systemId === system.id ? { ...b, orbitIndex: undefined } : b)),
    };
    setWorld(patched);

    const after = getSystemSubstrate(system.id);
    if (after.visibility !== "visible") throw new Error("expected visible");
    for (const b of after.bodies) {
      expect(b.workedCounts).toEqual(beforeById.get(b.id));
    }
  });

  it("passes size through unchanged from WorldBody.size — never defaulted or rounded", () => {
    const body = world.bodies[0];
    const patched: World = {
      ...world,
      bodies: world.bodies.map((b) => (b.id === body.id ? { ...b, size: 1.23456 } : b)),
    };
    setWorld(patched);

    const data = getSystemSubstrate(body.systemId);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.bodies.find((b) => b.id === body.id)!.size).toBe(1.23456);
  });
});
