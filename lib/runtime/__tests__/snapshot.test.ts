import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { getWorld, setWorld, clearWorld } from "@/lib/world/store";
import { buildStateFrame, type SnapshotSlices, type StateFrameBody } from "@/lib/runtime/snapshot";
import { EMPTY_INTEREST, type InterestSet } from "@/lib/runtime/channel";
import type { World, WorldEvent } from "@/lib/world/types";
import { GOODS } from "@/lib/constants/goods";
import { getSystemVitals } from "@/lib/services/system-vitals";
import { getSystemSubstrate } from "@/lib/services/universe";
import { getMarket } from "@/lib/services/market";
import { getMarketComparison } from "@/lib/services/market-comparison";
import { colonyEligibility } from "@/lib/services/colony-eligibility";

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

/** The coarse slices — always complete, regardless of interest (frame-architecture spec, "Frame
 *  contents" — "Pushed coarse set"). */
const COARSE_KEYS: (keyof SnapshotSlices)[] = [
  "atlas", "universe", "visibility", "events", "alerts", "tracker", "playerSettings", "ownership",
  "stability", "population", "development", "migration", "provision", "factions", "relations",
  "tradeFlow", "factionVitals", "factionConstruction", "factionTreasury", "factionDetail",
  "constructionStalls",
];

/** The interest-keyed detail slices — present only for the current interest set's ids. */
const DETAIL_KEYS: (keyof SnapshotSlices)[] = [
  "systemVitals", "systemPopulation", "systemIndustry", "systemLogistics", "systemConstruction",
  "systemBuildOptions", "systemSubstrate", "market", "colonyEligibility", "marketComparison",
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

/** Every system id + every good id — the interest set that must reproduce today's full-frame content
 *  (Proves 5, vacuity). `factions` is included too, though it is currently unused by the builder. */
function fullInterest(w: World): InterestSet {
  return {
    systems: w.systems.map((s) => s.id),
    factions: w.factions.map((f) => f.id),
    goods: Object.keys(GOODS),
  };
}

describe("buildStateFrame — coverage", () => {
  it("every slice key is present regardless of interest", () => {
    const frame = buildStateFrame(world, fullInterest(world));
    const keys = Object.keys(frame.slices).sort();
    expect(keys).toEqual([...EXPECTED_SLICE_KEYS].sort());
    for (const key of EXPECTED_SLICE_KEYS) {
      expect(frame.slices[key]).toBeDefined();
    }
  });
});

describe("buildStateFrame — Proves 1: empty interest", () => {
  it("carries every coarse slice, content-identical to a full-interest frame's coarse slices, and every detail record present but empty", () => {
    const empty = buildStateFrame(world, EMPTY_INTEREST);
    const full = buildStateFrame(world, fullInterest(world));

    // Every key present, even with nothing subscribed.
    expect(Object.keys(empty.slices).sort()).toEqual([...EXPECTED_SLICE_KEYS].sort());

    // Coarse slices don't depend on interest at all — identical content whether interest is empty
    // or everything.
    for (const key of COARSE_KEYS) {
      expect(empty.slices[key]).toEqual(full.slices[key]);
    }

    // Every detail record is present but empty — never a missing key, never a throw.
    for (const key of DETAIL_KEYS) {
      expect(empty.slices[key]).toEqual({});
    }
  });
});

describe("buildStateFrame — Proves 2: stale interest ids", () => {
  it("skips a system id and a good id absent from the world — no throw, key omitted", () => {
    const interest: InterestSet = { systems: ["does-not-exist"], factions: [], goods: ["does-not-exist-good"] };

    expect(() => buildStateFrame(world, interest)).not.toThrow();

    const frame = buildStateFrame(world, interest);
    expect(frame.slices.systemVitals).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(frame.slices.systemVitals ?? {}, "does-not-exist")).toBe(false);
    expect(frame.slices.marketComparison).toEqual({});
    expect(Object.prototype.hasOwnProperty.call(frame.slices.marketComparison ?? {}, "does-not-exist-good")).toBe(false);
  });
});

describe("buildStateFrame — Proves 3: atomic per-system bundle", () => {
  it("a subscribed controlled system's 8 family entries and colonyEligibility all land in the same frame", () => {
    const target = world.systems.find((s) => s.control === "developed");
    if (!target) throw new Error("fixture: expected at least one developed system");
    // Repurpose one non-target system into a controlled test fixture of the player's own faction.
    const controlled = world.systems.find((s) => s.id !== target.id);
    if (!controlled) throw new Error("fixture: expected a second system to repurpose");
    const factionId = target.factionId ?? world.factions[0]?.id;
    if (!factionId) throw new Error("fixture: expected a faction id");
    // Direct mutation (matches lib/services/__tests__/construction.test.ts's own fixture idiom) —
    // a spread-map literal here would need `as const`/an explicit `WorldSystem` annotation to keep
    // TS from widening `control` to `string`.
    controlled.control = "controlled";
    controlled.factionId = factionId;
    setWorld(world);

    const interest: InterestSet = { systems: [controlled.id], factions: [], goods: [] };
    const frame = buildStateFrame(world, interest);

    for (const key of [
      "systemVitals", "systemPopulation", "systemIndustry", "systemLogistics",
      "systemConstruction", "systemBuildOptions", "systemSubstrate", "market",
    ] as const) {
      expect(Object.prototype.hasOwnProperty.call(frame.slices[key] ?? {}, controlled.id)).toBe(true);
    }
    expect(Object.prototype.hasOwnProperty.call(frame.slices.colonyEligibility ?? {}, controlled.id)).toBe(true);
  });
});

