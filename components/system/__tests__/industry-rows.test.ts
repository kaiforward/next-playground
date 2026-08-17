import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { depositRows, depositRowProblems, depositTypeProblems, generalLand, staffedLevels } from "../industry-rows";
import type { DepositTypeRow } from "../industry-rows";
import { BUILDING_TYPES } from "@/lib/constants/industry";
import type { SystemDepositSummary, SystemIndustryReadout, SubstrateSpace, IdleReason } from "@/lib/engine/industry";

const T = 0.75;
/** `buildProblems`'s `inputLabel` — identity is enough for these fixtures. */
const label = (id: string) => id;

const deposit = (resource: SystemDepositSummary["resource"], slotCap: number): SystemDepositSummary => ({
  resource,
  slotCap,
  worked: 0,
  yieldMult: 1,
  band: "average",
});
const extractor = (
  buildingType: string,
  count: number,
  used: number,
  output: number,
  staffedFraction: number = count > 0 ? used / count : 0,
  idleReason?: IdleReason,
): SystemIndustryReadout["buildings"][number] => ({
  buildingType,
  outputGood: buildingType,
  tier: 0,
  count,
  used,
  staffedFraction,
  output,
  idleReason,
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
    expect(rows[0].staffed).toBeCloseTo(1.9);
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
    expect(rows[0].staffed).toBe(0);
    expect(rows[0].health).toBe("stable");
  });

  it("surfaces one type entry per catalog extractor on a shared resource, in catalog order, zeroing an unbuilt type", () => {
    // arable is shared by food + textiles (catalog order: food, textiles). Only food is built here —
    // textiles should still get a zeroed, stable entry so the player can see it and quick-add it.
    const rows = depositRows([deposit("arable", 5)], [extractor("food", 2, 1.5, 6)], 0, T);
    expect(rows[0].types.map((t) => t.buildingType)).toEqual(["food", "textiles"]);
    expect(rows[0].types[0]).toEqual({ buildingType: "food", outputGood: "food", built: 2, staffed: 1.5, output: 6, health: "stable", staffedFraction: 0.75, idleReason: undefined });
    expect(rows[0].types[1]).toEqual({ buildingType: "textiles", outputGood: "textiles", built: 0, staffed: 0, output: 0, health: "stable", staffedFraction: 0, idleReason: undefined });
  });

  it("carries exactly one type entry for a resource worked by a single catalog extractor", () => {
    const rows = depositRows([deposit("water", 3)], [extractor("water", 1, 1, 4)], 0, T);
    expect(rows[0].types).toHaveLength(1);
    expect(rows[0].types[0]).toEqual({ buildingType: "water", outputGood: "water", built: 1, staffed: 1, output: 4, health: "stable", staffedFraction: 1, idleReason: undefined });
  });

  it("staffed is staffed capacity (staffedFraction × count), not the staffed-and-selling `used` figure — a glutting extractor still shows its full labour", () => {
    // Fully staffed (staffedFraction 1, ×2 count → 2.0) but only half `used` because the good can't
    // sell (glut). staffed must read 2.0 — reading `used` here would give 1.0, the pre-rename value.
    const rows = depositRows([deposit("water", 3)], [extractor("water", 2, 1, 3, 1)], 0, T);
    expect(rows[0].staffed).toBe(2);
    expect(rows[0].types[0].staffed).toBe(2);
  });

  it("health still tracks `used`, not the new `staffed` figure — a glutting extractor with a whole idle level still contracts", () => {
    // staffedFraction 1 (fully staffed, ×2 → staffed 2.0) but used 1.0 → a whole idle level
    // (floor(2 - 1) = 1) sheds under the decay engine's own rule — health must reflect that, not the
    // fully-staffed `staffed` figure.
    const rows = depositRows([deposit("water", 3)], [extractor("water", 2, 1, 3, 1)], 0, T);
    expect(rows[0].staffed).toBe(2);
    expect(rows[0].health).toBe("contracting");
  });
});

/**
 * Every catalog type today has `id === outputGood`, so no shipped fixture can tell a row keyed by
 * building type from one keyed by output good — the `*_mk2` case the catalog is explicitly designed
 * for (`lib/constants/industry.ts`: "`buildingType → outputGood` is many-to-one so `*_mk2` types are
 * a pure data addition") is the only fixture that separates them, so it is registered here.
 */
describe("depositRows — outputGood on a many-to-one catalog", () => {
  beforeAll(() => {
    BUILDING_TYPES.food_mk2 = { ...BUILDING_TYPES.food, outputGood: "food" };
  });
  afterAll(() => {
    delete BUILDING_TYPES.food_mk2;
  });

  it("a built type carries the good it produces, not its own type id", () => {
    // The BuildingEntry fixture deliberately claims outputGood "food_mk2" (see `extractor`), so a row
    // that echoed the readout entry — or the type id — would read "food_mk2" and fail here.
    const rows = depositRows([deposit("arable", 5)], [extractor("food_mk2", 2, 2, 9)], 0, T);
    const mk2 = rows[0].types.find((t) => t.buildingType === "food_mk2")!;
    expect(mk2.outputGood).toBe("food");
  });

  it("an unbuilt type carries it too — the zeroed catalog entry is the row a player quick-adds from", () => {
    const rows = depositRows([deposit("arable", 5)], [extractor("food", 1, 1, 4)], 0, T);
    const mk2 = rows[0].types.find((t) => t.buildingType === "food_mk2")!;
    expect(mk2.built).toBe(0);
    expect(mk2.outputGood).toBe("food");
  });
});

