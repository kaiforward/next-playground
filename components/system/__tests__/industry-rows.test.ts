import { describe, it, expect } from "vitest";
import { depositRows, generalLand } from "../industry-rows";
import type { SystemDepositSummary, SystemIndustryReadout, SubstrateSpace } from "@/lib/engine/industry";

const T = 0.75;

const deposit = (resource: SystemDepositSummary["resource"], slotCap: number): SystemDepositSummary => ({
  resource,
  slotCap,
  worked: 0,
  yieldMult: 1,
  band: "average",
});
const extractor = (buildingType: string, count: number, used: number, output: number): SystemIndustryReadout["buildings"][number] => ({
  buildingType,
  outputGood: buildingType,
  tier: 0,
  count,
  used,
  staffedFraction: count > 0 ? used / count : 0,
  output,
});

describe("depositRows", () => {
  it("aggregates goods sharing a resource and takes the worst contributor's health", () => {
    // food + textiles both extract arable. textiles has a whole idle level (0.9/2.0) → contracting.
    const rows = depositRows(
      [deposit("arable", 5)],
      [extractor("food", 1, 1, 4), extractor("textiles", 2, 0.9, 3)],
      0,
      T,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].built).toBe(3);
    expect(rows[0].worked).toBeCloseTo(1.9);
    expect(rows[0].output).toBeCloseTo(7);
    expect(rows[0].health).toBe("contracting");
  });

  it("reads stable when built levels are staffed within a whole unit", () => {
    // 1.9/2.0 → floor(0.1) = 0 idle levels → stable (the engine never sheds a sub-unit gap).
    const rows = depositRows([deposit("arable", 4)], [extractor("food", 2, 1.9, 8)], 0, T);
    expect(rows[0].health).toBe("stable");
  });

  it("drops zero-slot resources; an undeveloped deposit reads stable with zero work", () => {
    const rows = depositRows([deposit("ore", 0), deposit("water", 3)], [], 0, T);
    expect(rows.map((r) => r.resource)).toEqual(["water"]);
    expect(rows[0].built).toBe(0);
    expect(rows[0].worked).toBe(0);
    expect(rows[0].health).toBe("stable");
  });

  it("surfaces one type entry per catalog extractor on a shared resource, in catalog order, zeroing an unbuilt type", () => {
    // arable is shared by food + textiles (catalog order: food, textiles). Only food is built here —
    // textiles should still get a zeroed, stable entry so the player can see it and quick-add it.
    const rows = depositRows([deposit("arable", 5)], [extractor("food", 2, 1.5, 6)], 0, T);
    expect(rows[0].types.map((t) => t.buildingType)).toEqual(["food", "textiles"]);
    expect(rows[0].types[0]).toEqual({ buildingType: "food", built: 2, worked: 1.5, output: 6, health: "stable" });
    expect(rows[0].types[1]).toEqual({ buildingType: "textiles", built: 0, worked: 0, output: 0, health: "stable" });
  });

  it("carries exactly one type entry for a resource worked by a single catalog extractor", () => {
    const rows = depositRows([deposit("water", 3)], [extractor("water", 1, 1, 4)], 0, T);
    expect(rows[0].types).toHaveLength(1);
    expect(rows[0].types[0]).toEqual({ buildingType: "water", built: 1, worked: 1, output: 4, health: "stable" });
  });
});

describe("generalLand", () => {
  it("partitions general land and breaks out the habitable subset in units", () => {
    const space: SubstrateSpace = {
      available: 200, deposit: 80, general: 120, habitable: 70,
      depositWorked: 40, generalUsed: 78, habitableUsed: 52,
    };
    const g = generalLand(space);
    expect(g.housing).toBe(52);
    expect(g.factory).toBe(26); // 78 − 52
    expect(g.habitableFree).toBe(18); // headroom 70 − 52, capped by free 42
    expect(g.factoryFree).toBe(24); // free 42 − 18
    expect(g.habitable).toBe(70);
    expect(g.housing + g.factory + g.habitableFree + g.factoryFree).toBeCloseTo(space.general);
  });
});
