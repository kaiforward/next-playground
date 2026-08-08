import { describe, it, expect } from "vitest";
import {
  classifyMarketRole, computeRoleCoverLevels, cohortsForSystem, computeWorldCohorts, marketRolesByKey,
} from "../cohort-analysis";
import { perSystemSupplyState, summarizePopulation } from "../population-analysis";
import type { MarketRole } from "../types";
import { MIN_DEMAND, TARGET_COVER } from "@/lib/constants/market-economy";
import { CROWDING } from "@/lib/constants/population";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { WorldMarket } from "@/lib/world/types";
import type { TickSystem } from "@/lib/tick/rows";

function state(over: Partial<GoodMarketState> = {}): GoodMarketState {
  return {
    goodId: "water",
    stock: 100,
    logisticsTarget: 100,
    donorReserve: 100,
    demand: 10,
    // Nothing braked and no event running, which is what these role fixtures state.
    drawDemand: 10,
    civilianDemand: 10,
    production: 0,
    capacityProduction: 0,
    ...over,
  };
}

describe("classifyMarketRole", () => {
  it("calls a market an exporter when production exceeds demand", () => {
    expect(classifyMarketRole(state({ production: 20, demand: 10 }), 10)).toBe("exporter");
  });

  it("does not call a suppressed producer an exporter", () => {
    // Strike or maintenance cut output — surplusDrawable excludes it, so this must too.
    expect(
      classifyMarketRole(state({ production: 20, demand: 10, productionSuppressed: true }), 10),
    ).toBe("self-supplier");
  });

  it("calls a producer that cannot cover its own demand a self-supplier", () => {
    expect(classifyMarketRole(state({ production: 5, demand: 10 }), 10)).toBe("self-supplier");
  });

  it("calls a non-producer with real demand a consumer", () => {
    expect(classifyMarketRole(state({ production: 0, demand: 10 }), 10)).toBe("consumer");
  });

  it("calls a market with neither production nor real demand inert", () => {
    // demandRate sitting exactly on the MIN_DEMAND floor is the pricing guard, not demand.
    expect(classifyMarketRole(state({ production: 0, demand: 0 }), MIN_DEMAND)).toBe("inert");
  });

  it("calls a producer whose local demand is floored an exporter, not inert", () => {
    // A mining world producing ore nobody there consumes: floored demandRate AND real
    // production. Precedence must resolve this to exporter — it genuinely ships the good.
    expect(classifyMarketRole(state({ production: 20, demand: 0 }), MIN_DEMAND)).toBe("exporter");
  });
});

function sys(id: string, over: Partial<TickSystem> = {}): TickSystem {
  return {
    id, name: id, economyType: "agricultural", regionId: "r1", factionId: "f1",
    control: "developed", governmentType: "federation", population: 100, popCap: 200,
    unrest: 0, buildings: {}, buildingIdleCycles: {}, collapseDebt: 0,
    yields: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    slotCap: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    generalSpace: 100, habitableSpace: 50,
    ...over,
  };
}

function mkt(systemId: string, goodId: string, stock: number, demandRate: number): WorldMarket {
  return { systemId, goodId, stock, anchorMult: 1, demandRate, storageCapacity: 0 };
}

