import { describe, it, expect } from "vitest";
import { runPopulationProcessor } from "../population";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import type { TickContext } from "@/lib/tick/types";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import { civilianDemandRateForGood, totalDemandRateForGood } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import type { CivilianDemandBasis } from "@/lib/engine/physical-economy";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";

const PARAMS = { unrest: { gain: 0.1, decay: 0.05 }, population: { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0 }, interval: 24 };

// Invariance fixture: a lower unrest decay than PARAMS. The unrest filter is integrated
// with explicit Euler, whose split residue between one full step and two half steps is
// ≈ 0.25·decay from a zero start — an integrator artifact, not a scaling error. Keeping
// decay small holds that residue well under the 1% first-order bar the scaling must meet.
const INVARIANCE_PARAMS = { unrest: { gain: 0.06, decay: 0.02 }, population: { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0 } };

/** A demand basis with no skilled work — matches these fixtures' academy-free systems. */
const popOnly = (population: number): CivilianDemandBasis => ({
  population,
  technicians: 0,
  engineers: 0,
});

function sys(id: string, population: number, popCap: number, unrest = 0, buildings: Record<string, number> = {}): TickSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", control: "developed", governmentType: "federation",
    population, popCap, unrest, buildings, buildingIdleMonths: {}, buildingCollapseDebt: {},
    yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
  };
}
function market(systemId: string, goodId: string): WorldMarket {
  return { systemId, goodId, stock: 100, anchorMult: 1, demandRate: 1, storageCapacity: 0 };
}
function ctxWithD(d: Map<string, number>): TickContext {
  return {
    tick: 0,
    results: new Map([
      ["economy", { economySignals: { dissatisfactionBySystem: d, sellingFactorBySystem: new Map(), realizedProductionBySystem: new Map() } }],
    ]),
  };
}

