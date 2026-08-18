import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getAtlas } from "@/lib/services/atlas";
import { regionInfos } from "@/lib/services/world-index";
import type { World } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 21 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getAtlas", () => {
  it("returns regions/systems/connections/factions in the expected shape", () => {
    const atlas = getAtlas();

    expect(atlas.regions.length).toBe(world.regions.length);
    expect(atlas.systems.length).toBe(world.systems.length);
    expect(atlas.connections.length).toBe(world.connections.length);
    expect(atlas.factions.length).toBe(world.factions.length);

    const region = world.regions[0];
    const atlasRegion = atlas.regions.find((r) => r.id === region.id)!;
    expect(atlasRegion.name).toBe(region.name);
    expect(atlasRegion.dominantEconomy).toBe(region.dominantEconomy);
    expect(atlasRegion.x).toBe(region.x);
    expect(atlasRegion.y).toBe(region.y);

    const system = world.systems[0];
    const atlasSystem = atlas.systems.find((s) => s.id === system.id)!;
    expect(atlasSystem).toEqual({
      id: system.id,
      x: system.x,
      y: system.y,
      regionId: system.regionId,
      factionId: system.factionId,
      economyType: system.economyType,
      isGateway: system.isGateway,
      developed: system.control === "developed",
      sunClass: system.sunClass,
    });

    const faction = world.factions[0];
    const atlasFaction = atlas.factions.find((f) => f.id === faction.id)!;
    expect(atlasFaction).toEqual({ id: faction.id, name: faction.name, color: faction.color });

    for (const c of atlas.connections) {
      expect(c.id).toBe(`${c.fromSystemId}:${c.toSystemId}`);
    }
  });

  it("copies each system's sunClass through from its world row", () => {
    const atlas = getAtlas();
    expect(atlas.systems.length).toBeGreaterThan(0);
    for (const system of world.systems) {
      const atlasSystem = atlas.systems.find((s) => s.id === system.id)!;
      expect(atlasSystem.sunClass).toBe(system.sunClass);
    }
  });

  it("exposes world meta (mapSize/systemCount/seed) for client tile geometry", () => {
    // The client derives tile-grid math from atlas.meta.mapSize (this replaced
    // the removed UNIVERSE_SCALE env), so meta must round-trip world.meta.
    expect(getAtlas().meta).toEqual({
      mapSize: world.meta.mapSize,
      systemCount: world.meta.systemCount,
      seed: world.meta.seed,
    });
  });

  it("sorts factions by name ascending", () => {
    const names = getAtlas().factions.map((f) => f.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  // The dominant-faction/government derivation is asserted at its owner
  // (world-index.test.ts → regionInfos); this is the wiring — the atlas serves that
  // derivation rather than a second one of its own.
  it("serves the shared region index rather than re-deriving regions", () => {
    expect(getAtlas().regions).toEqual(regionInfos());
  });

  it("derives developed flag from system.control, not popCap", () => {
    // A controlled system with popCap > 0 should NOT be developed
    // A developed system with popCap === 0 should be developed
    const s1 = world.systems[0];
    const s2 = world.systems[1];

    const systems = world.systems.map((s) => {
      if (s.id === s1.id) {
        return { ...s, control: "controlled" as const, popCap: 100 };
      }
      if (s.id === s2.id) {
        return { ...s, control: "developed" as const, popCap: 0 };
      }
      return s;
    });
    setWorld({ ...world, systems });

    const atlas = getAtlas();
    const controlled = atlas.systems.find((s) => s.id === s1.id)!;
    const developed = atlas.systems.find((s) => s.id === s2.id)!;

    expect(controlled.developed).toBe(false); // controlled, even with popCap > 0
    expect(developed.developed).toBe(true); // developed, even with popCap === 0
  });
});

describe("getAtlas — player", () => {
  it("exposes the controlled faction and its homeworld system", () => {
    const playerWorld = generateWorld({
      systemCount: 150,
      seed: 99,
      playerFaction: { name: "Focus Test", governmentType: "cooperative", doctrine: "protectionist" },
    });
    setWorld(playerWorld);

    const atlas = getAtlas();
    expect(atlas.player).not.toBeNull();
    const seatId = playerWorld.factions.find(
      (f) => f.id === playerWorld.player?.controlledFactionId,
    )!.id;
    expect(atlas.player?.controlledFactionId).toBe(seatId);
    const faction = playerWorld.factions.find((f) => f.id === seatId)!;
    expect(atlas.player?.homeworldSystemId).toBe(faction.homeworldId);
  });

  it("is null for a playerless world", () => {
    setWorld(generateWorld({ systemCount: 150, seed: 99 }));
    expect(getAtlas().player).toBeNull();
  });
});
