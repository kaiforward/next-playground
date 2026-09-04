import { describe, it, expect } from "vitest";
import {
  takeMarketSnapshot,
  computeMarketHealth,
  computeKneeBinding,
  newDemandHuntingAccumulator,
  sampleDemandHunting,
  summariseDemandHunting,
  newSpellAccumulator,
  sampleSurvivalSpells,
  summariseSpellDistribution,
} from "../market-analysis";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import { TARGET_COVER } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";

function market(
  systemId: string,
  goodId: string,
  stock: number,
): WorldMarket {
  return { systemId, goodId, stock, anchorMult: 1, demandRate: 1, storageCapacity: 0 };
}

/** Warehousing targets only feed `deficitFrac`; the suites below assert other metrics. */
const NO_TARGETS = new Map<string, number>();

/** A staffed food producer — 2 extractors, ample population, developed unless overridden. */
function producerSystem(id: string, control: TickSystem["control"] = "developed"): TickSystem {
  return {
    id, name: id, economyType: "agricultural", regionId: "r1", factionId: "f1", control,
    governmentType: "federation", population: 1000, popCap: 2000, unrest: 0,
    buildings: { food: 2 }, buildingIdleCycles: {}, collapseDebt: 0,
    yields: unitResourceVector(), extractionEff: unitResourceVector(),
    depositCounts: emptyResourceVector(), peopleLand: 0,
  };
}

describe("computeKneeBinding", () => {
  const bindingRow = (
    systemId: string,
    honestUseRate: number,
    storageCapacity: number,
  ): WorldMarket => ({
    systemId, goodId: "food", stock: 0, anchorMult: 1, demandRate: 1,
    honestUseRate, storageCapacity,
  });

  it("classifies each producing market by the term that set its knee, counts summing to the producer count", () => {
    const systems = [producerSystem("s-use"), producerSystem("s-output")];
    const markets = [
      // Use term 40 × 1000 dominates any 2-building output term → "use".
      bindingRow("s-use", 1000, 1e9),
      // An explicit zero use figure → only the working-inventory term can set the knee → "output".
      bindingRow("s-output", 0, 1e9),
    ];
    // The self-check the instrument exists to keep honest: two producing markets, and the
    // two term counts sum to exactly that — recorded at the knee, not read off the taper.
    expect(computeKneeBinding(systems, markets)).toEqual([
      { goodId: "food", use: 1, output: 1 },
    ]);
  });

  it("counts only producing markets at economically active systems", () => {
    // A consumer system (no capacity) and a frozen controlled system both fall out of the census.
    const consumer: TickSystem = { ...producerSystem("s-cons"), buildings: {} };
    const frozen = producerSystem("s-frozen", "controlled");
    const markets = [bindingRow("s-cons", 5, 100), bindingRow("s-frozen", 5, 100)];
    expect(computeKneeBinding([consumer, frozen], markets)).toEqual([]);
  });

  it("sorts entries alphabetically by goodId", () => {
    // A single-good fixture cannot observe the sort at all — two goods, deliberately inserted in
    // REVERSE alphabetical order (water's system processed first), so only an actual sort — not
    // insertion order — can produce the expected result.
    const waterProducer: TickSystem = { ...producerSystem("s-water"), buildings: { water: 2 } };
    const systems = [waterProducer, producerSystem("s-food")];
    const markets = [
      { ...bindingRow("s-water", 5, 100), goodId: "water" },
      { ...bindingRow("s-food", 5, 100), goodId: "food" },
    ];
    expect(computeKneeBinding(systems, markets).map((e) => e.goodId)).toEqual(["food", "water"]);
  });
});

describe("takeMarketSnapshot", () => {
  it("emits one snapshot per market with the spot price at its stock", () => {
    // demandRate 1, anchorMult 1 ⇒ reference stock = TARGET_COVER. Holding stock
    // at the reference prices the good at base — concrete yet TARGET_COVER-agnostic.
    const m = market("sys-1", "water", TARGET_COVER);
    const snaps = takeMarketSnapshot([m]);

    expect(snaps).toHaveLength(1);
    expect(snaps[0].systemId).toBe("sys-1");
    expect(snaps[0].goodId).toBe("water");
    expect(snaps[0].stock).toBe(TARGET_COVER);
    expect(snaps[0].price).toBe(GOODS.water.basePrice); // stock == reference ⇒ spot price == basePrice
  });
});