describe("population processor", () => {
  it("grows a fed system and leaves unrest at 0", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.unrest).toBe(0);
    expect(a.population).toBeGreaterThan(500);
  });
  it("raises unrest and rewrites demandRate for a starved system", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 1]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    // Hand-derived from the start state (pop 500, cap 1000, unrest 0) under D=1, so these
    // are an independent oracle rather than the processor's own output read back:
    //   unrest = 0 + gain·1 − decay·0 = 0.1
    //   Δpop   = growth·(1−D)=0 − decline·pop·unrest = −(0.02·500·0.1) = −1.0 → pop 499
    expect(a.unrest).toBeCloseTo(0.1, 6);
    expect(a.population).toBeCloseTo(499, 6);
    const m = world.markets.find((mm) => mm.systemId === "a")!;
    // demandRate = civilian-only floor for food at pop 499 (no production-input draw here).
    expect(m.demandRate).toBeCloseTo(civilianDemandRateForGood("food", popOnly(499)), 5);
  });
  it("includes production-input demand in the rewritten demandRate", async () => {
    // A smelter (metals building) draws ore as a recipe input. The ore market's
    // demandRate must be larger than the civilian-only floor once the input term is folded in.
    // metals is skill1-gated (tier 1), so a vocational_school is required for the forecast
    // to see any production — without one, computeLabourState gates metals output to 0.
    const population = 500;
    const buildings = { metals: 3, housing: 1, vocational_school: 1 };
    const world = new InMemoryPopulationWorld({
      systems: [sys("s", population, 1000, 0, buildings)],
      markets: [
        market("s", "food"),
        market("s", "ore"),
      ],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["s", 0]])), PARAMS);

    const oreMarket = world.markets.find((m) => m.systemId === "s" && m.goodId === "ore")!;
    const afterPop = world.systems.find((s) => s.id === "s")!.population;

    // Ore has no per-capita need, so civilian-only gives MIN_DEMAND. Ore is also not a
    // basket good, so the population-only basis matches the system's real (technician-
    // bearing) basis for this good.
    const civilianOnly = civilianDemandRateForGood("ore", popOnly(afterPop));
    const withIndustrial = totalDemandRateForGood("ore", popOnly(afterPop), buildings, unitResourceVector());

    // The smelter's ore draw must push the rate above the civilian-only floor.
    expect(withIndustrial).toBeGreaterThan(civilianOnly);
    expect(oreMarket.demandRate).toBeCloseTo(withIndustrial, 6);
  });
  it("raises a basket good's demandRate when skilled work is performed", async () => {
    // Same vocational_school-bearing system, now asserting a skill1-basket good:
    // the building-derived technician count must reach the market row through
    // rewriteDemandRates — a population-only basis would leave consumer_goods
    // at its per-capita rate.
    const population = 500;
    const buildings = { metals: 3, housing: 1, vocational_school: 1 };
    const world = new InMemoryPopulationWorld({
      systems: [sys("s", population, 1000, 0, buildings)],
      markets: [market("s", "food"), market("s", "consumer_goods")],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["s", 0]])), PARAMS);

    const m = world.markets.find((mm) => mm.systemId === "s" && mm.goodId === "consumer_goods")!;
    const afterPop = world.systems.find((s) => s.id === "s")!.population;
    const snap = computeSystemLabourSnapshot(buildings, afterPop);
    expect(snap.basis.technicians).toBeGreaterThan(0);

    // The technician basket term separates the real basis from population-only…
    expect(civilianDemandRateForGood("consumer_goods", snap.basis)).toBeGreaterThan(
      civilianDemandRateForGood("consumer_goods", popOnly(afterPop)),
    );
    // …and the market row carries the real-basis total, not the population-only one.
    const realBasisTotal = totalDemandRateForGood("consumer_goods", snap.basis, buildings, unitResourceVector(), snap.state);
    const popOnlyTotal = totalDemandRateForGood("consumer_goods", popOnly(afterPop), buildings, unitResourceVector(), snap.state);
    expect(m.demandRate).toBeCloseTo(realBasisTotal, 6);
    expect(m.demandRate).not.toBeCloseTo(popOnlyTotal, 6);
  });

  it("halving the interval halves the per-run growth (wall-clock rate preserved)", async () => {
    // Fed system (D=0 ⇒ unrest stays 0, decline term 0): pure logistic growth.
    // One run at interval 24 must match two runs at interval 12 over the same
    // wall-clock span, each run fed the same fresh D as the economy would.
    const worldA = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(worldA, ctxWithD(new Map([["a", 0]])), { ...INVARIANCE_PARAMS, interval: 24 });
    const popA = worldA.systems.find((s) => s.id === "a")!.population;

    const worldB = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(worldB, ctxWithD(new Map([["a", 0]])), { ...INVARIANCE_PARAMS, interval: 12 });
    await runPopulationProcessor(worldB, ctxWithD(new Map([["a", 0]])), { ...INVARIANCE_PARAMS, interval: 12 });
    const popB = worldB.systems.find((s) => s.id === "a")!.population;

    // Compare the growth increment, not the total: growth is ~1% of population, so an
    // unscaled two-run world (double the increment) would still sit within 1% of the
    // total — the invariance must bite on the delta that actually scales.
    const growthA = popA - 500;
    const growthB = popB - 500;
    expect(growthA).toBeGreaterThan(0); // it actually grew (guards a trivial no-op pass)
    expect(Math.abs(growthA - growthB) / growthA).toBeLessThan(0.01);
  });

  it("unrest integration scales with the interval", async () => {
    // Constant dissatisfaction: one run at 24 vs two runs at 12 must reach the
    // same wall-clock unrest, because gain and decay both scale by catchUpFactor.
    const D = 0.5;
    const worldA = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(worldA, ctxWithD(new Map([["a", D]])), { ...INVARIANCE_PARAMS, interval: 24 });
    const unrestA = worldA.systems.find((s) => s.id === "a")!.unrest;

    const worldB = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [market("a", "food")] });
    await runPopulationProcessor(worldB, ctxWithD(new Map([["a", D]])), { ...INVARIANCE_PARAMS, interval: 12 });
    await runPopulationProcessor(worldB, ctxWithD(new Map([["a", D]])), { ...INVARIANCE_PARAMS, interval: 12 });
    const unrestB = worldB.systems.find((s) => s.id === "a")!.unrest;

    expect(unrestA).toBeGreaterThan(0); // unrest actually accumulated
    expect(Math.abs(unrestA - unrestB) / unrestA).toBeLessThan(0.01);
  });

  it("no-ops when the economy left no signals", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000)], markets: [] });
    const before = world.systems[0].population;
    await runPopulationProcessor(world, { tick: 0, results: new Map() }, PARAMS);
    expect(world.systems[0].population).toBe(before);
  });
  it("no-ops when the economy signal map is present but empty", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000)], markets: [] });
    const before = world.systems[0].population;
    await runPopulationProcessor(world, ctxWithD(new Map()), PARAMS);
    expect(world.systems[0].population).toBe(before);
  });

  it("adds per-system tax pressure to the unrest integrator only", async () => {
    // d = 0, unrest starts 0, interval 24 (catchUp 1), UNREST_PARAMS-style gain 0.06:
    // taxed system integrates gain × pressure; untaxed stays at 0.
    const world = new InMemoryPopulationWorld({
      systems: [
        sys("taxed", 100, 1000, 0),
        sys("free", 100, 1000, 0),
      ],
      markets: [],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["taxed", 0], ["free", 0]])), {
      unrest: { gain: 0.06, decay: 0.06 },
      population: { growthRate: 0, declineRate: 0, overshootDeathRate: 0 },
      interval: 24,
      taxPressureBySystem: new Map([["taxed", 0.18]]),
    });
    expect(world.systems.find((s) => s.id === "taxed")!.unrest).toBeCloseTo(0.06 * 0.18, 9);
    expect(world.systems.find((s) => s.id === "free")!.unrest).toBe(0);
  });
});
