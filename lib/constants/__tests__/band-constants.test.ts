import { describe, it, expect } from "vitest";
import { ECONOMY_CONSTANTS, TARGET_COVER, SHORTAGE_SATISFACTION } from "@/lib/constants/economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { STRIKE_PARAMS, POPULATION_PARAMS, CROWDING } from "@/lib/constants/population";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { VACANCY_SLACK } from "@/lib/constants/infrastructure";
import { BUILDING_TYPES, HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { sizeColonyEstablish } from "@/lib/engine/directed-build";
import { housingUsed, idleLevels } from "@/lib/engine/infrastructure-decay";

describe("band constant dependencies", () => {
  it("starts logistics replenishment well before emergency rationing", () => {
    // Imports must arrive before rationing starts: receivers classify as
    // The deficit threshold is an anchor fraction; convert it to demand cycles
    // before comparing it with the independently-defined ration threshold.
    expect(DIRECTED_LOGISTICS.DEFICIT_FRACTION * TARGET_COVER).toBeGreaterThan(
      ECONOMY_CONSTANTS.RATION_COVER,
    );
  });
  it("keeps rationing close to empty and the hold ceiling above the anchor", () => {
    expect(ECONOMY_CONSTANTS.RATION_COVER).toBeLessThan(TARGET_COVER);
    expect(ECONOMY_CONSTANTS.HOLD_COVER).toBeGreaterThan(1);
  });
  it("keeps the shortage line a proper interior satisfaction level", () => {
    expect(SHORTAGE_SATISFACTION).toBeGreaterThan(0);
    expect(SHORTAGE_SATISFACTION).toBeLessThan(1);
  });
});

describe("population / unrest constant dependencies", () => {
  it("gates overshoot death on the strike threshold", () => {
    // The overshoot-death term is the collapse regime — it must fire on the same
    // unrest at which production strikes, not a separately drifting number.
    expect(POPULATION_PARAMS.overshootDeathUnrestGate).toBe(STRIKE_PARAMS.threshold);
  });
  it("shares one brake-end between the growth brake and the crowding pressure ramp", () => {
    expect(POPULATION_PARAMS.crowdBrakeEnd).toBe(CROWDING.BRAKE_END);
  });
  it("cannot strike-spiral off crowding pressure alone", () => {
    // Even a fully overcrowded world adds only PRESSURE_MAX to the standing floor,
    // which must stay well under the strike threshold.
    expect(CROWDING.PRESSURE_MAX).toBeLessThan(STRIKE_PARAMS.threshold);
  });
});

describe("housing containment — both directed-build sizing sites land inside the decay slack", () => {
  // The two sites the build planner sizes housing at: the relief valve (below) and colony establish.
  // Both must land the result inside the vacancy allowance decay reads, or the sizing commits exactly
  // the levels decay then tears down — the treadmill this band is meant to make structurally
  // impossible. (World-gen's homeworld prefab sizes housing too, but against labour demand rather
  // than residents, and is not part of this invariant.)
  it("opens a colony with no level the idle channel would immediately read as spare", () => {
    // Seeds swept across and around whole-level boundaries: the +1 headroom level this sizing used
    // to bundle put a fresh colony a whole level above its own occupancy, which reads idle from the
    // moment it lands. The `min(count, …)` here is the decay engine's own clamp (capacityUsed
    // "pop_cap" in lib/engine/industry.ts) — without it the proxy reads negative at boundary seeds
    // and the assertion would be testing a quantity decay never computes.
    const ampleLand = 1e6; // never the binding constraint here — the seed is
    for (const seedPop of [1, 2, 19, 20, 21, 40, 41]) {
      const sizing = sizeColonyEstablish(ampleLand, { seedPop, establishWork: 0 });
      expect(sizing).not.toBeNull();
      if (sizing === null) continue;
      expect(sizing.seedPop).toBe(seedPop);
      // Viable by construction: the landed colony can house everyone it was seeded with.
      expect(sizing.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(seedPop);
      // …and carries no whole level decay would reclaim (the trigger is `idleLevels >= 1`).
      const used = Math.min(sizing.housingLevels, housingUsed(seedPop) * (1 + VACANCY_SLACK));
      expect(idleLevels(sizing.housingLevels, used)).toBe(0);
    }
  });

  it("keeps the relief vacancy inside the decay slack", () => {
    // Housing decay reads levels as fully used while count ≤ housingUsed(pop) × (1 + VACANCY_SLACK)
    // (capacityUsed "pop_cap" in lib/engine/industry.ts). At occupancy r that is r × (1 + VACANCY_SLACK)
    // ≥ 1, so relief must size back to a target the slack still covers — otherwise the valve commits
    // exactly the levels decay then tears down. The two are fractions of DIFFERENT denominators (the
    // slack of used housing, 1 − RELIEF_TARGET of built popCap), so comparing them directly would
    // admit targets that break containment.
    expect(DIRECTED_BUILD.RELIEF_TARGET * (1 + VACANCY_SLACK)).toBeGreaterThanOrEqual(1);
  });

  it("binds the two housing-capacity readings to one density", () => {
    // Occupancy is read two ways: housingUsed(pop) divides by POP_CENTRE_DENSITY, housingPopCap()
    // multiplies by the housing type's popProvided. The decay-containment invariant above compares
    // fractions derived from both, so it only means anything while the two agree — a divergence
    // would silently shift the r the relief valve targets away from the r decay measures.
    expect(BUILDING_TYPES[HOUSING_TYPE].popProvided).toBe(POP_CENTRE_DENSITY);
  });

  it("triggers relief above the occupancy it sizes back to", () => {
    // The trigger/target pair is a hysteresis band: a target at or above the trigger would make the
    // sized want non-positive at the moment the valve opens, silently disabling relief entirely.
    expect(DIRECTED_BUILD.RELIEF_TRIGGER).toBeGreaterThan(DIRECTED_BUILD.RELIEF_TARGET);
  });
});
