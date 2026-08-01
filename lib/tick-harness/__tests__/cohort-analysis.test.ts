import { describe, it, expect } from "vitest";
import { classifyMarketRole, computeRoleCoverLevels } from "../cohort-analysis";
import { MIN_DEMAND } from "@/lib/constants/market-economy";
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
});
