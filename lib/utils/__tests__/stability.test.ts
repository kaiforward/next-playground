import { describe, it, expect } from "vitest";
import {
  stabilityLabel,
  stabilityRampColor,
  STABILITY_RAMP_STOPS,
} from "../stability";

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

  it("returns Tense at the 0.4 boundary up to < 0.6", () => {
    expect(stabilityLabel(0.4)).toBe("Tense");
    expect(stabilityLabel(0.5)).toBe("Tense");
    expect(stabilityLabel(0.59)).toBe("Tense");
  });

  it("returns Unrest at the 0.6 boundary up to < 0.8", () => {
    expect(stabilityLabel(0.6)).toBe("Unrest");
    expect(stabilityLabel(0.7)).toBe("Unrest");
    expect(stabilityLabel(0.79)).toBe("Unrest");
  });

  it("returns Strike at the 0.8 boundary and at 1.0", () => {
    expect(stabilityLabel(0.8)).toBe("Strike");
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
    expect(stabilityRampColor(0.5)).toBe(STABILITY_RAMP_STOPS.Tense);
  });

  it("returns the Unrest colour at the 0.6 threshold", () => {
    expect(stabilityRampColor(0.6)).toBe(STABILITY_RAMP_STOPS.Unrest);
    expect(stabilityRampColor(0.7)).toBe(STABILITY_RAMP_STOPS.Unrest);
  });

  it("returns the Strike colour at the 0.8 threshold and at 1.0", () => {
    expect(stabilityRampColor(0.8)).toBe(STABILITY_RAMP_STOPS.Strike);
    expect(stabilityRampColor(1.0)).toBe(STABILITY_RAMP_STOPS.Strike);
  });
});
