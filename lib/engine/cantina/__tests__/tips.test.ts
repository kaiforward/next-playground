import { describe, it, expect } from "vitest";
import {
  generateLocalTips,
  generateNeighborTips,
  combineTips,
} from "../tips";
import type { MarketEntry } from "@/lib/types/game";

function makeEntry(overrides: Partial<MarketEntry>): MarketEntry {
  return {
    goodId: "food",
    goodName: "Food",
    basePrice: 100,
    currentPrice: 100,
    supply: 50,
    demand: 50,
    ...overrides,
  };
}

describe("generateLocalTips", () => {
  it("returns tips for goods well below base price", () => {
    const entries = [
      makeEntry({ goodId: "food", goodName: "Food", basePrice: 100, currentPrice: 70 }),
      makeEntry({ goodId: "ore", goodName: "Ore", basePrice: 200, currentPrice: 195 }),
    ];

    const tips = generateLocalTips(entries);
    expect(tips).toHaveLength(1);
    expect(tips[0].goodId).toBe("food");
    expect(tips[0].type).toBe("local");
    expect(tips[0].text).toContain("Food");
  });

  it("returns empty array when no goods are significantly below base price", () => {
    const entries = [
      makeEntry({ basePrice: 100, currentPrice: 95 }),
    ];

    const tips = generateLocalTips(entries);
    expect(tips).toHaveLength(0);
  });

  it("returns at most 2 tips", () => {
    const entries = [
      makeEntry({ goodId: "a", goodName: "A", basePrice: 100, currentPrice: 50 }),
      makeEntry({ goodId: "b", goodName: "B", basePrice: 100, currentPrice: 60 }),
      makeEntry({ goodId: "c", goodName: "C", basePrice: 100, currentPrice: 70 }),
    ];

    const tips = generateLocalTips(entries);
    expect(tips.length).toBeLessThanOrEqual(2);
  });
});

describe("generateNeighborTips", () => {
  it("returns tips for price differentials above threshold", () => {
    const local = [
      makeEntry({ goodId: "food", goodName: "Food", currentPrice: 50 }),
    ];
    const neighbors = [
      {
        systemName: "Alpha",
        entries: [
          makeEntry({ goodId: "food", goodName: "Food", currentPrice: 120 }),
        ],
      },
    ];

    const tips = generateNeighborTips(local, neighbors);
    expect(tips).toHaveLength(1);
    expect(tips[0].type).toBe("neighbor");
    expect(tips[0].systemName).toBe("Alpha");
    expect(tips[0].text).toContain("Food");
    expect(tips[0].text).toContain("Alpha");
  });

  it("ignores small price differentials", () => {
    const local = [
      makeEntry({ goodId: "food", currentPrice: 100 }),
    ];
    const neighbors = [
      {
        systemName: "Alpha",
        entries: [makeEntry({ goodId: "food", currentPrice: 105 })],
      },
    ];

    const tips = generateNeighborTips(local, neighbors);
    expect(tips).toHaveLength(0);
  });
});

describe("combineTips", () => {
  it("caps at 3 tips total", () => {
    const local = generateLocalTips([
      makeEntry({ goodId: "a", goodName: "A", basePrice: 100, currentPrice: 50 }),
      makeEntry({ goodId: "b", goodName: "B", basePrice: 100, currentPrice: 60 }),
    ]);
    const neighbor = generateNeighborTips(
      [makeEntry({ goodId: "c", goodName: "C", currentPrice: 30 })],
      [
        {
          systemName: "Z",
          entries: [makeEntry({ goodId: "c", goodName: "C", currentPrice: 200 })],
        },
      ],
    );

    const combined = combineTips(local, neighbor);
    expect(combined.length).toBeLessThanOrEqual(3);
  });

  it("returns a fallback line when no tips are available", () => {
    const combined = combineTips([], []);
    expect(combined).toHaveLength(1);
    expect(combined[0].goodId).toBe("");
  });
});
