import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { serializeWorld, deserializeWorld, sanitizeSaveName, SAVE_FORMAT_VERSION } from "../save";
import type { World } from "../types";
import { runWorldTick } from "../tick";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";

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

  it("is at save format version 11 (founding ledger, charter flag and purse line)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(11);
  });

  it("rejects a prior-version (v10) save — saves break on the shape bump", () => {
    // v10's in-flight colonies were committed under the free founding model; there is no
    // field-defaulting path, and any default would be a lie about whether they were paid for.
    const json = JSON.stringify({ formatVersion: 10, world });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
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
