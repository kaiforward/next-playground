import { describe, it, expect } from "vitest";
import { runTreasuryProcessor } from "@/lib/tick/processors/treasury";
import { InMemoryTreasuryWorld } from "@/lib/tick/adapters/memory/treasury";
import type { TreasuryProcessorParams } from "@/lib/tick/world/treasury-world";
import type { TickContext } from "@/lib/tick/types";
import type { WorldFactionTreasury } from "@/lib/world/types";

const RATES: TreasuryProcessorParams["rates"] = {
  headsTaxPerMonth: 0.01,
  headsWeights: { unskilled: 1, technicians: 3, engineers: 9 },
  productionTaxRate: 0.05,
  referenceValues: { food: 20 },
  maintenanceRatePerWork: 0.002,
  constructionRatePerWork: 0.5,
  logisticsRatePerWork: 0.05,
};

function makeParams(overrides: Partial<TreasuryProcessorParams> = {}): TreasuryProcessorParams {
  return {
    interval: 24,
    economyScale: 1,
    constructionWorkByFaction: new Map(),
    logisticsWorkByFaction: new Map(),
    rates: RATES,
    ...overrides,
  };
}

function makeTreasury(overrides: Partial<WorldFactionTreasury> = {}): WorldFactionTreasury {
  return {
    factionId: "faction-1",
    balance: 0,
    taxLevel: "normal",
    bands: { maintenance: 1, logistics: 1, construction: 1 },
    funded: { maintenance: 1, logistics: 1, construction: 1 },
    pendingWork: { logistics: 0, construction: 0 },
    lastSettlement: null,
    updatedAtTick: 0,
    ...overrides,
  };
}

function ctxWithRealized(tick: number, realized: Map<string, Map<string, number>>): TickContext {
  return {
    tick,
    results: new Map([
      ["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map(),
          outputUptakeBySystem: new Map(),
          realizedProductionBySystem: realized,
        },
      }],
    ]),
  };
}

const SYSTEM = { systemId: "sys-1", factionId: "faction-1", population: 100, buildings: { housing: 4, food: 2 } };

describe("treasury processor", () => {
  it("settles on the month pulse: collects both lines, pays bills, latches funded fractions", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(
      world,
      ctxWithRealized(24, new Map([["sys-1", new Map([["food", 10]])]])),
      makeParams(),
    );
    const t = world.treasuries[0];
    expect(t.lastSettlement).not.toBeNull();
    expect(t.lastSettlement!.headsIncome).toBeGreaterThan(0);
    expect(t.lastSettlement!.productionIncome).toBeCloseTo(10 * 20 * 0.05);
    expect(t.lastSettlement!.maintenanceBill).toBeGreaterThan(0);
    expect(t.balance).toBeGreaterThanOrEqual(0);
    expect(t.updatedAtTick).toBe(24);
  });

  it("accrues work off-pulse without settling, and bills it at the next settlement", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, { tick: 12, results: new Map() }, makeParams({
      constructionWorkByFaction: new Map([["faction-1", 8]]),
      logisticsWorkByFaction: new Map([["faction-1", 40]]),
      economyScale: 100,
    }));
    expect(world.treasuries[0].lastSettlement).toBeNull();
    expect(world.treasuries[0].pendingWork.construction).toBe(8);
    expect(world.treasuries[0].pendingWork.logistics).toBeCloseTo(0.4); // 40 / S=100

    await runTreasuryProcessor(world, ctxWithRealized(24, new Map()), makeParams({ economyScale: 100 }));
    const settled = world.treasuries[0].lastSettlement!;
    expect(settled.constructionBill).toBeCloseTo(8 * 0.5);
    expect(settled.logisticsBill).toBeCloseTo(0.4 * 0.05);
    expect(world.treasuries[0].pendingWork).toEqual({ logistics: 0, construction: 0 });
  });

  it("shorts the ladder bottom-up under insolvency and latches the paid fraction as funding", async () => {
    // Zero income (no systems), a construction backlog to bill, zero balance.
    const world = new InMemoryTreasuryWorld({
      treasuries: [makeTreasury({ pendingWork: { logistics: 0, construction: 100 } })],
      systems: [],
    });
    await runTreasuryProcessor(world, ctxWithRealized(24, new Map()), makeParams());
    const t = world.treasuries[0];
    expect(t.funded.construction).toBe(0); // billed 50, paid 0
    expect(t.funded.maintenance).toBe(1);  // zero-bill guard: slider value
    expect(t.balance).toBe(0);
  });

  it("is a no-op off-pulse with no work", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, { tick: 7, results: new Map() }, makeParams());
    expect(world.treasuries[0].updatedAtTick).toBe(0);
  });
});
