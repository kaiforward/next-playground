import { describe, it, expect } from "vitest";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

describe("band constant dependencies", () => {
  it("keeps the logistics deficit trigger above the comfort knee", () => {
    // Imports must arrive before rationing starts: receivers classify as
    // deficits (cover < DEFICIT_FRACTION) while still above the comfort knee
    // (cover ≥ COMFORT_COVER), so the matcher refills them before pops feel it.
    expect(DIRECTED_LOGISTICS.DEFICIT_FRACTION).toBeGreaterThan(ECONOMY_CONSTANTS.COMFORT_COVER);
  });
  it("keeps the comfort knee below the anchor and the anchor below the hold ceiling", () => {
    expect(ECONOMY_CONSTANTS.COMFORT_COVER).toBeLessThan(1);
    expect(ECONOMY_CONSTANTS.HOLD_COVER).toBeGreaterThan(1);
  });
});
