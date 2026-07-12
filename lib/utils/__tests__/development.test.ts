import { describe, it, expect } from "vitest";
import {
  developmentRampColor,
  developmentRampColorPixi,
  shapeForRamp,
  DEVELOPMENT_RAMP_CSS,
} from "@/lib/utils/development";

/** Red channel of a Pixi 0xRRGGBB colour — warmth proxy (slate 71 → copper 217 → gold 252). */
function red(pixi: number): number {
  return (pixi >> 16) & 0xff;
}

describe("shapeForRamp — display curve that expands the squashed low band", () => {
  it("pins the endpoints (frontier stays cold, top stays gold)", () => {
    expect(shapeForRamp(0)).toBe(0);
    expect(shapeForRamp(1)).toBe(1);
  });

  it("lifts a low value well up the ramp (a p90 system ≈0.09 reads into the copper band, not near-slate)", () => {
    // The whole point: linearly 0.09 barely leaves slate; the curve pushes it past the ramp's midpoint.
    expect(shapeForRamp(0.09)).toBeGreaterThan(0.3);
  });

  it("is monotonic and clamps out-of-range input", () => {
    expect(shapeForRamp(0.05)).toBeLessThan(shapeForRamp(0.2));
    expect(shapeForRamp(-1)).toBe(0);
    expect(shapeForRamp(2)).toBe(1);
  });
});

describe("developmentRamp colours", () => {
  it("reads pure slate at 0 and pure gold at 1 (ramp anchors unchanged)", () => {
    expect(developmentRampColor(0)).toBe("#475569");
    expect(developmentRampColor(1)).toBe("#fcd34d");
  });

  it("renders a low-development system warm, not slate (the legibility fix)", () => {
    // Under the linear ramp a 0.09 system stayed near slate red (~97); the curve lifts it into copper.
    expect(red(developmentRampColorPixi(0.09))).toBeGreaterThan(150);
  });

  it("warms monotonically across the developed band", () => {
    expect(red(developmentRampColorPixi(0.02))).toBeLessThan(red(developmentRampColorPixi(0.09)));
    expect(red(developmentRampColorPixi(0.09))).toBeLessThan(red(developmentRampColorPixi(0.24)));
  });
});

describe("DEVELOPMENT_RAMP_CSS — legend gradient matches the curve", () => {
  it("carries positioned stops so the legend bar shows the same shaping as the map fill", () => {
    // More than the three raw anchors: the legend is sampled through the curve so it can't imply linear.
    expect(DEVELOPMENT_RAMP_CSS.length).toBeGreaterThan(3);
    expect(DEVELOPMENT_RAMP_CSS[0]).toContain("0%");
    expect(DEVELOPMENT_RAMP_CSS[DEVELOPMENT_RAMP_CSS.length - 1]).toContain("100%");
  });
});