describe("computeMarketHealth — stock drift", () => {
  it("averages drift per good, signs it vs the per-system reference, and sorts by |drift|", () => {
    // The market() fixture uses demandRate 1 and anchorMult 1, so every market's
    // reference is exactly TARGET_COVER (= TARGET_COVER × demandRate × anchorMult).
    // water: stocks 200 & 140 → both above the reference → avg drift positive.
    // luxuries: stock 20 → below the reference → drift negative.
    const { stockDrift } = computeMarketHealth([
      market("sys-1", "water", 200),
      market("sys-2", "water", 140),
      market("sys-1", "luxuries", 20),
    ], NO_TARGETS);

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
    const { stockDrift: base } = computeMarketHealth([market("sys-1", "water", stock)], NO_TARGETS);
    const { stockDrift: shifted } = computeMarketHealth([
      { ...market("sys-1", "water", stock), anchorMult: 2 },
    ], NO_TARGETS);
    expect(base[0].avgStockDrift).toBeGreaterThan(0); // above reference TARGET_COVER
    expect(shifted[0].avgStockDrift).toBeLessThan(0); // below reference 2 × TARGET_COVER
  });
});

describe("computeMarketHealth — stock pins", () => {
  it("counts a market at (or within 2% of max of) zero stock as floor-pinned", () => {
    // The true floor is stock ≈ 0 — a starved market's resting point. A market
    // that is empty, or within BAND_PROXIMITY_FRAC (2%) of maxStock of empty, is
    // floor-pinned; one just past that buffer is not.
    const oreBand = marketBandForRow(market("sys-1", "ore", 0), GOODS.ore);
    const buffer = 0.02 * oreBand.maxStock; // BAND_PROXIMITY_FRAC × maxStock
    const { stockPins } = computeMarketHealth([
      market("sys-1", "ore", 0), // empty → pinned
      market("sys-2", "ore", buffer), // exactly at the buffer → pinned (≤)
      market("sys-3", "ore", buffer * 2), // past the buffer → not pinned
    ], NO_TARGETS);

    const ore = stockPins.find((p) => p.goodId === "ore");
    expect(ore?.floorFrac).toBeCloseTo(2 / 3, 5);
    expect(ore?.ceilingFrac).toBe(0);
  });

  it("does NOT count the price-saturation point as pinned — deep draws are normal", () => {
    // minStock is the price-saturation point (mid price hits the ceiling), a
    // pricing construct — not a clamp. A market resting there is deep in the
    // normal draw zone, not empty, so floorFrac must read 0.
    const oreBand = marketBandForRow(market("sys-1", "ore", 0), GOODS.ore);
    const { stockPins } = computeMarketHealth([
      market("sys-1", "ore", oreBand.minStock), // stock = band.minStock → floorFrac 0
    ], NO_TARGETS);

    const ore = stockPins.find((p) => p.goodId === "ore");
    expect(ore?.floorFrac).toBe(0);
    expect(ore?.ceilingFrac).toBe(0);
  });

  it("reports the per-good fraction of markets at the floor or ceiling", () => {
    // Each stock is placed against its OWN good's band (ore and luxuries have
    // different price ceilings), so the fixture can't drift outside the band it
    // means to probe.
    // ore: both markets empty (stock ≈ 0) → fully floor-pinned.
    // luxuries: one at maxStock, one mid-band → half ceiling-pinned, none at floor.
    const luxBand = marketBandForRow(market("sys-1", "luxuries", 0), GOODS.luxuries);
    const { stockPins } = computeMarketHealth([
      market("sys-1", "ore", 0),
      market("sys-2", "ore", 0),
      market("sys-1", "luxuries", luxBand.maxStock),
      market("sys-2", "luxuries", (luxBand.minStock + luxBand.maxStock) / 2),
    ], NO_TARGETS);

    const ore = stockPins.find((p) => p.goodId === "ore");
    expect(ore?.floorFrac).toBe(1);
    expect(ore?.ceilingFrac).toBe(0);

    const lux = stockPins.find((p) => p.goodId === "luxuries");
    expect(lux?.floorFrac).toBe(0);
    expect(lux?.ceilingFrac).toBe(0.5);
  });

  it("sorts goods by total pinned fraction so the worst pathologies surface first", () => {
    // Each stock is placed against its OWN good's band — ore and metals have
    // different price ceilings, so a stock that reads mid-band for one can read
    // pinned for the other. The totals must stay apart (ore 1.0 vs metals 0.5)
    // for the ordering to mean anything: on a tie the comparator returns 0 and
    // a stable sort keeps insertion order, so the assertion would pass whichever
    // way the sort pointed.
    // ore: single empty market → total pinned 1.0.
    // metals: one empty, one mid-band → total pinned 0.5.
    const metalsBand = marketBandForRow(market("sys-1", "metals", 0), GOODS.metals);
    const { stockPins } = computeMarketHealth([
      market("sys-1", "ore", 0),
      market("sys-1", "metals", 0),
      market("sys-2", "metals", (metalsBand.minStock + metalsBand.maxStock) / 2),
    ], NO_TARGETS);

    const ore = stockPins.find((p) => p.goodId === "ore")!;
    const metals = stockPins.find((p) => p.goodId === "metals")!;
    expect(ore.floorFrac + ore.ceilingFrac).toBeCloseTo(1, 5);
    expect(metals.floorFrac + metals.ceilingFrac).toBeCloseTo(0.5, 5);

    expect(stockPins[0].goodId).toBe("ore");
  });
});

