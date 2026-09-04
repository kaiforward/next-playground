import { describe, it, expect } from "vitest";
import { laneStyle } from "../lane-style";
import { LANE_LOAD_COLOR } from "../../theme";

function style(overrides: Partial<Parameters<typeof laneStyle>[0]> = {}) {
  return laneStyle({ fuelCost: 8, level: 0, load: 0, blocked: false, ...overrides });
}

describe("laneStyle — fuel tier", () => {
  it("classes a cheap intra-region-typical lane as ordinary", () => {
    expect(style({ fuelCost: 8 }).tier).toBe("ordinary");
  });

  it("classes a lane just under the notable threshold as ordinary", () => {
    expect(style({ fuelCost: 11.9 }).tier).toBe("ordinary");
  });

  it("classes a lane at the notable threshold as notable", () => {
    expect(style({ fuelCost: 12 }).tier).toBe("notable");
  });

  it("classes a lane at the major threshold as major", () => {
    expect(style({ fuelCost: 20 }).tier).toBe("major");
  });

  it("widens and brightens strictly across the three tiers (level/load held fixed)", () => {
    const ordinary = style({ fuelCost: 8 });
    const notable = style({ fuelCost: 12 });
    const major = style({ fuelCost: 20 });
    expect(ordinary.width).toBeLessThan(notable.width);
    expect(notable.width).toBeLessThan(major.width);
    expect(ordinary.alpha).toBeLessThan(notable.alpha);
    expect(notable.alpha).toBeLessThan(major.alpha);
  });
});

describe("laneStyle — level → width", () => {
  it("a lane's drawn weight tracks its invested level (tier/load/blocked held fixed)", () => {
    const level0 = style({ level: 0 });
    const level3 = style({ level: 3 });
    const level8 = style({ level: 8 });
    expect(level0.width).toBeLessThan(level3.width);
    expect(level3.width).toBeLessThan(level8.width);
  });
});

describe("laneStyle — load/capacity → colour", () => {
  it("reads the idle colour at ~0 booked load", () => {
    expect(style({ load: 0 }).color).toBe(LANE_LOAD_COLOR.idle);
  });

  it("reads the loaded colour at load == capacity", () => {
    expect(style({ load: 1 }).color).toBe(LANE_LOAD_COLOR.loaded);
  });

  it("warms strictly as load rises from 0 toward 1", () => {
    // "Warming" = red channel rises toward the amber target while unblocked.
    const low = style({ load: 0.1 }).color;
    const high = style({ load: 0.9 }).color;
    const redOf = (c: number) => (c >> 16) & 0xff;
    expect(redOf(high)).toBeGreaterThan(redOf(low));
  });

  it("reads blocked (red) regardless of load, when blockedVolume > 0 this run", () => {
    expect(style({ load: 0, blocked: true }).color).toBe(LANE_LOAD_COLOR.blocked);
    expect(style({ load: 1, blocked: true }).color).toBe(LANE_LOAD_COLOR.blocked);
  });

  it("does NOT read blocked red merely from load approaching 1 (red means invest-here, not nearly-full)", () => {
    expect(style({ load: 0.99, blocked: false }).color).not.toBe(LANE_LOAD_COLOR.blocked);
  });
});
