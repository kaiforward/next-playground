import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateWorld } from "../gen";
import { serialiseWorld, deserialiseWorld, sanitiseSaveName, SAVE_FORMAT_VERSION } from "../save";
import type { World } from "../types";
import { runWorldTick } from "../tick";
import { setWorld, clearWorld } from "../store";
import { getTrackerData } from "@/lib/services/tracker";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { provision } from "@/lib/engine/population";
import { EXPECTATION_PARAMS } from "@/lib/constants/population";
import { effColumns, effOf, makeResourceVector, yieldColumns, yieldsOf } from "@/lib/engine/resources";
import { workedYieldVectors } from "@/lib/engine/worked-deposits";
import { craftedBodies, craftedSlots } from "./worked-yield-fixture";

const RESOURCE_YIELD_COLUMNS = [
  "yieldGas", "yieldMinerals", "yieldOre", "yieldBiomass", "yieldArable", "yieldWater", "yieldRadioactive",
] as const;
const RESOURCE_EFF_COLUMNS = [
  "effGas", "effMinerals", "effOre", "effBiomass", "effArable", "effWater", "effRadioactive",
] as const;

afterEach(() => {
  clearWorld();
});

describe("sanitiseSaveName", () => {
  it("lowercases and strips everything but [a-z0-9-_]", () => {
    expect(sanitiseSaveName("My Save! #1")).toBe("mysave1");
  });

  it("preserves hyphens and underscores (they don't collide)", () => {
    expect(sanitiseSaveName("Run-A_2")).toBe("run-a_2");
  });

  it("returns empty string for a name with no [a-z0-9-_] characters", () => {
    // The exact edge case saveGameSchema.refine() guards against — a name that
    // sanitises to "" would otherwise collide on saves/.json.
    expect(sanitiseSaveName("???")).toBe("");
    expect(sanitiseSaveName("   ")).toBe("");
  });
});

