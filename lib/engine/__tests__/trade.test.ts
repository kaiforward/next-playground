import { describe, it, expect } from "vitest";
import { validateAndCalculateTrade, validateFleetTrade } from "../trade";

describe("validateAndCalculateTrade", () => {
  const baseBuyParams = {
    type: "buy" as const,
    quantity: 5,
    unitPrice: 100,
    playerCredits: 1000,
    currentCargoUsed: 10,
    cargoMax: 50,
    currentSupply: 20,
    currentGoodQuantityInCargo: 0,
  };

  const baseSellParams = {
    type: "sell" as const,
    quantity: 5,
    unitPrice: 100,
    playerCredits: 500,
    currentCargoUsed: 10,
    cargoMax: 50,
    currentSupply: 20,
    currentGoodQuantityInCargo: 10,
  };

  describe("buy", () => {
    it("succeeds with valid params", () => {
      const result = validateAndCalculateTrade(baseBuyParams);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.delta.creditsDelta).toBe(-500); // 5 * 100
        expect(result.delta.cargoQuantityDelta).toBe(5);
        expect(result.delta.supplyDelta).toBe(-5);
        expect(result.delta.demandDelta).toBe(1); // round(5 * 0.1)
        expect(result.delta.totalPrice).toBe(500);
      }
    });

    it("fails when not enough credits", () => {
      const result = validateAndCalculateTrade({
        ...baseBuyParams,
        playerCredits: 100, // Need 500 (5 * 100)
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Not enough credits");
      }
    });

    it("fails when cargo is full", () => {
      const result = validateAndCalculateTrade({
        ...baseBuyParams,
        currentCargoUsed: 48, // Only 2 slots left, need 5
        cargoMax: 50,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Not enough cargo space");
      }
    });

    it("fails when not enough supply", () => {
      const result = validateAndCalculateTrade({
        ...baseBuyParams,
        currentSupply: 3, // Only 3 available, want 5
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Not enough supply");
      }
    });
  });

  describe("sell", () => {
    it("succeeds with valid params", () => {
      const result = validateAndCalculateTrade(baseSellParams);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.delta.creditsDelta).toBe(500); // 5 * 100
        expect(result.delta.cargoQuantityDelta).toBe(-5);
        expect(result.delta.supplyDelta).toBe(5);
        expect(result.delta.demandDelta).toBe(-1); // -round(5 * 0.1)
        expect(result.delta.totalPrice).toBe(500);
      }
    });

    it("fails when not enough cargo", () => {
      const result = validateAndCalculateTrade({
        ...baseSellParams,
        currentGoodQuantityInCargo: 2, // Only have 2, want to sell 5
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Not enough in cargo");
      }
    });
  });

  it("rejects zero quantity", () => {
    const result = validateAndCalculateTrade({
      ...baseBuyParams,
      quantity: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Quantity must be a positive integer");
    }
  });

  it("rejects negative quantity", () => {
    const result = validateAndCalculateTrade({
      ...baseBuyParams,
      quantity: -3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Quantity must be a positive integer");
    }
  });
});

describe("validateFleetTrade", () => {
  const baseParams = {
    type: "buy" as const,
    quantity: 5,
    unitPrice: 100,
    playerCredits: 1000,
    currentCargoUsed: 10,
    cargoMax: 50,
    currentSupply: 20,
    currentGoodQuantityInCargo: 0,
    shipStatus: "docked" as const,
  };

  it("succeeds when ship is docked", () => {
    const result = validateFleetTrade(baseParams);
    expect(result.ok).toBe(true);
  });

  it("fails when ship is in transit", () => {
    const result = validateFleetTrade({
      ...baseParams,
      shipStatus: "in_transit",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Ship must be docked to trade");
    }
  });

  it("delegates validation to validateAndCalculateTrade when docked", () => {
    const result = validateFleetTrade({
      ...baseParams,
      playerCredits: 100, // Not enough
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Not enough credits");
    }
  });
});
