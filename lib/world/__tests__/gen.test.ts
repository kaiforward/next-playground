import { describe, it, expect } from "vitest";
import { generateWorld, buildGenParams } from "../gen";
import { generateUniverse } from "@/lib/engine/universe-gen";
import { genConfigForSystemCount, REGION_NAMES } from "@/lib/constants/universe-gen";
import { GOODS } from "@/lib/constants/goods";
import { DEFAULT_TAX_LEVEL } from "@/lib/constants/treasury";
import { civilianDemandRateForGood, getInitialStock } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { yieldsOf, effOf, depositCountsOf, qualityOf } from "@/lib/engine/resources";
import { workedYieldVectors, type SlottedBody } from "@/lib/engine/worked-deposits";
import { toTickSystems } from "../tick";
import type { World, WorldFaction, WorldSystem } from "../types";

/**
 * The Marshalate-homeworld arrangement shared by the market-seeding and worked-columns
 * describe blocks below — same `generateWorld` call, same player/home lookup, so the two
 * suites read the exact same generated world rather than two independently-seeded ones.
 */
function marshalateWorld(): { world: World; player: WorldFaction; home: WorldSystem } {
  const world = generateWorld({
    systemCount: 60,
    seed: 8,
    playerFaction: { name: "Marshalate", governmentType: "militarist", doctrine: "hegemonic" },
  });
  const player = world.factions.find((faction) => faction.name === "Marshalate")!;
  const home = world.systems.find((system) => system.id === player.homeworldId)!;
  return { world, player, home };
}

