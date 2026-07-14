import { describe, it, expect } from "vitest";
import { chipStates, depositChipRows, generalLandSegments } from "../industry-chips";
import type { SystemDepositSummary, SystemIndustryReadout, SubstrateSpace } from "@/lib/engine/industry";

/** Compact chip-kind signature for readable assertions. */
const kinds = (cap: number, built: number, effective: number, addChip = false) =>
  chipStates(cap, built, effective, addChip).map((c) => c.kind);

describe("chipStates — four-state chip grammar", () => {
  it("fills every built slot when fully worked", () => {
    const chips = chipStates(4, 4, 4);
    expect(chips).toHaveLength(4);
    expect(chips.every((c) => c.kind === "staffed" && c.fill === 1)).toBe(true);
  });

  it("waterfalls a fractional working level across built slots", () => {
    const chips = chipStates(4, 4, 2.5);
    expect(chips.map((c) => c.kind)).toEqual(["staffed", "staffed", "staffed", "idle"]);
    expect(chips.map((c) => c.fill)).toEqual([1, 1, 0.5, 0]);
  });

  it("marks unbuilt slots dashed after the built ones", () => {
    expect(kinds(6, 4, 3)).toEqual(["staffed", "staffed", "staffed", "idle", "unbuilt", "unbuilt"]);
  });

  it("reds a built slot that receives no working", () => {
    expect(kinds(3, 3, 0)).toEqual(["idle", "idle", "idle"]);
  });

  it("appends a trailing room-to-build chip for unbounded pools", () => {
    expect(kinds(2, 2, 2, true)).toEqual(["staffed", "staffed", "unbuilt"]);
  });

  it("rounds a fractional structure up to one chip", () => {
    // A partial specialisation complex (count 0.7) still shows one built chip.
    expect(kinds(0.7, 0.7, 0.7)).toEqual(["staffed"]);
  });

  it("returns no chips for an empty pool", () => {
    expect(chipStates(0, 0, 0)).toEqual([]);
  });
});

describe("depositChipRows — per-resource aggregation", () => {
  const deposit = (resource: SystemDepositSummary["resource"], slotCap: number, worked: number): SystemDepositSummary => ({
    resource,
    slotCap,
    worked,
    yieldMult: 1,
    band: "average",
  });
  const extractor = (buildingType: string, used: number, output: number): SystemIndustryReadout["buildings"][number] => ({
    buildingType,
    outputGood: buildingType,
    tier: 0,
    count: 0,
    used,
    staffedFraction: 1,
    output,
  });

  it("sums working + output of goods sharing a resource onto one row", () => {
    // food + textiles both extract arable.
    const rows = depositChipRows(
      [deposit("arable", 5, 4)],
      [extractor("food", 2.5, 9), extractor("textiles", 1.0, 3)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].built).toBe(4);
    expect(rows[0].worked).toBeCloseTo(3.5);
    expect(rows[0].output).toBeCloseTo(12);
    // 4 built (3.5 worked → 3 full + 1 partial), 1 unbuilt slot.
    expect(rows[0].chips.map((c) => c.kind)).toEqual(["staffed", "staffed", "staffed", "staffed", "unbuilt"]);
  });

  it("drops resources with no slots and yields a zero-worked row when unmanned", () => {
    const rows = depositChipRows([deposit("ore", 0, 0), deposit("water", 3, 2)], []);
    expect(rows.map((r) => r.resource)).toEqual(["water"]);
    expect(rows[0].worked).toBe(0);
    expect(rows[0].chips.map((c) => c.kind)).toEqual(["idle", "idle", "unbuilt"]);
  });
});

describe("generalLandSegments", () => {
  it("splits housing / factory / free and normalises to total general land", () => {
    const space: SubstrateSpace = {
      available: 200, deposit: 80, general: 120, habitable: 70,
      depositWorked: 40, generalUsed: 78, habitableUsed: 52,
    };
    const segs = generalLandSegments(space);
    expect(segs.map((s) => [s.key, s.value])).toEqual([
      ["housing", 52], ["factory", 26], ["free", 42],
    ]);
    expect(segs.reduce((sum, s) => sum + s.fraction, 0)).toBeCloseTo(1);
  });
});