describe("computeMarketHealth — price dispersion", () => {
  it("reports zero dispersion for a single-system good and positive for a split one", () => {
    // Both water stocks sit strictly inside the band (TARGET_COVER/priceCeiling
    // = 20 … TARGET_COVER/priceFloor = 80), so their prices are unclamped and
    // genuinely differ — outside it both would pin to the same bound and read as
    // zero dispersion.
    const { priceDispersion } = computeMarketHealth([
      market("sys-1", "water", TARGET_COVER), // at the anchor → price == basePrice
      market("sys-2", "water", TARGET_COVER * 0.75), // scarcer → dearer
      market("sys-1", "luxuries", 20), // single system → no dispersion
    ], NO_TARGETS);

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
    const { priceLevels } = computeMarketHealth([
      market("sys-1", "water", 80),
      market("sys-2", "water", 40),
      market("sys-3", "water", 20),
    ], NO_TARGETS);
    expect(priceLevels.median).toBeCloseTo(1.0, 5);
    expect(priceLevels.p10).toBeCloseTo(0.5, 5);
    expect(priceLevels.p90).toBeCloseTo(2.0, 5);
    expect(priceLevels.cheapFrac).toBeCloseTo(1 / 3, 5);
    expect(priceLevels.nearFrac).toBeCloseTo(1 / 3, 5);
    expect(priceLevels.expensiveFrac).toBeCloseTo(1 / 3, 5);
  });
});

