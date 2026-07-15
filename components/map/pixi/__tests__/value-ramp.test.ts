import { describe, it, expect } from "vitest";
import {
  valueRampColorPixi, rampFloorPixi, rampTopPixi, ABSENT_COLOR, rampCssStops, ABSENT_CSS, deEmphasize,
} from "@/components/map/pixi/value-ramp";

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}
function sum(color: number): number {
  return channels(color).reduce((a, b) => a + b, 0);
}

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

describe("population palette — two-pole red→green with black reserved for zero", () => {
  it("reads black at zero and the red floor for a tiny present value", () => {
    expect(valueRampColorPixi(0, 100, "population")).toBe(ABSENT_COLOR);
    expect(valueRampColorPixi(0.0001, 1, "population")).toBe(rampFloorPixi("population"));
  });
  it("the reference-max value reads the green endpoint", () => {
    expect(valueRampColorPixi(50, 50, "population")).toBe(rampTopPixi("population"));
  });
  it("a near-zero present value reads the red endpoint", () => {
    expect(valueRampColorPixi(0.0001, 100, "population")).toBe(rampFloorPixi("population"));
  });
  it("has no amber midpoint — exactly 2 stops", () => {
    expect(rampCssStops("population")).toHaveLength(2);
  });
});

describe("stability — present-zero rides the red floor, not black", () => {
  it("colours a maximally-unstable present system red (absence is the caller's job)", () => {
    expect(valueRampColorPixi(0, 1, "stability")).toBe(rampFloorPixi("stability"));
    expect(valueRampColorPixi(0, 1, "stability")).not.toBe(ABSENT_COLOR);
  });
});

describe("migration — red→green, no reserved-zero (absence is developed gating)", () => {
  it("the reference-max value reads green, a tiny present value reads red", () => {
    expect(valueRampColorPixi(50, 50, "migration")).toBe(rampTopPixi("migration"));
    expect(valueRampColorPixi(0.0001, 50, "migration")).toBe(rampFloorPixi("migration"));
  });
  it("RESERVES_ABSENT_ZERO is false — a literal 0 rides the red floor, not black", () => {
    expect(valueRampColorPixi(0, 1, "migration")).toBe(rampFloorPixi("migration"));
    expect(valueRampColorPixi(0, 1, "migration")).not.toBe(ABSENT_COLOR);
  });
  it("a tiny present value is never ABSENT_COLOR — rides the red floor, unlike population's literal-0", () => {
    expect(valueRampColorPixi(0.0001, 1, "migration")).not.toBe(ABSENT_COLOR);
  });
  it("rampCssStops is a red→green two-stop legend", () => {
    const migrationStops = rampCssStops("migration");
    expect(migrationStops).toHaveLength(2);
    expect(migrationStops[0]).toMatch(/^rgb\(/);
  });
});

describe("rampCssStops / ABSENT_CSS — the legend's single source", () => {
  it("returns one rgb() stop per ramp anchor", () => {
    const stops = rampCssStops("development");
    expect(stops).toHaveLength(3);
    expect(stops[0]).toMatch(/^rgb\(/);
  });
  it("exposes the reserved absent colour as a hex string", () => {
    expect(ABSENT_CSS).toBe("#08090c");
  });
});

describe("deEmphasize — out-of-scope de-emphasis treatments", () => {
  it("'both' greys and darkens: never ABSENT_COLOR, summed channels strictly lower", () => {
    const input = rampTopPixi("population");
    const out = deEmphasize(input, "both");
    expect(out).not.toBe(ABSENT_COLOR);
    expect(sum(out)).toBeLessThan(sum(input));
  });
  it("'dim' darkens without erasing colour: summed channels strictly lower", () => {
    const input = rampTopPixi("stability");
    const out = deEmphasize(input, "dim");
    expect(out).not.toBe(ABSENT_COLOR);
    expect(sum(out)).toBeLessThan(sum(input));
  });
  it("'desat' pulls channels toward each other (less saturated)", () => {
    const input = rampTopPixi("population"); // a saturated green, channels far apart
    const out = deEmphasize(input, "desat");
    const [r, g, b] = channels(out);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const [ir, ig, ib] = channels(input);
    const inputSpread = Math.max(ir, ig, ib) - Math.min(ir, ig, ib);
    expect(spread).toBeLessThan(inputSpread);
  });
  it("is idempotent-safe on an already-dark development floor colour (still not ABSENT_COLOR)", () => {
    const out = deEmphasize(rampFloorPixi("development"), "both");
    expect(out).not.toBe(ABSENT_COLOR);
  });
});
