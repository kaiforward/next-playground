import { describe, it, expect } from "vitest";
import {
  valueRampColorPixi, rampFloorPixi, rampTopPixi, ABSENT_COLOR, rampCssStops, ABSENT_CSS,
} from "@/components/map/pixi/value-ramp";

describe("valueRampColorPixi", () => {
  it("returns black for exactly zero", () => {
    expect(valueRampColorPixi(0, 100, "development")).toBe(ABSENT_COLOR);
  });
  it("returns black for negative or NaN (never a coloured cell)", () => {
    expect(valueRampColorPixi(-5, 100, "population")).toBe(ABSENT_COLOR);
    expect(valueRampColorPixi(Number.NaN, 100, "population")).toBe(ABSENT_COLOR);
  });
  it("a tiny present value reads the grey floor, NOT black", () => {
    const c = valueRampColorPixi(0.0001, 1, "development");
    expect(c).not.toBe(ABSENT_COLOR);
    expect(c).toBe(rampFloorPixi("development"));
  });
  it("the reference-max value reads the top of the ramp", () => {
    expect(valueRampColorPixi(50, 50, "population")).toBe(rampTopPixi("population"));
  });
  it("clamps values above the reference to the top", () => {
    expect(valueRampColorPixi(200, 50, "stability")).toBe(rampTopPixi("stability"));
  });
  it("guards a zero reference max (no divide-by-zero → clamps to top)", () => {
    expect(valueRampColorPixi(5, 0, "population")).toBe(rampTopPixi("population"));
  });
});

describe("population palette — red→green with black reserved for zero", () => {
  it("reads black at zero and the red floor for a tiny present value", () => {
    expect(valueRampColorPixi(0, 100, "population")).toBe(ABSENT_COLOR);
    expect(valueRampColorPixi(0.0001, 1, "population")).toBe(rampFloorPixi("population"));
  });
});

describe("stability — present-zero rides the red floor, not black", () => {
  it("colours a maximally-unstable present system red (absence is the caller's job)", () => {
    expect(valueRampColorPixi(0, 1, "stability")).toBe(rampFloorPixi("stability"));
    expect(valueRampColorPixi(0, 1, "stability")).not.toBe(ABSENT_COLOR);
  });
});

describe("rampCssStops / ABSENT_CSS — the legend's single source", () => {
  it("returns one rgb() stop per ramp anchor", () => {
    const stops = rampCssStops("population");
    expect(stops).toHaveLength(3);
    expect(stops[0]).toMatch(/^rgb\(/);
  });
  it("exposes the reserved absent colour as a hex string", () => {
    expect(ABSENT_CSS).toBe("#08090c");
  });
});