describe("generateWorld", () => {
  const world = generateWorld({ systemCount: 120, seed: 42 });
  const goodIds = Object.keys(GOODS);

  it("generates a system count within generateUniverse's own under-fill tolerance, never over the requested count", () => {
    // Density-shaped placement (spec §5) deliberately leaves void unfilled, so the floor is far
    // looser than the old near-uniform guarantee — the ceiling still holds exactly.
    expect(world.systems.length).toBeGreaterThanOrEqual(120 * 0.2);
    expect(world.systems.length).toBeLessThanOrEqual(120);
  });

  it("gives every DEVELOPED system one market row per good, and unsettled systems none", () => {
    // An unclaimed rock holds no goods — nobody there grew, shipped, or stored anything. Its rows are
    // created when it is settled, so seeding them here would hand every future colony a full anchor's
    // worth of stock nobody produced (and drown every galaxy-wide market reading in rows that cannot move).
    const developed = world.systems.filter((s) => s.control === "developed");
    expect(developed.length).toBeGreaterThan(0);       // sanity: the split is real, not an empty galaxy
    expect(developed.length).toBeLessThan(world.systems.length);
    expect(world.markets.length).toBe(developed.length * goodIds.length);

    const seen = new Set<string>();
    for (const m of world.markets) {
      const key = `${m.systemId}|${m.goodId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    const developedIds = new Set(developed.map((s) => s.id));
    for (const sys of world.systems) {
      for (const goodId of goodIds) {
        expect(seen.has(`${sys.id}|${goodId}`)).toBe(developedIds.has(sys.id));
      }
    }
    // Every market row references a real system.
    const systemIds = new Set(world.systems.map((s) => s.id));
    for (const m of world.markets) {
      expect(systemIds.has(m.systemId)).toBe(true);
    }
  });

  it("seeds every market row with finite stock and storage capacity", () => {
    for (const m of world.markets) {
      expect(Number.isFinite(m.stock)).toBe(true);
      expect(Number.isFinite(m.storageCapacity)).toBe(true);
      expect(Number.isFinite(m.demandRate)).toBe(true);
      expect(m.anchorMult).toBe(1);
      expect(m.squeezeCycles).toBe(0);
      expect(m.proposalCycles).toBe(0);
      expect(m.realisedProductionRate).toBeUndefined();
      expect(m.productionSuppressed).toBeUndefined();
    }
  });

  it("owns only faction homeworlds — every other system is null, unpopulated, and unbuilt", () => {
    const factionIds = new Set(world.factions.map((f) => f.id));
    const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
    const buildingsBySystem = new Map<string, number>();
    for (const b of world.buildings) {
      buildingsBySystem.set(b.systemId, (buildingsBySystem.get(b.systemId) ?? 0) + 1);
    }

    let ownedCount = 0;
    for (const sys of world.systems) {
      if (homeworldIds.has(sys.id)) {
        ownedCount++;
        expect(sys.factionId).not.toBeNull();
        if (sys.factionId !== null) expect(factionIds.has(sys.factionId)).toBe(true);
      } else {
        expect(sys.factionId).toBeNull();
        expect(sys.population).toBe(0);
        expect(buildingsBySystem.get(sys.id) ?? 0).toBe(0);
      }
    }
    expect(ownedCount).toBe(world.factions.length); // one owned homeworld per faction
  });

  it("sets a valid dominantEconomy on every region, matching the mode of its systems' economyType", () => {
    const ECONOMY_TYPES = new Set([
      "agricultural", "extraction", "refinery", "industrial", "tech", "core",
    ]);

    for (const region of world.regions) {
      expect(ECONOMY_TYPES.has(region.dominantEconomy)).toBe(true);

      const regionSystems = world.systems.filter((s) => s.regionId === region.id);
      const counts = new Map<string, number>();
      for (const s of regionSystems) {
        counts.set(s.economyType, (counts.get(s.economyType) ?? 0) + 1);
      }
      let expected = "extraction";
      let bestCount = 0;
      for (const [econ, count] of counts) {
        if (count > bestCount || (count === bestCount && econ < expected)) {
          expected = econ;
          bestCount = count;
        }
      }
      expect(region.dominantEconomy).toBe(regionSystems.length === 0 ? "extraction" : expected);
    }
  });

  it("covers every faction pair exactly once, canonically ordered factionAId < factionBId", () => {
    const n = world.factions.length;
    const expectedPairCount = (n * (n - 1)) / 2;
    expect(world.relations.length).toBe(expectedPairCount);

    const seen = new Set<string>();
    for (const r of world.relations) {
      expect(r.factionAId < r.factionBId).toBe(true);
      const key = `${r.factionAId}|${r.factionBId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(r.score).toBe(0);
      expect(r.history).toEqual([]);
      expect(r.updatedAtTick).toBe(0);
    }

    const factionIds = world.factions.map((f) => f.id);
    for (let i = 0; i < factionIds.length; i++) {
      for (let j = i + 1; j < factionIds.length; j++) {
        const a = factionIds[i];
        const b = factionIds[j];
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        expect(seen.has(key)).toBe(true);
      }
    }
  });

  it("canonicalises a pair whose mint order runs the wrong way lexicographically", () => {
    // Faction ids are minted after every region and system, so their numeric suffixes can straddle a
    // digit-width boundary ("faction-99" > "faction-100" as strings). At 80 systems they do — which is
    // the only shape that exercises the swap branch of the canonical ordering. The pair-count assertion
    // is the premise guard: if id minting ever stops straddling, this test says so instead of quietly
    // testing the same ascending case as the 120-system world above.
    const swapWorld = generateWorld({ systemCount: 80, seed: 42 });
    const mintOrder = swapWorld.factions.map((f) => f.id);
    let descendingPairs = 0;
    for (let i = 0; i < mintOrder.length; i++) {
      for (let j = i + 1; j < mintOrder.length; j++) {
        if (mintOrder[i] > mintOrder[j]) descendingPairs++;
      }
    }
    expect(descendingPairs).toBeGreaterThan(0);

    for (const r of swapWorld.relations) {
      expect(typeof r.factionAId).toBe("string");
      expect(typeof r.factionBId).toBe("string");
      expect(r.factionAId < r.factionBId).toBe(true);
    }
    expect(swapWorld.relations.length).toBe((mintOrder.length * (mintOrder.length - 1)) / 2);
  });

  it("seeds no ships, events, modifiers, alliance pacts, or flow events", () => {
    expect(world.ships).toEqual([]);
    expect(world.events).toEqual([]);
    expect(world.modifiers).toEqual([]);
    expect(world.alliancePacts).toEqual([]);
    expect(world.flowEvents).toEqual([]);
  });

  it("leaves nextId exactly equal to the number of minted entities", () => {
    const mintedCount =
      world.regions.length + world.systems.length + world.bodies.length + world.factions.length;
    expect(world.nextId).toBe(mintedCount);
  });

  it("survives a JSON.parse(JSON.stringify(...)) round-trip unchanged", () => {
    const roundTripped = JSON.parse(JSON.stringify(world));
    expect(roundTripped).toEqual(world);
  });

  it("is deterministic — two calls with the same options produce identical worlds", () => {
    const worldA = generateWorld({ systemCount: 120, seed: 42 });
    const worldB = generateWorld({ systemCount: 120, seed: 42 });
    expect(worldA).toEqual(worldB);
  });

  it("produces different worlds for different seeds", () => {
    const worldA = generateWorld({ systemCount: 120, seed: 1 });
    const worldB = generateWorld({ systemCount: 120, seed: 2 });
    expect(worldA).not.toEqual(worldB);
  });
});

// New Game's optional `shape` knobs (galaxy structure + placement levers) thread through
// `buildGenParams`/`generateUniverse` (`lib/engine/universe-gen.ts`) — the back-compat pin every
// one of those levers depends on: a `newGame` (or `generateWorld`) call with `shape` omitted
// entirely must produce a world BYTE-IDENTICAL to one from before the levers existed, since the
// levers' defaults (mapSizeScale 1, starSpacing→minDistanceScale 1, clusterTightness→
// DENSITY_RADIUS_EXPONENT) must be true no-ops.
describe("generateWorld — shape knobs back-compat pin", () => {
  it("with shape omitted, produces the exact same world as a shape explicitly set to Gate-A defaults", () => {
    const withoutShape = generateWorld({ systemCount: 300, seed: 99 });
    const withExplicitDefaults = generateWorld({
      systemCount: 300,
      seed: 99,
      shape: { mapSizeScale: 1, starSpacing: 1, clusterTightness: 0.05 },
    });
    expect(withExplicitDefaults).toEqual(withoutShape);
  });

  it("a non-default shape knob actually perturbs the generated world (the pin isn't vacuously always-equal)", () => {
    const base = generateWorld({ systemCount: 300, seed: 99 });
    const perturbed = generateWorld({ systemCount: 300, seed: 99, shape: { starSpacing: 0.5 } });
    expect(perturbed).not.toEqual(base);
  });
});

describe("generateWorld: market seeding", () => {
  it("seeds owned markets from the shared civilian basket and unowned tick rows as frontier", () => {
    const { world, home } = marshalateWorld();
    const buildings: Record<string, number> = {};
    for (const building of world.buildings) {
      if (building.systemId === home.id) buildings[building.buildingType] = building.count;
    }
    const yields = yieldsOf(home);
    const basis = computeSystemLabourSnapshot(buildings, home.population).basis;
    const weapons = world.markets.find((market) => market.systemId === home.id && market.goodId === "weapons")!;
    expect(weapons.demandRate).toBeCloseTo(civilianDemandRateForGood("weapons", basis), 10);
    expect(weapons.stock).toBe(getInitialStock(buildings, yields, home.population, "weapons"));

    const unowned = world.systems.find((system) => system.factionId === null)!;
    expect(toTickSystems(world).find((system) => system.id === unowned.id)?.governmentType).toBe("frontier");
  });
});

describe("generateWorld: worked (not potential) columns", () => {
  it("the generation-time market seed carries the worked columns", () => {
    const { world, home } = marshalateWorld();

    const bodies: SlottedBody[] = world.bodies
      .filter((b) => b.systemId === home.id)
      .map((b) => ({ bodyType: b.bodyType, counts: depositCountsOf(b), quality: qualityOf(b) }));
    const buildings: Record<string, number> = {};
    for (const b of world.buildings) if (b.systemId === home.id) buildings[b.buildingType] = b.count;

    const worked = workedYieldVectors(bodies, buildings);
    // yieldsOf/effOf read the WorldSystem columns the market seed itself was built from
    // (`createSystemMarkets({ yields: s.yieldMult, extractionEff: s.extractionEfficiency, ... })`
    // at generation) — equality here proves those columns are the worked-prefix fold over the
    // system's own stored bodies/buildings, not the all-unlocked potential pool.
    expect(yieldsOf(home)).toEqual(worked.yieldMult);
    expect(effOf(home)).toEqual(worked.eff);
  });
});

describe("generateWorld: control flag", () => {
  it("seeds each faction homeworld as developed and every other system as unclaimed", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
    for (const s of world.systems) {
      if (homeworldIds.has(s.id)) {
        expect(s.control).toBe("developed");
        expect(s.factionId).not.toBeNull();
      } else {
        expect(s.control).toBe("unclaimed");
        expect(s.factionId).toBeNull();
      }
    }
  });
});

