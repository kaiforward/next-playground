import { describe, it, expect, afterEach } from "vitest";
import { generateWorld } from "../gen";
import { serializeWorld, deserializeWorld, sanitizeSaveName, SAVE_FORMAT_VERSION } from "../save";
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

afterEach(() => {
  clearWorld();
});

describe("sanitizeSaveName", () => {
  it("lowercases and strips everything but [a-z0-9-_]", () => {
    expect(sanitizeSaveName("My Save! #1")).toBe("mysave1");
  });

  it("preserves hyphens and underscores (they don't collide)", () => {
    expect(sanitizeSaveName("Run-A_2")).toBe("run-a_2");
  });

  it("returns empty string for a name with no [a-z0-9-_] characters", () => {
    // The exact edge case saveGameSchema.refine() guards against — a name that
    // sanitizes to "" would otherwise collide on saves/.json.
    expect(sanitizeSaveName("???")).toBe("");
    expect(sanitizeSaveName("   ")).toBe("");
  });
});

describe("serializeWorld / deserializeWorld", () => {
  const world = generateWorld({ systemCount: 60, seed: 7 });

  it("round-trips a generated world unchanged", () => {
    const result = deserializeWorld(serializeWorld(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world).toStrictEqual(world);
  });

  it("rejects malformed JSON", () => {
    const result = deserializeWorld("{ not valid json");
    expect(result.ok).toBe(false);
  });

  it("rejects a well-formed JSON object missing world.meta", () => {
    const json = JSON.stringify({ formatVersion: 2, world: { systems: [] } });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });

  it("rejects a world whose meta is missing mapSize (tile geometry depends on it)", () => {
    const { seed, systemCount, currentTick } = world.meta;
    const json = JSON.stringify({
      formatVersion: 2,
      world: { ...world, meta: { seed, systemCount, currentTick } },
    });
    const result = deserializeWorld(json);
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
      const result = deserializeWorld(json);
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
      expect(deserializeWorld(badMeta({ ...world.meta })).ok).toBe(true);
    });
  });

  it("rejects a save with an unsupported formatVersion", () => {
    const json = JSON.stringify({ formatVersion: 99, world });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });

  it("is at save format version 14 (attention-layer settings on the player seat)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(14);
  });

  it("rejects a prior-version (v11) save — saves break on the shape bump", () => {
    // v11 systems carry `supplyBand: "shortage"`, a value `SupplyRegime` no longer has, and a
    // `"rationing"` that meant `[0, 0.7)` rather than today's `[0.5, 0.7)`. `deserializeWorld` runs
    // structural spot-checks, not per-field validation, so nothing below this gate would notice
    // either — the version bump is the whole defence, and it must reject rather than load a band
    // string the type system says cannot exist.
    const json = JSON.stringify({ formatVersion: 11, world });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });

  it("rejects a prior-version (v13) save — the seat's settings records are required, not optional", () => {
    // A v13 seat carries `controlledFactionId`, `automation` and `pinnedSystemIds` and nothing else,
    // so `alertCategories`/`trackerSections` would load as `undefined`. The spot-checks below the
    // gate never look at `player`, and every reader of those records indexes them directly (the
    // settings panel's checkboxes, the run's own filter), so a loaded v13 save would throw on the
    // first render rather than degrade. The version bump is the whole defence.
    const json = JSON.stringify({ formatVersion: 13, world });
    const result = deserializeWorld(json);
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
    const result = deserializeWorld(serializeWorld(edited));
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
    const result = deserializeWorld(serializeWorld(withConstruction));
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
    const result = deserializeWorld(serializeWorld(marked));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.markets[0].logisticsFundingBound).toBe(true);
  });

  it("accepts generated rows without a logistics funding marker", () => {
    expect(world.markets[0].logisticsFundingBound).toBeUndefined();
    expect(deserializeWorld(serializeWorld(world)).ok).toBe(true);
  });

  it("round-trips a colony-establish project unchanged (serializable, no lost fields)", () => {
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
    const result = deserializeWorld(serializeWorld(withColony));
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
              realizedProductionRate: 0,
              productionSuppressed: true,
              squeezeCycles: 2,
              proposalCycles: 1,
            }
          : market,
      ),
    };
    const result = deserializeWorld(serializeWorld(assessed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.markets[0]).toMatchObject({
      realizedProductionRate: 0,
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
    const result = deserializeWorld(serializeWorld(fractional));
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
    const result = deserializeWorld(serializeWorld(marked));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.systems[0].provisionExpectation).toBe(0.42);
  });

  it("accepts generated systems without a provisionExpectation (never seeded)", () => {
    expect(world.systems[0].provisionExpectation).toBeUndefined();
    expect(deserializeWorld(serializeWorld(world)).ok).toBe(true);
  });

  it("round-trips the optional provision and supplyBand fields", () => {
    const marked: World = {
      ...world,
      systems: world.systems.map((system, index) =>
        index === 0 ? { ...system, provision: 0.73, supplyBand: "rationing" } : system),
    };
    const result = deserializeWorld(serializeWorld(marked));
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
    expect(deserializeWorld(serializeWorld(world)).ok).toBe(true);
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
    const result = deserializeWorld(serializeWorld(marked));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.systems[0].criticalWeight).toBe(1.3);
  });

  it("accepts generated systems without criticalWeight (never assessed)", () => {
    expect(world.systems[0].criticalWeight).toBeUndefined();
    expect(deserializeWorld(serializeWorld(world)).ok).toBe(true);
  });

  it("keeps new optional assessment values omitted in an old-shaped save", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const oldShaped: World = {
      ...world,
      markets: world.markets.map(({ realizedProductionRate, productionSuppressed, squeezeCycles, proposalCycles, ...market }) => market),
    };
    const result = deserializeWorld(serializeWorld(oldShaped));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.markets[0].realizedProductionRate).toBeUndefined();
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
    const back = deserializeWorld(serializeWorld(world));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.world.player).toEqual(world.player);
  });

  it("rejects a pre-6 save cleanly", () => {
    const stale = JSON.stringify({ formatVersion: 5, world: { meta: {} } });
    const result = deserializeWorld(stale);
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
    const result = deserializeWorld(serializeWorld(withPins));
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
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });

  it("a CURRENT-version save whose player seat lacks pinnedSystemIds loads, then breaks the first read that touches it", () => {
    // deserializeWorld's structural spot-checks cover only `meta` (see isWorldShaped's doc comment) —
    // they were never going to notice a missing `pinnedSystemIds` on a save stamped with today's
    // SAVE_FORMAT_VERSION. Every save `serializeWorld` actually produces always carries the field
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

    const result = deserializeWorld(json);
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
    const result = deserializeWorld(preMigrationSave());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const s of result.world.systems) expect(s.collapseDebt ?? 0).toBe(0);
  });

  it("runs a tick without NaN or Infinity entering world state, and drops the stale field", async () => {
    const result = deserializeWorld(preMigrationSave());
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
    // And it still survives a full serialize round-trip after the migration.
    expect(deserializeWorld(serializeWorld(world)).ok).toBe(true);
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
    const loaded = deserializeWorld(legacy);
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
