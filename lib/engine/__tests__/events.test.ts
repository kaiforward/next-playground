import { describe, it, expect } from "vitest";
import {
  checkPhaseTransition,
  buildModifiersForPhase,
  buildShocksForPhase,
  evaluateSpreadTargets,
  aggregateModifiers,
  selectEventToSpawn,
  rollPhaseDuration,
  type EventSnapshot,
  type SystemSnapshot,
  type NeighborSnapshot,
  type ModifierRow,
} from "../events";
import { MODIFIER_CAPS, type EventDefinition, type EventPhaseDefinition, type SpreadRule } from "@/lib/constants/events";

type ModifierCaps = typeof MODIFIER_CAPS;

// ── Helpers ─────────────────────────────────────────────────────

const defaultCaps: ModifierCaps = {
  maxShift: 100,
  minMultiplier: 0.1,
  maxMultiplier: 3.0,
  minReversionMult: 0.2,
};

function makeDefinition(
  overrides: Partial<EventDefinition> = {},
): EventDefinition {
  return {
    type: "war",
    name: "Test Event",
    description: "A test event",
    cooldown: 50,
    maxActive: 5,
    weight: 10,
    phases: [
      {
        name: "phase_one",
        displayName: "Phase One",
        durationRange: [10, 20],
        modifiers: [
          {
            domain: "economy",
            type: "equilibrium_shift",
            target: "system",
            goodId: "fuel",
            parameter: "demand_target",
            value: 30,
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
    type: "war",
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
      type: "equilibrium_shift",
      targetType: "system",
      targetId: "sys-1",
      goodId: "fuel",
      parameter: "demand_target",
      value: 30,
    });
  });

  it("resolves region target correctly", () => {
    const regionPhase = {
      name: "test",
      displayName: "Test",
      durationRange: [10, 20] satisfies [number, number],
      modifiers: [{
        domain: "economy" as const,
        type: "equilibrium_shift" as const,
        target: "region" as const,
        goodId: "ore",
        parameter: "supply_target",
        value: 20,
      }],
    };
    const rows = buildModifiersForPhase(regionPhase, "sys-1", "reg-1", 1.0);
    expect(rows[0].targetType).toBe("region");
    expect(rows[0].targetId).toBe("reg-1");
  });

  it("scales shift values linearly with severity", () => {
    const rows = buildModifiersForPhase(def.phases[0], "sys-1", "reg-1", 0.5);
    expect(rows[0].value).toBe(15); // 30 × 0.5
  });

  it("scales multiplier values by lerping toward 1.0", () => {
    const rows = buildModifiersForPhase(def.phases[1], "sys-1", "reg-1", 0.5);
    // value = 0.5, severity = 0.5 → 1 + (0.5 - 1) × 0.5 = 1 - 0.25 = 0.75
    expect(rows[0].value).toBe(0.75);
  });

  it("returns full severity at 1.0 (shift)", () => {
    const rows = buildModifiersForPhase(def.phases[0], "sys-1", "reg-1", 1.0);
    expect(rows[0].value).toBe(30);
  });

  it("returns full severity at 1.0 (multiplier)", () => {
    const rows = buildModifiersForPhase(def.phases[1], "sys-1", "reg-1", 1.0);
    expect(rows[0].value).toBe(0.5);
  });

  it("returns neutral values at severity 0", () => {
    const shiftRows = buildModifiersForPhase(def.phases[0], "sys-1", "reg-1", 0);
    expect(shiftRows[0].value).toBe(0); // shift: 30 × 0 = 0

    const multRows = buildModifiersForPhase(def.phases[1], "sys-1", "reg-1", 0);
    expect(multRows[0].value).toBe(1.0); // multiplier lerps to 1.0
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
      supplyTargetShift: 0,
      demandTargetShift: 0,
      productionMult: 1,
      consumptionMult: 1,
      reversionMult: 1,
    });
  });

  it("sums equilibrium shifts for matching good", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "equilibrium_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "demand_target", value: 30 },
      { domain: "economy", type: "equilibrium_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "demand_target", value: 20 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.demandTargetShift).toBe(50);
  });

  it("includes null-goodId modifiers (applies to all goods)", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "equilibrium_shift", targetType: "system", targetId: "sys-1", goodId: null, parameter: "demand_target", value: 15 },
    ];
    const result = aggregateModifiers(mods, "luxuries", defaultCaps);
    expect(result.demandTargetShift).toBe(15);
  });

  it("excludes modifiers for a different good", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "equilibrium_shift", targetType: "system", targetId: "sys-1", goodId: "ore", parameter: "demand_target", value: 40 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.demandTargetShift).toBe(0);
  });

  it("multiplies rate multipliers", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "production_rate", value: 0.5 },
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "production_rate", value: 0.8 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.productionMult).toBeCloseTo(0.4); // 0.5 × 0.8
  });

  it("takes min for reversion dampening", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "reversion_dampening", targetType: "system", targetId: "sys-1", goodId: null, parameter: "reversion_rate", value: 0.7 },
      { domain: "economy", type: "reversion_dampening", targetType: "system", targetId: "sys-1", goodId: null, parameter: "reversion_rate", value: 0.5 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.reversionMult).toBe(0.5);
  });

  it("caps shift to maxShift", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "equilibrium_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "demand_target", value: 80 },
      { domain: "economy", type: "equilibrium_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "demand_target", value: 60 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.demandTargetShift).toBe(100); // capped at maxShift
  });

  it("caps negative shift to -maxShift", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "equilibrium_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "supply_target", value: -120 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.supplyTargetShift).toBe(-100);
  });

  it("caps multiplier to minMultiplier", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "production_rate", value: 0.05 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.productionMult).toBe(0.1);
  });

  it("caps reversion mult to minReversionMult", () => {
    const mods: ModifierRow[] = [
      { domain: "economy", type: "reversion_dampening", targetType: "system", targetId: "sys-1", goodId: null, parameter: "reversion_rate", value: 0.1 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.reversionMult).toBe(0.2);
  });

  it("handles combined modifiers from multiple events", () => {
    const mods: ModifierRow[] = [
      // War: demand shift on fuel
      { domain: "economy", type: "equilibrium_shift", targetType: "system", targetId: "sys-1", goodId: "fuel", parameter: "demand_target", value: 80 },
      // War: production halved
      { domain: "economy", type: "rate_multiplier", targetType: "system", targetId: "sys-1", goodId: null, parameter: "production_rate", value: 0.4 },
      // War: reversion dampened
      { domain: "economy", type: "reversion_dampening", targetType: "system", targetId: "sys-1", goodId: null, parameter: "reversion_rate", value: 0.5 },
      // Festival: all demand up
      { domain: "economy", type: "equilibrium_shift", targetType: "system", targetId: "sys-1", goodId: null, parameter: "demand_target", value: 15 },
    ];
    const result = aggregateModifiers(mods, "fuel", defaultCaps);
    expect(result.demandTargetShift).toBe(95); // 80 + 15
    expect(result.productionMult).toBe(0.4);
    expect(result.reversionMult).toBe(0.5);
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

// ── selectEventToSpawn ──────────────────────────────────────────

describe("selectEventToSpawn", () => {
  const defs: Record<string, EventDefinition> = {
    war: makeDefinition(),
  };

  const systems: SystemSnapshot[] = [
    { id: "sys-1", economyType: "extraction", regionId: "reg-1" },
    { id: "sys-2", economyType: "agricultural", regionId: "reg-1" },
    { id: "sys-3", economyType: "core", regionId: "reg-2" },
  ];

  const defaultCapsSpawn = { maxEventsGlobal: 15, maxEventsPerSystem: 2 };

  it("returns a spawn decision when eligible", () => {
    const result = selectEventToSpawn(defs, [], systems, 100, defaultCapsSpawn, () => 0.5);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("war");
  });

  it("returns null when global cap reached", () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      makeSnapshot({ id: `evt-${i}`, systemId: `sys-other-${i}` }),
    );
    const result = selectEventToSpawn(defs, events, systems, 100, defaultCapsSpawn, () => 0.5);
    expect(result).toBeNull();
  });

  it("returns null when per-type cap reached", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      makeSnapshot({ id: `evt-${i}`, type: "war", systemId: `sys-other-${i}` }),
    );
    const result = selectEventToSpawn(defs, events, systems, 100, defaultCapsSpawn, () => 0.5);
    expect(result).toBeNull();
  });

  it("skips systems at per-system cap", () => {
    // sys-1 has 2 events already (at cap)
    const events = [
      makeSnapshot({ id: "evt-1", type: "plague", systemId: "sys-1" }),
      makeSnapshot({ id: "evt-2", type: "mining_boom", systemId: "sys-1" }),
    ];
    const result = selectEventToSpawn(defs, events, systems, 100, defaultCapsSpawn, () => 0.1);
    if (result) {
      expect(result.systemId).not.toBe("sys-1");
    }
  });

  it("respects cooldown", () => {
    // war at sys-1 started at tick 90, cooldown is 50
    const events = [makeSnapshot({ startTick: 90, systemId: "sys-1", type: "war" })];
    // At tick 100, cooldown not expired (90 + 50 > 100)
    // Only sys-2 and sys-3 remain. The war def has no economy filter,
    // so it can spawn at either.
    const result = selectEventToSpawn(defs, events, systems, 100, defaultCapsSpawn, () => 0.1);
    if (result) {
      expect(result.systemId).not.toBe("sys-1");
    }
  });

  it("respects economy type filter", () => {
    const filtered: Record<string, EventDefinition> = {
      war: makeDefinition({
        targetFilter: { economyTypes: ["core"] },
      }),
    };
    const result = selectEventToSpawn(filtered, [], systems, 100, defaultCapsSpawn, () => 0.5);
    expect(result).not.toBeNull();
    expect(result!.systemId).toBe("sys-3"); // only core system
  });

  it("returns null when no systems match filter", () => {
    const filtered: Record<string, EventDefinition> = {
      war: makeDefinition({
        targetFilter: { economyTypes: ["tech"] },
      }),
    };
    const result = selectEventToSpawn(filtered, [], systems, 100, defaultCapsSpawn, () => 0.5);
    expect(result).toBeNull();
  });

  it("sets severity to 1.0 for fresh spawns", () => {
    const result = selectEventToSpawn(defs, [], systems, 100, defaultCapsSpawn, () => 0.5);
    expect(result!.severity).toBe(1.0);
  });

  it("spawns with first phase and valid duration", () => {
    const result = selectEventToSpawn(defs, [], systems, 100, defaultCapsSpawn, () => 0.5);
    expect(result!.phase).toBe("phase_one");
    expect(result!.phaseDuration).toBeGreaterThanOrEqual(10);
    expect(result!.phaseDuration).toBeLessThanOrEqual(20);
  });

  it("skips weight-0 definitions (child events)", () => {
    const childOnly: Record<string, EventDefinition> = {
      conflict_spillover: makeDefinition({ type: "conflict_spillover", weight: 0 }),
    };
    const result = selectEventToSpawn(childOnly, [], systems, 100, defaultCapsSpawn, () => 0.5);
    expect(result).toBeNull();
  });
});

