import { describe, it, expect } from "vitest";
import {
  buildPriceEntry,
  appendSnapshot,
  type MarketInput,
  type PriceHistoryEntry,
} from "../snapshot";

// ── buildPriceEntry ─────────────────────────────────────────────

describe("buildPriceEntry", () => {
  const markets: MarketInput[] = [
    { systemId: "sys-1", goodId: "food", supply: 100, demand: 100, basePrice: 20 },
    { systemId: "sys-1", goodId: "ore", supply: 50, demand: 100, basePrice: 40 },
    { systemId: "sys-2", goodId: "food", supply: 200, demand: 100, basePrice: 20 },
  ];

  it("groups markets by system and calculates prices", () => {
    const result = buildPriceEntry(markets, 100);
    expect(result.size).toBe(2);

    const sys1 = result.get("sys-1")!;
    expect(sys1.tick).toBe(100);
    expect(sys1.prices["food"]).toBe(20); // 100/100 * 20 = 20
    expect(sys1.prices["ore"]).toBe(80); // 100/50 * 40 = 80

    const sys2 = result.get("sys-2")!;
    expect(sys2.tick).toBe(100);
    expect(sys2.prices["food"]).toBe(10); // 100/200 * 20 = 10
  });

  it("returns empty map for empty input", () => {
    const result = buildPriceEntry([], 50);
    expect(result.size).toBe(0);
  });

  it("handles zero supply (max price)", () => {
    const result = buildPriceEntry(
      [{ systemId: "sys-1", goodId: "food", supply: 0, demand: 100, basePrice: 20 }],
      10,
    );
    expect(result.get("sys-1")!.prices["food"]).toBe(100); // 5.0 * 20
  });

  it("clamps price to minimum", () => {
    // supply vastly exceeds demand → price floors at 0.2 * basePrice
    const result = buildPriceEntry(
      [{ systemId: "sys-1", goodId: "food", supply: 10000, demand: 1, basePrice: 100 }],
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
