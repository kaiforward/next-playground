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
  it("keeps the relief vacancy strictly inside the decay slack", () => {
    // Relief sizing leaves 1 − RELIEF_TARGET of the new popCap empty. Housing decay tolerates
    // VACANCY_SLACK of vacancy before a level reads as unused, so relief housing must land inside
    // that allowance — otherwise the valve builds exactly the levels decay then tears back down.
    expect(1 - DIRECTED_BUILD.RELIEF_TARGET).toBeLessThan(VACANCY_SLACK);
  });

  it("triggers relief above the occupancy it sizes back to", () => {
    // The trigger/target pair is a hysteresis band: a target at or above the trigger would make the
    // sized want non-positive at the moment the valve opens, silently disabling relief entirely.
    expect(DIRECTED_BUILD.RELIEF_TRIGGER).toBeGreaterThan(DIRECTED_BUILD.RELIEF_TARGET);
  });
});
