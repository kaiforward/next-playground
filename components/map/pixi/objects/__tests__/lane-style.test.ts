import { describe, it, expect } from "vitest";
import { laneStyleForFuel } from "../lane-style";

describe("laneStyleForFuel", () => {
  it("classes a cheap intra-region-typical lane as ordinary", () => {
    expect(laneStyleForFuel(8).tier).toBe("ordinary");
  });

  it("classes a lane just under the notable threshold as ordinary", () => {
    expect(laneStyleForFuel(11.9).tier).toBe("ordinary");
  });

  it("classes a lane at the notable threshold as notable", () => {
    expect(laneStyleForFuel(12).tier).toBe("notable");
  });

  it("classes a lane at the major threshold as major", () => {
    expect(laneStyleForFuel(20).tier).toBe("major");
  });

  it("widens and brightens strictly across the three tiers", () => {
    const ordinary = laneStyleForFuel(8);
    const notable = laneStyleForFuel(12);
    const major = laneStyleForFuel(20);
    expect(ordinary.width).toBeLessThan(notable.width);
    expect(notable.width).toBeLessThan(major.width);
    expect(ordinary.alpha).toBeLessThan(notable.alpha);
    expect(notable.alpha).toBeLessThan(major.alpha);
  });
});
