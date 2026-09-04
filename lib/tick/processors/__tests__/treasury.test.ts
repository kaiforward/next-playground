import { describe, it, expect } from "vitest";
import { runTreasuryProcessor } from "@/lib/tick/processors/treasury";
import { InMemoryTreasuryWorld } from "@/lib/tick/adapters/memory/treasury";
import type { TreasuryProcessorParams, TreasuryFactionSystemRow } from "@/lib/tick/world/treasury-world";
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
    laneUpkeepWorkByFaction: new Map(),
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

function ctxWithRealised(tick: number, realised: Map<string, Map<string, number>>): TickContext {
  return {
    tick,
    results: new Map([
      ["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map(),
          supplyStateBySystem: new Map(),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: realised,
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
      ctxWithRealised(24, new Map([["sys-1", new Map([["food", 10]])]])),
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

  it("persists the maintenance the settlement asked for, frozen at the slider then in force", async () => {
    // The alert bar's Maintenance unfunded reading is `paid[band] < charged[band]`, and it
    // is only honest if the charge is captured at settlement — the player can move the slider at any
    // time, with no re-settle. Two identical worlds settled at different sliders: the bill is the
    // same, the charge tracks the slider, and both are half of the bill at 0.5.
    const seed = () => new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    const full = seed();
    await runTreasuryProcessor(full, ctxWithRealised(24, new Map()), makeParams());
    const halved = new InMemoryTreasuryWorld({
      treasuries: [makeTreasury({ bands: { maintenance: 0.5, logistics: 1, construction: 1 } })],
      systems: [SYSTEM],
    });
    await runTreasuryProcessor(halved, ctxWithRealised(24, new Map()), makeParams());

    const a = full.treasuries[0].lastSettlement;
    const b = halved.treasuries[0].lastSettlement;
    if (a === null || b === null) throw new Error("expected settlements on both worlds");
    const chargeA = a.charged?.maintenance;
    const chargeB = b.charged?.maintenance;
    if (chargeA === undefined || chargeB === undefined) throw new Error("expected a recorded charge");
    expect(a.maintenanceBill).toBeGreaterThan(0);
    expect(chargeA).toBeCloseTo(a.maintenanceBill);
    expect(b.maintenanceBill).toBeCloseTo(a.maintenanceBill);
    expect(chargeB).toBeCloseTo(a.maintenanceBill * 0.5);
    // A settlement that paid what it was asked for is solvent, at either slider.
    expect(a.paid.maintenance).toBeCloseTo(chargeA);
    expect(b.paid.maintenance).toBeCloseTo(chargeB);
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

    await runTreasuryProcessor(world, ctxWithRealised(24, new Map()), makeParams({ economyScale: 100 }));
    const settled = world.treasuries[0].lastSettlement;
    if (settled === null) throw new Error("expected a settlement on the cycle start");
    expect(settled.constructionBill).toBeCloseTo(8 * 0.5);
    expect(settled.logisticsBill).toBeCloseTo(0.4 * 0.05);
    expect(world.treasuries[0].pendingWork).toEqual({ logistics: 0, construction: 0 });
  });

  it("scales the per-cycle rates by catchUpFactor but never the per-cycle quantities", async () => {
    // Identical worlds settled at tick 24 under interval 24 (catchUp 1) vs 12 (catchUp 0.5):
    // heads tax and maintenance are per-cycle rates and must halve; realised production and
    // accrued band work arrive already cycle-scaled and must not be rescaled.
    const seed = () =>
      new InMemoryTreasuryWorld({
        treasuries: [makeTreasury({ pendingWork: { logistics: 2, construction: 8 } })],
        systems: [SYSTEM],
      });
    const realised = () => ctxWithRealised(24, new Map([["sys-1", new Map([["food", 10]])]]));
    const ref = seed();
    await runTreasuryProcessor(ref, realised(), makeParams());
    const half = seed();
    await runTreasuryProcessor(half, realised(), makeParams({ interval: 12 }));

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

    await runTreasuryProcessor(world, ctxWithRealised(24, new Map()), makeParams({
      constructionWorkByFaction: new Map([["faction-1", NaN]]),
    }));
    const settled = world.treasuries[0].lastSettlement;
    if (settled === null) throw new Error("expected a settlement on the cycle start");
    expect(settled.constructionBill).toBe(0);
    expect(JSON.parse(JSON.stringify(world.treasuries[0]))).toEqual(world.treasuries[0]);
  });

  it("bills lane upkeep as exactly one more maintenance term, and funded.maintenance moves with it", async () => {
    const withoutLanes = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(withoutLanes, ctxWithRealised(24, new Map()), makeParams());
    const withLanes = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(
      withLanes,
      ctxWithRealised(24, new Map()),
      makeParams({ laneUpkeepWorkByFaction: new Map([["faction-1", 100]]) }),
    );

    const base = withoutLanes.treasuries[0].lastSettlement;
    const withLane = withLanes.treasuries[0].lastSettlement;
    if (base === null || withLane === null) throw new Error("expected both settlements");
    const laneTerm = 100 * RATES.maintenanceRatePerWork; // catchUp 1 at interval === cadence
    expect(withLane.maintenanceBill).toBeCloseTo(base.maintenanceBill + laneTerm, 9);
    expect(withLane.laneUpkeepBill).toBeCloseTo(laneTerm, 9);
    expect(base.laneUpkeepBill).toBeCloseTo(0, 9);

    // Isolate the ladder's reaction to the lane term: no systems (no building bill, no income), so
    // the ONLY maintenance charge either settlement carries is the lane term itself. Zero balance
    // means the unbilled faction reads the zero-bill guard (funded = slider = 1) while the billed one
    // is charged and cannot pay — funded.maintenance genuinely moves off the lane term, not off some
    // other bill it happens to share the band with.
    const unbilled = new InMemoryTreasuryWorld({ treasuries: [makeTreasury({ balance: 0 })], systems: [] });
    await runTreasuryProcessor(unbilled, ctxWithRealised(24, new Map()), makeParams());
    const billed = new InMemoryTreasuryWorld({ treasuries: [makeTreasury({ balance: 0 })], systems: [] });
    await runTreasuryProcessor(
      billed,
      ctxWithRealised(24, new Map()),
      makeParams({ laneUpkeepWorkByFaction: new Map([["faction-1", 100]]) }),
    );
    expect(unbilled.treasuries[0].funded.maintenance).toBe(1);
    expect(billed.treasuries[0].funded.maintenance).toBeLessThan(unbilled.treasuries[0].funded.maintenance);
  });

  it("bills nobody for a faction with an unclaimed-endpoint lane (no entry in the upkeep map)", async () => {
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(
      world,
      ctxWithRealised(24, new Map()),
      makeParams({ laneUpkeepWorkByFaction: new Map() }),
    );
    const settled = world.treasuries[0].lastSettlement;
    if (settled === null) throw new Error("expected a settlement on the cycle start");
    expect(settled.laneUpkeepBill).toBe(0);
  });

  it("shorts the ladder bottom-up under insolvency and latches the paid fraction as funding", async () => {
    // Zero income (no systems), a construction backlog to bill, zero balance.
    const world = new InMemoryTreasuryWorld({
      treasuries: [makeTreasury({ pendingWork: { logistics: 0, construction: 100 } })],
      systems: [],
    });
    await runTreasuryProcessor(world, ctxWithRealised(24, new Map()), makeParams());
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

  it("carries a mid-cycle tick that moved ONLY logistics work through to persisted state", async () => {
    // Logistics is the one band that can accrue on a tick where nothing else did — a transfer is
    // paid for on its own cadence. Both the early return and the mid-cycle write branch test all
    // three accruals, and either dropping logistics loses that work silently: nothing else on the
    // tick would differ, and the bill simply never arrives at settlement.
    const world = new InMemoryTreasuryWorld({
      treasuries: [makeTreasury({ balance: 500 })],
      systems: [SYSTEM],
    });
    await runTreasuryProcessor(world, { tick: 9, results: new Map() }, makeParams({
      logisticsWorkByFaction: new Map([["faction-1", 40]]),
      economyScale: 100,
    }));
    expect(world.treasuries[0].pendingWork.logistics).toBeCloseTo(0.4); // 40 / S=100
    expect(world.treasuries[0].pendingWork.construction).toBe(0);
    expect(world.treasuries[0].updatedAtTick).toBe(9);
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

    await runTreasuryProcessor(world, ctxWithRealised(24, new Map()), makeParams());
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
      ctxWithRealised(24, new Map([["sys-1", new Map([["food", 10]])]])),
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
    await runTreasuryProcessor(free, ctxWithRealised(24, new Map()), makeParams());
    const charged = seed();
    await runTreasuryProcessor(
      charged,
      ctxWithRealised(24, new Map()),
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

// ── What the settlement reads, writes and falls back to ──────────

/** Records the call sequence, so a read or a write made for nothing is visible. */
class RecordingTreasuryWorld extends InMemoryTreasuryWorld {
  readonly calls: string[] = [];
  override getTreasuries(): Promise<WorldFactionTreasury[]> {
    this.calls.push("getTreasuries");
    return super.getTreasuries();
  }
  override getFactionSystems(): Promise<TreasuryFactionSystemRow[]> {
    this.calls.push("getFactionSystems");
    return super.getFactionSystems();
  }
  override applyTreasuryUpdates(updates: WorldFactionTreasury[]): Promise<void> {
    this.calls.push("applyTreasuryUpdates");
    return super.applyTreasuryUpdates(updates);
  }
}

const settlementOf = (world: InMemoryTreasuryWorld) => {
  const settled = world.treasuries[0].lastSettlement;
  if (settled === null) throw new Error("expected a settlement on the cycle start");
  return settled;
};

describe("treasury processor: reads and writes made for nothing", () => {
  it("collects no faction systems for a galaxy with no treasuries", async () => {
    // The system fetch is the expensive read here — a settlement with nobody to settle for must
    // not pay for it.
    const world = new RecordingTreasuryWorld({ treasuries: [], systems: [SYSTEM] });
    await runTreasuryProcessor(world, ctxWithRealised(24, new Map()), makeParams());
    expect(world.calls).toEqual(["getTreasuries"]);
  });

  it("collects no faction systems mid-cycle, however much work accrued", async () => {
    // Mid-cycle the body only banks work against the next settlement; income is a settlement
    // concern, so nothing about the faction's systems is needed.
    const world = new RecordingTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, { tick: 12, results: new Map() }, makeParams({
      constructionWorkByFaction: new Map([["faction-1", 8]]),
    }));
    expect(world.calls).not.toContain("getFactionSystems");
    expect(world.treasuries[0].pendingWork.construction).toBe(8); // it did bank the work
  });

  it("writes nothing for a faction whose pending position did not move", async () => {
    // Another faction's accrual puts the tick past the early return, but this faction's row is
    // unchanged: rewriting it would touch every treasury in the galaxy on every tick any faction
    // did any work, and stamp `updatedAtTick` on rows that did not move.
    const world = new RecordingTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, { tick: 12, results: new Map() }, makeParams({
      constructionWorkByFaction: new Map([["someone-else", 8]]),
    }));
    expect(world.calls).not.toContain("applyTreasuryUpdates");
    expect(world.treasuries[0].updatedAtTick).toBe(0);
  });

  it("does not touch a treasury at all on a mid-cycle tick with nothing to accrue", async () => {
    // The early return is what keeps an idle tick free. The seeded non-finite pending value is the
    // tracer that makes any write visible at all: it is exactly what `safeMoney` would rewrite, so
    // a row that comes back unchanged proves the body never ran for it.
    const world = new RecordingTreasuryWorld({
      treasuries: [makeTreasury({ pendingWork: { logistics: 0, construction: NaN } })],
      systems: [SYSTEM],
    });
    await runTreasuryProcessor(world, { tick: 7, results: new Map() }, makeParams());
    expect(world.calls).toEqual(["getTreasuries"]);
    expect(world.treasuries[0].updatedAtTick).toBe(0);
  });
});

describe("treasury processor: fallbacks for unusable inputs", () => {
  it("normalises logistics work at unit scale when economyScale is unusable", async () => {
    // S normalises the logistics work signal. A corrupt, negative or zero scale is not a reason to
    // divide by it — that lands a NaN or an Infinity in `pendingWork`, which `safeMoney` then
    // flattens to 0 and the work is gone with no bill and no trace.
    const accrued = async (economyScale: number): Promise<number> => {
      const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
      await runTreasuryProcessor(world, { tick: 12, results: new Map() }, makeParams({
        logisticsWorkByFaction: new Map([["faction-1", 40]]),
        economyScale,
      }));
      return world.treasuries[0].pendingWork.logistics;
    };
    expect(await accrued(NaN)).toBe(40);
    expect(await accrued(-2)).toBe(40);
    expect(await accrued(0)).toBe(40);
  });

  it("bills a reference cycle when the cadence itself is unusable", async () => {
    // Heads tax and maintenance are per-cycle RATES scaled by the cadence. A zero cadence cannot
    // scale them — falling through with it would silently make the whole faction tax-free and
    // maintenance-free rather than billing a reference cycle.
    const settle = async (interval: number) => {
      const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
      await runTreasuryProcessor(
        world, ctxWithRealised(24, new Map([["sys-1", new Map([["food", 10]])]])),
        makeParams({ interval }),
      );
      return settlementOf(world);
    };
    const reference = await settle(24);
    const degenerate = await settle(0);
    expect(reference.headsIncome).toBeGreaterThan(0);
    expect(reference.maintenanceBill).toBeGreaterThan(0);
    expect(degenerate.headsIncome).toBeCloseTo(reference.headsIncome, 9);
    expect(degenerate.maintenanceBill).toBeCloseTo(reference.maintenanceBill, 9);
  });

  it("settles with no production income when the economy stage emitted no signals", async () => {
    // The economy stage is skipped off its own cycle boundary, so its result carries no signals at
    // all. Reaching through that for the realised-production map is a crash mid-tick — which hard-
    // pauses the loop and discards the whole tick.
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, { tick: 24, results: new Map([["economy", {}]]) }, makeParams());
    const settled = settlementOf(world);
    expect(settled.productionIncome).toBe(0);
    expect(settled.headsIncome).toBeGreaterThan(0); // the rest of the settlement still ran
  });
});

describe("treasury processor: the per-system income lines", () => {
  it("records a line for every system that earned on either tax, and for no other", async () => {
    // The lines are the settlement's audit trail. A system that earned on heads alone or on
    // production alone still earned; one that earned on neither is noise in every faction's
    // income breakdown, at one row per system per cycle.
    const world = new InMemoryTreasuryWorld({
      treasuries: [makeTreasury()],
      systems: [
        { ...SYSTEM, systemId: "both" },
        { ...SYSTEM, systemId: "heads-only" },
        { ...SYSTEM, systemId: "production-only", population: 0 },
        { ...SYSTEM, systemId: "idle", population: 0 },
      ],
    });
    await runTreasuryProcessor(
      world,
      ctxWithRealised(24, new Map([
        ["both", new Map([["food", 10]])],
        ["production-only", new Map([["food", 10]])],
      ])),
      makeParams(),
    );
    const lines = settlementOf(world).incomeBySystem;
    expect(lines.map((l) => l.systemId).sort()).toEqual(["both", "heads-only", "production-only"]);
    expect(lines.find((l) => l.systemId === "heads-only")!.production).toBe(0);
    expect(lines.find((l) => l.systemId === "production-only")!.heads).toBe(0);
  });

  it("scales each maintenance line by the same cadence factor as the bill it sums to", async () => {
    // The per-type breakdown is what the UI renders the maintenance bill from. Scaled the other
    // way, the lines would read four times the bill at half the cadence and still look plausible.
    const world = new InMemoryTreasuryWorld({ treasuries: [makeTreasury()], systems: [SYSTEM] });
    await runTreasuryProcessor(world, ctxWithRealised(24, new Map()), makeParams({ interval: 12 }));
    const settled = settlementOf(world);
    const summed = settled.maintenanceByType.reduce((total, l) => total + l.amount, 0);
    expect(settled.maintenanceBill).toBeGreaterThan(0);
    expect(summed).toBeCloseTo(settled.maintenanceBill, 9);
  });
});
