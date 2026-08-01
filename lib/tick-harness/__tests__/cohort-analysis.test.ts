import { describe, it, expect } from "vitest";
import { classifyMarketRole } from "../cohort-analysis";
import { MIN_DEMAND } from "@/lib/constants/market-economy";
import type { GoodMarketState } from "@/lib/engine/directed-logistics";

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
