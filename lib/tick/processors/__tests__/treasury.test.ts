import { describe, it, expect } from "vitest";
import { runTreasuryProcessor } from "@/lib/tick/processors/treasury";
import { InMemoryTreasuryWorld } from "@/lib/tick/adapters/memory/treasury";
import type { TreasuryProcessorParams } from "@/lib/tick/world/treasury-world";
import type { TickContext } from "@/lib/tick/types";
import type { WorldFactionTreasury } from "@/lib/world/types";

const RATES: TreasuryProcessorParams["rates"] = {
  headsTaxPerCycle: 0.01,
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
    foundingDebitsByFaction: new Map(),
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
    pendingFounding: 0,
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
          supplyStateBySystem: new Map(),
          sellingFactorBySystem: new Map(),
          realizedProductionBySystem: realized,
          productionSuppressBySystem: new Map(),
        },
      }],
    ]),
  };
}

const SYSTEM = { systemId: "sys-1", factionId: "faction-1", population: 100, buildings: { housing: 4, food: 2 } };

describe("treasury processor", () => {
  it("settles on the cycle start: collects both lines, pays bills, latches funded fractions", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(
      world,
      ctxWithRealized(24, new Map([["sys-1", new Map([["food", 10]])]])),
      makeParams(),
    );
    const t = world.treasuries[0];
    const settled = t.lastSettlement;
    if (settled === null) throw new Error("expected a settlement on the cycle start");
    expect(settled.headsIncome).toBeGreaterThan(0);
    expect(settled.productionIncome).toBeCloseTo(10 * 20 * 0.05);
    expect(settled.maintenanceBill).toBeGreaterThan(0);
    expect(t.balance).toBeGreaterThanOrEqual(0);
    expect(t.updatedAtTick).toBe(24);
  });

  it("accrues work mid-cycle without settling, and bills it at the next settlement", async () => {
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
    const settled = world.treasuries[0].lastSettlement;
    if (settled === null) throw new Error("expected a settlement on the cycle start");
    expect(settled.constructionBill).toBeCloseTo(8 * 0.5);
    expect(settled.logisticsBill).toBeCloseTo(0.4 * 0.05);
    expect(world.treasuries[0].pendingWork).toEqual({ logistics: 0, construction: 0 });
  });

  it("scales the per-cycle rates by catchUpFactor but never the per-cycle quantities", async () => {
    // Identical worlds settled at tick 24 under interval 24 (catchUp 1) vs 12 (catchUp 0.5):
    // heads tax and maintenance are per-cycle rates and must halve; realized production and
    // accrued band work arrive already cycle-scaled and must not be rescaled.
    const seed = () =>
      new InMemoryTreasuryWorld({
        treasuries: [makeTreasury({ pendingWork: { logistics: 2, construction: 8 } })],
        systems: [SYSTEM],
      });
    const realized = () => ctxWithRealized(24, new Map([["sys-1", new Map([["food", 10]])]]));
    const ref = seed();
    await runTreasuryProcessor(ref, realized(), makeParams());
    const half = seed();
    await runTreasuryProcessor(half, realized(), makeParams({ interval: 12 }));

    const a = ref.treasuries[0].lastSettlement;
    const b = half.treasuries[0].lastSettlement;
    if (a === null || b === null) throw new Error("expected settlements at both intervals");
    expect(a.headsIncome).toBeGreaterThan(0);
    expect(a.constructionBill).toBeGreaterThan(0);
    expect(b.headsIncome).toBeCloseTo(a.headsIncome * 0.5);
    expect(b.maintenanceBill).toBeCloseTo(a.maintenanceBill * 0.5);
    expect(b.productionIncome).toBeCloseTo(a.productionIncome);
    expect(b.logisticsBill).toBeCloseTo(a.logisticsBill);
    expect(b.constructionBill).toBeCloseTo(a.constructionBill);
  });

  it("coerces non-finite work signals to 0 so they never reach persisted state", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, { tick: 12, results: new Map() }, makeParams({
      constructionWorkByFaction: new Map([["faction-1", NaN]]),
      logisticsWorkByFaction: new Map([["faction-1", Infinity]]),
    }));
    expect(world.treasuries[0].pendingWork).toEqual({ logistics: 0, construction: 0 });

    await runTreasuryProcessor(world, ctxWithRealized(24, new Map()), makeParams({
      constructionWorkByFaction: new Map([["faction-1", NaN]]),
    }));
    const settled = world.treasuries[0].lastSettlement;
    if (settled === null) throw new Error("expected a settlement on the cycle start");
    expect(settled.constructionBill).toBe(0);
    expect(JSON.parse(JSON.stringify(world.treasuries[0]))).toEqual(world.treasuries[0]);
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

  it("is a no-op mid-cycle with no work", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, { tick: 7, results: new Map() }, makeParams());
    expect(world.treasuries[0].updatedAtTick).toBe(0);
  });

  it("carries a founding debit accrued on a WORKLESS mid-cycle tick through to settlement", async () => {
    // A colony can be committed on a cycle where the queue absorbed nothing at all. Both the early
    // return and the mid-cycle write branch key on pending WORK by default, so either one still
    // reading only work drops this debit on the floor and the colony is founded for free.
    const world = new InMemoryTreasuryWorld({
      treasuries: [makeTreasury({ balance: 500 })],
      systems: [SYSTEM],
    });
    await runTreasuryProcessor(world, { tick: 12, results: new Map() }, makeParams({
      foundingDebitsByFaction: new Map([["faction-1", 120]]),
    }));
    expect(world.treasuries[0].pendingWork).toEqual({ logistics: 0, construction: 0 });
    expect(world.treasuries[0].pendingFounding).toBe(120);
    expect(world.treasuries[0].lastSettlement).toBeNull();

    await runTreasuryProcessor(world, ctxWithRealized(24, new Map()), makeParams());
    const settled = world.treasuries[0].lastSettlement;
    if (settled === null) throw new Error("expected a settlement on the cycle start");
    expect(settled.foundingExpense).toBe(120);
    expect(world.treasuries[0].pendingFounding).toBe(0);
  });

  it("reconciles the balance across a settlement carrying a founding expense", async () => {
    const opening = 1000;
    const world = new InMemoryTreasuryWorld({
      treasuries: [makeTreasury({ balance: opening })],
      systems: [SYSTEM],
    });
    await runTreasuryProcessor(
      world,
      ctxWithRealized(24, new Map([["sys-1", new Map([["food", 10]])]])),
      makeParams({ foundingDebitsByFaction: new Map([["faction-1", 200]]) }),
    );
    const t = world.treasuries[0];
    const s = t.lastSettlement;
    if (s === null) throw new Error("expected a settlement on the cycle start");
    expect(s.foundingExpense).toBe(200);
    const income = s.headsIncome + s.productionIncome;
    const paid = s.paid.maintenance + s.paid.logistics + s.paid.construction;
    expect(t.balance).toBeCloseTo(opening + income - paid - s.foundingExpense, 6);
  });

  it("takes founding off the top, so a tight ladder pays less than it would without it", async () => {
    // The deliberate ordering choice: founding lands BEFORE settleLadder, so it can push even the
    // maintenance floor down. Settle the same faction twice — the only difference is the debit.
    // No systems: zero income and a zero maintenance bill, so the only bill is the 50 the
    // construction backlog owes and the only money is the opening balance.
    const seed = () =>
      new InMemoryTreasuryWorld({
        treasuries: [makeTreasury({ balance: 60, pendingWork: { logistics: 0, construction: 100 } })],
        systems: [],
      });
    const free = seed();
    await runTreasuryProcessor(free, ctxWithRealized(24, new Map()), makeParams());
    const charged = seed();
    await runTreasuryProcessor(
      charged,
      ctxWithRealized(24, new Map()),
      makeParams({ foundingDebitsByFaction: new Map([["faction-1", 40]]) }),
    );

    const a = free.treasuries[0];
    const b = charged.treasuries[0];
    // The bills are identical; only what was available to pay them moved.
    expect(a.lastSettlement?.constructionBill).toBeCloseTo(50, 6);
    expect(b.lastSettlement?.constructionBill).toBeCloseTo(50, 6);
    expect(a.funded.construction).toBeCloseTo(1, 6); // 60 covers the 50 bill
    expect(b.funded.construction).toBeCloseTo(0.4, 6); // 40 left for founding ⇒ 20 of 50
    expect(b.balance).toBe(0);
  });
});
