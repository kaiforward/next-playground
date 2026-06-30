import { describe, it, expect } from "vitest";
import {
  takeMarketSnapshot,
  computeMarketHealth,
} from "../market-analysis";
import type { SimWorld, SimMarketEntry } from "../types";
import { TARGET_COVER } from "@/lib/constants/market-economy";

function market(
  systemId: string,
  goodId: string,
  stock: number,
): SimMarketEntry {
  return { systemId, goodId, basePrice: 100, stock, anchorMult: 1, demandRate: 1, priceFloor: 0.2, priceCeiling: 5.0, storageCapacity: 0 };
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
    // demandRate 1, anchorMult 1 ⇒ reference stock = TARGET_COVER. Holding stock
    // at the reference prices the good at base — concrete yet TARGET_COVER-agnostic.
    const m = market("sys-1", "water", TARGET_COVER);
    const snaps = takeMarketSnapshot(world([m]));

    expect(snaps).toHaveLength(1);
    expect(snaps[0].systemId).toBe("sys-1");
    expect(snaps[0].goodId).toBe("water");
    expect(snaps[0].stock).toBe(TARGET_COVER);
    expect(snaps[0].price).toBe(100); // stock == reference ⇒ spot price == basePrice
  });
});

describe("computeMarketHealth — stock drift", () => {
  it("averages drift per good, signs it vs the per-system reference, and sorts by |drift|", () => {
    // The market() fixture uses demandRate 1 and anchorMult 1, so every market's
    // reference is exactly TARGET_COVER (= TARGET_COVER × demandRate × anchorMult).
    // water: stocks 200 & 140 → both above the reference → avg drift positive.
    // luxuries: stock 20 → below the reference → drift negative.
    const { stockDrift } = computeMarketHealth(
      world([
        market("sys-1", "water", 200),
        market("sys-2", "water", 140),
        market("sys-1", "luxuries", 20),
      ]),
    );

    const expectedWater = (200 + 140) / 2 - TARGET_COVER;
    const expectedLux = 20 - TARGET_COVER;

    // |water drift| > |luxuries drift| → water sorts first.
    expect(stockDrift[0].goodId).toBe("water");
    expect(stockDrift[0].avgStockDrift).toBeCloseTo(expectedWater, 5);
    expect(stockDrift[0].avgStockDrift).toBeGreaterThan(0); // above reference

    const lux = stockDrift.find((d) => d.goodId === "luxuries");
    expect(lux?.avgStockDrift).toBeCloseTo(expectedLux, 5);
    expect(lux?.avgStockDrift).toBeLessThan(0); // below reference
  });

  it("scales the per-market reference by anchorMult", () => {
    // anchorMult shifts the reference (TARGET_COVER × demandRate × anchorMult). A
    // stock just above the anchorMult-1 reference reads below it once doubled.
    const stock = TARGET_COVER + 10;
    const { stockDrift: base } = computeMarketHealth(world([market("sys-1", "water", stock)]));
    const { stockDrift: shifted } = computeMarketHealth(
      world([{ ...market("sys-1", "water", stock), anchorMult: 2 }]),
    );
    expect(base[0].avgStockDrift).toBeGreaterThan(0); // above reference TARGET_COVER
    expect(shifted[0].avgStockDrift).toBeLessThan(0); // below reference 2 × TARGET_COVER
  });
});

describe("computeMarketHealth — stock pins", () => {
  it("reports the per-good fraction of markets clamped at the floor or ceiling", () => {
    // ore: both markets sit at/below minStock (TARGET_COVER/priceCeiling = 8) → fully floor-pinned.
    // luxuries: one at maxStock (TARGET_COVER/priceFloor = 200), one mid-band → half ceiling-pinned, none at floor.
    const { stockPins } = computeMarketHealth(
      world([
        market("sys-1", "ore", 5),
        market("sys-2", "ore", 6),
        market("sys-1", "luxuries", 200),
        market("sys-2", "luxuries", 100),
      ]),
    );

    const ore = stockPins.find((p) => p.goodId === "ore");
    expect(ore?.floorFrac).toBe(1);
    expect(ore?.ceilingFrac).toBe(0);

    const lux = stockPins.find((p) => p.goodId === "luxuries");
    expect(lux?.floorFrac).toBe(0);
    expect(lux?.ceilingFrac).toBe(0.5);
  });

  it("sorts goods by total pinned fraction so the worst pathologies surface first", () => {
    const { stockPins } = computeMarketHealth(
      world([
        market("sys-1", "ore", 5), // ore fully floor-pinned
        market("sys-1", "metals", 5), // metals half-pinned
        market("sys-2", "metals", 100),
      ]),
    );
    expect(stockPins[0].goodId).toBe("ore");
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

describe("computeMarketHealth — price levels", () => {
  it("reports the galaxy-wide price/base distribution and cheap/near/expensive split", () => {
    // ratios: stock 80 → 0.5 (cheap), stock 40 → 1.0 (near), stock 20 → 2.0 (expensive).
    const { priceLevels } = computeMarketHealth(
      world([
        market("sys-1", "water", 80),
        market("sys-2", "water", 40),
        market("sys-3", "water", 20),
      ]),
    );
    expect(priceLevels.median).toBeCloseTo(1.0, 5);
    expect(priceLevels.p10).toBeCloseTo(0.5, 5);
    expect(priceLevels.p90).toBeCloseTo(2.0, 5);
    expect(priceLevels.cheapFrac).toBeCloseTo(1 / 3, 5);
    expect(priceLevels.nearFrac).toBeCloseTo(1 / 3, 5);
    expect(priceLevels.expensiveFrac).toBeCloseTo(1 / 3, 5);
  });
});

describe("computeMarketHealth — cover levels", () => {
  it("reports per-good median cover and surplus/deficit fractions vs the anchor", () => {
    // covers (stock/target=40): 80→2.0 surplus(≥1.4), 40→1.0 balanced, 20→0.5 deficit(<0.8).
    const { coverLevels } = computeMarketHealth(
      world([
        market("sys-1", "water", 80),
        market("sys-2", "water", 40),
        market("sys-3", "water", 20),
      ]),
    );
    const water = coverLevels.find((c) => c.goodId === "water");
    expect(water?.medianCover).toBeCloseTo(1.0, 5);
    expect(water?.surplusFrac).toBeCloseTo(1 / 3, 5);
    expect(water?.deficitFrac).toBeCloseTo(1 / 3, 5);
  });
});
