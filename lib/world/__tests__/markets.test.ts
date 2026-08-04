import { describe, it, expect } from "vitest";
import { createSystemMarkets } from "@/lib/world/markets";
import { classifyMarketState, surplusDrawable } from "@/lib/engine/directed-logistics";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { useRatesByGood } from "@/lib/engine/honest-demand";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { unitResourceVector } from "@/lib/engine/resources";
import type { WorldMarket } from "@/lib/world/types";

/** A colony at the moment of founding: seed population, no industry, empty warehouses. */
const FOUNDING = {
  systemId: "colony",
  buildings: {},
  yields: unitResourceVector(),
  population: 12,
  seedStock: false,
};

/** A world-gen starting world: a smelter, its academy, and generations of stock on the shelves. */
const ESTABLISHED = {
  systemId: "capital",
  buildings: { ore: 4, metals: 3, vocational_school: 1 },
  yields: unitResourceVector(),
  population: 600,
  seedStock: true,
};

function rowOf(markets: WorldMarket[], goodId: string): WorldMarket {
  const row = markets.find((m) => m.goodId === goodId);
  if (row === undefined) throw new Error(`Expected a ${goodId} market`);
  return row;
}

function useRateOf(row: WorldMarket): number {
  if (row.honestUseRate === undefined) throw new Error(`Expected a seeded use rate on ${row.goodId}`);
  return row.honestUseRate;
}

describe("createSystemMarkets: the seeded use figure", () => {
  it("seeds a positive use figure on every row of a freshly founded colony", () => {
    const markets = createSystemMarkets(FOUNDING);
    expect(markets.length).toBeGreaterThan(0);
    for (const row of markets) {
      expect(useRateOf(row)).toBeGreaterThan(0);
    }
  });

  it("seeds civilian want alone at a colony with no industry", () => {
    const markets = createSystemMarkets(FOUNDING);
    const basis = computeSystemLabourSnapshot(FOUNDING.buildings, FOUNDING.population).basis;
    // No factories ⇒ no recipe draw, so the figure is the population's want and nothing else.
    expect(useRateOf(rowOf(markets, "food"))).toBeCloseTo(consumptionRate("food", basis), 9);
    expect(useRateOf(rowOf(markets, "ore"))).toBeCloseTo(consumptionRate("ore", basis), 9);
  });

  it("counts the local recipe draw at an established world, at full production", () => {
    const markets = createSystemMarkets(ESTABLISHED);
    const expected = useRatesByGood({
      buildings: ESTABLISHED.buildings,
      population: ESTABLISHED.population,
      yields: ESTABLISHED.yields,
      productionSuppress: 1, // nothing has struck yet at creation
    });
    const ore = rowOf(markets, "ore");
    const oreExpected = expected.get("ore");
    if (oreExpected === undefined) throw new Error("Expected an ore use rate");
    expect(oreExpected.industrial).toBeGreaterThan(0); // the smelter's draw, or this is vacuous
    expect(useRateOf(ore)).toBeCloseTo(oreExpected.total, 9);
  });

  it("leaves an empty founding row a deficit sink, not an un-sinkable market", () => {
    // The pathology a 0 here produces: classifyMarketState treats target ≤ 0 as "nobody wants it"
    // and drops the row out of the match entirely, so a new colony can never be shipped to.
    const row = rowOf(createSystemMarkets(FOUNDING), "food");
    const target = DIRECTED_LOGISTICS.WAREHOUSE_COVER * useRateOf(row) * row.anchorMult;
    expect(row.stock).toBe(0);
    expect(classifyMarketState(row.stock, target).kind).toBe("deficit");
    expect(classifyMarketState(row.stock, target).shortfall).toBeGreaterThan(0);
  });

  it("leaves a founding row holding its reserve, not fully drawable as a donor", () => {
    // The other half of the same pathology: at demand 0 the donor reserve is 0 and the whole
    // yard is drawable, so the colony's first delivery is immediately donated away again.
    const row = rowOf(createSystemMarkets(FOUNDING), "food");
    const useRate = useRateOf(row);
    const donorReserve = DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * useRate * row.anchorMult;
    const stock = donorReserve * 1.5; // clears SURPLUS_MARGIN, so the reserve is what binds
    const drawable = surplusDrawable(stock, donorReserve, useRate, 0);
    expect(drawable).toBeCloseTo(stock - donorReserve, 9);
    expect(drawable).toBeLessThan(stock);
  });
});