describe("generateWorld — player faction", () => {
  const base = { systemCount: 200, seed: 12345 };
  const authored = {
    name: "Aurelian League",
    governmentType: "technocratic" as const,
    doctrine: "mercantile" as const,
  };

  it("seeds the authored faction as an additional major and points world.player at it", () => {
    const world = generateWorld({ ...base, playerFaction: authored });

    expect(world.player).not.toBeNull();
    const seatId = world.player?.controlledFactionId;
    const player = world.factions.find((f) => f.id === seatId)!;
    expect(player.name).toBe("Aurelian League");
    expect(player.governmentType).toBe("technocratic");
    expect(player.doctrine).toBe("mercantile");
    // Placed like everyone: it owns exactly its homeworld, which is developed.
    const home = world.systems.find((s) => s.id === player.homeworldId)!;
    expect(home.factionId).toBe(player.id);
    expect(home.control).toBe("developed");
  });

  it("is additive — one more faction, with presets + minors unchanged", () => {
    const playerless = generateWorld(base);
    const withPlayer = generateWorld({ ...base, playerFaction: authored });

    expect(withPlayer.factions.length).toBe(playerless.factions.length + 1);
    // The authored faction is the only new identity: every preset major and procedural
    // minor keeps its name and array position (they're generated before the player is
    // spliced in at the major/minor boundary).
    const nonPlayerNames = withPlayer.factions
      .filter((f) => f.id !== withPlayer.player?.controlledFactionId)
      .map((f) => f.name);
    expect(nonPlayerNames).toEqual(playerless.factions.map((f) => f.name));
  });

  it("wires every faction's homeworld to its own id after the player splice + reindex", () => {
    // The player is spliced in at the major/minor boundary and every faction's
    // index is reassigned before placement/ownership. A stale index would attribute
    // a faction's homeworld to a *different* (still-valid) faction id — which the
    // generic ownership test can't catch (it only checks the id is some valid one).
    // Assert every faction — player and non-player alike — owns its own homeworld.
    const world = generateWorld({ ...base, playerFaction: authored });
    for (const f of world.factions) {
      const home = world.systems.find((s) => s.id === f.homeworldId)!;
      expect(home.factionId).toBe(f.id);
    }
  });

  it("stays playerless when no faction is authored (the harness path)", () => {
    const world = generateWorld(base);
    expect(world.player).toBeNull();
  });

  it("seats the player with both automation switches on", () => {
    const world = generateWorld({ ...base, playerFaction: authored });
    expect(world.player?.automation).toEqual({ build: true, colonisation: true });
  });

  it("seats the player with no pinned systems", () => {
    const world = generateWorld({ ...base, playerFaction: authored });
    expect(world.player?.pinnedSystemIds).toEqual([]);
  });
});

