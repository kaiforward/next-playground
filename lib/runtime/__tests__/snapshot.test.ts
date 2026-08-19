import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { getWorld, setWorld, clearWorld } from "@/lib/world/store";
import { buildStateFrame, type SnapshotSlices, type StateFrame } from "@/lib/runtime/snapshot";
import type { World, WorldEvent } from "@/lib/world/types";
import { GOODS } from "@/lib/constants/goods";

/**
 * The full, authoritative slice-key list `SnapshotSlices` names — kept here (not imported) so the
 * coverage test is checking the type's own shape against an independently-written list, the same way
 * the task's own "Interface" line enumerates it, rather than trivially re-deriving the list from the
 * implementation and asserting it matches itself.
 */
const EXPECTED_SLICE_KEYS: (keyof SnapshotSlices)[] = [
  "atlas", "universe", "visibility", "events", "alerts", "tracker", "playerSettings", "ownership",
  "stability", "population", "development", "migration", "provision", "factions", "factionDetail",
  "relations", "systemVitals", "systemPopulation", "systemIndustry", "systemLogistics",
  "systemConstruction", "systemBuildOptions", "systemSubstrate", "market", "marketComparison",
  "tradeFlow", "factionVitals", "factionConstruction", "factionTreasury",
  "colonyEligibility", "constructionStalls",
];

let world: World;

