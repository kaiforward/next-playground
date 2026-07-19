import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { GOODS } from "@/lib/constants/goods";
import { DEFAULT_TAX_LEVEL } from "@/lib/constants/treasury";

describe("generateWorld", () => {
  const world = generateWorld({ systemCount: 120, seed: 42 });
  const goodIds = Object.keys(GOODS);

  it("generates a system count within generateUniverse's own under-fill tolerance (90%-100% of requested)", () => {
    expect(world.systems.length).toBeGreaterThanOrEqual(120 * 0.9);
    expect(world.systems.length).toBeLessThanOrEqual(120);
  });

  it("gives every system exactly one market row per good, with no duplicates", () => {
    expect(world.markets.length).toBe(world.systems.length * goodIds.length);

    const seen = new Set<string>();
    for (const m of world.markets) {
      const key = `${m.systemId}|${m.goodId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    const systemIds = new Set(world.systems.map((s) => s.id));
    for (const sys of world.systems) {
      for (const goodId of goodIds) {
        expect(seen.has(`${sys.id}|${goodId}`)).toBe(true);
      }
    }
    // Every market row references a real system.
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
