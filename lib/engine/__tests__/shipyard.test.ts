import { describe, it, expect } from "vitest";
import { validateShipPurchase } from "../shipyard";
import { SHIP_TYPES } from "@/lib/constants/ships";

const LF_PRICE = SHIP_TYPES.light_freighter.price;
const CV_PRICE = SHIP_TYPES.command_vessel.price;

describe("validateShipPurchase", () => {
  it("accepts a valid light_freighter purchase", () => {
    const result = validateShipPurchase({
      shipType: "light_freighter",
      playerCredits: LF_PRICE + 1000,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        shipTypeDef: expect.objectContaining({ id: "light_freighter", price: LF_PRICE }),
        totalCost: LF_PRICE,
      },
    });
  });

  it("accepts purchase with exact credits", () => {
    const result = validateShipPurchase({
      shipType: "light_freighter",
      playerCredits: LF_PRICE,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unknown ship type", () => {
    const result = validateShipPurchase({
      shipType: "battlecruiser",
      playerCredits: 999_999,
    });
    expect(result).toEqual({
      ok: false,
      error: 'Unknown ship type: "battlecruiser".',
    });
  });

  it("rejects starter-only ship type (shuttle)", () => {
    const result = validateShipPurchase({
      shipType: "shuttle",
      playerCredits: 999_999,
    });
    expect(result).toEqual({
      ok: false,
      error: "Shuttle is not available for purchase.",
    });
  });

  it("rejects when player cannot afford", () => {
    const result = validateShipPurchase({
      shipType: "light_freighter",
      playerCredits: LF_PRICE - 1,
    });
    expect(result).toEqual({
      ok: false,
      error: `Not enough credits. Need ${LF_PRICE}, have ${LF_PRICE - 1}.`,
    });
  });

  it("accepts expensive ship purchase", () => {
    const result = validateShipPurchase({
      shipType: "command_vessel",
      playerCredits: CV_PRICE,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.totalCost).toBe(CV_PRICE);
    }
  });
});
