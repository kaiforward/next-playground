import { describe, it, expect } from "vitest";
import {
  emptyResourceVector, makeResourceVector,
  sumResourceVector, sumResourceVectors, resourceVectorFromColumns, prepareResourceBars,
  slotColumns, qualColumns, yieldColumns, unitResourceVector,
  slotCapOf, qualityOf, yieldsOf, RESOURCE_TYPES,
} from "../resources";
import type { ResourceType, ResourceVector } from "@/lib/types/game";

const ALL: ResourceType[] = [
  "gas", "minerals", "ore", "biomass", "arable", "water", "radioactive",
];

describe("unitResourceVector", () => {
  it("returns all seven resource types at 1", () => {
    const v = unitResourceVector();
    expect(Object.keys(v).sort()).toEqual([...ALL].sort());
    for (const t of ALL) expect(v[t]).toBe(1);
  });

  it("returns a fresh object each call (no shared mutation)", () => {
    const a = unitResourceVector();
    a.gas = 5;
    expect(unitResourceVector().gas).toBe(1);
  });
});

describe("emptyResourceVector", () => {
  it("returns all seven types at zero", () => {
    const v = emptyResourceVector();
    expect(Object.keys(v).sort()).toEqual([...ALL].sort());
    for (const t of ALL) expect(v[t]).toBe(0);
  });

  it("returns a fresh object each call (no shared mutation)", () => {
    const a = emptyResourceVector();
    a.gas = 5;
    expect(emptyResourceVector().gas).toBe(0);
  });
});

describe("makeResourceVector", () => {
  it("fills unspecified types with zero", () => {
    const v = makeResourceVector({ gas: 3, ore: 2 });
    expect(v.gas).toBe(3);
    expect(v.ore).toBe(2);
    expect(v.minerals).toBe(0);
    expect(v.water).toBe(0);
    expect(Object.keys(v).sort()).toEqual([...ALL].sort());
  });
});

describe("sumResourceVectors", () => {
  it("sums element-wise across vectors", () => {
    const sum = sumResourceVectors([
      makeResourceVector({ gas: 1, ore: 2 }),
      makeResourceVector({ ore: 3, water: 5 }),
    ]);
    expect(sum.gas).toBe(1);
    expect(sum.ore).toBe(5);
    expect(sum.water).toBe(5);
    expect(sum.minerals).toBe(0);
  });

  it("returns an all-zero vector for an empty list", () => {
    const sum = sumResourceVectors([]);
    expect(sum).toEqual(makeResourceVector({}));
  });
});

describe("sumResourceVector", () => {
  it("sums the components of a single vector", () => {
    expect(sumResourceVector(makeResourceVector({ gas: 1, ore: 2, water: 5 }))).toBe(8);
  });

  it("is zero for an empty vector", () => {
    expect(sumResourceVector(emptyResourceVector())).toBe(0);
  });

  it("counts every one of the seven resource types (no slot dropped)", () => {
    // Each type must contribute — a dropped type here would silently skew the universe-wide industryRef
    // that getDevelopmentRefs derives from this sum.
    const v = makeResourceVector({
      gas: 1, minerals: 1, ore: 1, biomass: 1, arable: 1, water: 1, radioactive: 1,
    });
    expect(sumResourceVector(v)).toBe(7);
  });
});

describe("resourceVectorFromColumns", () => {
  it("defaults missing columns to zero", () => {
    expect(resourceVectorFromColumns({ slotGas: 7 }, "slot")).toEqual(
      makeResourceVector({ gas: 7 }),
    );
  });
});

describe("prepareResourceBars", () => {
  it("keeps canonical order with all seven entries and no trace by default", () => {
    const v = makeResourceVector({ gas: 1, ore: 2 });
    const { entries, trace } = prepareResourceBars(v);
    expect(entries.map((e) => e.type)).toEqual([
      "gas", "minerals", "ore", "biomass", "arable", "water", "radioactive",
    ]);
    expect(trace).toEqual([]);
  });

  it("normalizes fractions to the vector max", () => {
    const { entries } = prepareResourceBars(makeResourceVector({ gas: 1, ore: 4 }));
    const byType = Object.fromEntries(entries.map((e) => [e.type, e.fraction]));
    expect(byType.ore).toBe(1);
    expect(byType.gas).toBeCloseTo(0.25);
    expect(byType.water).toBe(0);
  });

  it("sorts rich-first when sort is true", () => {
    const { entries } = prepareResourceBars(
      makeResourceVector({ gas: 1, ore: 4, water: 2 }),
      { sort: true },
    );
    expect(entries[0].type).toBe("ore");
    expect(entries[1].type).toBe("water");
    expect(entries[2].type).toBe("gas");
  });

  it("collapses zero and near-zero resources into trace", () => {
    const { entries, trace } = prepareResourceBars(
      makeResourceVector({ ore: 100, gas: 1 }), // gas is 1% of max → trace
      { collapseTrace: true, sort: true },
    );
    expect(entries.map((e) => e.type)).toEqual(["ore"]);
    expect(trace).toContain("gas");
    expect(trace).toContain("water");
    expect(trace).toHaveLength(6);
  });

  it("puts every type in trace for an all-zero vector when collapsing", () => {
    const { entries, trace } = prepareResourceBars(emptyResourceVector(), {
      collapseTrace: true,
    });
    expect(entries).toEqual([]);
    expect(trace).toHaveLength(7);
  });

  it("keeps all-zero entries with fraction 0 when not collapsing (no 0/0 NaN)", () => {
    const { entries, trace } = prepareResourceBars(emptyResourceVector());
    expect(entries).toHaveLength(7);
    expect(entries.every((e) => e.fraction === 0)).toBe(true);
    expect(trace).toEqual([]);
  });
});

