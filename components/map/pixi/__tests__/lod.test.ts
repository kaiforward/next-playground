import { describe, it, expect } from "vitest";
import { computeLOD } from "../lod";

const TERRITORY_ALPHA_KEYS = [
  "territoryAlpha",
  "politicalTerritoryAlpha",
] as const;
type TerritoryAlphaKey = (typeof TERRITORY_ALPHA_KEYS)[number];

describe.each(TERRITORY_ALPHA_KEYS)(
  "computeLOD — %s curve (PR 5/5 polish)",
  (key: TerritoryAlphaKey) => {
    it("never culls the territory layer regardless of zoom", () => {
      for (const zoom of [0.05, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0]) {
        expect(computeLOD(zoom).showTerritories).toBe(true);
      }
    });

    it("renders at full opacity in universe view", () => {
      expect(computeLOD(0.1)[key]).toBe(1);
      expect(computeLOD(0.3)[key]).toBe(1);
    });

    it("eases between universe and system view", () => {
      const mid = computeLOD(0.5)[key];
      // Between the 0.3 start and 0.7 end, alpha is mid-way through the
      // 1.0 → 0.5 range.
      expect(mid).toBeGreaterThan(0.5);
      expect(mid).toBeLessThan(1.0);
    });

    it("floors at 0.5 at deep system zoom (never fully transparent)", () => {
      for (const zoom of [0.7, 1.0, 1.5, 2.0]) {
        const alpha = computeLOD(zoom)[key];
        // Allow a tiny float-equality slack.
        expect(alpha).toBeGreaterThanOrEqual(0.49999);
        expect(alpha).toBeLessThanOrEqual(0.50001);
      }
    });

    it("is monotonically non-increasing across the zoom range", () => {
      const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0];
      const alphas = samples.map((z) => computeLOD(z)[key]);
      for (let i = 1; i < alphas.length; i++) {
        expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1] + 1e-9);
      }
    });
  },
);

describe("computeLOD — political and regions territory share the same default config", () => {
  it("yields identical alphas at every zoom sample (until product asks to diverge)", () => {
    for (const zoom of [0.05, 0.3, 0.5, 0.7, 1.0]) {
      const lod = computeLOD(zoom);
      expect(lod.politicalTerritoryAlpha).toBe(lod.territoryAlpha);
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

  it("fleetDotAlpha still fades out across 0.3 → 0.5", () => {
    expect(computeLOD(0.25).fleetDotAlpha).toBe(1);
    expect(computeLOD(0.55).fleetDotAlpha).toBe(0);
  });
});