describe("depositTypeProblems", () => {
  it("a fully staffed but selling-throttled extractor surfaces Glut — the load-bearing case DepositTable must not stay silent on", () => {
    // Full end-to-end pipeline: depositRows threads staffedFraction/idleReason off the BuildingEntry
    // onto DepositTypeRow, and depositTypeProblems turns that into the same chip BuildingRow would show.
    const rows = depositRows([deposit("water", 3)], [extractor("water", 2, 1, 3, 1, "selling")], 0, T);
    expect(depositTypeProblems(rows[0].types[0], undefined, label)).toEqual([{ kind: "selling", label: "Glut", severity: "short" }]);
  });

  it("an understaffed extractor names Unskilled — extractors carry no skilled labour, so 'labour' is the only understaffed idleReason", () => {
    const rows = depositRows([deposit("ore", 5)], [extractor("ore", 3, 1.2, 1, 0.4, "labour")], 0, T);
    expect(depositTypeProblems(rows[0].types[0], undefined, label)).toEqual([{ kind: "staffing", label: "Unskilled understaffed 40%", severity: "critical" }]);
  });

  it("a built extractor's own pop shortage surfaces — tier-0 goods are directly consumed, same as any producer's output", () => {
    const rows = depositRows([deposit("water", 3)], [extractor("water", 2, 2, 3, 1)], 0, T);
    expect(depositTypeProblems(rows[0].types[0], { satisfaction: 0.5 }, label)).toEqual([{ kind: "pops", label: "pops short 50%", severity: "short" }]);
  });

  it("an unbuilt catalog entry (built 0) never surfaces a chip, even when its staffing figures alone would read as a problem", () => {
    // Adversarial fixture: depositRows' own zero-default always pairs built:0 with idleReason
    // undefined, so this fixture sets idleReason explicitly to exercise the `built <= 0` guard
    // itself, not rely on idleReason being absent to suppress the chip.
    const t: DepositTypeRow = { buildingType: "ore", built: 0, staffed: 0, output: 0, health: "stable", staffedFraction: 1, idleReason: "selling" };
    expect(depositTypeProblems(t, undefined, label)).toEqual([]);
  });
});

describe("depositRowProblems", () => {
  it("a single-type deposit's parent row carries that type's own chip verbatim", () => {
    const rows = depositRows([deposit("water", 3)], [extractor("water", 2, 1, 3, 1, "selling")], 0, T);
    expect(depositRowProblems(rows[0], undefined, label)).toEqual([{ kind: "selling", label: "Glut", severity: "short" }]);
  });

  it("a multi-type deposit's parent row shows nothing even when the FIRST catalog type is glutting — misattributing food's Glut to the shared arable row would be the lie this rule avoids", () => {
    // food is glutting, textiles is healthy, and food sorts first in catalog order (the existing
    // "surfaces one type entry... in catalog order" test pins ["food", "textiles"]) — deliberately so
    // that a rule which fell through to `row.types[0]` on a multi-type row (instead of returning [])
    // would surface food's own Glut chip here and fail this assertion, not stay accidentally green.
    const rows = depositRows(
      [deposit("arable", 5)],
      [extractor("food", 2, 1, 3, 1, "selling"), extractor("textiles", 1, 1, 4, 1, undefined)],
      0,
      T,
    );
    expect(rows[0].types.map((t) => t.buildingType)).toEqual(["food", "textiles"]);
    expect(depositRowProblems(rows[0], undefined, label)).toEqual([]);
    // The food sub-row still carries its own, correctly-attributed chip; the healthy textiles sub-row carries none.
    expect(depositTypeProblems(rows[0].types[0], undefined, label)).toEqual([{ kind: "selling", label: "Glut", severity: "short" }]);
    expect(depositTypeProblems(rows[0].types[1], undefined, label)).toEqual([]);
  });
});

describe("staffedLevels", () => {
  it("housing (tier -1) reads `used` — the vacancy-protected figure — not staffedFraction × count, which is bare occupancy and can overshoot count", () => {
    // Overcrowded system: bare occupancy (staffedFraction 1.24) sits above 1, so staffedFraction ×
    // count (6.2) would overshoot `count` (5); `used` (4.8, vacancy-capped) is what belongs on screen.
    const housing: Parameters<typeof staffedLevels>[0] = { tier: -1, used: 4.8, staffedFraction: 1.24, count: 5 };
    expect(staffedLevels(housing)).toBe(4.8);
  });

  it("a producer/extractor (tier >= 0) reads staffedFraction × count — pure labour, not the staffed-and-selling `used`", () => {
    // Fully staffed (staffedFraction 1) but glutting: `used` (1) is throttled by the selling
    // ceiling; staffedFraction × count (2) is the labour figure that belongs on screen.
    const producer: Parameters<typeof staffedLevels>[0] = { tier: 0, used: 1, staffedFraction: 1, count: 2 };
    expect(staffedLevels(producer)).toBe(2);
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