describe("serialiseWorld / deserialiseWorld", () => {
  const world = generateWorld({ systemCount: 60, seed: 7 });

  it("round-trips a generated world unchanged", () => {
    const result = deserialiseWorld(serialiseWorld(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world).toStrictEqual(world);
  });

  it("round-trips every generated body's orbitIndex unchanged", () => {
    expect(world.bodies.length).toBeGreaterThan(0); // non-vacuous
    expect(world.bodies.every((b) => typeof b.orbitIndex === "number")).toBe(true);
    const result = deserialiseWorld(serialiseWorld(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.bodies.map((b) => b.orbitIndex)).toEqual(
      world.bodies.map((b) => b.orbitIndex),
    );
  });

  it("accepts a body row with no orbitIndex — additive optional field, an old save loads without it", () => {
    const stripped: World = {
      ...world,
      bodies: world.bodies.map(({ orbitIndex: _orbitIndex, ...rest }) => rest),
    };
    const result = deserialiseWorld(serialiseWorld(stripped));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.bodies[0].orbitIndex).toBeUndefined();
  });

  it("rejects malformed JSON", () => {
    const result = deserialiseWorld("{ not valid json");
    expect(result.ok).toBe(false);
  });

  it("rejects a well-formed JSON object missing world.meta", () => {
    const json = JSON.stringify({ formatVersion: 2, world: { systems: [] } });
    const result = deserialiseWorld(json);
    expect(result.ok).toBe(false);
  });

  it("rejects a world whose meta is missing mapSize (tile geometry depends on it)", () => {
    const { seed, systemCount, currentTick } = world.meta;
    const json = JSON.stringify({
      formatVersion: 2,
      world: { ...world, meta: { seed, systemCount, currentTick } },
    });
    const result = deserialiseWorld(json);
    expect(result.ok).toBe(false);
  });

  /**
   * The structural spot-checks, each reached on its own. Every case below carries the CURRENT
   * formatVersion deliberately: a stale version short-circuits at the version check, so a
   * wrong-version fixture proves nothing about the shape guards that run after it.
   */
  describe("structural spot-checks (each guard reached on its own)", () => {
    type MalformedValue = object | number | null;
    function badWorld(worldValue: MalformedValue): string {
      return JSON.stringify({ formatVersion: SAVE_FORMAT_VERSION, world: worldValue });
    }
    function badMeta(meta: MalformedValue): string {
      return badWorld({ ...world, meta });
    }
    function expectRejected(json: string, error: string) {
      const result = deserialiseWorld(json);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(error);
    }

    const NOT_OBJECT = "Save file is not a JSON object";
    const BAD_META = "Save file's world is missing required meta fields";

    it("rejects a top-level JSON scalar", () => {
      expectRejected("5", NOT_OBJECT);
    });

    it("rejects a top-level JSON null (typeof null is 'object' — the null arm is load-bearing)", () => {
      expectRejected("null", NOT_OBJECT);
    });

    it("rejects a current-version save with no world key at all", () => {
      expectRejected(JSON.stringify({ formatVersion: SAVE_FORMAT_VERSION }), BAD_META);
    });

    it("rejects a current-version save whose world is not an object", () => {
      expectRejected(badWorld(5), BAD_META);
    });

    it("rejects a current-version save whose world is null", () => {
      expectRejected(badWorld(null), BAD_META);
    });

    it("rejects a current-version save whose world has no meta", () => {
      expectRejected(badWorld({ systems: [] }), BAD_META);
    });

    it("rejects a world whose meta is not an object", () => {
      expectRejected(badMeta(5), BAD_META);
    });

    it("rejects a world whose meta is null", () => {
      expectRejected(badMeta(null), BAD_META);
    });

    // One case per numeric meta field: each is checked separately, so a guard that stopped
    // covering one field would pass every other case here.
    const NUMERIC_META_FIELDS = ["currentTick", "seed", "mapSize", "systemCount"] as const;
    for (const field of NUMERIC_META_FIELDS) {
      it(`rejects a world whose meta.${field} is present but not a number`, () => {
        expectRejected(badMeta({ ...world.meta, [field]: "not-a-number" }), BAD_META);
      });
    }

    it("accepts a meta carrying all four numeric fields (the guards are not rejecting everything)", () => {
      expect(deserialiseWorld(badMeta({ ...world.meta })).ok).toBe(true);
    });

    // The three array fields `rebuildWorkedYieldColumns` dereferences unconditionally in the `ok`
    // arm — a save with valid meta but a missing/malformed one of these must fail cleanly
    // ({ ok: false }), never throw out of deserialiseWorld.
    const REQUIRED_ARRAY_FIELDS = ["systems", "bodies", "buildings"] as const;
    for (const field of REQUIRED_ARRAY_FIELDS) {
      it(`rejects a world with valid meta but no "${field}" array (never throws)`, () => {
        const { [field]: _omitted, ...rest } = world;
        expect(() => deserialiseWorld(badWorld(rest))).not.toThrow();
        expectRejected(badWorld(rest), BAD_META);
      });

      it(`rejects a world whose "${field}" is present but not an array`, () => {
        expectRejected(badWorld({ ...world, [field]: "not-an-array" }), BAD_META);
      });
    }
  });

  it("rejects a save with an unsupported formatVersion", () => {
    const json = JSON.stringify({ formatVersion: 99, world });
    const result = deserialiseWorld(json);
    expect(result.ok).toBe(false);
  });

  // This is what makes a pre-bump save fail cleanly. A v14 market row spells the persisted rate
  // `realizedProductionRate`, so on today's shape it loads as `undefined` — and because the field is
  // optional with a `?? capacity` fallback in the good-market-state processor, such a save would
  // NOT throw: every market would silently price against nameplate capacity instead of realised
  // output. Nothing but this constant stands between the two, which is why the number is pinned
  // rather than left to drift.
  it("is at save format version 17 (alert-category key set shrinks; WorldEvent.type union shrinks)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(17);
  });

  it("rejects a v16 (pre-events-strip) save with the clean version error", () => {
    // A v16 save's world.player.alertCategories can carry the three now-deleted keys
    // (crisis/disruption/windfall) and world.events can carry a now-deleted WorldEvent.type — the
    // version bump is what makes this fail cleanly instead of loading a stale shape the structural
    // spot-checks below `meta` cannot see, or silently expiring a foreign event row through the
    // events processor's stale-type guard.
    const json = JSON.stringify({ formatVersion: 16, world });
    const result = deserialiseWorld(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(`Unsupported save formatVersion (expected ${SAVE_FORMAT_VERSION})`);
  });

  it("rejects a v15 (pre-habitability-seeding) save with the clean version error", () => {
    // v15 systems/bodies carry the retired partition-model columns under their pre-rename names
    // and no eff* columns at all — the version bump is what makes this fail cleanly
    // instead of loading a stale shape the structural spot-checks below `meta` cannot see.
    const json = JSON.stringify({ formatVersion: 15, world });
    const result = deserialiseWorld(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(`Unsupported save formatVersion (expected ${SAVE_FORMAT_VERSION})`);
  });

  it("a fresh world round-trips through serialise/deserialise with the new extraction-efficiency columns finite", () => {
    const fresh = generateWorld({ systemCount: 60, seed: 21 });
    const result = deserialiseWorld(serialiseWorld(fresh));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world).toStrictEqual(fresh);
    for (const s of result.world.systems) {
      for (const col of [
        "effGas", "effMinerals", "effOre", "effBiomass", "effArable", "effWater", "effRadioactive",
      ] as const) {
        expect(Number.isFinite(s[col]), col).toBe(true);
        expect(s[col]).toBeGreaterThan(0);
      }
    }
  });

  it("a v16 world round-trips with no industryLand field anywhere in systems or bodies", () => {
    // habitability-seeding's amendment (2026-08-24) deleted the industry-land budget without a
    // version bump — the field is REMOVED from v16 rather than bumping again (one-shipped-bump
    // rule; v16 is branch-only, never shipped). Systems and bodies never carried the field in the
    // first place under today's generator, so this pins that absence rather than assuming it.
    const fresh = generateWorld({ systemCount: 60, seed: 33 });
    const result = deserialiseWorld(serialiseWorld(fresh));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const s of result.world.systems) expect("industryLand" in s).toBe(false);
    for (const b of result.world.bodies) expect("industryLand" in b).toBe(false);
  });

  it("loads cleanly with the industry-land budget deleted", () => {
    // A save file still carrying `industryLand` from before the cut (systems AND bodies) loads —
    // deserialiseWorld's guard checks version + meta shape only (see the module doc comment) — and
    // the stale field is harmlessly ignored: nothing in the current World type or any reader
    // touches it, so the world ticks and re-serialises exactly as if the field had never been
    // there. This is the true load behaviour being asserted, not a rejection.
    const world = generateWorld({ systemCount: 40, seed: 34 });
    const staleShaped = {
      formatVersion: SAVE_FORMAT_VERSION,
      world: {
        ...world,
        systems: world.systems.map((s) => ({ ...s, industryLand: 999 })),
        bodies: world.bodies.map((b) => ({ ...b, industryLand: 42 })),
      },
    };
    const result = deserialiseWorld(JSON.stringify(staleShaped));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The stale field survives the JSON round-trip (deserialiseWorld does structural spot-checks,
    // not field stripping) but nothing in the current World type or its readers ever looks at it —
    // a fresh re-serialise still produces a value-equal world once the stale key is stripped back
    // off, proving it was carried inertly rather than feeding any computation.
    result.world.systems.forEach((s: { industryLand?: number } & typeof world.systems[number]) => {
      expect(s.industryLand).toBe(999);
    });
    const stripped = {
      ...result.world,
      systems: result.world.systems.map(({ industryLand: _dropped, ...rest }: { industryLand?: number } & typeof world.systems[number]) => rest),
      bodies: result.world.bodies.map(({ industryLand: _dropped, ...rest }: { industryLand?: number } & typeof world.bodies[number]) => rest),
    };
    expect(stripped).toStrictEqual(world);
  });

  it("rejects a prior-version (v11) save — saves break on the shape bump", () => {
    // v11 systems carry `supplyBand: "shortage"`, a value `SupplyRegime` no longer has, and a
    // `"rationing"` that meant `[0, 0.7)` rather than today's `[0.5, 0.7)`. `deserialiseWorld` runs
    // structural spot-checks, not per-field validation, so nothing below this gate would notice
    // either — the version bump is the whole defence, and it must reject rather than load a band
    // string the type system says cannot exist.
    const json = JSON.stringify({ formatVersion: 11, world });
    const result = deserialiseWorld(json);
    expect(result.ok).toBe(false);
  });

  it("round-trips the player seat's attention-layer settings unchanged", () => {
    // A SEATED world: the settings records hang off `player`, so the shared fixture above (no
    // `playerFaction`, hence `player: null`) would round-trip nothing at all here.
    const seated = generateWorld({
      systemCount: 60,
      seed: 7,
      playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
    });
    const player = seated.player;
    expect(player).not.toBeNull();
    if (!player) return;
    const edited: World = {
      ...seated,
      player: {
        ...player,
        alertCategories: { ...player.alertCategories, unrest_rising: true, overcrowded: false },
        trackerSections: { ...player.trackerSections, building: false },
      },
    };
    const result = deserialiseWorld(serialiseWorld(edited));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.player?.alertCategories.unrest_rising).toBe(true);
    expect(result.world.player?.alertCategories.overcrowded).toBe(false);
    expect(result.world.player?.trackerSections.building).toBe(false);
    expect(result.world).toStrictEqual(edited);
  });

  it("round-trips construction projects + building idleCycles unchanged", () => {
    const withConstruction: World = {
      ...world,
      constructionProjects: [
        {
          kind: "build",
          id: "proj-1",
          origin: "auto",
          factionId: world.factions[0].id,
          systemId: world.systems[0].id,
          buildingType: "housing",
          levels: 2,
          workTotal: 30,
          workDone: 12,
        },
      ],
      buildings: world.buildings.map((b, i) => ({ ...b, idleCycles: i === 0 ? 3 : 0 })),
    };
    const result = deserialiseWorld(serialiseWorld(withConstruction));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world).toStrictEqual(withConstruction);
  });

  it("round-trips the optional logistics funding-bound marker", () => {
    const marked: World = {
      ...world,
      markets: world.markets.map((market, index) =>
        index === 0 ? { ...market, logisticsFundingBound: true } : market,
      ),
    };
    const result = deserialiseWorld(serialiseWorld(marked));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.markets[0].logisticsFundingBound).toBe(true);
  });

  it("accepts generated rows without a logistics funding marker", () => {
    expect(world.markets[0].logisticsFundingBound).toBeUndefined();
    expect(deserialiseWorld(serialiseWorld(world)).ok).toBe(true);
  });

  it("round-trips a colony-establish project unchanged (serialisable, no lost fields)", () => {
    // The staged manifest is real in-transit inventory sitting in no market row at either end —
    // lose it on save and the founder is debited for goods the colony never receives.
    const withColony: World = {
      ...world,
      constructionProjects: [
        {
          kind: "colony_establish",
          id: "establish-1",
          origin: "auto",
          factionId: world.factions[0].id,
          systemId: world.systems[1].id,
          sourceSystemId: world.systems[0].id,
          seedPop: 50,
          housingLevels: 3,
          workTotal: 84,
          workDone: 40,
          stagedManifest: [
            { goodId: "water", quantity: 42 },
            { goodId: "food", quantity: 17.5 },
          ],
          charterPaid: true,
          stalledCycles: 3,
        },
      ],
    };
    const result = deserialiseWorld(serialiseWorld(withColony));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world).toStrictEqual(withColony);
  });


  it("round-trips optional planner assessment fields without a save bump", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const assessed: World = {
      ...world,
      markets: world.markets.map((market, index) =>
        index === 0
          ? {
              ...market,
              realisedProductionRate: 0,
              productionSuppressed: true,
              squeezeCycles: 2,
              proposalCycles: 1,
            }
          : market,
      ),
    };
    const result = deserialiseWorld(serialiseWorld(assessed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.markets[0]).toMatchObject({
      realisedProductionRate: 0,
      productionSuppressed: true,
      squeezeCycles: 2,
      proposalCycles: 1,
    });
  });

  it("round-trips fractional persistence counters (reference-time, not integers)", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const fractional: World = {
      ...world,
      markets: world.markets.map((market, index) =>
        index === 0 ? { ...market, squeezeCycles: 1.5, proposalCycles: 0.5 } : market,
      ),
    };
    const result = deserialiseWorld(serialiseWorld(fractional));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.markets[0].squeezeCycles).toBe(1.5);
    expect(result.world.markets[0].proposalCycles).toBe(0.5);
  });

  it("round-trips the optional provisionExpectation field", () => {
    const marked: World = {
      ...world,
      systems: world.systems.map((system, index) =>
        index === 0 ? { ...system, provisionExpectation: 0.42 } : system,
      ),
    };
    const result = deserialiseWorld(serialiseWorld(marked));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.systems[0].provisionExpectation).toBe(0.42);
  });

  it("accepts generated systems without a provisionExpectation (never seeded)", () => {
    expect(world.systems[0].provisionExpectation).toBeUndefined();
    expect(deserialiseWorld(serialiseWorld(world)).ok).toBe(true);
  });

  it("round-trips the optional provision and supplyBand fields", () => {
    const marked: World = {
      ...world,
      systems: world.systems.map((system, index) =>
        index === 0 ? { ...system, provision: 0.73, supplyBand: "rationing" } : system),
    };
    const result = deserialiseWorld(serialiseWorld(marked));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.systems[0].provision).toBe(0.73);
    expect(result.world.systems[0].supplyBand).toBe("rationing");
  });

  it("accepts generated systems without provision or supplyBand (never assessed)", () => {
    // A freshly generated world has never run an economy cycle — the absent-means-assessed-at-
    // famine trap the provisionExpectation convention above also guards: reading a coerced 0
    // here would render as "0% Provisioned" for a system nobody has ever measured.
    expect(world.systems[0].provision).toBeUndefined();
    expect(world.systems[0].supplyBand).toBeUndefined();
    expect(deserialiseWorld(serialiseWorld(world)).ok).toBe(true);
  });

  it("round-trips the optional criticalWeight field UN-CLAMPED — unlike provision, it carries no [0,1] ceiling", () => {
    // 1.3 is deliberately above 1: criticalWeight has no upper bound of its own (supplyUnrestTerm
    // floors it at 0 only; the min(slopeShortage, …) cap inside that function bounds its EFFECT,
    // not the stored weight — lib/world/types.ts). A save round trip that silently clamped this to
    // 1 would be indistinguishable from the provision-style bug this test exists to catch.
    const marked: World = {
      ...world,
      systems: world.systems.map((system, index) =>
        index === 0 ? { ...system, provision: 0.4, supplyBand: "rationing", criticalWeight: 1.3 } : system),
    };
    const result = deserialiseWorld(serialiseWorld(marked));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.systems[0].criticalWeight).toBe(1.3);
  });

  it("accepts generated systems without criticalWeight (never assessed)", () => {
    expect(world.systems[0].criticalWeight).toBeUndefined();
    expect(deserialiseWorld(serialiseWorld(world)).ok).toBe(true);
  });

  it("round-trips the optional habitabilityQuality field (the fill-best-first quality cache)", () => {
    const marked: World = {
      ...world,
      systems: world.systems.map((system, index) =>
        index === 0 ? { ...system, habitabilityQuality: { quality: 0.68, frontierIndex: 1, partial: true } } : system),
    };
    const result = deserialiseWorld(serialiseWorld(marked));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.systems[0].habitabilityQuality).toEqual({ quality: 0.68, frontierIndex: 1, partial: true });
  });

  it("accepts generated systems without habitabilityQuality (never assessed by the population processor)", () => {
    // A freshly generated world has never run a population cycle — additive optional field, no
    // version bump needed (SAVE_FORMAT_VERSION's own doc comment): absent stays absent on load.
    expect(world.systems[0].habitabilityQuality).toBeUndefined();
    expect(deserialiseWorld(serialiseWorld(world)).ok).toBe(true);
  });

  it("keeps new optional assessment values omitted in an old-shaped save", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const oldShaped: World = {
      ...world,
      markets: world.markets.map(({ realisedProductionRate, productionSuppressed, squeezeCycles, proposalCycles, ...market }) => market),
    };
    const result = deserialiseWorld(serialiseWorld(oldShaped));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.markets[0].realisedProductionRate).toBeUndefined();
    expect(result.world.markets[0].productionSuppressed).toBeUndefined();
    expect(result.world.markets[0].squeezeCycles).toBeUndefined();
    expect(result.world.markets[0].proposalCycles).toBeUndefined();
  });

});
describe("save format — player seat", () => {
  it("round-trips world.player", () => {
    const world = generateWorld({
      systemCount: 120,
      seed: 7,
      playerFaction: { name: "Testers Guild", governmentType: "corporate", doctrine: "hegemonic" },
    });
    const back = deserialiseWorld(serialiseWorld(world));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.world.player).toEqual(world.player);
  });

  it("rejects a pre-6 save cleanly", () => {
    const stale = JSON.stringify({ formatVersion: 5, world: { meta: {} } });
    const result = deserialiseWorld(stale);
    expect(result.ok).toBe(false);
  });

  it("round-trips pinnedSystemIds in insertion order", () => {
    const world = generateWorld({
      systemCount: 120,
      seed: 7,
      playerFaction: { name: "Testers Guild", governmentType: "corporate", doctrine: "hegemonic" },
    });
    if (!world.player) throw new Error("fixture: expected a player seat");
    const [a, b, c] = world.systems;
    const withPins: World = {
      ...world,
      player: { ...world.player, pinnedSystemIds: [c.id, a.id, b.id] },
    };
    const result = deserialiseWorld(serialiseWorld(withPins));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.player?.pinnedSystemIds).toEqual([c.id, a.id, b.id]);
  });

  it("rejects a stale formatVersion save even when its payload otherwise matches the current shape", () => {
    // The version gate rejects on `formatVersion` alone, before the player seat (or anything else
    // below `meta`) is ever inspected — stripping `pinnedSystemIds` here changes nothing about WHY
    // this is rejected, only what a genuine v12 save (predating the field) would have looked like.
    // Same defence as the v11 supply-band case above: the bump is the whole mechanism.
    const world = generateWorld({
      systemCount: 60,
      seed: 7,
      playerFaction: { name: "Testers Guild", governmentType: "corporate", doctrine: "hegemonic" },
    });
    if (!world.player) throw new Error("fixture: expected a player seat");
    const { pinnedSystemIds: _dropped, ...v12Player } = world.player;
    const json = JSON.stringify({ formatVersion: 12, world: { ...world, player: v12Player } });
    const result = deserialiseWorld(json);
    expect(result.ok).toBe(false);
  });

  it("a CURRENT-version save whose player seat lacks pinnedSystemIds loads, then breaks the first read that touches it", () => {
    // deserialiseWorld's structural spot-checks cover only `meta` (see isWorldShaped's doc comment) —
    // they were never going to notice a missing `pinnedSystemIds` on a save stamped with today's
    // SAVE_FORMAT_VERSION. Every save `serialiseWorld` actually produces always carries the field
    // (it's a required, non-optional column on WorldPlayer), so this shape can only arise from a
    // hand-edited or corrupted file, not from any real version transition — but the module's own
    // contract is deliberately non-exhaustive, so it is worth pinning what that gap actually does.
    const world = generateWorld({
      systemCount: 60,
      seed: 7,
      playerFaction: { name: "Testers Guild", governmentType: "corporate", doctrine: "hegemonic" },
    });
    if (!world.player) throw new Error("fixture: expected a player seat");
    const { pinnedSystemIds: _dropped, ...v13PlayerMissingPins } = world.player;
    const json = JSON.stringify({
      formatVersion: SAVE_FORMAT_VERSION,
      world: { ...world, player: v13PlayerMissingPins },
    });

    const result = deserialiseWorld(json);
    // Loads successfully — the spot-check has nothing to say about a missing player field.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.player?.pinnedSystemIds).toBeUndefined();

    // The gap: the first Tracker read against this world throws, rather than degrading (e.g. to an
    // empty pin list). This is a real behavioural hole for a corrupted/hand-edited save — flagged
    // here, not silently patched with a `?? []` fallback, because a save-path behaviour change is a
    // human decision (AGENTS.md), not one this test should make unilaterally.
    setWorld(result.world);
    expect(() => getTrackerData()).toThrow();
  });
});