describe("computeRoleCoverLevels", () => {
  it("reports one entry per good with every market counted into exactly one role", () => {
    // No buildings anywhere ⇒ zero production ⇒ every market is consumer or inert,
    // separated purely by whether its demandRate cleared the MIN_DEMAND floor.
    const systems = [sys("s1"), sys("s2")];
    const markets = [
      mkt("s1", "water", 50, 10),
      mkt("s2", "water", 0, MIN_DEMAND),
    ];

    const [entry] = computeRoleCoverLevels(systems, markets);

    expect(entry.goodId).toBe("water");
    expect(entry.countByRole.consumer).toBe(1);
    expect(entry.countByRole.inert).toBe(1);
    expect(entry.countByRole.exporter).toBe(0);
    expect(entry.countByRole["self-supplier"]).toBe(0);
  });

  it("is unchanged when pinned to the partition it would have computed itself", () => {
    // The null case the pin must satisfy before any A/B can trust it: pinning to the classifier's
    // own fresh roles has to reproduce the unpinned report exactly, or the pin is itself a change.
    const systems = [sys("s1"), sys("s2")];
    const markets = [mkt("s1", "water", 50, 10), mkt("s2", "water", 0, MIN_DEMAND)];

    const fresh = new Map(
      [...marketRolesByKey(systems, markets)].map(([key, info]) => [key, info.role]),
    );
    expect(computeRoleCoverLevels(systems, markets, fresh))
      .toEqual(computeRoleCoverLevels(systems, markets));
  });

  it("holds cohort membership fixed against the pinned partition, not the live classification", () => {
    // The classifier reads `state.demand` in its exporter branch, so membership moves in any stage
    // that changes the demand figure — and a cover median then moves with the cohort MIX rather than
    // with anything about supply. Pinning is what makes two arms comparable. The fixture is a
    // staffed extractor on a live water deposit — a genuine exporter (the scoping test below pins
    // the arithmetic) — so the pin demonstrably overrides a real producer classification.
    const producerYields = { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 1, radioactive: 0 };
    const systems = [sys("s1", { population: 10, buildings: { water: 1 }, yields: producerYields })];
    const markets = [mkt("s1", "water", 50, 1)];

    const liveInfo = marketRolesByKey(systems, markets).get("s1|water");
    expect(liveInfo?.role).toBe("exporter"); // non-vacuous: the pin overrides a role really held

    const pinned = computeRoleCoverLevels(systems, markets, new Map([["s1|water", "consumer"]]));
    expect(pinned[0].countByRole.consumer).toBe(1);
    expect(pinned[0].countByRole.exporter).toBe(0);
  });

  it("refuses a pin that matches no live market — another world's partition", () => {
    // Sequential system ids collide across seeds, so a wrong-world pin usually half-matches; a
    // zero-match pin (different systemCount, renamed goods) would otherwise classify everything
    // live while the report prints PINNED.
    const systems = [sys("s1")];
    const markets = [mkt("s1", "water", 50, 10)];
    expect(() =>
      computeRoleCoverLevels(systems, markets, new Map<string, MarketRole>([["other|ore", "consumer"]])),
    ).toThrow(/matched 0/);
  });

  it("falls back to the live role for a market the pinned partition never saw", () => {
    // A colony founded after the baseline arm was measured has no pinned entry; dropping it would
    // silently shrink the later arm's population.
    const systems = [sys("s1"), sys("s2")];
    const markets = [mkt("s1", "water", 50, 10), mkt("s2", "water", 50, 10)];
    const partial = new Map<string, MarketRole>([["s1|water", "consumer"]]);

    const [entry] = computeRoleCoverLevels(systems, markets, partial);
    expect(entry.countByRole.consumer).toBe(2); // s2 classified live, still counted
  });

  it("reports 0 rather than NaN for a role with no markets", () => {
    const [entry] = computeRoleCoverLevels([sys("s1")], [mkt("s1", "water", 50, 10)]);

    expect(entry.medianCoverByRole.exporter).toBe(0);
    expect(Number.isNaN(entry.medianCoverByRole.exporter)).toBe(false);
    expect(entry.exporterMedianPriceRatio).toBe(0);
  });

  it("counts an empty consumer market in consumerEmptyFrac", () => {
    const systems = [sys("s1"), sys("s2")];
    const markets = [
      mkt("s1", "water", 0, 10),   // empty
      mkt("s2", "water", 500, 10), // stocked
    ];

    const [entry] = computeRoleCoverLevels(systems, markets);

    expect(entry.countByRole.consumer).toBe(2);
    expect(entry.consumerEmptyFrac).toBe(0.5);
  });

  it("keeps each role's median cover and the exporter price ratio scoped to only its own markets", () => {
    // A single fully-staffed water extractor: population 10 covers its 10-unit labour
    // demand exactly (LABOUR_BY_TIER[0].unskilled), so it produces at full rate — 2.0
    // (OUTPUT_PER_UNIT.water at ECONOMY_SCALE 1) against a population-10 civilian want of
    // only 0.007 × 10 = 0.07 (nothing else consumes water) — a real exporter, not one
    // merely sitting on the MIN_DEMAND floor.
    const producerYields = { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 0, water: 1, radioactive: 0 };
    const systems = [
      sys("exp-a", { population: 10, buildings: { water: 1 }, yields: producerYields }),
      sys("exp-b", { population: 10, buildings: { water: 1 }, yields: producerYields }),
      // Same extractor and the same fixed 2.0 production, but population 500 lifts
      // civilian consumption to 0.007 × 500 = 3.5 — still a producer, just not a net
      // exporter, so this must land as self-supplier.
      sys("self", { population: 500, buildings: { water: 1 }, yields: producerYields }),
      // No buildings anywhere ⇒ production 0; demandRate above MIN_DEMAND makes it a consumer.
      sys("con"),
    ];
    // demandRate 1 everywhere makes every market's targetStock exactly TARGET_COVER (the
    // same trick market-analysis.test.ts's fixtures use), so stock alone fixes each
    // market's cover, and — for the exporters — its price ratio too (k=1 default elasticity
    // on water ⇒ price ratio = targetStock / stock = 1 / cover). exp-a and exp-b are chosen
    // so the cover set {2.0, 0.8} and the price-ratio set {0.5, 1.25} are DIFFERENT sets with
    // DIFFERENT medians (1.4 vs 0.875) — an implementation that pushed a cover value into the
    // price list, or vice versa, would fail at least one of the two assertions below instead
    // of silently reproducing the right answer by coincidence. 1.25 also sits inside the
    // price curve's graded band (floor 0.5, ceiling 2.0 on water) rather than on a clamp
    // boundary, unlike 0.5 and 2.0 which both sit exactly on one.
    const markets = [
      mkt("exp-a", "water", TARGET_COVER * 2, 1),   // cover 2.0, price ratio 0.5
      mkt("exp-b", "water", TARGET_COVER * 0.8, 1), // cover 0.8, price ratio 1.25
      mkt("self", "water", TARGET_COVER * 0.8, 1),  // cover 0.8
      mkt("con", "water", TARGET_COVER * 0.2, 1),   // cover 0.2
    ];

    const [water] = computeRoleCoverLevels(systems, markets);

    expect(water.countByRole.exporter).toBe(2);
    expect(water.countByRole["self-supplier"]).toBe(1);
    expect(water.countByRole.consumer).toBe(1);

    // Median of {2.0, 0.8} (1.4) — distinct from the self-supplier's 0.8, the consumer's
    // 0.2, and the price-ratio median below, so either list absorbing the wrong market's
    // values would fail this.
    expect(water.medianCoverByRole.exporter).toBeCloseTo(1.4, 5);
    expect(water.medianCoverByRole["self-supplier"]).toBeCloseTo(0.8, 5);
    expect(water.medianCoverByRole.consumer).toBeCloseTo(0.2, 5);

    // Median of {0.5, 1.25} across the exporter markets only (0.875) — distinct from the
    // exporter cover median (1.4) above, so a cover value crossed into this list, or vice
    // versa, changes one assertion without the other.
    expect(water.exporterMedianPriceRatio).toBeCloseTo(0.875, 5);
  });

  it("separates a genuinely-empty inert market from one with real sub-floor demand", () => {
    // s1: population 0, no buildings — civilian consumption is strictly population-
    // proportional (GOOD_CONSUMPTION × population, no flat term), so state.demand is
    // exactly 0. s2: population 3, well under water's ~7-population MIN_DEMAND threshold
    // (0.007/head × 3 = 0.021 < MIN_DEMAND) — real, non-zero demand that still floors.
    // Both markets carry demandRate at the floor, so both classify inert; only s1 is
    // genuinely wanted by nobody.
    const systems = [sys("s1", { population: 0 }), sys("s2", { population: 3 })];
    const markets = [
      mkt("s1", "water", 50, MIN_DEMAND),
      mkt("s2", "water", 50, MIN_DEMAND),
    ];

    const [entry] = computeRoleCoverLevels(systems, markets);

    expect(entry.countByRole.inert).toBe(2);
    expect(entry.trulyInertCount).toBe(1);
  });
});

