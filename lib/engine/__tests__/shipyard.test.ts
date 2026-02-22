import { describe, it, expect } from "vitest";
import { validateShipPurchase } from "../shipyard";

describe("validateShipPurchase", () => {
  it("accepts a valid light_freighter purchase", () => {
    const result = validateShipPurchase({
      shipType: "light_freighter",
      playerCredits: 10_000,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        shipTypeDef: expect.objectContaining({ id: "light_freighter", price: 3000 }),
        totalCost: 3000,
      },
    });
  });

  it("accepts purchase with exact credits", () => {
    const result = validateShipPurchase({
      shipType: "light_freighter",
      playerCredits: 3000,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown ship type", () => {
    const result = validateShipPurchase({
      shipType: "battlecruiser",
      playerCredits: 99_999,
    });
    expect(result).toEqual({
      ok: false,
      error: 'Unknown ship type: "battlecruiser".',
    });
  });

  it("rejects starter-only ship type (shuttle)", () => {
    const result = validateShipPurchase({
      shipType: "shuttle",
      playerCredits: 99_999,
    });
    expect(result).toEqual({
      ok: false,
      error: "Shuttle is not available for purchase.",
    });
  });

  it("rejects when player cannot afford", () => {
    const result = validateShipPurchase({
      shipType: "light_freighter",
      playerCredits: 2999,
    });
    expect(result).toEqual({
      ok: false,
      error: "Not enough credits. Need 3000, have 2999.",
    });
  });

  it("accepts expensive ship purchase", () => {
    const result = validateShipPurchase({
      shipType: "command_vessel",
      playerCredits: 50_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.totalCost).toBe(50_000);
    }
  });
});