describe("computeMarketHealth — cover levels", () => {
  /** Warehousing targets keyed as the runner keys them, for markets whose demand clears the floor. */
  const targets = (...entries: [string, number][]) => new Map(entries);

  it("reports per-good median cover vs the anchor and surplus/deficit fractions vs the logistics lines", () => {
    // covers (stock/anchor=40): 80→2.0 surplus(≥1.4×donor line 40), 40→1.0 balanced, 20→0.5 deficit(<0.8).
    // Unfloored demand here matches the row's rate, so each warehousing target is the anchor too.
    const { coverLevels } = computeMarketHealth(
      [
        market("sys-1", "water", 80),
        market("sys-2", "water", 40),
        market("sys-3", "water", 20),
      ],
      targets(["sys-1|water", 40], ["sys-2|water", 40], ["sys-3|water", 40]),
    );
    const water = coverLevels.find((c) => c.goodId === "water");
    expect(water?.medianCover).toBeCloseTo(1.0, 5);
    expect(water?.surplusFrac).toBeCloseTo(1 / 3, 5);
    expect(water?.deficitFrac).toBeCloseTo(1 / 3, 5);
  });

  it("counts deficits against the warehousing target, not the floored price anchor", () => {
    // The divergence this metric exists to report honestly. Both markets hold stock 20 against
    // an anchor of 40, so both read cover 0.5 — but sys-2's real demand sits under MIN_DEMAND,
    // giving it a warehousing target of 4 that its stock of 20 clears five times over. Only
    // sys-1 is a market directed logistics would fill.
    const { coverLevels } = computeMarketHealth(
      [market("sys-1", "water", 20), market("sys-2", "water", 20)],
      targets(["sys-1|water", 40], ["sys-2|water", 4]),
    );
    const water = coverLevels.find((c) => c.goodId === "water");
    expect(water?.medianCover).toBeCloseTo(0.5, 5); // both still read low cover vs the anchor…
    expect(water?.deficitFrac).toBeCloseTo(1 / 2, 5); // …but only one is a live deficit.

    // Discrimination check: point the floored market's target back at the anchor — what this
    // metric read before the split — and it becomes a deficit again. If this stops reporting
    // 100%, the case above has stopped proving anything.
    const asBefore = computeMarketHealth(
      [market("sys-1", "water", 20), market("sys-2", "water", 20)],
      targets(["sys-1|water", 40], ["sys-2|water", 40]),
    );
    expect(asBefore.coverLevels.find((c) => c.goodId === "water")?.deficitFrac).toBeCloseTo(1, 5);
  });

  it("counts surpluses against the donor line, not the price anchor", () => {
    // The surplus mirror of the deficit split above. Stock 45 against an anchor of 40 reads
    // cover 1.125 — nowhere near the anchor-margin line of 56 — but sys-1's real demand sits
    // under MIN_DEMAND, giving it a donor line of 4 × 1.4 = 5.6 that its stock clears: it is
    // a market the donor rule would actually draw from.
    const { coverLevels } = computeMarketHealth(
      [market("sys-1", "water", 45), market("sys-2", "water", 45)],
      targets(["sys-1|water", 4], ["sys-2|water", 40]),
    );
    const water = coverLevels.find((c) => c.goodId === "water");
    expect(water?.surplusFrac).toBeCloseTo(1 / 2, 5);

    // Discrimination check, isolated to the donor comparison itself: at a warehousing target of 40,
    // stock 45 clears the deficit line (45 ≥ 32) and sits in the dead-band below the donor line
    // (45 < 40 × 1.4 = 56) — neither a deficit nor a surplus. Stock chosen above the deficit line so
    // this contrast exercises the donor comparison, not the branch exclusivity.
    const asBefore = computeMarketHealth(
      [market("sys-1", "water", 45), market("sys-2", "water", 45)],
      targets(["sys-1|water", 40], ["sys-2|water", 40]),
    );
    const before = asBefore.coverLevels.find((c) => c.goodId === "water");
    expect(before?.surplusFrac).toBe(0);
    expect(before?.deficitFrac).toBe(0);
  });

  it("counts a stocked market with a KNOWN zero warehousing target as a surplus (fully drawable)", () => {
    // Real demand 0 ⇒ donor reserve 0 ⇒ the whole pile is drawable under the live donor rule
    // (surplusDrawable's demand-0 branch). A known 0 must not be conflated with an absent entry:
    // the target map stores an entry for every walked market, including a computed 0.
    const { coverLevels } = computeMarketHealth(
      [market("sys-1", "water", 30), market("sys-2", "water", 0)],
      targets(["sys-1|water", 0], ["sys-2|water", 0]),
    );
    const water = coverLevels.find((c) => c.goodId === "water");
    expect(water?.surplusFrac).toBeCloseTo(1 / 2, 5); // stocked ⇒ surplus; empty ⇒ neither
    expect(water?.deficitFrac).toBe(0); // a zero target is never a sink
  });

  it("never counts a market with no known warehousing target as a deficit or a surplus", () => {
    // An unknown target is not evidence of need — an empty map must not report a starving galaxy.
    const { coverLevels } = computeMarketHealth([market("sys-1", "water", 200)], new Map());
    const water = coverLevels.find((c) => c.goodId === "water");
    expect(water?.deficitFrac).toBe(0);
    expect(water?.surplusFrac).toBe(0);
  });
});

// ── Demand hunting ────────────────────────────────────────────────

