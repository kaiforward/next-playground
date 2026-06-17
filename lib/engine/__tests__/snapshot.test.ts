import { describe, it, expect } from "vitest";
import {
  buildPriceEntry,
  appendSnapshot,
  type MarketInput,
  type PriceHistoryEntry,
} from "../snapshot";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";

// ── buildPriceEntry ─────────────────────────────────────────────

describe("buildPriceEntry", () => {
  // Price is the spot price off each market's per-system days-of-supply curve
  // (reference = TARGET_COVER × demandRate). The fixtures omit floor/ceiling,
  // so buildPriceEntry applies the 0.2×/5.0× defaults.
  const markets: MarketInput[] = [
    { systemId: "sys-1", goodId: "food", stock: 100, basePrice: 20, demandRate: 1 },
    { systemId: "sys-1", goodId: "water", stock: 50, basePrice: 40, demandRate: 1 },
    { systemId: "sys-2", goodId: "food", stock: 200, basePrice: 20, demandRate: 1 },
  ];

  // Mirror buildPriceEntry's own curve so the expectations track TARGET_COVER
  // through any recalibration instead of baking in a numeric price.
  const priceFor = (basePrice: number, stock: number, demandRate: number) =>
    spotPrice(curveForGood(basePrice, 0.2, 5.0, demandRate), stock);

  it("groups markets by system and computes spot prices from stock", () => {
    const result = buildPriceEntry(markets, 100);
    expect(result.size).toBe(2);

    const sys1 = result.get("sys-1")!;
    expect(sys1.tick).toBe(100);
    expect(sys1.prices["food"]).toBe(priceFor(20, 100, 1));
    expect(sys1.prices["water"]).toBe(priceFor(40, 50, 1));

    const sys2 = result.get("sys-2")!;
    expect(sys2.tick).toBe(100);
    expect(sys2.prices["food"]).toBe(priceFor(20, 200, 1));
    // Same good, deeper stock at sys-2 ⇒ strictly cheaper than sys-1.
    expect(sys2.prices["food"]).toBeLessThan(sys1.prices["food"]);
  });

  it("returns empty map for empty input", () => {
    const result = buildPriceEntry([], 50);
    expect(result.size).toBe(0);
  });

  it("handles zero stock (ceiling price)", () => {
    const result = buildPriceEntry(
      [{ systemId: "sys-1", goodId: "food", stock: 0, basePrice: 20, demandRate: 1 }],
      10,
    );
    expect(result.get("sys-1")!.prices["food"]).toBe(100); // 5.0 * 20
  });

  it("clamps price to the floor when stock is abundant", () => {
    // stock vastly exceeds target → price floors at 0.2 * basePrice
    const result = buildPriceEntry(
      [{ systemId: "sys-1", goodId: "food", stock: 100000, basePrice: 100, demandRate: 1 }],
      10,
    );
    expect(result.get("sys-1")!.prices["food"]).toBe(20); // 0.2 * 100
  });
});

// ── appendSnapshot ──────────────────────────────────────────────

describe("appendSnapshot", () => {
  const entry: PriceHistoryEntry = { tick: 100, prices: { food: 20 } };

  it("appends to an empty array", () => {
    const result = appendSnapshot([], entry, 50);
    expect(result).toEqual([entry]);
  });

  it("appends without trimming when under max", () => {
    const existing: PriceHistoryEntry[] = [
      { tick: 80, prices: { food: 18 } },
    ];
    const result = appendSnapshot(existing, entry, 50);
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(entry);
  });

  it("caps at max entries by dropping oldest", () => {
    const existing: PriceHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      tick: i * 20,
      prices: { food: 20 + i },
    }));
    const result = appendSnapshot(existing, entry, 5);
    expect(result).toHaveLength(5);
    // Oldest (tick=0) should be dropped
    expect(result[0].tick).toBe(20);
    expect(result[4]).toEqual(entry);
  });

  it("does not mutate the existing array", () => {
    const existing: PriceHistoryEntry[] = [{ tick: 80, prices: { food: 18 } }];
    const copy = [...existing];
    appendSnapshot(existing, entry, 50);
    expect(existing).toEqual(copy);
  });
});
