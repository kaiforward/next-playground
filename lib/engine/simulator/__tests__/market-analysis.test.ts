import { describe, it, expect } from "vitest";
import {
  takeMarketSnapshot,
  computeMarketHealth,
} from "../market-analysis";
import type { SimWorld, SimMarketEntry } from "../types";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";

function market(
  systemId: string,
  goodId: string,
  stock: number,
): SimMarketEntry {
  return { systemId, goodId, basePrice: 100, stock, anchorMult: 1, demandRate: 1, priceFloor: 0.2, priceCeiling: 5.0 };
}

/** Minimal SimWorld — the analysis functions only read `markets`. */
function world(markets: SimMarketEntry[]): SimWorld {
  return {
    tick: 0,
    regions: [],
    systems: [],
    connections: [],
    markets,
    events: [],
    modifiers: [],
    ships: [],
    players: [],
    flowEvents: [],
    nextId: 0,
  };
}

describe("takeMarketSnapshot", () => {
  it("emits one snapshot per market with the spot price at its stock", () => {
    const m = market("sys-1", "water", 200);
    const snaps = takeMarketSnapshot(world([m]));

    expect(snaps).toHaveLength(1);
    expect(snaps[0].systemId).toBe("sys-1");
    expect(snaps[0].goodId).toBe("water");
    expect(snaps[0].stock).toBe(200);
    expect(snaps[0].price).toBe(
      spotPrice(curveForGood(100, 0.2, 5.0, 1), 200),
    );
  });
});

describe("computeMarketHealth — stock drift", () => {
  it("averages drift per good, signs it vs the per-system reference, and sorts by |drift|", () => {
    // The market() fixture uses basePrice 100, demandRate 1, anchorMult 1, so
    // every market's reference is curveForGood(100, 0.2, 5.0, 1).targetStock.
    // water: stocks 200 & 140 → both above the reference → avg drift positive.
    // luxuries: stock 20 → below the reference → drift negative.
    const { stockDrift } = computeMarketHealth(
      world([
        market("sys-1", "water", 200),
        market("sys-2", "water", 140),
        market("sys-1", "luxuries", 20),
      ]),
    );

    const reference = curveForGood(100, 0.2, 5.0, 1).targetStock;
    const expectedWater = (200 + 140) / 2 - reference;
    const expectedLux = 20 - reference;

    // |water drift| > |luxuries drift| → water sorts first.
    expect(stockDrift[0].goodId).toBe("water");
    expect(stockDrift[0].avgStockDrift).toBeCloseTo(expectedWater, 5);
    expect(stockDrift[0].avgStockDrift).toBeGreaterThan(0); // above reference

    const lux = stockDrift.find((d) => d.goodId === "luxuries");
    expect(lux?.avgStockDrift).toBeCloseTo(expectedLux, 5);
    expect(lux?.avgStockDrift).toBeLessThan(0); // below reference
  });
});

describe("computeMarketHealth — price dispersion", () => {
  it("reports zero dispersion for a single-system good and positive for a split one", () => {
    const { priceDispersion } = computeMarketHealth(
      world([
        market("sys-1", "water", 200), // price ≈ 25
        market("sys-2", "water", 140), // price ≈ 36 → spread across systems
        market("sys-1", "luxuries", 20), // single system → no dispersion
      ]),
    );

    const water = priceDispersion.find((p) => p.goodId === "water");
    const lux = priceDispersion.find((p) => p.goodId === "luxuries");
    expect(water?.avgStdDev).toBeGreaterThan(0);
    expect(lux?.avgStdDev).toBe(0);
    // Sorted by dispersion descending → water (the only good that varies) first.
    expect(priceDispersion[0].goodId).toBe("water");
  });
});