describe("demand hunting", () => {
  const WAREHOUSE = DIRECTED_LOGISTICS.WAREHOUSE_COVER;
  // `ore` is a recipe input (metals consumes it); `luxuries` is consumed by nothing.
  const inputRow = (systemId: string, stock: number, useRate = 1): WorldMarket => ({
    systemId, goodId: "ore", stock, anchorMult: 1, demandRate: 1,
    honestUseRate: useRate, storageCapacity: 0,
  });
  const deep = (systemId: string) => inputRow(systemId, 0); // far below target × 0.8
  const full = (systemId: string) => inputRow(systemId, WAREHOUSE * 2); // far above target × 1.4

  it("reads no flips on a market that never crosses the dead band", () => {
    const acc = newDemandHuntingAccumulator();
    for (let i = 0; i < 6; i++) sampleDemandHunting(acc, [deep("s1")]);
    expect(summariseDemandHunting(acc, []).flipRate).toBe(0);
  });

  it("counts a market oscillating between deficit and surplus on every reversal", () => {
    const acc = newDemandHuntingAccumulator();
    // deficit, surplus, deficit, surplus → 3 reversals over 3 comparable readings (the first
    // decided reading has nothing to reverse and sits outside the denominator).
    sampleDemandHunting(acc, [deep("s1")]);
    sampleDemandHunting(acc, [full("s1")]);
    sampleDemandHunting(acc, [deep("s1")]);
    sampleDemandHunting(acc, [full("s1")]);
    expect(acc.decidedReadings).toBe(4);
    expect(summariseDemandHunting(acc, []).flipRate).toBeCloseTo(1, 9);
  });

  it("excludes each market's first decided reading from the denominator", () => {
    // Two markets, one sample each: two decided readings, zero comparable — an unreversible
    // first reading must dilute nothing, or the rate shrinks with how often markets decide.
    const acc = newDemandHuntingAccumulator();
    sampleDemandHunting(acc, [deep("s1"), full("s2")]);
    expect(acc.decidedReadings).toBe(2);
    expect(summariseDemandHunting(acc, []).flipRate).toBe(0);

    // One of them reverses once: 1 reversal over exactly 1 comparable reading, not over 3.
    sampleDemandHunting(acc, [full("s1")]);
    expect(summariseDemandHunting(acc, []).flipRate).toBeCloseTo(1, 9);
  });

  it("registers an oscillation THROUGH the dead band as a reversal", () => {
    // deficit → balanced → surplus: the balanced sample is skipped and must not overwrite the
    // market's last decided reading, so the surplus still reverses the deficit — 1 reversal
    // over 1 comparable reading. An implementation that recorded the balanced sample would
    // report 0 here while the market genuinely oscillated.
    const mid = inputRow("s1", WAREHOUSE); // inside [0.8, 1.4) × target — balanced
    const acc = newDemandHuntingAccumulator();
    sampleDemandHunting(acc, [deep("s1")]);
    sampleDemandHunting(acc, [mid]);
    sampleDemandHunting(acc, [full("s1")]);
    expect(acc.decidedReadings).toBe(2); // the balanced sample decided nothing
    expect(summariseDemandHunting(acc, []).flipRate).toBeCloseTo(1, 9);
  });

  it("ignores goods no recipe consumes — hunting is an industrial-input pathology", () => {
    const acc = newDemandHuntingAccumulator();
    const luxuries = (stock: number): WorldMarket => ({
      systemId: "s1", goodId: "luxuries", stock, anchorMult: 1, demandRate: 1,
      honestUseRate: 1, storageCapacity: 0,
    });
    sampleDemandHunting(acc, [luxuries(0)]);
    sampleDemandHunting(acc, [luxuries(WAREHOUSE * 2)]);
    expect(summariseDemandHunting(acc, []).flipRate).toBe(0);
  });

  it("skips a row with no use figure rather than classifying it against a zero target", () => {
    // Asserted on the accumulator, not on flipRate — a skipped row and a classified-but-never-
    // reversing row both produce flipRate 0, so only the decided-reading count can see the guard.
    const acc = newDemandHuntingAccumulator();
    const bare: WorldMarket = {
      systemId: "s1", goodId: "ore", stock: 0, anchorMult: 1, demandRate: 1, storageCapacity: 0,
    };
    sampleDemandHunting(acc, [bare]);
    sampleDemandHunting(acc, [bare]);
    expect(acc.decidedReadings).toBe(0);

    // Positive control: the same row carrying a use figure classifies both times.
    const carried = newDemandHuntingAccumulator();
    sampleDemandHunting(carried, [{ ...bare, honestUseRate: 1 }]);
    sampleDemandHunting(carried, [{ ...bare, honestUseRate: 1 }]);
    expect(carried.decidedReadings).toBe(2);
  });

  it("reads no haul churn when every delivery stays where it landed", () => {
    const flows = [
      { tick: 1, fromSystemId: "a", toSystemId: "b", goodId: "ore", quantity: 100 },
      { tick: 2, fromSystemId: "a", toSystemId: "c", goodId: "ore", quantity: 50 },
    ];
    expect(summariseDemandHunting(newDemandHuntingAccumulator(), flows).haulChurnRatio).toBe(0);
  });

  it("counts tonnage delivered and then donated straight back out as churn", () => {
    // b receives 100 and later ships 40 of it onward. Delivered tonnage is every arrival —
    // b's 100, c's 50 and d's 40 — so 40 of 190 churned.
    const flows = [
      { tick: 1, fromSystemId: "a", toSystemId: "b", goodId: "ore", quantity: 100 },
      { tick: 2, fromSystemId: "a", toSystemId: "c", goodId: "ore", quantity: 50 },
      { tick: 3, fromSystemId: "b", toSystemId: "d", goodId: "ore", quantity: 40 },
    ];
    expect(summariseDemandHunting(newDemandHuntingAccumulator(), flows).haulChurnRatio)
      .toBeCloseTo(40 / 190, 9);
  });

  it("never counts more churn out of a market than was delivered into it", () => {
    // A structural exporter ships far more than it ever received; that is production, not churn.
    // Only the 10 tonnes b was actually sent can be re-donated tonnage, out of 910 delivered —
    // uncapped, b's 900 would count and the reading would be ~0.99 instead.
    const flows = [
      { tick: 1, fromSystemId: "a", toSystemId: "b", goodId: "ore", quantity: 10 },
      { tick: 2, fromSystemId: "b", toSystemId: "c", goodId: "ore", quantity: 900 },
    ];
    const { haulChurnRatio } = summariseDemandHunting(newDemandHuntingAccumulator(), flows);
    expect(haulChurnRatio).toBeCloseTo(10 / 910, 9);
    expect(haulChurnRatio).toBeLessThan(0.05);
  });
});

