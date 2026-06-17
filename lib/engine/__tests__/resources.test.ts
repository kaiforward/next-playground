import { describe, it, expect } from "vitest";
import {
  emptyResourceVector, makeResourceVector, aggregateColumns, bodyResourceColumns,
  sumResourceVectors, resourceVectorFromColumns, prepareResourceBars,
} from "../resources";
import type { ResourceType } from "@/lib/types/game";

const ALL: ResourceType[] = [
  "gas", "minerals", "ore", "biomass", "arable", "water", "radioactive",
];

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

describe("aggregateColumns", () => {
  it("maps a vector to the StarSystem agg* columns", () => {
    const cols = aggregateColumns(makeResourceVector({ gas: 1, ore: 2, water: 3 }));
    expect(cols).toEqual({
      aggGas: 1, aggMinerals: 0, aggOre: 2, aggBiomass: 0,
      aggArable: 0, aggWater: 3, aggRadioactive: 0,
    });
  });
});

describe("bodyResourceColumns", () => {
  it("maps a vector to the SystemBody res* columns", () => {
    const cols = bodyResourceColumns(makeResourceVector({ minerals: 4, radioactive: 1 }));
    expect(cols).toEqual({
      resGas: 0, resMinerals: 4, resOre: 0, resBiomass: 0,
      resArable: 0, resWater: 0, resRadioactive: 1,
    });
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
  it("round-trips with aggregateColumns (agg prefix)", () => {
    const v = makeResourceVector({ gas: 1, ore: 2, water: 3, radioactive: 4 });
    expect(resourceVectorFromColumns(aggregateColumns(v), "agg")).toEqual(v);
  });

  it("round-trips with bodyResourceColumns (res prefix)", () => {
    const v = makeResourceVector({ minerals: 5, biomass: 2, arable: 1 });
    expect(resourceVectorFromColumns(bodyResourceColumns(v), "res")).toEqual(v);
  });

  it("defaults missing columns to zero", () => {
    expect(resourceVectorFromColumns({ aggGas: 7 }, "agg")).toEqual(
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
});
