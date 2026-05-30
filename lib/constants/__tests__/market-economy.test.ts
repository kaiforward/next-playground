import { describe, it, expect } from "vitest";
import {
  STOCK_MIN,
  STOCK_MAX,
  getTargetStock,
  getInitialStock,
  getSpread,
} from "../market-economy";
import { GOVERNMENT_TYPES } from "../government";

describe("stock bounds", () => {
  it("reuses the legacy supply band", () => {
    expect(STOCK_MIN).toBe(5);
    expect(STOCK_MAX).toBe(200);
  });
});

describe("getTargetStock", () => {
  it("returns the calibrated anchor for re-anchored goods", () => {
    // Staples touched by every economy type (no neutral markets to hold the
    // average up) settle below the supply-band midpoint, so their anchor is
    // pinned to the measured equilibrium (PR 3 calibration).
    expect(getTargetStock("water")).toBe(116);
    expect(getTargetStock("food")).toBe(111);
  });

  it("falls back to the supply-band midpoint for uncalibrated goods", () => {
    // luxuries: produces.supply 38, consumes.supply 24 -> round((38+24)/2)=31
    expect(getTargetStock("luxuries")).toBe(31);
  });

  it("falls back to the mid stock band for unknown goods", () => {
    expect(getTargetStock("not_a_good")).toBe(Math.round((STOCK_MIN + STOCK_MAX) / 2));
  });
});

describe("getInitialStock", () => {
  it("seeds producers high (above target -> cheap)", () => {
    // agricultural produces food (produces.supply 155)
    expect(getInitialStock("agricultural", "food")).toBe(155);
    expect(getInitialStock("agricultural", "food")).toBeGreaterThan(getTargetStock("food"));
  });

  it("seeds consumers below producers, blended by self-sufficiency", () => {
    // tech consumes food (self-sufficiency 0.15) -> blended between consumes.supply
    // (110) and produces.supply (155), below the producer seed. The cheap/expensive
    // spread vs the anchor is an emergent steady-state property (see simulator), not
    // a seed-time guarantee now that the anchor sits at the equilibrium.
    const consumerSeed = getInitialStock("tech", "food");
    const producerSeed = getInitialStock("agricultural", "food");
    expect(consumerSeed).toBeLessThan(producerSeed);
    expect(consumerSeed).toBeGreaterThanOrEqual(110);
    expect(consumerSeed).toBeLessThanOrEqual(155);
  });

  it("seeds neutral goods at the target (-> price == base)", () => {
    // a good the economy neither produces nor consumes resolves to targetStock
    expect(getInitialStock("agricultural", "weapons")).toBe(getTargetStock("weapons"));
  });
});

describe("getSpread", () => {
  it("returns the default half-spread with no government", () => {
    expect(getSpread()).toBe(0.05);
  });

  it("widens for frontier and tightens for authoritarian", () => {
    const frontier = getSpread(GOVERNMENT_TYPES.frontier); // +20% -> 0.06
    const auth = getSpread(GOVERNMENT_TYPES.authoritarian); // -15% -> 0.0425
    expect(frontier).toBeCloseTo(0.06, 5);
    expect(auth).toBeCloseTo(0.0425, 5);
    expect(frontier).toBeGreaterThan(auth);
  });
});
