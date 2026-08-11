import { describe, it, expect } from "vitest";
import {
  stabilityLabel,
  stabilityRampColor,
  STABILITY_RAMP_STOPS,
} from "../stability";
import { STRIKE_PARAMS } from "@/lib/constants/population";

describe("stabilityLabel", () => {
  it("returns Stable for unrest < 0.2", () => {
    expect(stabilityLabel(0)).toBe("Stable");
    expect(stabilityLabel(0.0)).toBe("Stable");
    expect(stabilityLabel(0.19)).toBe("Stable");
  });

  it("returns Calm at the 0.2 boundary up to < 0.4", () => {
    expect(stabilityLabel(0.2)).toBe("Calm");
    expect(stabilityLabel(0.3)).toBe("Calm");
    expect(stabilityLabel(0.39)).toBe("Calm");
  });

  it("returns Tense at the 0.4 boundary up to < 0.5", () => {
    expect(stabilityLabel(0.4)).toBe("Tense");
    expect(stabilityLabel(0.45)).toBe("Tense");
    expect(stabilityLabel(0.49)).toBe("Tense");
  });

  it("returns Unrest at the 0.5 boundary up to just below the strike threshold", () => {
    expect(stabilityLabel(0.5)).toBe("Unrest");
    expect(stabilityLabel(0.6)).toBe("Unrest");
    expect(stabilityLabel(STRIKE_PARAMS.threshold - 0.01)).toBe("Unrest");
  });

  it("labels Strike exactly where striking starts — the label stays in lockstep with STRIKE_PARAMS.threshold, not a literal", () => {
    // STRIKE_PARAMS.threshold is 0.65 today; a hardcoded 0.8 boundary would fail this at the live
    // value, which is the point — the label may never contradict the mechanic it names. `strikeMultiplier`
    // suppresses production strictly above the threshold, so a world sitting on it is not yet striking.
    expect(stabilityLabel(STRIKE_PARAMS.threshold)).toBe("Unrest");
    expect(stabilityLabel(STRIKE_PARAMS.threshold + 1e-9)).toBe("Strike");
    expect(stabilityLabel(0.9)).toBe("Strike");
    expect(stabilityLabel(1.0)).toBe("Strike");
  });
});

describe("stabilityRampColor", () => {
  it("returns the Stable colour for low unrest", () => {
    expect(stabilityRampColor(0)).toBe(STABILITY_RAMP_STOPS.Stable);
    expect(stabilityRampColor(0.1)).toBe(STABILITY_RAMP_STOPS.Stable);
  });

  it("returns the Calm colour at the 0.2 threshold", () => {
    expect(stabilityRampColor(0.2)).toBe(STABILITY_RAMP_STOPS.Calm);
    expect(stabilityRampColor(0.3)).toBe(STABILITY_RAMP_STOPS.Calm);
  });

  it("returns the Tense colour at the 0.4 threshold", () => {
    expect(stabilityRampColor(0.4)).toBe(STABILITY_RAMP_STOPS.Tense);
    expect(stabilityRampColor(0.45)).toBe(STABILITY_RAMP_STOPS.Tense);
  });

  it("returns the Unrest colour at the 0.5 threshold up to just below the strike threshold", () => {
    expect(stabilityRampColor(0.5)).toBe(STABILITY_RAMP_STOPS.Unrest);
    expect(stabilityRampColor(STRIKE_PARAMS.threshold - 0.01)).toBe(STABILITY_RAMP_STOPS.Unrest);
  });

  it("returns the Strike colour above the strike threshold and at 1.0, but not on the threshold itself", () => {
    expect(stabilityRampColor(STRIKE_PARAMS.threshold)).toBe(STABILITY_RAMP_STOPS.Unrest);
    expect(stabilityRampColor(STRIKE_PARAMS.threshold + 1e-9)).toBe(STABILITY_RAMP_STOPS.Strike);
    expect(stabilityRampColor(1.0)).toBe(STABILITY_RAMP_STOPS.Strike);
  });
});
