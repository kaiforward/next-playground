import { describe, it, expect } from "vitest";
import {
  takeMarketSnapshot,
  computeMarketHealth,
} from "../market-analysis";
import type { SimWorld, SimMarketEntry } from "../types";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { getTargetStock } from "@/lib/constants/market-economy";

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
      spotPrice(curveForGood("water", 100, 0.2, 5.0), 200),
    );
  });
});

describe("computeMarketHealth — stock drift", () => {
  it("averages drift per good, signs it vs targetStock, and sorts by |drift|", () => {
    // water target 122: stocks 200 & 140 → drifts +78 & +18 → avg +48 (above target).
    // luxuries target 39: stock 20 → drift −19 (below target).
    const { stockDrift } = computeMarketHealth(
      world([
        market("sys-1", "water", 200),
        market("sys-2", "water", 140),
        market("sys-1", "luxuries", 20),
      ]),
    );

    const waterTarget = getTargetStock("water");
    const luxTarget = getTargetStock("luxuries");
    const expectedWater = (200 + 140) / 2 - waterTarget;
    const expectedLux = 20 - luxTarget;

    // |water drift| > |luxuries drift| → water sorts first.
    expect(stockDrift[0].goodId).toBe("water");
    expect(stockDrift[0].avgStockDrift).toBeCloseTo(expectedWater, 5);
    expect(stockDrift[0].avgStockDrift).toBeGreaterThan(0); // above target

    const lux = stockDrift.find((d) => d.goodId === "luxuries");
    expect(lux?.avgStockDrift).toBeCloseTo(expectedLux, 5);
    expect(lux?.avgStockDrift).toBeLessThan(0); // below target
  });
});

describe("computeMarketHealth — price dispersion", () => {
  it("reports zero dispersion for a single-system good and positive for a split one", () => {
    const { priceDispersion } = computeMarketHealth(
      world([
        market("sys-1", "water", 200), // price ≈ 68
        market("sys-2", "water", 140), // price ≈ 96 → spread across systems
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