describe("slotColumns", () => {
  it("maps a vector to the slot* columns", () => {
    const cols = slotColumns(makeResourceVector({ gas: 3, ore: 5, radioactive: 1 }));
    expect(cols).toEqual({
      slotGas: 3, slotMinerals: 0, slotOre: 5, slotBiomass: 0,
      slotArable: 0, slotWater: 0, slotRadioactive: 1,
    });
  });

  it("round-trips with resourceVectorFromColumns (slot prefix)", () => {
    const v = makeResourceVector({ gas: 2, minerals: 4, water: 6 });
    expect(resourceVectorFromColumns(slotColumns(v), "slot")).toEqual(v);
  });
});

describe("qualColumns", () => {
  it("maps a vector to the qual* columns", () => {
    const cols = qualColumns(makeResourceVector({ biomass: 2, arable: 3 }));
    expect(cols).toEqual({
      qualGas: 0, qualMinerals: 0, qualOre: 0, qualBiomass: 2,
      qualArable: 3, qualWater: 0, qualRadioactive: 0,
    });
  });

  it("round-trips with resourceVectorFromColumns (qual prefix)", () => {
    const v = makeResourceVector({ ore: 1, biomass: 2, radioactive: 3 });
    expect(resourceVectorFromColumns(qualColumns(v), "qual")).toEqual(v);
  });
});

describe("yieldColumns", () => {
  it("maps a vector to the yield* columns", () => {
    const cols = yieldColumns(makeResourceVector({ gas: 1.5, minerals: 0.8 }));
    expect(cols).toEqual({
      yieldGas: 1.5, yieldMinerals: 0.8, yieldOre: 0, yieldBiomass: 0,
      yieldArable: 0, yieldWater: 0, yieldRadioactive: 0,
    });
  });

  it("round-trips with resourceVectorFromColumns (yield prefix)", () => {
    const v = makeResourceVector({ gas: 1.2, arable: 0.9, water: 1.5 });
    expect(resourceVectorFromColumns(yieldColumns(v), "yield")).toEqual(v);
  });
});

describe("resourceVectorFromColumns — new prefixes and yield default", () => {
  it("yield prefix: missing columns default to 1", () => {
    const v = resourceVectorFromColumns({}, "yield");
    for (const t of ALL) expect(v[t]).toBe(1);
  });

  it("slot prefix: missing columns default to 0", () => {
    const v = resourceVectorFromColumns({}, "slot");
    for (const t of ALL) expect(v[t]).toBe(0);
  });

  it("qual prefix: missing columns default to 0", () => {
    const v = resourceVectorFromColumns({}, "qual");
    for (const t of ALL) expect(v[t]).toBe(0);
  });

  it("yield prefix: partially-present columns use correct defaults", () => {
    const v = resourceVectorFromColumns({ yieldGas: 1.3 }, "yield");
    expect(v.gas).toBe(1.3);
    // All other resources should default to 1
    expect(v.minerals).toBe(1);
    expect(v.ore).toBe(1);
    expect(v.water).toBe(1);
  });
});

/**
 * The readers iterate `RESOURCE_TYPES`, so they pick a new resource type up for free — the column
 * spreaders and the column-bag types they read from do NOT. An eighth type whose column never
 * reaches the bag reads as an empty deposit (or a neutral ×1 yield) with no type error and no
 * runtime error, so these assert coverage against `RESOURCE_TYPES` itself rather than a fixed seven.
 */
describe("resource column coverage", () => {
  const columnKeys = (prefix: string): string[] =>
    RESOURCE_TYPES.map((t) => `${prefix}${t.charAt(0).toUpperCase()}${t.slice(1)}`).sort();

  /** A vector whose every resource carries its own distinct value, so a dropped column cannot
   *  coincide with a neighbour's (or with the reader's 0/1 fallback). */
  const distinct = (): ResourceVector => {
    const v = emptyResourceVector();
    RESOURCE_TYPES.forEach((t, i) => { v[t] = 2 + i; });
    return v;
  };

  it("slotColumns emits exactly one column per resource type", () => {
    expect(Object.keys(slotColumns(emptyResourceVector())).sort()).toEqual(columnKeys("slot"));
  });

  it("qualColumns emits exactly one column per resource type", () => {
    expect(Object.keys(qualColumns(emptyResourceVector())).sort()).toEqual(columnKeys("qual"));
  });

  it("yieldColumns emits exactly one column per resource type", () => {
    expect(Object.keys(yieldColumns(emptyResourceVector())).sort()).toEqual(columnKeys("yield"));
  });

  it("slotCapOf reads back every resource type's own value", () => {
    const v = distinct();
    expect(slotCapOf(slotColumns(v))).toEqual(v);
  });

  it("qualityOf reads back every resource type's own value", () => {
    const v = distinct();
    expect(qualityOf(qualColumns(v))).toEqual(v);
  });

  it("yieldsOf reads back every resource type's own value", () => {
    const v = distinct();
    expect(yieldsOf(yieldColumns(v))).toEqual(v);
  });
});
