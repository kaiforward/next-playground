import { describe, it, expect } from "vitest";
import { priceRampColor, PRICE_RAMP_STOPS } from "../price-ramp";

describe("priceRampColor", () => {
  it("returns the deep-bargain green at <= 0.6x base", () => {
    expect(priceRampColor(60, 100)).toBe(PRICE_RAMP_STOPS.deepBargain);
    expect(priceRampColor(40, 100)).toBe(PRICE_RAMP_STOPS.deepBargain);
  });

  it("returns the light-bargain green at 0.85x", () => {
    expect(priceRampColor(85, 100)).toBe(PRICE_RAMP_STOPS.bargain);
  });

  it("returns neutral amber near base", () => {
    expect(priceRampColor(100, 100)).toBe(PRICE_RAMP_STOPS.neutral);
    expect(priceRampColor(99, 100)).toBe(PRICE_RAMP_STOPS.neutral);
  });

  it("returns orange premium at 1.15x", () => {
    expect(priceRampColor(115, 100)).toBe(PRICE_RAMP_STOPS.premium);
  });

  it("returns deep-premium red at >= 1.4x", () => {
    expect(priceRampColor(140, 100)).toBe(PRICE_RAMP_STOPS.deepPremium);
    expect(priceRampColor(250, 100)).toBe(PRICE_RAMP_STOPS.deepPremium);
  });

  it("returns null when basePrice is 0 or current is missing", () => {
    expect(priceRampColor(100, 0)).toBeNull();
  });
});
