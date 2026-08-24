import { describe, it, expect } from "vitest";
import { COLONISATION } from "@/lib/constants/colonisation";

describe("COLONISATION constants", () => {
  it("prices an establish project as positive work (the base settle cost)", () => {
    expect(COLONISATION.COLONY_ESTABLISH_WORK).toBeGreaterThan(0);
  });

  it("carries positive land-value weights", () => {
    expect(COLONISATION.LAND_PREMIUM).toBeGreaterThan(0);
    expect(COLONISATION.LAND_DEPOSIT_WEIGHT).toBeGreaterThanOrEqual(0);
  });

  it("no longer carries a general-space weight — industry bills no land (habitability-seeding cut)", () => {
    expect("LAND_GENERAL_WEIGHT" in COLONISATION).toBe(false);
  });

  it("keeps the σ-floor a valid gate fraction in [0, 1]", () => {
    expect(COLONISATION.SIGMA_FLOOR).toBeGreaterThanOrEqual(0);
    expect(COLONISATION.SIGMA_FLOOR).toBeLessThanOrEqual(1);
  });
});
