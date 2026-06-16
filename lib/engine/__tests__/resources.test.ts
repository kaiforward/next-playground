import { describe, it, expect } from "vitest";
import { emptyResourceVector, makeResourceVector, aggregateColumns, bodyResourceColumns, sumResourceVectors } from "../resources";
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