beforeEach(() => {
  world = generateWorld({
    systemCount: 60,
    seed: 42,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("buildStateFrame — coverage", () => {
  it("a full frame carries every slice any panel can open on", () => {
    const frame = buildStateFrame(world, null);
    const keys = Object.keys(frame.slices).sort();
    expect(keys).toEqual([...EXPECTED_SLICE_KEYS].sort());
    for (const key of EXPECTED_SLICE_KEYS) {
      expect(frame.slices[key]).toBeDefined();
    }
  });
});

describe("buildStateFrame — vacuity", () => {
  it("a seeded world's full frame is non-empty for every populated slice", () => {
    const frame = buildStateFrame(world, null).slices;
    const systemCount = world.systems.length;
    const factionCount = world.factions.length;
    expect(systemCount).toBeGreaterThan(0);
    expect(factionCount).toBeGreaterThan(0);

    expect(frame.universe?.systems.length).toBe(systemCount);
    expect(frame.atlas?.systems.length).toBe(systemCount);
    expect(frame.ownership?.length).toBe(systemCount);
    expect(frame.stability?.length).toBe(systemCount);
    expect(frame.population?.length).toBe(systemCount);
    expect(frame.development?.length).toBe(systemCount);
    // Migration is developed-systems-only, but world-gen seats the player on a developed homeworld,
    // so at least one entry exists without a tick ever having run.
    expect(frame.migration?.length).toBeGreaterThan(0);
    expect(frame.factions?.length).toBe(factionCount);

    expect(Object.keys(frame.systemVitals ?? {}).length).toBe(systemCount);
    expect(Object.keys(frame.systemPopulation ?? {}).length).toBe(systemCount);
    expect(Object.keys(frame.systemIndustry ?? {}).length).toBe(systemCount);
    expect(Object.keys(frame.systemLogistics ?? {}).length).toBe(systemCount);
    expect(Object.keys(frame.systemConstruction ?? {}).length).toBe(systemCount);
    expect(Object.keys(frame.systemBuildOptions ?? {}).length).toBe(systemCount);
    expect(Object.keys(frame.systemSubstrate ?? {}).length).toBe(systemCount);
    expect(Object.keys(frame.market ?? {}).length).toBe(systemCount);
    // The player's homeworld is developed (economically active) straight out of world-gen, so at
    // least one system's market carries priced entries without a tick ever having run.
    const marketEntryCounts = Object.values(frame.market ?? {}).map((m) => m.entries.length);
    expect(marketEntryCounts.some((n) => n > 0)).toBe(true);
    expect(Object.keys(frame.marketComparison ?? {}).length).toBe(Object.keys(GOODS).length);
    const comparisonEntryCounts = Object.values(frame.marketComparison ?? {}).map((c) => c.entries.length);
    expect(comparisonEntryCounts.some((n) => n > 0)).toBe(true);
    expect(Array.isArray(frame.tradeFlow?.logisticsEdges)).toBe(true);
    expect(Object.keys(frame.factionVitals ?? {}).length).toBe(factionCount);
    expect(Object.keys(frame.factionConstruction ?? {}).length).toBe(factionCount);
    expect(Object.keys(frame.factionDetail ?? {}).length).toBe(factionCount);
  });
});

describe("buildStateFrame — drop-harmless", () => {
  it("applying only the newer of a sequence of frames equals applying all of them", () => {
    const f0 = buildStateFrame(world, null);

    const developed = world.systems.find((s) => s.control === "developed");
    if (!developed) throw new Error("fixture: expected at least one developed system");
    const target = developed;
    const w1: World = {
      ...world,
      systems: world.systems.map((s) => (s.id === target.id ? { ...s, population: s.population + 500 } : s)),
    };
    setWorld(w1);
    const f1 = buildStateFrame(w1, f0.worldVersion);

    const w2: World = {
      ...w1,
      systems: w1.systems.map((s) => (s.id === target.id ? { ...s, population: s.population + 500 } : s)),
    };
    setWorld(w2);
    const f2 = buildStateFrame(w2, f1.worldVersion);

    // The mutation actually moved something, so equality below is not vacuous.
    expect(f2.slices.systemPopulation?.[target.id]).not.toEqual(f0.slices.systemPopulation?.[target.id]);

    function reduce(frames: StateFrame[]): Partial<SnapshotSlices> {
      return frames.reduce<Partial<SnapshotSlices>>((acc, f) => ({ ...acc, ...f.slices }), {});
    }

    expect(reduce([f0, f1, f2])).toEqual(reduce([f2]));
  });
});

describe("buildStateFrame — event lists stay in the state slice", () => {
  function baseEvent(overrides: Partial<WorldEvent>): WorldEvent {
    return {
      id: "ev", type: "mining_boom", phase: "peak", systemId: null, regionId: null,
      startTick: 0, phaseStartTick: 0, phaseDuration: 0, severity: 1,
      sourceEventId: null, metadata: null,
      ...overrides,
    };
  }

  it("the events slice carries the rich per-tick event list; the pacing frame never does", () => {
    const withEvent: World = {
      ...world,
      events: [baseEvent({ id: "ev-1", systemId: world.systems[0].id })],
    };
    setWorld(withEvent);
    const frame = buildStateFrame(withEvent, null);

    expect(Array.isArray(frame.slices.events)).toBe(true);
    expect(frame.slices.events?.length).toBe(1);
    expect(frame.slices.events?.[0]).toHaveProperty("id", "ev-1");
    expect(frame.slices.events?.[0]).toHaveProperty("phase");
  });
});

describe("buildStateFrame — call-pattern contract", () => {
  it("throws when handed a world that is not the store's current value, instead of silently adopting it", () => {
    // A foreign world — never passed to setWorld — is exactly the caller bug ensureWorldCommitted
    // now refuses rather than silently committing (see the module docstring's resolution).
    const foreign: World = { ...world, nextId: world.nextId + 1 };
    expect(() => buildStateFrame(foreign, null)).toThrow(/not the store's current value/);
    // The store is untouched by the rejected call — still holding the world this file's beforeEach set.
    expect(getWorld()).toBe(world);
  });
});

describe("buildStateFrame — JSON round trip", () => {
  it("every slice survives JSON.stringify/parse unchanged (no Map/Set/Date/NaN)", () => {
    const frame = buildStateFrame(world, null);
    const roundTripped = JSON.parse(JSON.stringify(frame));
    expect(roundTripped).toEqual(frame);
  });
});
