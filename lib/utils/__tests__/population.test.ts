import { describe, it, expect } from "vitest";
import {
  populationRampColor,
  populationRampColorPixi,
  POPULATION_RAMP_CSS,
} from "../population";

describe("populationRampColor", () => {
  it("is red at zero population", () => {
    expect(populationRampColor(0)).toBe("#ef4444");
  });

  it("is green at the highest visible population (ratio 1)", () => {
    expect(populationRampColor(1)).toBe("#22c55e");
  });

  it("is amber at the midpoint", () => {
    expect(populationRampColor(0.5)).toBe("#f59e0b");
  });

  it("clamps out-of-range ratios (and NaN) to the ends", () => {
    expect(populationRampColor(-1)).toBe("#ef4444");
    expect(populationRampColor(2)).toBe("#22c55e");
    expect(populationRampColor(Number.NaN)).toBe("#ef4444");
  });

  it("interpolates across the lower half (red → amber): g rises, b falls", () => {
    const hex = populationRampColor(0.25);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // red #ef4444 (239,68,68) → amber #f59e0b (245,158,11)
    expect(r).toBeGreaterThanOrEqual(239);
    expect(r).toBeLessThanOrEqual(245);
    expect(g).toBeGreaterThan(68);
    expect(g).toBeLessThan(158);
    expect(b).toBeLessThan(68);
  });
});

describe("populationRampColorPixi", () => {
  it("matches the CSS hex as an integer at the anchors", () => {
    expect(populationRampColorPixi(0)).toBe(parseInt("ef4444", 16));
    expect(populationRampColorPixi(0.5)).toBe(parseInt("f59e0b", 16));
    expect(populationRampColorPixi(1)).toBe(parseInt("22c55e", 16));
  });

  it("returns a plain non-negative integer across the range", () => {
    [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].forEach((ratio) => {
      const result = populationRampColorPixi(ratio);
      expect(typeof result).toBe("number");
      expect(Number.isNaN(result)).toBe(false);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("POPULATION_RAMP_CSS", () => {
  it("exposes the red → amber → green legend stops", () => {
    expect(POPULATION_RAMP_CSS).toEqual(["#ef4444", "#f59e0b", "#22c55e"]);
  });
});