describe("save compatibility — collapseDebt moved from building rows to system rows", () => {
  /**
   * A save written before the unrest-collapse debt became per-system: every system row lacks
   * `collapseDebt`, and every building row still carries the retired per-type one. The format
   * version was deliberately NOT bumped, because the debt is transient regime state that resets
   * whenever unrest falls back below the decay threshold — never a balance anything is owed. This
   * pins that the decision is safe rather than merely asserted.
   */
  function preMigrationSave(): string {
    const world = generateWorld({ systemCount: 40, seed: 11 });
    const legacy = {
      formatVersion: SAVE_FORMAT_VERSION,
      world: {
        ...world,
        systems: world.systems.map((s) => {
          const { collapseDebt: _dropped, ...withoutDebt } = s;
          return withoutDebt;
        }),
        buildings: world.buildings.map((b) => ({ ...b, collapseDebt: 0.4 })),
      },
    };
    return JSON.stringify(legacy);
  }

  it("loads, and every system's missing collapseDebt reads 0", () => {
    const result = deserialiseWorld(preMigrationSave());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const s of result.world.systems) expect(s.collapseDebt ?? 0).toBe(0);
  });

  it("runs a tick without NaN or Infinity entering world state, and drops the stale field", async () => {
    const result = deserialiseWorld(preMigrationSave());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Past a cycle boundary, so the economy/population/decay cycle actually resolves.
    let world: World = result.world;
    for (let tick = 1; tick <= CYCLE_LENGTH + 1; tick++) {
      world = (await runWorldTick(world)).world;
    }

    // The retired per-building field is rebuilt away by the first tick's row flatten…
    for (const b of world.buildings) expect("collapseDebt" in b).toBe(false);
    // …and the per-system one is a finite, non-negative number everywhere.
    for (const s of world.systems) {
      const debt = s.collapseDebt ?? 0;
      expect(Number.isFinite(debt)).toBe(true);
      expect(debt).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(s.population)).toBe(true);
      expect(Number.isFinite(s.popCap)).toBe(true);
      expect(Number.isFinite(s.unrest)).toBe(true);
    }
    for (const m of world.markets) expect(Number.isFinite(m.stock)).toBe(true);
    // And it still survives a full serialise round-trip after the migration.
    expect(deserialiseWorld(serialiseWorld(world)).ok).toBe(true);
  });
});