describe("cohortsForSystem", () => {
  it("places a system in exactly one population band", () => {
    const bands = cohortsForSystem(sys("s1", { population: 50 }), new Set());
    expect(bands).toContain("pop 10-100");
    expect(bands).not.toContain("pop <10");
    expect(bands).not.toContain("pop 100-1K");
  });

  it("labels a homeworld a homeworld and everything else a colony", () => {
    expect(cohortsForSystem(sys("s1"), new Set(["s1"]))).toContain("homeworld");
    expect(cohortsForSystem(sys("s2"), new Set(["s1"]))).toContain("colony");
  });

  it("adds survival-short for a world with no arable slot, alongside its other cohorts", () => {
    const rock = sys("s1", {
      population: 5,
      slotCap: { gas: 0, minerals: 0, ore: 3, biomass: 0, arable: 0, water: 0, radioactive: 0 },
    });
    const cohorts = cohortsForSystem(rock, new Set());

    expect(cohorts).toContain("survival-short");
    expect(cohorts).toContain("pop <10");
    expect(cohorts).toContain("colony");
  });

  it("does not call a world with an arable slot survival-short", () => {
    const farm = sys("s1", {
      slotCap: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 2, water: 0, radioactive: 0 },
    });
    expect(cohortsForSystem(farm, new Set())).not.toContain("survival-short");
  });
});