describe("generateWorld: connections carry the engine's isCrossing flag", () => {
  it("world connection rows match generateUniverse's own isCrossing exactly, lane for lane", () => {
    const systemCount = 600;
    const seed = 1;

    // Reproduces exactly the params generateWorld builds internally (buildGenParams is the same
    // exported helper gen.ts itself calls), so this compares against the SAME generated universe
    // generateWorld would have folded into World — not a second, differently-configured run.
    const config = genConfigForSystemCount(systemCount);
    const params = buildGenParams(seed, config);
    const universe = generateUniverse(params, REGION_NAMES);
    const world = generateWorld({ systemCount, seed });

    // Non-vacuity: the fixture must actually mix crossing and non-crossing lanes, or this test
    // could pass by coincidence (e.g. every lane false).
    const crossingCount = universe.connections.filter((c) => c.isCrossing).length;
    const nonCrossingCount = universe.connections.length - crossingCount;
    expect(crossingCount, "fixture must contain at least one crossing-class lane").toBeGreaterThan(0);
    expect(nonCrossingCount, "fixture must contain at least one non-crossing lane").toBeGreaterThan(0);

    // `gen.ts` mints one system id per generated system in array order (`systemIds = universe.
    // systems.map(() => mintId(...))`), so `world.systems[i].id` names `universe.systems[i]`.
    const idAtIndex = world.systems.map((s) => s.id);
    const worldIsCrossingByPair = new Map(world.connections.map((c) => [`${c.fromId}|${c.toId}`, c.isCrossing]));

    for (const conn of universe.connections) {
      const key = `${idAtIndex[conn.fromSystemIndex]}|${idAtIndex[conn.toSystemIndex]}`;
      expect(worldIsCrossingByPair.get(key)).toBe(conn.isCrossing);
    }
  });
});

describe("treasury seeding", () => {
  const world = generateWorld({ systemCount: 40, seed: 7 });

  it("seeds one zero-balance treasury per faction with full bands", () => {
    expect(world.treasuries).toHaveLength(world.factions.length);
    const byFaction = new Set(world.treasuries.map((t) => t.factionId));
    for (const f of world.factions) expect(byFaction.has(f.id)).toBe(true);
    for (const t of world.treasuries) {
      expect(t.balance).toBe(0);
      expect(t.bands).toEqual({ maintenance: 1, logistics: 1, construction: 1 });
      expect(t.funded).toEqual({ maintenance: 1, logistics: 1, construction: 1 });
      expect(t.pendingWork).toEqual({ logistics: 0, construction: 0 });
      expect(t.lastSettlement).toBeNull();
    }
  });

  it("flavours the default tax level by government", () => {
    for (const t of world.treasuries) {
      const faction = world.factions.find((f) => f.id === t.factionId)!;
      expect(t.taxLevel).toBe(DEFAULT_TAX_LEVEL[faction.governmentType]);
    }
  });
});
