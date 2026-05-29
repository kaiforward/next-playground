import { describe, it, expect } from "vitest";
import { validateAndCalculateTrade, validateFleetTrade, type TradeParams } from "../trade";

const BUY_BASE: TradeParams = {
  type: "buy",
  quantity: 10,
  totalPrice: 1000,
  playerCredits: 5000,
  currentCargoUsed: 0,
  cargoMax: 100,
  currentStock: 100,
  stockMin: 5,
  stockMax: 200,
  currentGoodQuantityInCargo: 0,
};

describe("validateAndCalculateTrade — buy", () => {
  it("produces a negative-credit, +cargo, -stock delta", () => {
    const res = validateAndCalculateTrade(BUY_BASE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.delta).toEqual({
      creditsDelta: -1000,
      cargoQuantityDelta: 10,
      stockDelta: -10,
      totalPrice: 1000,
    });
  });

  it("rejects when the player cannot afford the total", () => {
    const res = validateAndCalculateTrade({ ...BUY_BASE, playerCredits: 999 });
    expect(res.ok).toBe(false);
  });

  it("rejects when cargo space is insufficient", () => {
    const res = validateAndCalculateTrade({ ...BUY_BASE, currentCargoUsed: 95 });
    expect(res.ok).toBe(false);
  });

  it("caps the buy at floor(stock - stockMin) — the market keeps a reserve", () => {
    // stock 12, min 5 -> at most 7 buyable; asking 10 fails
    const res = validateAndCalculateTrade({ ...BUY_BASE, currentStock: 12, quantity: 10 });
    expect(res.ok).toBe(false);
    const ok = validateAndCalculateTrade({ ...BUY_BASE, currentStock: 12, quantity: 7 });
    expect(ok.ok).toBe(true);
  });
});

describe("validateAndCalculateTrade — sell", () => {
  const SELL_BASE: TradeParams = {
    type: "sell",
    quantity: 10,
    totalPrice: 800,
    playerCredits: 0,
    currentCargoUsed: 10,
    cargoMax: 100,
    currentStock: 100,
    stockMin: 5,
    stockMax: 200,
    currentGoodQuantityInCargo: 10,
  };

  it("produces a positive-credit, -cargo, +stock delta", () => {
    const res = validateAndCalculateTrade(SELL_BASE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.delta).toEqual({
      creditsDelta: 800,
      cargoQuantityDelta: -10,
      stockDelta: 10,
      totalPrice: 800,
    });
  });

  it("rejects selling more than is in cargo", () => {
    const res = validateAndCalculateTrade({ ...SELL_BASE, currentGoodQuantityInCargo: 4 });
    expect(res.ok).toBe(false);
  });

  it("caps the sell at floor(stockMax - stock) — can't sell into a full warehouse", () => {
    // stock 195, max 200 -> at most 5 absorbable; asking 10 fails
    const res = validateAndCalculateTrade({
      ...SELL_BASE,
      currentStock: 195,
      currentGoodQuantityInCargo: 10,
      quantity: 10,
    });
    expect(res.ok).toBe(false);
    const ok = validateAndCalculateTrade({
      ...SELL_BASE,
      currentStock: 195,
      currentGoodQuantityInCargo: 10,
      quantity: 5,
    });
    expect(ok.ok).toBe(true);
  });
});

describe("validateAndCalculateTrade — quantity guard", () => {
  const SELL_BASE: TradeParams = {
    type: "sell",
    quantity: 10,
    totalPrice: 800,
    playerCredits: 0,
    currentCargoUsed: 10,
    cargoMax: 100,
    currentStock: 100,
    stockMin: 5,
    stockMax: 200,
    currentGoodQuantityInCargo: 10,
  };

  it("rejects a zero quantity", () => {
    expect(validateAndCalculateTrade({ ...BUY_BASE, quantity: 0 }).ok).toBe(false);
    expect(validateAndCalculateTrade({ ...SELL_BASE, quantity: 0 }).ok).toBe(false);
  });

  it("rejects a negative quantity", () => {
    expect(validateAndCalculateTrade({ ...BUY_BASE, quantity: -1 }).ok).toBe(false);
    expect(validateAndCalculateTrade({ ...SELL_BASE, quantity: -1 }).ok).toBe(false);
  });

  it("rejects a non-integer quantity", () => {
    expect(validateAndCalculateTrade({ ...BUY_BASE, quantity: 1.5 }).ok).toBe(false);
  });
});

describe("validateAndCalculateTrade — stock boundaries", () => {
  it("a max buy drains stock exactly to stockMin (the reserve floor)", () => {
    // stock 12, min 5 → 7 buyable; buying all 7 lands stock at the floor.
    const res = validateAndCalculateTrade({ ...BUY_BASE, currentStock: 12, quantity: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(12 + res.delta.stockDelta).toBe(5); // == stockMin
  });

  it("a max sell fills stock exactly to stockMax (can't overfill the warehouse)", () => {
    // stock 195, max 200 → 5 absorbable; selling all 5 lands stock at the ceiling.
    const res = validateAndCalculateTrade({
      type: "sell",
      quantity: 5,
      totalPrice: 400,
      playerCredits: 0,
      currentCargoUsed: 5,
      cargoMax: 100,
      currentStock: 195,
      stockMin: 5,
      stockMax: 200,
      currentGoodQuantityInCargo: 5,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(195 + res.delta.stockDelta).toBe(200); // == stockMax
  });
});

describe("validateFleetTrade", () => {
  it("rejects a non-docked ship before any market checks", () => {
    const res = validateFleetTrade({ ...BUY_BASE, shipStatus: "in_transit" });
    expect(res.ok).toBe(false);
  });

  it("delegates to validateAndCalculateTrade when docked", () => {
    const res = validateFleetTrade({ ...BUY_BASE, shipStatus: "docked" });
    expect(res.ok).toBe(true);
  });
});
