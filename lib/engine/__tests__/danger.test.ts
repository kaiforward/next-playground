import { describe, it, expect } from "vitest";
import {
  aggregateDangerLevel,
  rollCargoLoss,
  rollHazardIncidents,
  applyImportDuty,
  rollContrabandInspection,
  DANGER_CONSTANTS,
  HAZARD_CONSTANTS,
  LEGALITY_CONSTANTS,
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

// ── rollHazardIncidents ─────────────────────────────────────────

describe("rollHazardIncidents", () => {
  it("returns [] for all hazard: none cargo", () => {
    const cargo = [
      { goodId: "food", quantity: 100, hazard: "none" as const },
      { goodId: "ore", quantity: 50, hazard: "none" as const },
    ];
    expect(rollHazardIncidents(cargo, 0.3, () => 0)).toEqual([]);
  });

  it("returns [] when all rng rolls >= effective chance", () => {
    const cargo = [
      { goodId: "fuel", quantity: 100, hazard: "low" as const },
      { goodId: "weapons", quantity: 50, hazard: "high" as const },
    ];
    // At danger 0: low effective = 0.03, high effective = 0.06
    // rng = 0.99 → always >= effective chance
    expect(rollHazardIncidents(cargo, 0, () => 0.99)).toEqual([]);
  });

  it("low hazard: loss is 10-25% of that good only", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0; // incident roll for fuel (passes)
      if (call === 2) return 0.5; // loss fraction: 0.10 + 0.5 * 0.15 = 0.175
      return 0.99; // skip everything else
    };
    const cargo = [
      { goodId: "fuel", quantity: 100, hazard: "low" as const },
      { goodId: "food", quantity: 50, hazard: "none" as const },
    ];
    const result = rollHazardIncidents(cargo, 0, rng);
    // ceil(100 * 0.175) = 18
    expect(result).toEqual([
      { goodId: "fuel", hazard: "low", lost: 18, remaining: 82 },
    ]);
  });

  it("high hazard: loss is 50-100% of that good only", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0; // incident roll for weapons (passes)
      if (call === 2) return 0.5; // loss fraction: 0.50 + 0.5 * 0.50 = 0.75
      return 0.99;
    };
    const cargo = [
      { goodId: "weapons", quantity: 40, hazard: "high" as const },
    ];
    const result = rollHazardIncidents(cargo, 0, rng);
    // ceil(40 * 0.75) = 30
    expect(result).toEqual([
      { goodId: "weapons", hazard: "high", lost: 30, remaining: 10 },
    ]);
  });

  it("non-hazardous goods in same hold are never affected", () => {
    const cargo = [
      { goodId: "food", quantity: 100, hazard: "none" as const },
      { goodId: "fuel", quantity: 50, hazard: "low" as const },
      { goodId: "ore", quantity: 200, hazard: "none" as const },
    ];
    // rng always triggers incidents
    const result = rollHazardIncidents(cargo, 0, () => 0);
    // Only fuel should appear
    expect(result).toHaveLength(1);
    expect(result[0].goodId).toBe("fuel");
  });

  it("danger level compounds: higher danger = higher effective chance", () => {
    const cargo = [{ goodId: "fuel", quantity: 100, hazard: "low" as const }];
    // At danger 0: effective = 0.03, at danger 0.5: effective = 0.03 + 0.5*0.5 = 0.28
    // rng = 0.10 → at danger 0 this passes (0.10 >= 0.03), so incident
    // Actually 0.10 < 0.03 is false... let me rethink
    // rng = 0.05 → at danger 0: 0.05 >= 0.03 → no incident
    // rng = 0.05 → at danger 0.5: 0.05 >= 0.28 → no... 0.05 < 0.28 → incident!
    let call = 0;
    const rngNoIncident = () => {
      call++;
      return 0.05; // 0.05 >= 0.03 → no incident at danger 0
    };
    expect(rollHazardIncidents(cargo, 0, rngNoIncident)).toEqual([]);

    call = 0;
    const rngWithDanger = () => {
      call++;
      if (call === 1) return 0.05; // 0.05 < 0.28 → incident at danger 0.5
      return 0; // min loss
    };
    const result = rollHazardIncidents(
      [{ goodId: "fuel", quantity: 100, hazard: "low" as const }],
      0.5,
      rngWithDanger,
    );
    expect(result.length).toBe(1);
    expect(result[0].goodId).toBe("fuel");
  });

  it("at danger 0, base chance still applies (3%/6%)", () => {
    // low hazard base = 0.03 → rng 0.02 < 0.03 triggers
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0.02;
      return 0;
    };
    const cargo = [{ goodId: "fuel", quantity: 100, hazard: "low" as const }];
    const result = rollHazardIncidents(cargo, 0, rng);
    expect(result.length).toBe(1);
  });

  it("caps lost at quantity", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0; // incident
      return 1; // max loss (100% for high)
    };
    const cargo = [{ goodId: "weapons", quantity: 5, hazard: "high" as const }];
    const result = rollHazardIncidents(cargo, 0, rng);
    expect(result).toEqual([
      { goodId: "weapons", hazard: "high", lost: 5, remaining: 0 },
    ]);
  });
});

// ── applyImportDuty ─────────────────────────────────────────────

