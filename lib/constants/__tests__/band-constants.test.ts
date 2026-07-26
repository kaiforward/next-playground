import { describe, it, expect } from "vitest";
import { ECONOMY_CONSTANTS, TARGET_COVER, SHORTAGE_SATISFACTION } from "@/lib/constants/economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { STRIKE_PARAMS, POPULATION_PARAMS, CROWDING } from "@/lib/constants/population";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { VACANCY_SLACK } from "@/lib/constants/infrastructure";

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

describe("housing relief constant dependencies", () => {
  it("keeps the relief vacancy inside the decay slack", () => {
    // Housing decay reads levels as fully used while count ≤ housingUsed(pop) × (1 + VACANCY_SLACK)
    // (capacityUsed "pop_cap" in lib/engine/industry.ts). At occupancy r that is r × (1 + VACANCY_SLACK)
    // ≥ 1, so relief must size back to a target the slack still covers — otherwise the valve commits
    // exactly the levels decay then tears down. The two are fractions of DIFFERENT denominators (the
    // slack of used housing, 1 − RELIEF_TARGET of built popCap), so comparing them directly would
    // admit targets that break containment.
    expect(DIRECTED_BUILD.RELIEF_TARGET * (1 + VACANCY_SLACK)).toBeGreaterThanOrEqual(1);
  });

  it("triggers relief above the occupancy it sizes back to", () => {
    // The trigger/target pair is a hysteresis band: a target at or above the trigger would make the
    // sized want non-positive at the moment the valve opens, silently disabling relief entirely.
    expect(DIRECTED_BUILD.RELIEF_TRIGGER).toBeGreaterThan(DIRECTED_BUILD.RELIEF_TARGET);
  });
});