describe("save compatibility — connection rows predating isCrossing", () => {
  /**
   * A save written before `WorldConnection.isCrossing` existed: every connection row lacks the
   * key entirely. Not version-bumped — the load boundary defaults the missing value to `false`
   * (`normalizeConnectionCrossing`, save.ts), the same reading every intra-cluster/band-chain lane
   * already carries, so a pre-migration save just shows no crossing-class lanes rather than failing
   * to load or mis-highlighting ordinary lanes.
   */
  it("loads, and every connection missing isCrossing reads false", () => {
    const world = generateWorld({ systemCount: 40, seed: 11 });
    expect(world.connections.length).toBeGreaterThan(0); // non-vacuous
    const legacy = {
      formatVersion: SAVE_FORMAT_VERSION,
      world: {
        ...world,
        connections: world.connections.map(({ isCrossing: _dropped, ...rest }) => rest),
      },
    };
    const result = deserialiseWorld(JSON.stringify(legacy));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const c of result.world.connections) expect(c.isCrossing).toBe(false);
  });

  it("does not disturb a current save whose connections already carry a real isCrossing", () => {
    // 600 systems, seed 1 — a fixture already known to produce at least one crossing-class lane
    // (`lib/world/__tests__/gen.test.ts`'s isCrossing pass-through test uses the same pair).
    const world = generateWorld({ systemCount: 600, seed: 1 });
    // Non-vacuity: this generated fixture actually has at least one crossing-class lane, so a
    // buggy normalizer that always forced false would be caught here.
    expect(world.connections.some((c) => c.isCrossing)).toBe(true);
    const result = deserialiseWorld(serialiseWorld(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.connections).toEqual(world.connections);
  });
});