describe("applyImportDuty", () => {
  it("returns [] when taxedGoods is empty", () => {
    const cargo = [{ goodId: "fuel", quantity: 100 }];
    expect(applyImportDuty(cargo, [], 0.12)).toEqual([]);
  });

  it("returns [] when taxRate is 0", () => {
    const cargo = [{ goodId: "chemicals", quantity: 100 }];
    expect(applyImportDuty(cargo, ["chemicals"], 0)).toEqual([]);
  });

  it("returns [] when taxRate is negative", () => {
    const cargo = [{ goodId: "chemicals", quantity: 100 }];
    expect(applyImportDuty(cargo, ["chemicals"], -0.1)).toEqual([]);
  });

  it("seizes Math.ceil(quantity × taxRate) of matching goods", () => {
    const cargo = [{ goodId: "chemicals", quantity: 100 }];
    const result = applyImportDuty(cargo, ["chemicals"], 0.12);
    // ceil(100 * 0.12) = 12
    expect(result).toEqual([
      { goodId: "chemicals", seized: 12, remaining: 88 },
    ]);
  });

  it("non-taxed goods are untouched", () => {
    const cargo = [
      { goodId: "chemicals", quantity: 100 },
      { goodId: "food", quantity: 50 },
      { goodId: "weapons", quantity: 30 },
    ];
    const result = applyImportDuty(cargo, ["chemicals"], 0.12);
    expect(result).toHaveLength(1);
    expect(result[0].goodId).toBe("chemicals");
  });

  it("caps seized at quantity", () => {
    const cargo = [{ goodId: "chemicals", quantity: 1 }];
    // ceil(1 * 0.12) = 1, capped at 1
    const result = applyImportDuty(cargo, ["chemicals"], 0.12);
    expect(result).toEqual([
      { goodId: "chemicals", seized: 1, remaining: 0 },
    ]);
  });

  it("handles multiple taxed goods", () => {
    const cargo = [
      { goodId: "chemicals", quantity: 100 },
      { goodId: "fuel", quantity: 80 },
    ];
    const result = applyImportDuty(cargo, ["chemicals", "fuel"], 0.15);
    expect(result).toHaveLength(2);
    // ceil(100 * 0.15) = 15, ceil(80 * 0.15) = 12
    expect(result).toEqual([
      { goodId: "chemicals", seized: 15, remaining: 85 },
      { goodId: "fuel", seized: 12, remaining: 68 },
    ]);
  });
});

// ── rollContrabandInspection ────────────────────────────────────

describe("rollContrabandInspection", () => {
  it("returns [] when inspectionModifier is 0 (frontier)", () => {
    const cargo = [{ goodId: "weapons", quantity: 50 }];
    expect(rollContrabandInspection(cargo, ["weapons"], 0, () => 0)).toEqual([]);
  });

  it("returns [] when contrabandGoods is empty", () => {
    const cargo = [{ goodId: "weapons", quantity: 50 }];
    expect(rollContrabandInspection(cargo, [], 1.0, () => 0)).toEqual([]);
  });

  it("full confiscation on detection", () => {
    const cargo = [{ goodId: "weapons", quantity: 50 }];
    // inspectionChance = 0.25 * 1.2 = 0.3, rng = 0 < 0.3 → caught
    const result = rollContrabandInspection(cargo, ["weapons"], 1.2, () => 0);
    expect(result).toEqual([
      { goodId: "weapons", seized: 50 },
    ]);
  });

  it("returns [] when rng >= inspection chance (not caught)", () => {
    const cargo = [{ goodId: "weapons", quantity: 50 }];
    // inspectionChance = 0.25 * 1.2 = 0.3, rng = 0.5 >= 0.3 → not caught
    expect(rollContrabandInspection(cargo, ["weapons"], 1.2, () => 0.5)).toEqual([]);
  });

  it("non-contraband goods are unaffected", () => {
    const cargo = [
      { goodId: "weapons", quantity: 50 },
      { goodId: "food", quantity: 100 },
      { goodId: "fuel", quantity: 80 },
    ];
    const result = rollContrabandInspection(cargo, ["weapons"], 1.5, () => 0);
    expect(result).toHaveLength(1);
    expect(result[0].goodId).toBe("weapons");
  });

  it("modifier scales chance correctly", () => {
    const cargo = [{ goodId: "weapons", quantity: 50 }];
    // modifier 0.8 → chance = 0.25 * 0.8 = 0.20
    // rng = 0.19 < 0.20 → caught
    expect(
      rollContrabandInspection(cargo, ["weapons"], 0.8, () => 0.19),
    ).toHaveLength(1);
    // rng = 0.21 >= 0.20 → not caught
    expect(
      rollContrabandInspection(cargo, ["weapons"], 0.8, () => 0.21),
    ).toEqual([]);
  });

  it("inspects multiple contraband goods independently", () => {
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0; // weapons caught
      return 0.99; // chemicals not caught
    };
    const cargo = [
      { goodId: "weapons", quantity: 30 },
      { goodId: "chemicals", quantity: 40 },
    ];
    // inspectionChance = 0.25 * 1.5 = 0.375
    const result = rollContrabandInspection(cargo, ["weapons", "chemicals"], 1.5, rng);
    expect(result).toEqual([
      { goodId: "weapons", seized: 30 },
    ]);
  });

  it("returns [] when inspectionModifier is negative", () => {
    const cargo = [{ goodId: "weapons", quantity: 50 }];
    expect(rollContrabandInspection(cargo, ["weapons"], -0.5, () => 0)).toEqual([]);
  });
});
