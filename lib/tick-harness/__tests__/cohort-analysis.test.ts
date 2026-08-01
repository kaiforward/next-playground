import { describe, it, expect } from "vitest";
import { classifyMarketRole, computeRoleCoverLevels } from "../cohort-analysis";
import { MIN_DEMAND, TARGET_COVER } from "@/lib/constants/market-economy";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";
import type { WorldMarket } from "@/lib/world/types";
import type { TickSystem } from "@/lib/tick/rows";

function state(over: Partial<GoodMarketState> = {}): GoodMarketState {
  return {
    goodId: "water",
    stock: 100,
    targetStock: 100,
    demand: 10,
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
    // on water ⇒ price ratio = targetStock / stock = 1 / cover).
    const markets = [
      mkt("exp-a", "water", TARGET_COVER * 2, 1),   // cover 2.0, price ratio 0.5
      mkt("exp-b", "water", TARGET_COVER * 0.5, 1), // cover 0.5, price ratio 2.0
      mkt("self", "water", TARGET_COVER * 0.8, 1),  // cover 0.8
      mkt("con", "water", TARGET_COVER * 0.2, 1),   // cover 0.2
    ];

    const [water] = computeRoleCoverLevels(systems, markets);

    expect(water.countByRole.exporter).toBe(2);
    expect(water.countByRole["self-supplier"]).toBe(1);
    expect(water.countByRole.consumer).toBe(1);

    // Median of exactly {2.0, 0.5} (1.25) — distinct from the self-supplier's 0.8 and the
    // consumer's 0.2, so either list absorbing the wrong market's cover would fail this.
    expect(water.medianCoverByRole.exporter).toBeCloseTo(1.25, 5);
    expect(water.medianCoverByRole["self-supplier"]).toBeCloseTo(0.8, 5);
    expect(water.medianCoverByRole.consumer).toBeCloseTo(0.2, 5);

    // Median of {0.5, 2.0} across the exporter markets only (1.25) — a value that can
    // only come from those two prices, not from a crossed or empty list.
    expect(water.exporterMedianPriceRatio).toBeCloseTo(1.25, 5);
  });
});

import { cohortsForSystem, computeWorldCohorts } from "../cohort-analysis";

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
    }
  });

  it("counts a striking system into its cohort's striking share", () => {
    const systems = [sys("s1", { population: 50, unrest: 0.9 }), sys("s2", { population: 50, unrest: 0 })];
    const entries = computeWorldCohorts(systems, [], new Set(), 0.8, []);
    const band = entries.find((e) => e.cohort === "pop 10-100");

    expect(band?.n).toBe(2);
    expect(band?.strikingShare).toBe(0.5);
  });
});