describe("computeWorldCohorts", () => {
  it("omits a cohort with no members rather than emitting a NaN row", () => {
    const entries = computeWorldCohorts([sys("s1", { population: 50 })], [], new Set(), 0.8, []);

    expect(entries.some((e) => e.cohort === "pop 10-100")).toBe(true);
    expect(entries.some((e) => e.cohort === "pop >=1K")).toBe(false);
    for (const e of entries) {
      expect(Number.isNaN(e.meanDissatisfaction)).toBe(false);
      expect(Number.isNaN(e.meanUnrest)).toBe(false);
      expect(Number.isNaN(e.meanProvision)).toBe(false);
      expect(Number.isNaN(e.worstGoodMedian)).toBe(false);
    }
  });

  it("folds a cohort's Provision mean from the same per-system map perSystemSupplyState computes", () => {
    // Both systems land in "pop <10" — the cohort IS the whole settled population here, so its
    // meanProvision must equal a manual fold over the same map computeWorldCohorts reads.
    const systems = [sys("s1", { population: 5 }), sys("s2", { population: 5 })];
    const markets = [
      { systemId: "s1", goodId: "water", satisfaction: 0.5 },
      { systemId: "s2", goodId: "water", satisfaction: 1 },
    ];

    const states = perSystemSupplyState(systems, markets);
    const manualMean = [...states.values()].reduce((a, s) => a + s.provision, 0) / states.size;

    const entries = computeWorldCohorts(systems, markets, new Set(), 0.8, []);
    const band = entries.find((e) => e.cohort === "pop <10");

    expect(band?.meanProvision).toBeCloseTo(manualMean, 10);
  });

  it("reports a cohort's worstGoodMedian as the median of its members' known worst-good satisfactions", () => {
    // Each system demands only water, so its worst good IS water and its satisfaction is
    // unambiguous — no tie-break or multi-good folding can obscure what the median is taken over.
    // Values 0.2, 0.5, 0.9 median to the middle one exactly, so a stand-in default (e.g. always 1)
    // cannot coincidentally pass.
    const systems = [
      sys("s1", { population: 5 }), sys("s2", { population: 5 }), sys("s3", { population: 5 }),
    ];
    const markets = [
      { systemId: "s1", goodId: "water", satisfaction: 0.2 },
      { systemId: "s2", goodId: "water", satisfaction: 0.5 },
      { systemId: "s3", goodId: "water", satisfaction: 0.9 },
    ];

    const entries = computeWorldCohorts(systems, markets, new Set(), 0.8, []);
    const band = entries.find((e) => e.cohort === "pop <10");

    expect(band?.worstGoodMedian).toBeCloseTo(0.5, 6);
  });

  it("keeps an unclaimed system out of every cohort's Provision denominator", () => {
    const claimed = sys("s1", { population: 5 });
    const unclaimed = sys("s2", { population: 5, control: "unclaimed" });
    const markets = [{ systemId: "s1", goodId: "water", satisfaction: 0.4 }];

    const entries = computeWorldCohorts([claimed, unclaimed], markets, new Set(), 0.8, []);
    const band = entries.find((e) => e.cohort === "pop <10");

    expect(band?.n).toBe(1);
    expect(band?.meanProvision).toBeCloseTo(0.4, 6);
  });

  it("counts a striking system into its cohort's striking share", () => {
    const systems = [sys("s1", { population: 50, unrest: 0.9 }), sys("s2", { population: 50, unrest: 0 })];
    const entries = computeWorldCohorts(systems, [], new Set(), 0.8, []);
    const band = entries.find((e) => e.cohort === "pop 10-100");

    expect(band?.n).toBe(2);
    expect(band?.strikingShare).toBe(0.5);
  });

  it("gives each overlapping cohort its own row and its own denominator", () => {
    // A rock: population 5 (band "pop <10"), no arable slot (default slotCap ⇒
    // survival-short), not a homeworld ⇒ colony. Lands in three rows at once.
    const rock = sys("s1", { population: 5 });
    // A homeworld with an arable slot: population 500 (a different band, "pop
    // 100-1K"), homeworld ⇒ not colony, arable ⇒ not survival-short. Deliberately
    // shares none of the rock's cohorts, so a dropped or double-counted row shows up
    // as a wrong `n` on a specific cohort rather than a coincidental match.
    const homeworld = sys("s2", {
      population: 500,
      slotCap: { gas: 0, minerals: 0, ore: 0, biomass: 0, arable: 2, water: 0, radioactive: 0 },
    });
    const entries = computeWorldCohorts([rock, homeworld], [], new Set(["s2"]), 0.8, []);
    const byCohort = new Map(entries.map((e) => [e.cohort, e]));

    // The rock's three rows: each n === 1, from the rock alone.
    expect(byCohort.get("pop <10")?.n).toBe(1);
    expect(byCohort.get("survival-short")?.n).toBe(1);
    expect(byCohort.get("colony")?.n).toBe(1);

    // The homeworld's two rows: each n === 1, from the homeworld alone — unaffected
    // by the rock's rows above.
    expect(byCohort.get("pop 100-1K")?.n).toBe(1);
    expect(byCohort.get("homeworld")?.n).toBe(1);

    // Neither system reaches these cohorts.
    expect(byCohort.has("pop >=1K")).toBe(false);
    expect(byCohort.has("pop 10-100")).toBe(false);
  });

  describe("netGrowthPct", () => {
    it("agrees with the galaxy-wide growthPct arithmetic when the cohort is everything", () => {
      // All three systems are homeworlds ⇒ the "homeworld" cohort IS the whole settled galaxy,
      // so its netGrowthPct must reproduce summarizePopulation's growthPct computed the same way
      // (same start/end sums, same formula) over the identical systems.
      const systems = [
        sys("s1", { population: 120 }),
        sys("s2", { population: 80 }),
        sys("s3", { population: 300 }),
      ];
      const start = new Map([["s1", 100], ["s2", 100], ["s3", 250]]);
      const homeworldIds = new Set(["s1", "s2", "s3"]);

      const totalStart = [...start.values()].reduce((a, b) => a + b, 0);
      const expected = summarizePopulation(systems, totalStart, 0.8, CROWDING.BRAKE_END).growthPct;

      const entries = computeWorldCohorts(systems, [], homeworldIds, 0.8, [], start);
      const homeworld = entries.find((e) => e.cohort === "homeworld");

      expect(homeworld?.netGrowthPct).toBeCloseTo(expected, 6);
    });

    it("counts a mid-run founded colony's whole population as growth, not a divide-by-zero", () => {
      // s1 existed at start (100, unchanged); s2 is absent from the start snapshot — founded
      // during the run — and ends with population 40. Both land in "colony". Summing before
      // dividing keeps s2's own start-0 from individually blowing up: (140 - 100) / 100 = 40%.
      const systems = [sys("s1", { population: 100 }), sys("s2", { population: 40 })];
      const start = new Map([["s1", 100]]); // s2 absent — founded mid-run

      const entries = computeWorldCohorts(systems, [], new Set(), 0.8, [], start);
      const colony = entries.find((e) => e.cohort === "colony");

      expect(colony?.netGrowthPct).not.toBeNull();
      expect(Number.isFinite(colony?.netGrowthPct)).toBe(true);
      expect(colony?.netGrowthPct).toBeCloseTo(40, 6);
    });

    it("reports a negative percentage for a cohort that lost population, not a clamp to 0", () => {
      const systems = [sys("s1", { population: 40 })];
      const start = new Map([["s1", 100]]);

      const entries = computeWorldCohorts(systems, [], new Set(), 0.8, [], start);
      const colony = entries.find((e) => e.cohort === "colony");

      expect(colony?.netGrowthPct).toBeCloseTo(-60, 6);
    });

    it("gives a system in two overlapping cohorts the same correct reading in both, with no cross-cohort bleed", () => {
      // s1: band "pop <10", not a homeworld ⇒ also "colony". s2: band "pop >=1K" (population
      // 1500, above the 1K cutoff) and homeworld. Deliberately shares no cohort with s1, so a
      // denominator leaking between rows shows up as a wrong netGrowthPct on a specific cohort
      // rather than a coincidental match.
      const rock = sys("s1", { population: 5 });
      const homeworld = sys("s2", { population: 1500 });
      const start = new Map([["s1", 2], ["s2", 1500]]);

      const entries = computeWorldCohorts([rock, homeworld], [], new Set(["s2"]), 0.8, [], start);
      const byCohort = new Map(entries.map((e) => [e.cohort, e]));

      // s1's two rows: (5 - 2) / 2 = 150%, independently in both.
      expect(byCohort.get("pop <10")?.netGrowthPct).toBeCloseTo(150, 6);
      expect(byCohort.get("colony")?.netGrowthPct).toBeCloseTo(150, 6);
      // s2's two rows: unchanged (1500 → 1500) = 0%, unaffected by s1's 150%.
      expect(byCohort.get("pop >=1K")?.netGrowthPct).toBeCloseTo(0, 6);
      expect(byCohort.get("homeworld")?.netGrowthPct).toBeCloseTo(0, 6);
    });

    it("reports null, not an unmeasured 0, for a run that took no start snapshot", () => {
      // No 6th argument ⇒ the default empty map, the same shape a run shorter than one
      // SNAPSHOT_INTERVAL produces (runner.ts's populationSnapshots stays empty).
      const systems = [sys("s1", { population: 50 })];
      const entries = computeWorldCohorts(systems, [], new Set(), 0.8, []);

      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) expect(e.netGrowthPct).toBeNull();
    });
  });
});
