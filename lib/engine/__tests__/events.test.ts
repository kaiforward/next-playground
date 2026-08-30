import { describe, it, expect } from "vitest";
import {
  checkPhaseTransition,
  buildModifiersForPhase,
  aggregateModifiers,
  rollPhaseDuration,
  type EventSnapshot,
  type ModifierRow,
} from "../events";
import { MODIFIER_CAPS, type EventDefinition } from "@/lib/constants/events";

type ModifierCaps = typeof MODIFIER_CAPS;

// ── Helpers ─────────────────────────────────────────────────────

const defaultCaps: ModifierCaps = {
  minAnchorMult: 0.1,
  maxAnchorMult: 4.0,
  minMultiplier: 0.1,
  maxMultiplier: 3.0,
};

function makeDefinition(
  overrides: Partial<EventDefinition> = {},
): EventDefinition {
  return {
    type: "border_conflict",
    name: "Test Event",
    description: "A test event",
    phases: [
      {
        name: "phase_one",
        displayName: "Phase One",
        durationRange: [10, 20],
        modifiers: [
          {
            domain: "economy",
            type: "anchor_shift",
            target: "system",
            goodId: "fuel",
            parameter: "target_stock",
            value: 1.5,
          },
        ],
      },
      {
        name: "phase_two",
        displayName: "Phase Two",
        durationRange: [20, 40],
        modifiers: [
          {
            domain: "economy",
            type: "rate_multiplier",
            target: "system",
            goodId: null,
            parameter: "production_rate",
            value: 0.5,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<EventSnapshot> = {},
): EventSnapshot {
  return {
    id: "evt-1",
    type: "border_conflict",
    phase: "phase_one",
    systemId: "sys-1",
    regionId: "reg-1",
    startTick: 100,
    phaseStartTick: 100,
    phaseDuration: 15,
    severity: 1.0,
    sourceEventId: null,
    ...overrides,
  };
}

// ── checkPhaseTransition ────────────────────────────────────────

describe("checkPhaseTransition", () => {
  const def = makeDefinition();

  it("returns 'none' when phase duration has not elapsed", () => {
    const snap = makeSnapshot({ phaseStartTick: 100, phaseDuration: 15 });
    expect(checkPhaseTransition(snap, 110, def)).toBe("none");
  });

  it("returns 'advance' when phase duration elapsed and more phases exist", () => {
    const snap = makeSnapshot({ phase: "phase_one", phaseStartTick: 100, phaseDuration: 15 });
    expect(checkPhaseTransition(snap, 115, def)).toBe("advance");
  });

  it("returns 'advance' when well past phase duration", () => {
    const snap = makeSnapshot({ phase: "phase_one", phaseStartTick: 100, phaseDuration: 15 });
    expect(checkPhaseTransition(snap, 200, def)).toBe("advance");
  });

  it("returns 'expire' when on the last phase and duration elapsed", () => {
    const snap = makeSnapshot({ phase: "phase_two", phaseStartTick: 100, phaseDuration: 30 });
    expect(checkPhaseTransition(snap, 130, def)).toBe("expire");
  });

  it("returns 'expire' for unknown phase", () => {
    const snap = makeSnapshot({ phase: "unknown_phase" });
    expect(checkPhaseTransition(snap, 200, def)).toBe("expire");
  });

  it("returns 'none' exactly at boundary minus one", () => {
    const snap = makeSnapshot({ phaseStartTick: 100, phaseDuration: 15 });
    expect(checkPhaseTransition(snap, 114, def)).toBe("none");
  });
});

// ── buildModifiersForPhase ──────────────────────────────────────

describe("buildModifiersForPhase", () => {
  const def = makeDefinition();

  it("builds modifier rows with system target resolved", () => {
    const rows = buildModifiersForPhase(def.phases[0], "sys-1", "reg-1", 1.0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      domain: "economy",
      type: "anchor_shift",
      targetType: "system",
      targetId: "sys-1",
      goodId: "fuel",
      parameter: "target_stock",
      value: 1.5,
    });
  });

  it("resolves region target correctly", () => {
    const regionPhase = {
      name: "test",
      displayName: "Test",
      durationRange: [10, 20] satisfies [number, number],
      modifiers: [{
        domain: "economy" as const,
        type: "anchor_shift" as const,
        target: "region" as const,
        goodId: "ore",
        parameter: "target_stock",
        value: 2.0,
      }],
    };
    const rows = buildModifiersForPhase(regionPhase, "sys-1", "reg-1", 1.0);
    expect(rows[0].targetType).toBe("region");
    expect(rows[0].targetId).toBe("reg-1");
  });

  it("scales anchor_shift values by lerping toward 1.0", () => {
    const rows = buildModifiersForPhase(def.phases[0], "sys-1", "reg-1", 0.5);
    // value = 1.5, severity = 0.5 → 1 + (1.5 - 1) × 0.5 = 1.25
    expect(rows[0].value).toBe(1.25);
  });

  it("scales rate_multiplier values by lerping toward 1.0", () => {
    const rows = buildModifiersForPhase(def.phases[1], "sys-1", "reg-1", 0.5);
    // value = 0.5, severity = 0.5 → 1 + (0.5 - 1) × 0.5 = 0.75
    expect(rows[0].value).toBe(0.75);
  });

  it("returns full severity at 1.0 (anchor_shift)", () => {
    const rows = buildModifiersForPhase(def.phases[0], "sys-1", "reg-1", 1.0);
    expect(rows[0].value).toBe(1.5);
  });

  it("returns full severity at 1.0 (rate_multiplier)", () => {
    const rows = buildModifiersForPhase(def.phases[1], "sys-1", "reg-1", 1.0);
    expect(rows[0].value).toBe(0.5);
  });

  it("returns neutral values at severity 0", () => {
    const shiftRows = buildModifiersForPhase(def.phases[0], "sys-1", "reg-1", 0);
    expect(shiftRows[0].value).toBe(1.0); // anchor_shift lerps to 1.0

    const multRows = buildModifiersForPhase(def.phases[1], "sys-1", "reg-1", 0);
    expect(multRows[0].value).toBe(1.0); // rate_multiplier lerps to 1.0
  });

  it("sets null goodId when template has null", () => {
    const rows = buildModifiersForPhase(def.phases[1], "sys-1", "reg-1", 1.0);
    expect(rows[0].goodId).toBeNull();
  });
});

// ── aggregateModifiers ──────────────────────────────────────────

describe("aggregateModifiers", () => {
  it("returns defaults when no modifiers match", () => {
    const result = aggregateModifiers([], "fuel", defaultCaps);
    expect(result).toEqual({
      anchorMult: 1,
      productionMult: 1,
      consumptionMult: 1,
    });
  });

  it("compounds anchor shifts for matching good", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 1.5 },
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 1.4 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBeCloseTo(2.1); // 1.5 × 1.4
  });

  it("includes null-goodId anchor shifts (apply to all goods)", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: null, parameter: "target_stock", value: 1.3 },
    ];
    const result = aggregateModifiers(mods, "luxuries", defaultCaps);
    expect(result.anchorMult).toBeCloseTo(1.3);
  });

  it("compounds null-goodId and per-good anchor shifts together", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: null, parameter: "target_stock", value: 1.67 },
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "weapons", parameter: "target_stock", value: 2.0 },
    ];
    const result = aggregateModifiers(mods, "weapons", defaultCaps);
    expect(result.anchorMult).toBeCloseTo(3.34); // 1.67 × 2.0
  });

  it("excludes anchor shifts for a different good", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "ore", parameter: "target_stock", value: 2.0 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBe(1);
  });

  it("multiplies rate multipliers", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "production_rate", value: 0.5 },
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "production_rate", value: 0.8 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.productionMult).toBeCloseTo(0.4); // 0.5 × 0.8
  });

  it("multiplies consumption-rate modifiers into consumptionMult, independent of productionMult", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "consumption_rate", value: 0.5 },
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "consumption_rate", value: 0.8 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.consumptionMult).toBeCloseTo(0.4); // 0.5 × 0.8
    expect(result.productionMult).toBe(1); // the other rate arm is untouched
  });

  it("caps anchor to maxAnchorMult", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 3.0 },
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 2.0 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBe(4.0); // 6.0 capped at maxAnchorMult
  });

  it("caps anchor to minAnchorMult", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 0.05 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBe(0.1); // capped at minAnchorMult
  });

  it("caps rate multiplier to minMultiplier", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "production_rate", value: 0.05 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.productionMult).toBe(0.1);
  });

  it("handles combined modifiers from multiple events", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "target_stock", value: 1.8 },
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "production_rate", value: 0.4 },
      { domain: "economy", type: "anchor_shift", targetType: "system", targetId: "sys-1", goodId: null, parameter: "target_stock", value: 1.2 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.anchorMult).toBeCloseTo(2.16); // 1.8 × 1.2
    expect(result.productionMult).toBe(0.4);
  });
});

// ── rollPhaseDuration ───────────────────────────────────────────

describe("rollPhaseDuration", () => {
  it("returns min at rng=0", () => {
    expect(rollPhaseDuration([10, 20], () => 0)).toBe(10);
  });

  it("returns max at rng just below 1", () => {
    const result = rollPhaseDuration([10, 20], () => 0.999);
    expect(result).toBeLessThanOrEqual(20);
    expect(result).toBeGreaterThanOrEqual(10);
  });

  it("returns values within range", () => {
    for (let i = 0; i < 20; i++) {
      const r = rollPhaseDuration([30, 60], () => i / 20);
      expect(r).toBeGreaterThanOrEqual(30);
      expect(r).toBeLessThanOrEqual(60);
    }
  });

  it("works with single-value range", () => {
    expect(rollPhaseDuration([15, 15], () => 0.5)).toBe(15);
  });
});
