import { describe, it, expect } from "vitest";
import {
  STOCK_MIN,
  STOCK_MAX,
  getTargetStock,
  getInitialStock,
  getSpread,
} from "../market-economy";
import { GOVERNMENT_TYPES } from "../government";
import { GOODS } from "../goods";
import { makeResourceVector } from "@/lib/engine/resources";

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
  it("seeds a net producer high (toward produces -> cheap)", () => {
    // Water-rich, low-pop system: strong net water producer.
    const seed = getInitialStock(makeResourceVector({ water: 12 }), 100, "water");
    expect(seed).toBeGreaterThan(getTargetStock("water"));
    expect(seed).toBeLessThanOrEqual(GOODS.water.equilibrium.produces);
  });

  it("seeds a net consumer low (toward consumes -> dear)", () => {
    // Water-barren, populous system: pure net water consumer.
    const consumerSeed = getInitialStock(makeResourceVector({ water: 0 }), 2000, "water");
    const producerSeed = getInitialStock(makeResourceVector({ water: 12 }), 100, "water");
    expect(consumerSeed).toBe(GOODS.water.equilibrium.consumes);
    expect(consumerSeed).toBeLessThan(producerSeed);
  });

  it("seeds at the target when the system has no production or consumption", () => {
    // Zero population -> no rates on either axis -> the pricing anchor.
    expect(getInitialStock(makeResourceVector({ water: 12 }), 0, "water")).toBe(getTargetStock("water"));
  });

  it("seeds an unknown good at its target", () => {
    expect(getInitialStock(makeResourceVector({}), 1000, "not_a_good")).toBe(getTargetStock("not_a_good"));
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
