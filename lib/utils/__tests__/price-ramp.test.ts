import { describe, it, expect } from "vitest";
import { priceRampColor, priceRampColorPixi, PRICE_RAMP_STOPS } from "../price-ramp";

describe("priceRampColor mode-awareness", () => {
  it("buy mode (default): cheap = green, expensive = red", () => {
    expect(priceRampColor(50, 100)).toBe(PRICE_RAMP_STOPS.deepBargain); // 0.5× → green
    expect(priceRampColor(200, 100)).toBe(PRICE_RAMP_STOPS.deepPremium); // 2.0× → red
  });

  it("sell mode: expensive = green, cheap = red (mirror of buy)", () => {
    // 2.0× to sell is great → green; mirror lookup uses base/current = 0.5
    expect(priceRampColor(200, 100, "sell")).toBe(PRICE_RAMP_STOPS.deepBargain);
    // 0.5× to sell is bad → red; mirror uses base/current = 2.0
    expect(priceRampColor(50, 100, "sell")).toBe(PRICE_RAMP_STOPS.deepPremium);
  });

  it("neutral (at base) is neutral in both modes", () => {
    expect(priceRampColor(100, 100, "buy")).toBe(PRICE_RAMP_STOPS.neutral);
    expect(priceRampColor(100, 100, "sell")).toBe(PRICE_RAMP_STOPS.neutral);
  });

  it("returns null for non-positive prices", () => {
    expect(priceRampColor(100, 0)).toBeNull();
    expect(priceRampColor(0, 100, "sell")).toBeNull();
  });
});

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

describe("priceRampColorPixi", () => {
  it("converts a known hex stop to the matching Pixi integer", () => {
    // neutral stop: #d9c95d => parseInt("d9c95d", 16) = 14272861
    expect(priceRampColorPixi(100, 100)).toBe(parseInt("d9c95d", 16));
  });

  it("converts the deep-bargain stop correctly", () => {
    // deepBargain stop: #3ec775 => parseInt("3ec775", 16) = 4113269
    expect(priceRampColorPixi(60, 100)).toBe(parseInt("3ec775", 16));
  });

  it("returns null when basePrice is non-positive", () => {
    expect(priceRampColorPixi(100, 0)).toBeNull();
  });
});
