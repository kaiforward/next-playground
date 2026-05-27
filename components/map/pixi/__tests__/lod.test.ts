import { describe, it, expect } from "vitest";
import { computeLOD } from "../lod";

describe("computeLOD — territory visibility curve (PR 5/5 polish)", () => {
  it("never culls the territory layer regardless of zoom", () => {
    for (const zoom of [0.05, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0]) {
      expect(computeLOD(zoom).showTerritories).toBe(true);
    }
  });

  it("renders at full opacity in universe view", () => {
    expect(computeLOD(0.1).territoryAlpha).toBe(1);
    expect(computeLOD(0.3).territoryAlpha).toBe(1);
  });

  it("eases between universe and system view", () => {
    const mid = computeLOD(0.5).territoryAlpha;
    // Between the 0.3 start and 0.7 end of the ease, alpha is mid-way through
    // the 1.0 → 0.6 range.
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(1.0);
  });

  it("floors at ~0.6 at deep system zoom (never fully transparent)", () => {
    for (const zoom of [0.7, 1.0, 1.5, 2.0]) {
      const alpha = computeLOD(zoom).territoryAlpha;
      // Allow a tiny float-equality slack.
      expect(alpha).toBeGreaterThanOrEqual(0.59999);
      expect(alpha).toBeLessThanOrEqual(0.60001);
    }
  });

  it("territoryAlpha is monotonically non-increasing across the zoom range", () => {
    const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0];
    const alphas = samples.map((z) => computeLOD(z).territoryAlpha);
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1] + 1e-9);
    }
  });
});

describe("computeLOD — unchanged adjacent curves (regression guards)", () => {
  it("regionLabelAlpha still fades to zero past 0.5", () => {
    // Labels follow their existing curve — they're text, not tint.
    expect(computeLOD(0.6).regionLabelAlpha).toBe(0);
  });

  it("tradeFlowAlpha still fades in across 0.4 → 0.6", () => {
    expect(computeLOD(0.3).tradeFlowAlpha).toBe(0);
    expect(computeLOD(0.7).tradeFlowAlpha).toBe(1);
  });
});