// ── Survival-good deficit spell distribution ─────────────────────

describe("survival spell distribution", () => {
  const WAREHOUSE = DIRECTED_LOGISTICS.WAREHOUSE_COVER;
  const waterRow = (stock: number, useRate = 1): WorldMarket => ({
    systemId: "s1", goodId: "water", stock, anchorMult: 1, demandRate: 1,
    honestUseRate: useRate, storageCapacity: 0,
  });
  const deep = () => waterRow(0); // deficit
  const full = () => waterRow(WAREHOUSE * 2); // surplus

  it("reports zeroes, never NaN, on a run that recorded no completed spell", () => {
    const acc = newSpellAccumulator();
    expect(summariseSpellDistribution(acc)).toEqual({ n: 0, median: 0, p90: 0, singleRunShare: 0 });
  });

  it("closes a spell the cycle it clears, counting its consecutive-deficit length", () => {
    const acc = newSpellAccumulator();
    sampleSurvivalSpells(acc, [deep()], 24, 0); // spell starts
    sampleSurvivalSpells(acc, [deep()], 48, 0); // still deficit — length 2
    sampleSurvivalSpells(acc, [full()], 72, 0); // clears — spell closes at length 2
    const summary = summariseSpellDistribution(acc);
    expect(summary.n).toBe(1);
    expect(summary.median).toBe(2);
  });

  it("drops a spell still open at the last sample — censored, not completed", () => {
    const acc = newSpellAccumulator();
    sampleSurvivalSpells(acc, [deep()], 24, 0);
    sampleSurvivalSpells(acc, [deep()], 48, 0);
    // Run ends mid-deficit: nothing ever closes this spell.
    expect(summariseSpellDistribution(acc).n).toBe(0);
  });

  it("excludes a spell that started before the equilibrium horizon even though it closes after it", () => {
    const acc = newSpellAccumulator();
    sampleSurvivalSpells(acc, [deep()], 10, 100); // spell starts before eqStartTick 100
    sampleSurvivalSpells(acc, [full()], 130, 100); // closes after the horizon
    expect(summariseSpellDistribution(acc).n).toBe(0);
  });

  it("ignores goods outside SURVIVAL_GOODS", () => {
    const acc = newSpellAccumulator();
    const ore = (stock: number): WorldMarket => ({
      systemId: "s1", goodId: "ore", stock, anchorMult: 1, demandRate: 1,
      honestUseRate: 1, storageCapacity: 0,
    });
    sampleSurvivalSpells(acc, [ore(0)], 24, 0);
    sampleSurvivalSpells(acc, [ore(WAREHOUSE * 2)], 48, 0);
    expect(summariseSpellDistribution(acc).n).toBe(0);
  });

  it("skips a row with no use figure rather than classifying it against a zero target", () => {
    const acc = newSpellAccumulator();
    const bare: WorldMarket = {
      systemId: "s1", goodId: "water", stock: 0, anchorMult: 1, demandRate: 1, storageCapacity: 0,
    };
    sampleSurvivalSpells(acc, [bare], 24, 0);
    sampleSurvivalSpells(acc, [bare], 48, 0);
    expect(acc.activeByKey.size).toBe(0);
  });
});
