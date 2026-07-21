import { describe, it, expect } from "vitest";
import { ECONOMY_CONSTANTS, TARGET_COVER } from "@/lib/constants/economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

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
});
