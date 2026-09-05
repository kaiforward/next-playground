import { describe, it, expect } from "vitest";
import { laneStyle, laneModeStyle, type LaneModeStyleInput } from "../lane-style";
import { LANE_BASE_COLOR, LANE_MODE, LANE_WIDTH } from "../../theme";

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

function modeStyle(overrides: Partial<LaneModeStyleInput> = {}): LaneModeStyleInput {
  return { investorFactionId: null, factionColor: null, level: 0, band: "fine", ...overrides };
}

describe("laneModeStyle — the Lanes map mode", () => {
  it("is dashed and slate when there is no investor", () => {
    const style = laneModeStyle(modeStyle({ investorFactionId: null, factionColor: null }));
    expect(style.dashed).toBe(true);
    expect(style.color).toBe(LANE_BASE_COLOR);
  });

  it("is solid and takes the investor's colour when there is one", () => {
    const style = laneModeStyle(modeStyle({ investorFactionId: "f1", factionColor: 0x11aa33 }));
    expect(style.dashed).toBe(false);
    expect(style.color).toBe(0x11aa33);
  });

  it("a level-3 lane is wider than a level-0 lane", () => {
    const level0 = laneModeStyle(modeStyle({ level: 0 }));
    const level3 = laneModeStyle(modeStyle({ level: 3 }));
    expect(level3.width).toBeGreaterThan(level0.width);
    expect(level3.width - level0.width).toBeCloseTo(LANE_MODE.perLevel * 3);
  });

  it("steps alpha by band: fine dims, busy and congested both read full", () => {
    const fine = laneModeStyle(modeStyle({ band: "fine" }));
    const busy = laneModeStyle(modeStyle({ band: "busy" }));
    const congested = laneModeStyle(modeStyle({ band: "congested" }));
    expect(fine.alpha).toBe(LANE_MODE.fineAlpha);
    expect(busy.alpha).toBe(LANE_MODE.busyAlpha);
    expect(congested.alpha).toBe(LANE_MODE.busyAlpha);
    expect(fine.alpha).toBeLessThan(busy.alpha);
  });

  it("a dashed lane can still be busy or congested — dashed reads investor only, not load", () => {
    const style = laneModeStyle(modeStyle({ investorFactionId: null, band: "congested" }));
    expect(style.dashed).toBe(true);
    expect(style.alpha).toBe(LANE_MODE.busyAlpha);
  });
});
