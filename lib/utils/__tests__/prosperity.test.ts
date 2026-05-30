import { describe, it, expect } from "vitest";
import {
  prosperityRampColor,
  prosperityRampColorPixi,
  prosperityEffectLabel,
  PROSPERITY_RAMP_STOPS,
} from "@/lib/utils/prosperity";

describe("prosperity ramp colours (cold→warm by label)", () => {
  it("maps anchor values to the right stop", () => {
    expect(prosperityRampColor(-1)).toBe(PROSPERITY_RAMP_STOPS.Crisis);
    expect(prosperityRampColor(-0.5)).toBe(PROSPERITY_RAMP_STOPS.Crisis); // ≤ -0.5
    expect(prosperityRampColor(-0.1)).toBe(PROSPERITY_RAMP_STOPS.Disrupted); // ≤ -0.1
    expect(prosperityRampColor(0)).toBe(PROSPERITY_RAMP_STOPS.Stagnant);
    expect(prosperityRampColor(0.7)).toBe(PROSPERITY_RAMP_STOPS.Active); // ≤ 0.7
    expect(prosperityRampColor(1)).toBe(PROSPERITY_RAMP_STOPS.Booming);
  });
  it("pixi variant returns the numeric form", () => {
    expect(prosperityRampColorPixi(1)).toBe(
      parseInt(PROSPERITY_RAMP_STOPS.Booming.slice(1), 16),
    );
  });
});

describe("prosperityEffectLabel", () => {
  it("shows the bare multiplier factor, correct in both directions", () => {
    expect(prosperityEffectLabel(1)).toBe("Production & Consumption ×1.3");
    expect(prosperityEffectLabel(0)).toBe("Production & Consumption ×0.7");
    expect(prosperityEffectLabel(-1)).toBe("Production & Consumption ×0.3");
  });
});