// ── buildShocksForPhase ─────────────────────────────────────────

describe("buildShocksForPhase", () => {
  it("returns empty array when no shocks defined", () => {
    const phase: EventPhaseDefinition = {
      name: "test",
      displayName: "Test",
      durationRange: [10, 20],
      modifiers: [],
    };
    expect(buildShocksForPhase(phase, 1.0)).toEqual([]);
  });

  it("returns empty array when shocks is empty", () => {
    const phase: EventPhaseDefinition = {
      name: "test",
      displayName: "Test",
      durationRange: [10, 20],
      modifiers: [],
      shocks: [],
    };
    expect(buildShocksForPhase(phase, 1.0)).toEqual([]);
  });

  it("scales shock value by severity", () => {
    const phase: EventPhaseDefinition = {
      name: "test",
      displayName: "Test",
      durationRange: [10, 20],
      modifiers: [],
      shocks: [{ target: "system", goodId: "food", parameter: "supply", value: -30 }],
    };
    const shocks = buildShocksForPhase(phase, 0.5);
    expect(shocks).toHaveLength(1);
    expect(shocks[0]).toEqual({ goodId: "food", parameter: "supply", value: -15 });
  });

  it("returns full value at severity 1.0", () => {
    const phase: EventPhaseDefinition = {
      name: "test",
      displayName: "Test",
      durationRange: [10, 20],
      modifiers: [],
      shocks: [{ target: "system", goodId: "fuel", parameter: "demand", value: 20 }],
    };
    const shocks = buildShocksForPhase(phase, 1.0);
    expect(shocks[0]).toEqual({ goodId: "fuel", parameter: "demand", value: 20 });
  });

  it("returns zero-value shocks at severity 0", () => {
    const phase: EventPhaseDefinition = {
      name: "test",
      displayName: "Test",
      durationRange: [10, 20],
      modifiers: [],
      shocks: [{ target: "system", goodId: "food", parameter: "supply", value: -30 }],
    };
    const shocks = buildShocksForPhase(phase, 0);
    expect(shocks[0].value).toBe(0);
  });

  it("returns correct goodId and parameter", () => {
    const phase: EventPhaseDefinition = {
      name: "test",
      displayName: "Test",
      durationRange: [10, 20],
      modifiers: [],
      shocks: [
        { target: "system", goodId: "food", parameter: "supply", value: -30 },
        { target: "system", goodId: "fuel", parameter: "demand", value: 20 },
      ],
    };
    const shocks = buildShocksForPhase(phase, 1.0);
    expect(shocks).toHaveLength(2);
    expect(shocks[0].goodId).toBe("food");
    expect(shocks[0].parameter).toBe("supply");
    expect(shocks[1].goodId).toBe("fuel");
    expect(shocks[1].parameter).toBe("demand");
  });
});