describe("save compatibility — provisionExpectation seeds from Provision, not a coerced 0", () => {
  /**
   * A save predating the field loads and its first economy cycle seeds the stored memory from
   * THAT cycle's Provision — never from a `?? 0` coercion (which would read stored 0, effective =
   * the expectation floor) and never from a floor-write bug (persisting the read-side `effective`
   * instead of the raw `stored`, which would read the floor 0.5). The fixture starves both
   * survival goods on an otherwise-ample homeworld so this cycle's Provision lands well UNDER
   * EXPECTATION_PARAMS.floor (0.5) — Provision strictly between 0 and the floor is the only
   * reading that discriminates both failure modes at once.
   */
  it("loads and the first cycle seeds stored expectation from that cycle's Provision, not 0 or the floor", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const systemId = base.factions[0].homeworldId;
    const prepared: World = {
      ...base,
      // Strip every producer but housing — the fixture's only output is population, so an emptied
      // survival good's stock cannot refill and stays a structural deficit for the whole cycle.
      buildings: [
        ...base.buildings.filter((b) => b.systemId !== systemId),
        { systemId, buildingType: HOUSING_TYPE, count: 250, idleCycles: 0 },
      ],
      markets: base.markets.map((m) =>
        m.systemId === systemId
          ? { ...m, stock: m.goodId === "food" || m.goodId === "water" ? 0 : 1e7, satisfaction: 1 }
          : m,
      ),
    };
    // Premise: this save predates the field on every system.
    for (const s of prepared.systems) expect(s.provisionExpectation).toBeUndefined();

    const legacy = JSON.stringify({ formatVersion: SAVE_FORMAT_VERSION, world: prepared });
    const loaded = deserialiseWorld(legacy);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // One full cycle so the economy actually assesses and the population processor's bridge seeds
    // the memory. Construction/logistics parked — noise from those stages is not this test's concern.
    let ticked: World = loaded.world;
    const cadence = { cycle: CYCLE_LENGTH, construction: 999_999, logistics: 999_999 };
    for (let t = 0; t < CYCLE_LENGTH; t++) {
      ticked = (await runWorldTick(ticked, { cadence })).world;
    }
    const system = ticked.systems.find((s) => s.id === systemId)!;

    // Independent oracle: the SAME provision() fold the economy applied, fed the tick's OWN
    // persisted satisfaction figures and this basis's own demand rates — not a hand-guessed number.
    const buildingsBySystem: Record<string, number> = {};
    for (const b of ticked.buildings) if (b.systemId === systemId) buildingsBySystem[b.buildingType] = b.count;
    const { basis } = computeSystemLabourSnapshot(buildingsBySystem, system.population);
    const goods = ticked.markets
      .filter((m) => m.systemId === systemId && consumptionRate(m.goodId, basis) > 0)
      .map((m) => ({
        goodId: m.goodId,
        satisfaction: m.satisfaction ?? 1,
        demanded: consumptionRate(m.goodId, basis),
      }));
    const expectedProvision = provision(goods);

    // Non-vacuity: the fixture actually lands where it needs to for the test to discriminate.
    expect(expectedProvision).toBeGreaterThan(0);
    expect(expectedProvision).toBeLessThan(EXPECTATION_PARAMS.floor);

    expect(system.provisionExpectation).toBeCloseTo(expectedProvision, 6);
    // Falsifies both named failure modes explicitly, not just via the closeness check above.
    expect(system.provisionExpectation).not.toBeCloseTo(0, 3);
    expect(system.provisionExpectation).not.toBeCloseTo(EXPECTATION_PARAMS.floor, 3);
  }, 60_000);
});