describe("buildStateFrame — Proves 4: goods interest", () => {
  it("marketComparison carries exactly the requested catalog goods, nothing else", () => {
    const goodIds = Object.keys(GOODS);
    if (goodIds.length < 2) throw new Error("fixture: expected at least two catalog goods");
    const [firstGood, secondGood] = goodIds;
    const interest: InterestSet = { systems: [], factions: [], goods: [firstGood] };

    const frame = buildStateFrame(world, interest);

    expect(Object.keys(frame.slices.marketComparison ?? {})).toEqual([firstGood]);
    expect(Object.prototype.hasOwnProperty.call(frame.slices.marketComparison ?? {}, secondGood)).toBe(false);
  });
});

describe("buildStateFrame — Proves 5: vacuity (full interest reproduces today's full frame)", () => {
  it("every detail record's key set is exactly every system/good id in the world", () => {
    const frame = buildStateFrame(world, fullInterest(world));
    const systemIds = world.systems.map((s) => s.id).sort();
    const goodIds = Object.keys(GOODS).sort();

    for (const key of [
      "systemVitals", "systemPopulation", "systemIndustry", "systemLogistics",
      "systemConstruction", "systemBuildOptions", "systemSubstrate", "market",
    ] as const) {
      expect(Object.keys(frame.slices[key] ?? {}).sort()).toEqual(systemIds);
    }
    expect(Object.keys(frame.slices.marketComparison ?? {}).sort()).toEqual(goodIds);
    // colonyEligibility: exactly every CONTROLLED system, not every system (matches the pre-change
    // builder's `buildColonyEligibility`, which the same condition gated).
    const controlledIds = world.systems.filter((s) => s.control === "controlled" && s.factionId).map((s) => s.id).sort();
    expect(Object.keys(frame.slices.colonyEligibility ?? {}).sort()).toEqual(controlledIds);
  });

  it("spot-checks per-id detail content against the same read services the builder calls directly, for one sampled system per family", () => {
    const sample = world.systems[0];
    const frame = buildStateFrame(world, fullInterest(world));

    expect(frame.slices.systemVitals?.[sample.id]).toEqual(getSystemVitals(sample.id));
    expect(frame.slices.systemSubstrate?.[sample.id]).toEqual(getSystemSubstrate(sample.id));
    expect(frame.slices.market?.[sample.id]).toEqual(getMarket(sample.id));

    const goodId = Object.keys(GOODS)[0];
    expect(frame.slices.marketComparison?.[goodId]).toEqual(getMarketComparison(goodId));

    if (sample.control === "controlled" && sample.factionId) {
      expect(frame.slices.colonyEligibility?.[sample.id]).toEqual(
        colonyEligibility(world, sample.factionId, sample),
      );
    }
  });
});

describe("buildStateFrame — vacuity", () => {
  it("a seeded world's full frame is non-empty for every populated slice", () => {
    const frame = buildStateFrame(world, fullInterest(world)).slices;
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

describe("buildStateFrame — self-containment", () => {
  it("every frame carries the whole interest set's detail, never a delta, so applying only the latest of a sequence equals applying all of them", () => {
    const interest = fullInterest(world);
    const f0 = buildStateFrame(world, interest);

    const developed = world.systems.find((s) => s.control === "developed");
    if (!developed) throw new Error("fixture: expected at least one developed system");
    const target = developed;
    const w1: World = {
      ...world,
      systems: world.systems.map((s) => (s.id === target.id ? { ...s, population: s.population + 500 } : s)),
    };
    setWorld(w1);
    const f1 = buildStateFrame(w1, interest);

    const w2: World = {
      ...w1,
      systems: w1.systems.map((s) => (s.id === target.id ? { ...s, population: s.population + 500 } : s)),
    };
    setWorld(w2);
    const f2 = buildStateFrame(w2, interest);

    // The mutation actually moved something, so equality below is not vacuous.
    expect(f2.slices.systemPopulation?.[target.id]).not.toEqual(f0.slices.systemPopulation?.[target.id]);

    function reduce(frames: StateFrameBody[]): Partial<SnapshotSlices> {
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
    const frame = buildStateFrame(withEvent, EMPTY_INTEREST);

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
    expect(() => buildStateFrame(foreign, EMPTY_INTEREST)).toThrow(/not the store's current value/);
    // The store is untouched by the rejected call — still holding the world this file's beforeEach set.
    expect(getWorld()).toBe(world);
  });
});

describe("buildStateFrame — JSON round trip", () => {
  it("every slice survives JSON.stringify/parse unchanged (no Map/Set/Date/NaN)", () => {
    const frame = buildStateFrame(world, fullInterest(world));
    const roundTripped = JSON.parse(JSON.stringify(frame));
    expect(roundTripped).toEqual(frame);
  });
});
