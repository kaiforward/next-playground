import { describe, it, expect } from "vitest";
import { laneStyle } from "../lane-style";
import { LANE_WIDTH } from "../../theme";

function style(overrides: Partial<Parameters<typeof laneStyle>[0]> = {}) {
  return laneStyle({ fuelCost: 8, level: 0, ...overrides });
}

describe("laneStyle — width", () => {
  it("draws the same width for an ordinary and a notable lane at equal level", () => {
    const ordinary = style({ fuelCost: 8 });
    const notable = style({ fuelCost: 12 });
    expect(ordinary.width).toBe(notable.width);
  });

  it("draws a major-tier lane heavier than a non-major lane at equal level", () => {
    const notable = style({ fuelCost: 12 });
    const major = style({ fuelCost: 20 });
    expect(major.width).toBeGreaterThan(notable.width);
    expect(major.width - notable.width).toBeCloseTo(LANE_WIDTH.majorExtra);
  });

  it("widens strictly as invested level rises (fuel tier held fixed)", () => {
    const level0 = style({ level: 0 });
    const level3 = style({ level: 3 });
    const level8 = style({ level: 8 });
    expect(level0.width).toBeLessThan(level3.width);
    expect(level3.width).toBeLessThan(level8.width);
  });

  it("draws one alpha regardless of tier or level", () => {
    expect(style({ fuelCost: 8, level: 0 }).alpha).toBe(style({ fuelCost: 20, level: 8 }).alpha);
  });
});