describe("rebuildWorkedYieldColumns — the worked-prefix load hook", () => {
  it("a save whose columns hold deliberately-wrong pooled values reads worked-fold values after deserialiseWorld", () => {
    const base = generateWorld({ systemCount: 40, seed: 55 });
    const systemId = base.factions[0].homeworldId;
    // Independent oracle: the same fold, computed directly from the crafted fixture — not read
    // back off the world under test.
    const expected = workedYieldVectors(craftedSlots(systemId), { ore: 1 });
    // Premise: the fold's answer really is one a count-weighted pool over both bodies could not
    // produce (a pool would land strictly between the two bodies' ground values).
    expect(expected.eff.ore).toBe(1);
    expect(expected.yieldMult.ore).toBe(2);

    const staleShaped = {
      formatVersion: SAVE_FORMAT_VERSION,
      world: {
        ...base,
        bodies: [...base.bodies.filter((b) => b.systemId !== systemId), ...craftedBodies(systemId)],
        buildings: [
          ...base.buildings.filter((b) => b.systemId !== systemId),
          { systemId, buildingType: "ore", count: 1, idleCycles: 0 },
        ],
        systems: base.systems.map((s) =>
          s.id === systemId
            ? {
                ...s,
                // Deliberately wrong: values a worked-prefix fold of this fixture can never
                // produce (0.01 sits nowhere near either body's modifier or ground value).
                ...effColumns(makeResourceVector({ ore: 0.01 })),
                ...yieldColumns(makeResourceVector({ ore: 0.01 })),
              }
            : s,
        ),
      },
    };

    const result = deserialiseWorld(JSON.stringify(staleShaped));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const system = result.world.systems.find((s) => s.id === systemId);
    expect(system).toBeDefined();
    if (!system) return;
    expect(system.effOre).toBeCloseTo(expected.eff.ore, 10);
    expect(system.yieldOre).toBeCloseTo(expected.yieldMult.ore, 10);
    // Non-vacuity: the deliberately-wrong stored value really was overwritten, not coincidentally
    // close to the fold's answer.
    expect(system.effOre).not.toBeCloseTo(0.01, 3);
    expect(system.yieldOre).not.toBeCloseTo(0.01, 3);
  });

  it("a current-version save round-trips (no version rejection), and every system's yield/eff columns survive serialise+deserialise unchanged", () => {
    const world = generateWorld({ systemCount: 30, seed: 77 });
    // Non-vacuity: there is actually something to compare below.
    expect(world.systems.length).toBeGreaterThan(0);
    const result = deserialiseWorld(serialiseWorld(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.world.systems.map((s) => [s.id, s]));
    for (const before of world.systems) {
      const after = byId.get(before.id);
      expect(after).toBeDefined();
      if (!after) continue;
      expect(yieldsOf(after)).toEqual(yieldsOf(before));
      expect(effOf(after)).toEqual(effOf(before));
    }
  });

  it("a world with a body-less system loads without NaN, and leaves its columns untouched", () => {
    const world = generateWorld({ systemCount: 30, seed: 88 });
    const systemId = world.systems[0].id;
    const bodyless: World = {
      ...world,
      bodies: world.bodies.filter((b) => b.systemId !== systemId),
    };
    const result = deserialiseWorld(JSON.stringify({ formatVersion: SAVE_FORMAT_VERSION, world: bodyless }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const system = result.world.systems.find((s) => s.id === systemId);
    expect(system).toBeDefined();
    if (!system) return;
    for (const col of [...RESOURCE_EFF_COLUMNS, ...RESOURCE_YIELD_COLUMNS]) {
      expect(Number.isFinite(system[col]), col).toBe(true);
      // No slots to fold: the guard leaves a body-less row exactly as it was, rather than
      // folding it to the neutral-1.0 reading it never earned.
      expect(system[col]).toBe(world.systems[0][col]);
    }
  });

  describe("the hook lives solely in deserialiseWorld — file and IndexedDB loads share it", () => {
    const here = fileURLToPath(import.meta.url);
    const repoRoot = join(dirname(here), "..", "..", "..");
    const read = (relPath: string) => readFileSync(join(repoRoot, relPath), "utf8");

    it("lib/services/game.ts's loadGame passes deserialiseWorld's own result straight to setWorld, no second transform", () => {
      const src = read("lib/services/game.ts");
      const bodyMatch = src.match(/export async function loadGame[\s\S]*?\r?\n\}\r?\n/);
      expect(bodyMatch).not.toBeNull();
      const body = bodyMatch ? bodyMatch[0] : "";
      expect(body).toMatch(/const parsed = deserialiseWorld\(json\);/);
      // setWorld receives parsed.world literally — nothing rebuilds or re-wraps it at this call
      // site, because the load hook already ran inside deserialiseWorld itself.
      expect(body).toMatch(/setWorld\(parsed\.world\);/);
      expect(src).not.toMatch(/rebuildWorkedYieldColumns/);
    });
  });
});
