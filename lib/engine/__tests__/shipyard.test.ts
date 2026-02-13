import { describe, it, expect } from "vitest";
import { validateShipPurchase } from "../shipyard";

describe("validateShipPurchase", () => {
  it("accepts a valid freighter purchase", () => {
    const result = validateShipPurchase({
      shipType: "freighter",
      playerCredits: 10_000,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        shipTypeDef: expect.objectContaining({ id: "freighter", price: 5000 }),
        totalCost: 5000,
      },
    });
  });

  it("accepts purchase with exact credits", () => {
    const result = validateShipPurchase({
      shipType: "freighter",
      playerCredits: 5000,
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
      shipType: "freighter",
      playerCredits: 4999,
    });
    expect(result).toEqual({
      ok: false,
      error: "Not enough credits. Need 5000, have 4999.",
    });
  });
});