// ── evaluateSpreadTargets ───────────────────────────────────────

describe("evaluateSpreadTargets", () => {
  const childDef = makeDefinition({
    type: "conflict_spillover",
    weight: 0,
    phases: [{
      name: "child_phase",
      displayName: "Child Phase",
      durationRange: [20, 40],
      modifiers: [],
    }],
  });

  const defs: Record<string, EventDefinition> = {
    war: makeDefinition(),
    conflict_spillover: childDef,
  };

  const defaultSpreadCaps = { maxEventsGlobal: 15, maxEventsPerSystem: 2 };

  const neighbors: NeighborSnapshot[] = [
    { id: "sys-2", economyType: "agricultural", regionId: "reg-1" },
    { id: "sys-3", economyType: "industrial", regionId: "reg-1" },
    { id: "sys-4", economyType: "agricultural", regionId: "reg-2" },
  ];

  const baseRule: SpreadRule = {
    eventType: "conflict_spillover",
    probability: 1.0,
    severity: 0.3,
  };

  it("returns empty array when no spread rules", () => {
    const result = evaluateSpreadTargets(
      [], makeSnapshot(), neighbors, [], defaultSpreadCaps, defs, () => 0,
    );
    expect(result).toEqual([]);
  });

  it("spawns at all neighbors when probability is 1.0 and no filters", () => {
    const result = evaluateSpreadTargets(
      [baseRule], makeSnapshot(), neighbors, [], defaultSpreadCaps, defs, () => 0,
    );
    expect(result).toHaveLength(3);
    expect(result.map((d) => d.systemId)).toEqual(["sys-2", "sys-3", "sys-4"]);
  });

  it("filters neighbors by sameRegion", () => {
    const rule: SpreadRule = {
      ...baseRule,
      targetFilter: { sameRegion: true },
    };
    const source = makeSnapshot({ regionId: "reg-1" });
    const result = evaluateSpreadTargets(
      [rule], source, neighbors, [], defaultSpreadCaps, defs, () => 0,
    );
    // sys-4 is reg-2, should be filtered out
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.systemId)).toEqual(["sys-2", "sys-3"]);
  });

  it("filters neighbors by economyTypes", () => {
    const rule: SpreadRule = {
      ...baseRule,
      targetFilter: { economyTypes: ["agricultural"] },
    };
    const result = evaluateSpreadTargets(
      [rule], makeSnapshot(), neighbors, [], defaultSpreadCaps, defs, () => 0,
    );
    // Only sys-2 and sys-4 are agricultural
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.systemId)).toEqual(["sys-2", "sys-4"]);
  });

  it("skips neighbors at per-system cap", () => {
    const existingEvents = [
      makeSnapshot({ id: "evt-a", type: "plague", systemId: "sys-2", sourceEventId: null }),
      makeSnapshot({ id: "evt-b", type: "mining_boom", systemId: "sys-2", sourceEventId: null }),
    ];
    const result = evaluateSpreadTargets(
      [baseRule], makeSnapshot(), neighbors, existingEvents, defaultSpreadCaps, defs, () => 0,
    );
    // sys-2 at cap (2 events), should be skipped
    expect(result.map((d) => d.systemId)).not.toContain("sys-2");
  });

  it("skips neighbors with same event type already active", () => {
    const existingEvents = [
      makeSnapshot({ id: "evt-a", type: "conflict_spillover", systemId: "sys-3", sourceEventId: "evt-parent" }),
    ];
    const result = evaluateSpreadTargets(
      [baseRule], makeSnapshot(), neighbors, existingEvents, defaultSpreadCaps, defs, () => 0,
    );
    // sys-3 already has conflict_spillover, should be skipped
    expect(result.map((d) => d.systemId)).not.toContain("sys-3");
  });

  it("always spreads when rng returns 0 (below probability)", () => {
    const rule: SpreadRule = { ...baseRule, probability: 0.5 };
    const result = evaluateSpreadTargets(
      [rule], makeSnapshot(), neighbors, [], defaultSpreadCaps, defs, () => 0,
    );
    expect(result).toHaveLength(3);
  });

  it("never spreads when rng returns 1 (at or above probability)", () => {
    const rule: SpreadRule = { ...baseRule, probability: 0.5 };
    const result = evaluateSpreadTargets(
      [rule], makeSnapshot(), neighbors, [], defaultSpreadCaps, defs, () => 1,
    );
    expect(result).toHaveLength(0);
  });

  it("sets severity to rule.severity × source severity", () => {
    const source = makeSnapshot({ severity: 0.8 });
    const rule: SpreadRule = { ...baseRule, severity: 0.5 };
    const result = evaluateSpreadTargets(
      [rule], source, neighbors, [], defaultSpreadCaps, defs, () => 0,
    );
    expect(result[0].severity).toBeCloseTo(0.4); // 0.5 × 0.8
  });

  it("returns valid SpawnDecision fields", () => {
    const result = evaluateSpreadTargets(
      [baseRule], makeSnapshot(), [neighbors[0]], [], defaultSpreadCaps, defs, () => 0,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "conflict_spillover",
      systemId: "sys-2",
      regionId: "reg-1",
      phase: "child_phase",
      severity: 0.3,
    });
    expect(result[0].phaseDuration).toBeGreaterThanOrEqual(20);
    expect(result[0].phaseDuration).toBeLessThanOrEqual(40);
  });

  it("skips rules for event types not in definitions record", () => {
    // "plague" is a valid EventTypeId but not in the test's defs record
    const rule: SpreadRule = { ...baseRule, eventType: "plague" };
    const result = evaluateSpreadTargets(
      [rule], makeSnapshot(), neighbors, [], defaultSpreadCaps, defs, () => 0,
    );
    expect(result).toEqual([]);
  });
});
