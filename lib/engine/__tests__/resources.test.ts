import { describe, it, expect } from "vitest";
import {
  emptyResourceVector, makeResourceVector,
  sumResourceVectors, resourceVectorFromColumns, prepareResourceBars,
  slotColumns, qualColumns, yieldColumns, unitResourceVector,
} from "../resources";
import type { ResourceType } from "@/lib/types/game";

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
