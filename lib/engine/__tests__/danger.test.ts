import { describe, it, expect } from "vitest";
import {
  aggregateDangerLevel,
  rollCargoLoss,
  DANGER_CONSTANTS,
} from "../danger";
import type { ModifierRow } from "../events";

// ── Helpers ─────────────────────────────────────────────────────

function makeDangerMod(value: number, overrides: Partial<ModifierRow> = {}): ModifierRow {
  return {
    domain: "navigation",
    type: "equilibrium_shift",
    targetType: "system",
    targetId: "sys-1",
    goodId: null,
    parameter: "danger_level",
    value,
    ...overrides,
  };
}

function makeEconomyMod(overrides: Partial<ModifierRow> = {}): ModifierRow {
  return {
    domain: "economy",
    type: "equilibrium_shift",
    targetType: "system",
    targetId: "sys-1",
    goodId: "fuel",
    parameter: "demand_target",
    value: 30,
    ...overrides,
  };
}

// ── aggregateDangerLevel ────────────────────────────────────────

describe("aggregateDangerLevel", () => {
  it("returns 0 when no modifiers", () => {
    expect(aggregateDangerLevel([])).toBe(0);
  });

  it("returns 0 when no danger_level modifiers (only economy modifiers)", () => {
    const mods = [makeEconomyMod(), makeEconomyMod({ parameter: "supply_target" })];
    expect(aggregateDangerLevel(mods)).toBe(0);
  });

  it("returns the value of a single danger modifier", () => {
    expect(aggregateDangerLevel([makeDangerMod(0.15)])).toBe(0.15);
  });

  it("sums multiple danger_level values", () => {
    const mods = [makeDangerMod(0.15), makeDangerMod(0.05), makeDangerMod(0.1)];
    expect(aggregateDangerLevel(mods)).toBeCloseTo(0.3);
  });

  it("caps at maxDanger (default 0.5)", () => {
    const mods = [makeDangerMod(0.3), makeDangerMod(0.3)];
    expect(aggregateDangerLevel(mods)).toBe(DANGER_CONSTANTS.MAX_DANGER);
  });

  it("accepts custom maxDanger cap", () => {
    const mods = [makeDangerMod(0.3), makeDangerMod(0.3)];
    expect(aggregateDangerLevel(mods, 0.8)).toBeCloseTo(0.6);
  });

  it("ignores modifiers with non-danger parameters", () => {
    const mods = [
      makeDangerMod(0.1),
      makeDangerMod(0, { parameter: "production_rate", value: 0.5 }),
      makeEconomyMod(),
    ];
    expect(aggregateDangerLevel(mods)).toBeCloseTo(0.1);
  });
});

// ── rollCargoLoss ───────────────────────────────────────────────

describe("rollCargoLoss", () => {
  const cargo = [
    { goodId: "fuel", quantity: 100 },
    { goodId: "food", quantity: 50 },
  ];

  it("returns empty when danger is 0", () => {
    expect(rollCargoLoss(0, cargo, () => 0)).toEqual([]);
  });

  it("returns empty when danger is negative", () => {
    expect(rollCargoLoss(-0.1, cargo, () => 0)).toEqual([]);
  });

  it("returns empty when cargo is empty", () => {
    expect(rollCargoLoss(0.5, [], () => 0)).toEqual([]);
  });

  it("returns empty when rng roll >= danger (no loss)", () => {
    // danger = 0.3, rng returns 0.5 (>= 0.3) → no loss
    expect(rollCargoLoss(0.3, cargo, () => 0.5)).toEqual([]);
  });

  it("returns empty when rng roll equals danger exactly", () => {
    // rng() >= danger → no loss
    expect(rollCargoLoss(0.3, cargo, () => 0.3)).toEqual([]);
  });

  it("returns losses when rng roll < danger", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0.1; // danger roll: 0.1 < 0.3 → loss occurs
      return 0.5; // loss fraction: 0.2 + 0.5 * 0.2 = 0.3
    };
    const result = rollCargoLoss(0.3, cargo, rng);
    expect(result.length).toBeGreaterThan(0);
  });

  it("loss fraction is 20-40% of each item", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0; // danger roll: always lose
      return 0.5; // loss fraction: 0.2 + 0.5 * 0.2 = 0.3 (30%)
    };
    const result = rollCargoLoss(0.5, cargo, rng);
    // fraction ≈ 0.3 (floating-point: 0.30000000000000004)
    // fuel: ceil(100 * 0.3...) = 31, food: ceil(50 * 0.3...) = 16
    expect(result).toEqual([
      { goodId: "fuel", lost: 31, remaining: 69 },
      { goodId: "food", lost: 16, remaining: 34 },
    ]);
  });

  it("minimum loss fraction is 20% (rng=0 for fraction)", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0; // danger roll
      return 0; // fraction roll → MIN_LOSS_FRACTION = 0.2
    };
    const result = rollCargoLoss(0.5, cargo, rng);
    // fuel: ceil(100 * 0.2) = 20, food: ceil(50 * 0.2) = 10
    expect(result).toEqual([
      { goodId: "fuel", lost: 20, remaining: 80 },
      { goodId: "food", lost: 10, remaining: 40 },
    ]);
  });

  it("maximum loss fraction is 40% (rng=1 for fraction)", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0; // danger roll
      return 1; // fraction roll → MAX_LOSS_FRACTION = 0.4
    };
    const result = rollCargoLoss(0.5, cargo, rng);
    // fuel: ceil(100 * 0.4) = 40, food: ceil(50 * 0.4) = 20
    expect(result).toEqual([
      { goodId: "fuel", lost: 40, remaining: 60 },
      { goodId: "food", lost: 20, remaining: 30 },
    ]);
  });

  it("caps lost quantity to item quantity (no negative remaining)", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0;
      return 1; // 40% loss
    };
    const smallCargo = [{ goodId: "fuel", quantity: 1 }];
    const result = rollCargoLoss(0.5, smallCargo, rng);
    // ceil(1 * 0.4) = 1, capped at quantity 1
    expect(result).toEqual([
      { goodId: "fuel", lost: 1, remaining: 0 },
    ]);
  });

  it("returns entries for all cargo items (each item affected)", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0;
      return 0.5;
    };
    const threeCargo = [
      { goodId: "fuel", quantity: 100 },
      { goodId: "food", quantity: 50 },
      { goodId: "ore", quantity: 200 },
    ];
    const result = rollCargoLoss(0.5, threeCargo, rng);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.goodId)).toEqual(["fuel", "food", "ore"]);
  });

  it("rounds up with Math.ceil (always lose at least 1 unit if loss occurs)", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0;
      return 0; // 20% fraction
    };
    const tinyCargo = [{ goodId: "fuel", quantity: 3 }];
    const result = rollCargoLoss(0.5, tinyCargo, rng);
    // ceil(3 * 0.2) = ceil(0.6) = 1
    expect(result).toEqual([
      { goodId: "fuel", lost: 1, remaining: 2 },
    ]);
  });
});
