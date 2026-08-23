import { describe, it, expect } from "vitest";
import { runPopulationProcessor } from "../population";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import type { PopulationStateView, PopulationUpdate } from "@/lib/tick/world/population-world";
import type { TickContext } from "@/lib/tick/types";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import { civilianDemandRateForGood, totalDemandRateForGood } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot, inputDemandForGood } from "@/lib/engine/industry";
import { consumptionRate } from "@/lib/engine/physical-economy";
import type { CivilianDemandBasis } from "@/lib/engine/physical-economy";
import type { SupplyRegime, SupplyState } from "@/lib/engine/population";
import { updateExpectation } from "@/lib/engine/expectation";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import { ABANDON_POP_FLOOR, CROWDING, EXPECTATION_PARAMS } from "@/lib/constants/population";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { EXPANSION } from "@/lib/constants/expansion";

// Occupancy at which the growth brake reaches zero and the crowding-pressure ramp saturates
// — one boundary these fixtures hand to the processor, which threads it to both terms.
const BRAKE_END = 1.15;
// Non-rate shape knobs shared by the population fixtures below — the growth brake's end
// and the overshoot-death gate. Every fixture sets overshootDeathRate 0, so the gate value
// is inert here; only the rates differ between fixtures.
const POP_SHAPE = { crowdBrakeEnd: BRAKE_END, overshootDeathUnrestGate: 0.65 };

const PARAMS = {
  unrest: { slopeBase: 2, slopeShortage: 4, decay: 0.05 },
  population: { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0, ...POP_SHAPE },
  expectation: EXPECTATION_PARAMS,
  interval: 24,
};

// Invariance fixture: a lower relaxation rate than PARAMS. The unrest filter is integrated
// with explicit Euler, whose split residue between one full step and two half steps is
// ≈ 0.25·decay from a zero start — an integrator artifact, not a scaling error. Keeping
// the relaxation rate small holds that residue well under the 1% first-order bar the
// scaling must meet, whichever regime selects it. One slope for both regimes: this fixture
// measures the time step, not the D-selected slope.
const INVARIANCE_PARAMS = {
  unrest: { slopeBase: 3, slopeShortage: 3, decay: 0.02 },
  population: { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0, ...POP_SHAPE },
  expectation: EXPECTATION_PARAMS,
};

// Unrest fixture for the floor/regime suites: three pairwise-distinct numbers, so an assertion
// naming the wrong one cannot pass by coincidence.
const RATES = { slopeBase: 1.5, slopeShortage: 3, decay: 0.06 };
// Frozen population, so a run's only observable is the unrest integrator.
const FROZEN_POP = { growthRate: 0, declineRate: 0, overshootDeathRate: 0, ...POP_SHAPE };

/** A demand basis with no skilled work — matches these fixtures' academy-free systems. */
const popOnly = (population: number): CivilianDemandBasis => ({
  population,
  technicians: 0,
  engineers: 0,
});

function sys(id: string, population: number, popCap: number, unrest = 0, buildings: Record<string, number> = {}): TickSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", control: "developed", governmentType: "federation",
    population, popCap, unrest, buildings, buildingIdleCycles: {}, collapseDebt: 0,
    yields: unitResourceVector(), extractionEff: unitResourceVector(),
    depositCounts: emptyResourceVector(), industryLand: 0, peopleLand: 0,
  };
}
function market(systemId: string, goodId: string): WorldMarket {
  return { systemId, goodId, stock: 100, anchorMult: 1, demandRate: 1, storageCapacity: 0 };
}
function ctxWithD(
  d: Map<string, number>,
  regimes: Map<string, SupplyRegime> = new Map(),
  productionSuppressBySystem: Map<string, number> = new Map(),
): TickContext {
  const states = new Map<string, SupplyState>(
    [...regimes].map(([systemId, regime]) =>
      [systemId, { regime, survivalShortfall: false, criticalWeight: 0, emptyBasket: false }]),
  );
  return {
    tick: 0,
    results: new Map([
      ["economy", {
        economySignals: {
          dissatisfactionBySystem: d,
          supplyStateBySystem: states,
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem,
        },
      }],
    ]),
  };
}

const unrestOf = (world: InMemoryPopulationWorld, systemId: string) =>
  world.systems.find((s) => s.id === systemId)!.unrest;

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
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 1]]), new Map([["a", "famine"]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    // Hand-derived from the start state (pop 500, cap 1000, unrest 0) under D=1, no survival or
    // critical-good signal (ctxWithD's regime map carries neither — only the "famine" display
    // label), no tax/crowd — an independent oracle rather than the processor's own output read
    // back. The system carries no provisionExpectation, so this is a first-use read:
    // readExpectation seeds stored = P (this cycle's Provision) exactly, then floors the EFFECTIVE
    // reading only:
    //   P          = 1 − d = 0
    //   stored     = 0 (seeded, absent field)
    //   effective  = max(stored, EXPECTATION_FLOOR) = max(0, 0.5) = 0.5
    //   grievance  = clamp(effective − P, 0, 1) = clamp(0.5 − 0, 0, 1) = 0.5
    //   crisisTerm = 0 (no survival shortfall, criticalWeight 0)
    //   term       = max(slopeBase·0.5, 0) = 1
    //   floor      = 0 (untaxed, under the housing cap)
    //   unrest     = floor + (1−decay)·(0 − floor) + term·decay = 1·0.05 = 0.05
    //   Δpop       = growth·(1−D)=0 − decline·pop·unrest = −(0.02·500·0.05) = −0.5 → pop 499.5
    expect(a.unrest).toBeCloseTo(0.05, 6);
    expect(a.population).toBeCloseTo(499.5, 6);
    const m = world.markets.find((mm) => mm.systemId === "a")!;
    // demandRate = civilian-only floor for food at pop 499.5 (no production-input draw here).
    expect(m.demandRate).toBeCloseTo(civilianDemandRateForGood("food", popOnly(499.5)), 5);
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
    // Constant dissatisfaction: one run at 24 vs two runs at 12 must reach the same wall-clock
    // unrest, because gain and decay both scale by catchUpFactor. D = 0.7 keeps P (0.3) strictly
    // below EXPECTATION_FLOOR (0.5) — a newborn system's memory seeds to P immediately (already
    // below the floor), so the effective reading pins at the floor and grievance holds at exactly
    // floor − P for every subsequent run, decoupled from how the stored memory itself drifts. D =
    // 0.5 (P = floor exactly) would read zero grievance from the first cycle on and make this
    // fixture vacuous — deliberately avoided here.
    const D = 0.7;
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

  it("enters per-system tax pressure as the unrest floor, not as a gain", async () => {
    // d = 0, unrest starts 0, interval 24 (catchUp 1), calm: the run relaxes toward the floor,
    // so unrest moves decay of the way to the tax pressure. A gain term would instead have
    // integrated slopeBase × decay × pressure — a different number that then decays back
    // to zero rather than holding.
    const pressure = TAX_LEVEL_UNREST_PRESSURE.very_high;
    const world = new InMemoryPopulationWorld({
      systems: [
        sys("taxed", 100, 1000, 0),
        sys("free", 100, 1000, 0),
      ],
      markets: [],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["taxed", 0], ["free", 0]])), {
      unrest: RATES,
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
      taxPressureBySystem: new Map([["taxed", pressure]]),
    });
    expect(unrestOf(world, "taxed")).toBeCloseTo(RATES.decay * pressure, 9);
    expect(unrestOf(world, "free")).toBe(0);
  });

  it("settles a calm, supplied, taxed system at exactly its tax pressure", async () => {
    // The floor is the equilibrium: however many cycles run, a system with no
    // dissatisfaction converges on its standing pressure and stops there. RATES.decay is now
    // the only relaxation rate (no faster Supplied branch), so convergence to 1e-6 needs more
    // cycles than it did when this fixture's default "supplied" label picked a faster rate.
    const pressure = TAX_LEVEL_UNREST_PRESSURE.very_high;
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 100, 1000, 0)], markets: [] });
    const ctx = ctxWithD(new Map([["a", 0]]));
    const params = {
      unrest: RATES,
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
      taxPressureBySystem: new Map([["a", pressure]]),
    };
    for (let cycle = 0; cycle < 260; cycle++) await runPopulationProcessor(world, ctx, params);
    expect(unrestOf(world, "a")).toBeCloseTo(pressure, 6);
    expect(unrestOf(world, "a")).toBeLessThan(pressure); // approached from below, never overshot
  });

  it("adds crowding above the housing cap to the standing floor", async () => {
    // Three equally-taxed systems differing only in occupancy: at the cap crowding adds
    // nothing, at the brake end it adds the full PRESSURE_MAX, and halfway adds half.
    const cap = 1000;
    const pressure = TAX_LEVEL_UNREST_PRESSURE.high;
    const halfway = 1 + (BRAKE_END - 1) / 2;
    const world = new InMemoryPopulationWorld({
      systems: [
        sys("roomy", cap, cap, 0),
        sys("half", cap * halfway, cap, 0),
        sys("packed", cap * BRAKE_END, cap, 0),
      ],
      markets: [],
    });
    await runPopulationProcessor(
      world,
      ctxWithD(new Map([["roomy", 0], ["half", 0], ["packed", 0]])),
      {
        unrest: RATES,
        population: FROZEN_POP,
        expectation: EXPECTATION_PARAMS,
        interval: 24,
        taxPressureBySystem: new Map([["roomy", pressure], ["half", pressure], ["packed", pressure]]),
      },
    );
    expect(unrestOf(world, "roomy")).toBeCloseTo(RATES.decay * pressure, 9);
    expect(unrestOf(world, "half")).toBeCloseTo(RATES.decay * (pressure + CROWDING.PRESSURE_MAX / 2), 9);
    expect(unrestOf(world, "packed")).toBeCloseTo(RATES.decay * (pressure + CROWDING.PRESSURE_MAX), 9);
  });

  it("falls back to a crowding-only floor when no tax map is supplied", async () => {
    const cap = 1000;
    const world = new InMemoryPopulationWorld({
      systems: [sys("roomy", cap, cap, 0), sys("packed", cap * BRAKE_END, cap, 0)],
      markets: [],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["roomy", 0], ["packed", 0]])), {
      unrest: RATES,
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(unrestOf(world, "packed")).toBeCloseTo(RATES.decay * CROWDING.PRESSURE_MAX, 9);
    expect(unrestOf(world, "roomy")).toBe(0);
  });

  it("moves the growth brake and the crowding-pressure ramp together off one brake end", async () => {
    // One over-capacity system, run twice against different crowdBrakeEnd params. At the
    // default the system sits at the saturated end (growth fully braked, full crowding
    // pressure); stretching the brake end to 1.6 puts the same occupancy halfway along both
    // ramps, so growth resumes at half rate AND the pressure term halves. A brake end read
    // from a constant for one term would leave that term pinned while the other moved.
    const cap = 1000;
    const population = 1300; // r = 1.3: past the default brake end, halfway to a 1.6 one
    const growthRate = 0.02;
    const runWithBrakeEnd = async (crowdBrakeEnd: number) => {
      const world = new InMemoryPopulationWorld({ systems: [sys("s", population, cap, 0)], markets: [] });
      await runPopulationProcessor(world, ctxWithD(new Map([["s", 0]])), {
        unrest: RATES,
        // Decline off, so population moves on the growth brake alone.
        population: { growthRate, declineRate: 0, overshootDeathRate: 0, crowdBrakeEnd, overshootDeathUnrestGate: 0.65 },
        expectation: EXPECTATION_PARAMS,
        interval: 24,
      });
      return world;
    };

    const atDefault = await runWithBrakeEnd(BRAKE_END);
    expect(unrestOf(atDefault, "s")).toBeCloseTo(RATES.decay * CROWDING.PRESSURE_MAX, 9);
    expect(atDefault.systems[0].population).toBeCloseTo(population, 9); // growth fully braked

    // r = 1.3 over a span of 0.6 ⇒ t = 0.5: half the crowding pressure, and a smoothstep
    // brake of 1 − t²(3 − 2t) = 0.5 on growth.
    const stretched = await runWithBrakeEnd(1.6);
    expect(unrestOf(stretched, "s")).toBeCloseTo(RATES.decay * (CROWDING.PRESSURE_MAX / 2), 9);
    expect(stretched.systems[0].population).toBeCloseTo(population + growthRate * population * 0.5, 9);
  });

  it("clamps the standing floor at 1 when tax and crowding would overflow it", async () => {
    // No tax level reaches this today; the clamp guards a future retune. floor saturates at
    // 1, so one run moves decay of the way from 0 to 1 — an unclamped floor of 1.04 would
    // have landed higher instead.
    const cap = 1000;
    const world = new InMemoryPopulationWorld({ systems: [sys("overtaxed", cap * BRAKE_END, cap, 0)], markets: [] });
    await runPopulationProcessor(world, ctxWithD(new Map([["overtaxed", 0]])), {
      unrest: RATES,
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
      taxPressureBySystem: new Map([["overtaxed", 0.99]]),
    });
    expect(unrestOf(world, "overtaxed")).toBeCloseTo(RATES.decay, 9);
  });

  it("relaxes unrest identically whatever supply label a system carries, including one missing from the map", async () => {
    // Three systems, identical starting unrest and zero D — only the LABEL differs (one is
    // missing from the regime map entirely, which the ctx builder below defaults to "supplied").
    // The old behaviour picked a different relaxation rate per label; this is the only test that
    // would catch a leftover `supply.regime` read reaching the processor.
    const start = 0.5;
    const world = new InMemoryPopulationWorld({
      systems: [
        sys("unlisted", 100, 1000, start),
        sys("served", 100, 1000, start),
        sys("short", 100, 1000, start),
      ],
      markets: [],
    });
    const regimes = new Map<string, SupplyRegime>([["served", "supplied"], ["short", "famine"]]);
    await runPopulationProcessor(
      world,
      ctxWithD(new Map([["unlisted", 0], ["served", 0], ["short", 0]]), regimes),
      { unrest: RATES, population: FROZEN_POP, expectation: EXPECTATION_PARAMS, interval: 24 },
    );
    const expected = start * (1 - RATES.decay);
    expect(unrestOf(world, "unlisted")).toBeCloseTo(expected, 9);
    expect(unrestOf(world, "served")).toBeCloseTo(expected, 9);
    expect(unrestOf(world, "short")).toBeCloseTo(expected, 9);
  });

  it("scales the relaxation rate — and hence the derived gains — by the catch-up factor", async () => {
    // Interval 48 is two reference cycles, so one run must move exactly twice as far as one run at
    // the reference interval. Only the relaxation rate is scaled; the gain is term × rate, so it
    // rides along while the slope stays a dimensionless exchange rate. Gains are read from a zero
    // start (no relaxation term) and relaxation from a raised start (D = 0, so no gain term). The
    // slope is flat now (no D-ramp, no regime selection): neither gain fixture carries a survival or
    // critical-good signal, so gain-rationing and gain-famine differ only in their D value — both
    // driven by the identical slopeBase. The two gain systems are pre-seeded with a valid stored
    // provisionExpectation of 1 (a fully-accustomed world), so the read-side effective value is
    // pinned at the ceiling regardless of D and grievance tracks D exactly (clamp(1 − P, 0, 1) = D)
    // — a single-cycle read per run, so the update the processor also performs afterward never gets
    // a chance to feed back within this fixture. relax-supplied and relax-rationing carry different
    // LABELS but the identical rate, so they must land on the identical relaxed value; they carry no
    // provisionExpectation (D = 0, so P = 1 either way, and grievance reads 0 regardless of the
    // seed).
    const start = 0.5;
    const D_LOW = 0.1;
    const D_HIGH = 0.95;
    const runAt = async (interval: number) => {
      const world = new InMemoryPopulationWorld({
        systems: [
          { ...sys("gain-rationing", 100, 1000, 0), provisionExpectation: 1 },
          { ...sys("gain-famine", 100, 1000, 0), provisionExpectation: 1 },
          sys("relax-rationing", 100, 1000, start),
          sys("relax-supplied", 100, 1000, start),
        ],
        markets: [],
      });
      const regimes = new Map<string, SupplyRegime>([
        ["gain-rationing", "rationing"],
        ["gain-famine", "famine"],
        ["relax-rationing", "rationing"],
        ["relax-supplied", "supplied"],
      ]);
      const dissatisfaction = new Map([
        ["gain-rationing", D_LOW], ["gain-famine", D_HIGH], ["relax-rationing", 0], ["relax-supplied", 0],
      ]);
      await runPopulationProcessor(world, ctxWithD(dissatisfaction, regimes), {
        unrest: RATES, population: FROZEN_POP, expectation: EXPECTATION_PARAMS, interval,
      });
      return world;
    };
    const ref = await runAt(24);
    const double = await runAt(48);

    const rationingGain = RATES.slopeBase * RATES.decay * D_LOW;
    const famineGain = RATES.slopeBase * RATES.decay * D_HIGH;
    expect(unrestOf(ref, "gain-rationing")).toBeCloseTo(rationingGain, 9);
    expect(unrestOf(double, "gain-rationing")).toBeCloseTo(2 * rationingGain, 9);
    expect(unrestOf(ref, "gain-famine")).toBeCloseTo(famineGain, 9);
    expect(unrestOf(double, "gain-famine")).toBeCloseTo(2 * famineGain, 9);
    expect(unrestOf(ref, "relax-rationing")).toBeCloseTo(start * (1 - RATES.decay), 9);
    expect(unrestOf(double, "relax-rationing")).toBeCloseTo(start * (1 - 2 * RATES.decay), 9);
    expect(unrestOf(ref, "relax-supplied")).toBeCloseTo(start * (1 - RATES.decay), 9);
    expect(unrestOf(double, "relax-supplied")).toBeCloseTo(start * (1 - 2 * RATES.decay), 9);
    expect(unrestOf(ref, "relax-supplied")).toBe(unrestOf(ref, "relax-rationing"));
  });

  it("settles unrest at the same level whatever the interval", async () => {
    // The reparameterisation's payoff at the processor: equilibrium is floor + slope × G, with no
    // rate in it, so a shard running at a different interval settles in the same place rather than
    // merely approaching it at a scaled speed. d = 0.7 keeps P (0.3) below EXPECTATION_FLOOR (0.5):
    // a newborn system's memory seeds to P on its very first cycle — already below the floor — so
    // the effective reading pins at the floor for the whole run and G holds at exactly
    // floor − P = 0.2 forever, independent of interval and of how the (irrelevant, floor-shadowed)
    // stored value itself might drift.
    const d = 0.7;
    const settleAt = async (interval: number) => {
      const world = new InMemoryPopulationWorld({ systems: [sys("a", 100, 1000, 0)], markets: [] });
      const ctx = ctxWithD(new Map([["a", d]]), new Map([["a", "rationing"]]));
      for (let i = 0; i < 400; i++) {
        await runPopulationProcessor(world, ctx, {
          unrest: RATES, population: FROZEN_POP, expectation: EXPECTATION_PARAMS, interval,
        });
      }
      return unrestOf(world, "a");
    };
    const G = EXPECTATION_PARAMS.floor - (1 - d);
    const expected = RATES.slopeBase * G;
    expect(await settleAt(24)).toBeCloseTo(expected, 6);
    expect(await settleAt(48)).toBeCloseTo(expected, 6);
  });
});

// ── The use figure, written beside the pricing rate ────────────────

describe("population processor: the honest use figure", () => {
  // A smelter world: metals draws ore, and the vocational school licenses the tier-1
  // technicians without which metals output — and so ore's industrial draw — is zero.
  const BUILDINGS = { metals: 3, housing: 1, vocational_school: 1 };
  const START_POP = 500;

  function runAt(suppress: Map<string, number>): Promise<InMemoryPopulationWorld> {
    const world = new InMemoryPopulationWorld({
      systems: [sys("s", START_POP, 1000, 0, BUILDINGS)],
      markets: [market("s", "food"), market("s", "ore")],
    });
    return runPopulationProcessor(world, ctxWithD(new Map([["s", 0]]), new Map(), suppress), PARAMS)
      .then(() => world);
  }

  const rowOf = (world: InMemoryPopulationWorld, goodId: string): WorldMarket => {
    const row = world.markets.find((m) => m.systemId === "s" && m.goodId === goodId);
    if (row === undefined) throw new Error(`Expected an ${goodId} market`);
    return row;
  };

  it("leaves the pricing demandRate untouched by the strike while the use figure falls", async () => {
    const calm = await runAt(new Map());
    const struck = await runAt(new Map([["s", 0.4]]));

    // D is 0 in both runs, so population evolves identically and the two are comparable.
    const pop = struck.systems[0].population;
    expect(calm.systems[0].population).toBeCloseTo(pop, 9);

    // The pricing rate is capacity-based and floored — an independent oracle, not a read-back.
    const priced = totalDemandRateForGood("ore", popOnly(pop), BUILDINGS, unitResourceVector());
    expect(rowOf(calm, "ore").demandRate).toBeCloseTo(priced, 9);
    expect(rowOf(struck, "ore").demandRate).toBeCloseTo(priced, 9);

    // The use figure is not floored and not capacity-based: it falls with the strike.
    const calmUse = rowOf(calm, "ore").honestUseRate;
    const struckUse = rowOf(struck, "ore").honestUseRate;
    if (calmUse === undefined || struckUse === undefined) throw new Error("Expected a use rate on both rows");
    expect(struckUse).toBeLessThan(calmUse);
  });

  it("gates only the industrial half — civilian want stays at full rate under a strike", async () => {
    const struck = await runAt(new Map([["s", 0.4]]));
    const pop = struck.systems[0].population;
    const snap = computeSystemLabourSnapshot(BUILDINGS, pop);

    // Independent oracle: the civilian rate at full population plus the capacity draw scaled once.
    const civilian = consumptionRate("ore", snap.basis);
    const industrial = inputDemandForGood(BUILDINGS, "ore", snap.state, unitResourceVector());
    expect(industrial).toBeGreaterThan(0); // or the gating assertion below is vacuous
    expect(rowOf(struck, "ore").honestUseRate).toBeCloseTo(civilian + industrial * 0.4, 9);

    // Nothing consumes food as a recipe input, so its use figure is civilian alone — and a
    // starving town must read as a full-rate consumer however hard its industry is struck.
    expect(rowOf(struck, "food").honestUseRate).toBeCloseTo(consumptionRate("food", snap.basis), 9);
  });

  it("reads a system missing from the suppress signal as unsuppressed", async () => {
    const absent = await runAt(new Map([["other", 0.2]]));
    const calm = await runAt(new Map([["s", 1]]));
    expect(rowOf(absent, "ore").honestUseRate).toBeCloseTo(rowOf(calm, "ore").honestUseRate ?? 0, 9);
  });

  it("leaves the use figure absent — never 0 — when the compute is corrupt", async () => {
    // A NaN population poisons the whole use computation. The write side's one guarantee is that
    // the poison never lands as 0: the readers' contract is absent ⇒ live recompute, while a
    // persisted 0 is a completed assessment that makes the row un-sinkable and fully drawable
    // at once. The stale prior figure must not survive either — absence is the recompute signal.
    const world = new InMemoryPopulationWorld({
      systems: [sys("s", Number.NaN, 1000, 0, BUILDINGS)],
      markets: [{ ...market("s", "ore"), honestUseRate: 12.5 }],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["s", 0]])), PARAMS);

    const row = rowOf(world, "ore");
    expect(row.honestUseRate).toBeUndefined();
    expect("honestUseRate" in row).toBe(false);
  });
});

// ── What the processor asks the world for ────────────────────────

/** Records the call sequence and the exact batches handed to the world. */
class RecordingPopulationWorld extends InMemoryPopulationWorld {
  readonly calls: string[] = [];
  readonly updates: PopulationUpdate[] = [];
  readonly demandRows: Array<{ systemId: string; population: number; productionSuppress: number }> = [];
  override getPopulationState(systemIds: string[]): Promise<PopulationStateView[]> {
    this.calls.push("getPopulationState");
    return super.getPopulationState(systemIds);
  }
  override applyPopulationUpdates(updates: PopulationUpdate[]): Promise<void> {
    this.calls.push("applyPopulationUpdates");
    this.updates.push(...updates);
    return super.applyPopulationUpdates(updates);
  }
  override rewriteDemandRates(
    pops: Array<{ systemId: string; population: number; productionSuppress: number }>,
  ): Promise<void> {
    this.calls.push("rewriteDemandRates");
    this.demandRows.push(...pops);
    return super.rewriteDemandRates(pops);
  }
}

describe("population processor: the world calls it makes", () => {
  it("reads and writes nothing when the economy stage resolved no system", async () => {
    // The processor is scoped to the economy's shard — off the economy's cycle the signal map is
    // empty, and a run that pushed on would fetch state for no systems and then write two empty
    // batches back, once per tick, for every tick between cycles.
    const world = new RecordingPopulationWorld({
      systems: [sys("a", 500, 1000, 0)],
      markets: [market("a", "food")],
    });
    await runPopulationProcessor(world, ctxWithD(new Map()), PARAMS);
    expect(world.calls).toEqual([]);
  });

  it("hands the world exactly one row per system it resolved", async () => {
    const world = new RecordingPopulationWorld({
      systems: [sys("a", 500, 1000, 0), sys("b", 400, 1000, 0)],
      markets: [market("a", "food"), market("b", "food")],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 0.2], ["b", 0.2]])), PARAMS);
    expect(world.updates.map((u) => u.systemId)).toEqual(["a", "b"]);
    expect(world.demandRows.map((p) => p.systemId)).toEqual(["a", "b"]);
  });

  it("treats a system the supply fold left out as supplied, not as famine-struck", async () => {
    // The supply state selects the unrest slope. A missing entry is a system the economy did not
    // classify, not one in famine — defaulting the other way would hand every unclassified world
    // the shortage slope and double the unrest it settles at. d = 0.6 keeps P (0.4) below
    // EXPECTATION_FLOOR (0.5) so a newborn system's grievance is genuinely nonzero (floor − P) —
    // d = 0.1 would read P above the floor and make the slope's contribution vacuously zero for
    // BOTH systems, proving nothing about which slope was picked.
    const seed = () => new RecordingPopulationWorld({
      systems: [sys("a", 500, 1000, 0)],
      markets: [market("a", "food")],
    });
    const omitted = seed();
    await runPopulationProcessor(omitted, ctxWithD(new Map([["a", 0.6]])), PARAMS);
    const classified = seed();
    await runPopulationProcessor(
      classified, ctxWithD(new Map([["a", 0.6]]), new Map([["a", "supplied"]])), PARAMS,
    );
    expect(unrestOf(omitted, "a")).toBeGreaterThan(0); // the slope really is doing work here
    expect(unrestOf(omitted, "a")).toBeCloseTo(unrestOf(classified, "a"), 12);
  });
});

// ── Adaptive expectation: the processor resolves the cycle-start memory, judges unrest against
// it, and only then advances the store ────────────────────────────────────

describe("population processor: adaptive expectation", () => {
  it("judges this cycle's unrest against the CYCLE-START memory, not a mid-cycle update", async () => {
    // An accustomed system (stored provisionExpectation = 1, valid) reading a mid-poverty cycle
    // (D = 0.6, P = 0.4). Correct order: grievance is read from the untouched stored value BEFORE
    // the memory advances toward P — clamp(1 - 0.4, 0, 1) = 0.6. An implementation that updates the
    // store FIRST and then reads grievance off the already-resigned value would instead read the
    // one-substep-resigned stored (1 + 0.02*(0.4-1) = 0.988), giving grievance 0.588 — a small but
    // exact and easily-distinguished divergence, not a floating-point coincidence.
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 100, 1000, 0), provisionExpectation: 1 }],
      markets: [],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 0.6]])), {
      unrest: { slopeBase: 2, slopeShortage: 4, decay: 0.5 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    // correct: grievance 0.6 -> term 1.2 -> unrest = 0 + 1.2*0.5 = 0.6
    // wrong (update-before-read): grievance 0.588 -> term 1.176 -> unrest = 0.588
    expect(unrestOf(world, "a")).toBeCloseTo(0.6, 6);
  });

  it("splits political from biological: an accustomed-poor world settles unrest at the standing floor while growth still reads absolute d", async () => {
    // Pre-seeded exactly at its own (poor but above-floor) Provision: G = 0 by construction, so the
    // supply term contributes nothing and unrest settles at the standing floor (0 here, untaxed,
    // uncrowded) — while population growth still reads the ABSOLUTE shortfall d = 0.45, not the
    // (zero) grievance. Feeding G into populationDelta instead of d would read satisfactionFactor
    // = 1 (full growth, wrong); feeding d into the unrest term instead of G would read a nonzero
    // term (wrong, unrest > 0) — this single fixture's two assertions catch each swap independently.
    const d = 0.45;
    const P = 1 - d; // 0.55, above EXPECTATION_FLOOR (0.5) — a genuinely accustomed reading
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 100, 1000, 0), provisionExpectation: P }],
      markets: [],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", d]])), {
      unrest: { slopeBase: 2, slopeShortage: 4, decay: 0.5 },
      population: { growthRate: 0.1, declineRate: 0.1, overshootDeathRate: 0, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.unrest).toBeCloseTo(0, 9); // political: G = 0, so no supply term at all
    // biological: growth = 0.1*100*crowdFactor(1)*(1-0.45) = 5.5, decline = 0 (unrest 0) -> pop 105.5
    expect(a.population).toBeCloseTo(105.5, 9);
  });

  it("skips the expectation update for an emptyBasket system while unrest still relaxes normally", async () => {
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 100, 1000, 0.2), provisionExpectation: 0.9 }],
      markets: [],
    });
    const ctx: TickContext = {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["a", 0.3]]),
          supplyStateBySystem: new Map([
            ["a", { regime: "supplied", survivalShortfall: false, criticalWeight: 0, emptyBasket: true }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
    await runPopulationProcessor(world, ctx, {
      unrest: { slopeBase: 2, slopeShortage: 4, decay: 0.5 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    const a = world.systems.find((s) => s.id === "a")!;
    // Byte-identical: the update never ran, even though P (0.7) differs from stored (0.9) and would
    // otherwise have moved it.
    expect(a.provisionExpectation).toBe(0.9);
    // But unrest is untouched by emptyBasket — it still integrates the grievance term normally:
    // grievance = clamp(0.9 - 0.7, 0, 1) = 0.2, term = 2*0.2 = 0.4,
    // unrest = 0 + 0.5*(0.2-0) + 0.4*0.5 = 0.1 + 0.2 = 0.3.
    expect(a.unrest).toBeCloseTo(0.3, 9);
  });

  it("leaves a never-seeded system's expectation absent when its opening cycle has an empty basket", async () => {
    // No pre-seeded provisionExpectation — a founding/world-gen read exactly like the "ends a
    // newborn's first cycle..." fixture above, but this cycle's basket is empty (nothing demanded
    // yet). readExpectation(undefined, P=1, ...) seeds stored = 1 — provision()'s own
    // empty-basket-artifact convention, not a real memory — and the emptyBasket skip must not
    // persist that seed as if it were one: the field must stay absent, not become a false stored 1.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 100, 1000, 0)], markets: [] });
    const ctx: TickContext = {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["a", 0]]),
          supplyStateBySystem: new Map([
            ["a", { regime: "supplied", survivalShortfall: false, criticalWeight: 0, emptyBasket: true }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
    await runPopulationProcessor(world, ctx, {
      unrest: { slopeBase: 2, slopeShortage: 4, decay: 0.5 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.provisionExpectation).toBeUndefined();
    expect("provisionExpectation" in a).toBe(false);
  });

  it("sub-steps the expectation update at catchUpFactor(interval), not one scaled step", async () => {
    // interval 48 is two reference cycles (catchUpFactor = 2), so the write must equal
    // updateExpectation(stored, P, params, subSteps: 2) exactly — not subSteps: 1 (forgetting to
    // derive the sub-step count from the interval) and not one step at a doubled rate (scaling
    // instead of sub-stepping, the exact bug the sub-step rule exists to prevent). All three
    // candidates are computed below to confirm the fixture actually distinguishes them.
    const stored0 = 0.5;
    const P = 0.9; // rise branch throughout — the wiring under test is the SUB-STEP COUNT; branch
                    // re-evaluation itself is proven at the engine level (expectation.test.ts).
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 100, 1000, 0), provisionExpectation: stored0 }],
      markets: [],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 1 - P]])), {
      unrest: { slopeBase: 1, slopeShortage: 2, decay: 0.1 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 48,
    });
    const written = world.systems.find((s) => s.id === "a")!.provisionExpectation;
    const subStepped = updateExpectation(stored0, P, EXPECTATION_PARAMS, 2); // the correct oracle
    const oneStep = updateExpectation(stored0, P, EXPECTATION_PARAMS, 1); // forgot to derive subSteps
    const scaled = stored0 + Math.min(1, EXPECTATION_PARAMS.riseRate * 2) * (P - stored0); // scaled-rate bug
    expect(subStepped).not.toBeCloseTo(oneStep, 3); // the fixture has power against this bug
    expect(subStepped).not.toBeCloseTo(scaled, 3); // and against this one
    expect(written).toBeCloseTo(subStepped, 9);
  });

  it("floors the sub-step count at 1 for a below-reference interval, never 0", async () => {
    // interval 12 is half the reference cycle (catchUpFactor = 0.5). Math.round(0.5) already
    // equals 1 in JS, so this pins that the derived count really is the whole integer 1 fed to
    // updateExpectation — not the raw fractional 0.5 catch-up factor handed straight through,
    // which updateExpectation's own `Math.floor(subSteps)` guard would then floor to 0 sub-steps
    // and leave `stored` completely unmoved.
    const stored0 = 0.3;
    const P = 0.9; // stored !== P, so a 0-sub-step no-op is distinguishable from a 1-sub-step move
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 100, 1000, 0), provisionExpectation: stored0 }],
      markets: [],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 1 - P]])), {
      unrest: { slopeBase: 1, slopeShortage: 2, decay: 0.1 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 12,
    });
    const written = world.systems.find((s) => s.id === "a")!.provisionExpectation;
    const oneSubStep = updateExpectation(stored0, P, EXPECTATION_PARAMS, 1);
    expect(written).not.toBeCloseTo(stored0, 6); // the update really ran — not frozen at 0 sub-steps
    expect(written).toBeCloseTo(oneSubStep, 9);
  });

  it("rounds the sub-step count to the nearest whole step for a non-integer catch-up, not the floor", async () => {
    // interval 36 is 1.5 reference cycles (catchUpFactor = 1.5). Math.round(1.5) = 2, distinct
    // from Math.floor(1.5) = 1 — a floor-based implementation would apply one fewer sub-step than
    // the correct rounded count, separating "round" from "always floor to at least 1" (the
    // fixture above).
    const stored0 = 0.3;
    const P = 0.9;
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 100, 1000, 0), provisionExpectation: stored0 }],
      markets: [],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 1 - P]])), {
      unrest: { slopeBase: 1, slopeShortage: 2, decay: 0.1 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 36,
    });
    const written = world.systems.find((s) => s.id === "a")!.provisionExpectation;
    const twoSubSteps = updateExpectation(stored0, P, EXPECTATION_PARAMS, 2);
    const oneSubStep = updateExpectation(stored0, P, EXPECTATION_PARAMS, 1); // floor(1.5) — wrong
    expect(twoSubSteps).not.toBeCloseTo(oneSubStep, 6); // the fixture actually distinguishes them
    expect(written).toBeCloseTo(twoSubSteps, 9);
  });

  it("wires survivalShortfall through to the crisis-term reading, not just the grievance reading", async () => {
    // Pre-seeded stored === this cycle's P exactly: grievance is 0 by construction (P sits above
    // the floor, so effective = P and G = clamp(effective - P, 0, 1) = 0), so the grievance term
    // contributes nothing at all — whatever unrest reads above the floor can only have come from
    // the crisis term, which fires ONLY if survivalShortfall actually reached supplyUnrestTerm. A
    // benign-defaulted (false) flag on the way into the term would leave unrest pinned at 0.
    const D = 0.1;
    const P = 1 - D; // 0.9, above EXPECTATION_PARAMS.floor (0.5)
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 100, 1000, 0), provisionExpectation: P }],
      markets: [],
    });
    const unrest = { slopeBase: 1, slopeShortage: 4, decay: 0.5 };
    const ctx: TickContext = {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["a", D]]),
          supplyStateBySystem: new Map([
            ["a", { regime: "famine", survivalShortfall: true, criticalWeight: 0, emptyBasket: false }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
    await runPopulationProcessor(world, ctx, {
      unrest,
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    const a = world.systems.find((s) => s.id === "a")!;
    // term = slopeShortage * D = 4 * 0.1 = 0.4; unrest = 0 + 0.5*(0-0) + 0.4*0.5 = 0.2.
    expect(a.unrest).toBeCloseTo(unrest.slopeShortage * D * unrest.decay, 9);
    expect(a.unrest).toBeGreaterThan(0); // non-vacuous: a benign-defaulted flag would read exactly 0
  });

  it("ends a newborn's first cycle with stored = its own P and unrest at the floor-only fixed point, at any tax level", async () => {
    // No pre-seeded provisionExpectation on either system — an absent field, exactly a
    // world-gen/founding first read. P = 0.7 sits above EXPECTATION_FLOOR (0.5), so the
    // seed-and-no-op identity (readExpectation seeds stored = P; updateExpectation(P, P, ...) is a
    // no-op since p === s) makes the grievance term exactly 0 this cycle — structural newborn calm
    // at any tax level, per the spec's promise 1. Unrest is therefore governed only by the standing
    // tax+crowd floor, with no supply-term contribution at all.
    const pressure = TAX_LEVEL_UNREST_PRESSURE.very_high;
    const world = new InMemoryPopulationWorld({
      systems: [sys("taxed", 100, 1000, 0), sys("free", 100, 1000, 0)],
      markets: [],
    });
    const unrest = { slopeBase: 2, slopeShortage: 4, decay: 0.1 };
    await runPopulationProcessor(world, ctxWithD(new Map([["taxed", 0.3], ["free", 0.3]])), {
      unrest,
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
      taxPressureBySystem: new Map([["taxed", pressure]]),
    });
    const taxed = world.systems.find((s) => s.id === "taxed")!;
    const free = world.systems.find((s) => s.id === "free")!;
    expect(taxed.provisionExpectation).toBeCloseTo(0.7, 9);
    expect(free.provisionExpectation).toBeCloseTo(0.7, 9);
    expect(taxed.unrest).toBeCloseTo(pressure * unrest.decay, 9); // floor-only — no grievance term
    expect(free.unrest).toBe(0);
  });

  it("runs the expectation update for a system the supply signal omits (the defensive default carries emptyBasket: false)", async () => {
    // ctxWithD's default regimes map is empty, so "a" never appears in supplyStateBySystem — the
    // same defensive-default path the "treats a system the supply fold left out" unrest test above
    // exercises, here pointed at provisionExpectation. A regression that defaulted emptyBasket to
    // true would silently freeze the memory of every system the economy fold has not yet classified.
    const stored0 = 0.5;
    const P = 0.9;
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 100, 1000, 0), provisionExpectation: stored0 }],
      markets: [],
    });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 1 - P]])), {
      unrest: { slopeBase: 1, slopeShortage: 2, decay: 0.1 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    const written = world.systems.find((s) => s.id === "a")!.provisionExpectation;
    // A default emptyBasket: true would freeze this at stored0 exactly; the update must have run.
    expect(written).not.toBeCloseTo(stored0, 6);
    expect(written).toBeCloseTo(updateExpectation(stored0, P, EXPECTATION_PARAMS, 1), 9);
  });
});

// ── Persisted Provisioned and its band: written once per economy cycle from the same
// dissatisfactionBySystem / supplyStateBySystem signals the unrest read already consumed —
// so the presentation layer can read the same value the sim used instead of re-deriving it. ──

describe("population processor: persisted Provisioned and its band", () => {
  it("persists Provisioned as the complement of this cycle's dissatisfaction, per system — not a re-derived mean", async () => {
    const world = new InMemoryPopulationWorld({
      systems: [sys("a", 500, 1000, 0), sys("b", 500, 1000, 0)],
      markets: [],
    });
    const regimes = new Map<string, SupplyRegime>([["a", "supplied"], ["b", "rationing"]]);
    await runPopulationProcessor(
      world, ctxWithD(new Map([["a", 0.2], ["b", 0.7]]), regimes), PARAMS,
    );
    const a = world.systems.find((s) => s.id === "a")!;
    const b = world.systems.find((s) => s.id === "b")!;
    expect(a.provision).toBeCloseTo(0.8, 9);
    expect(b.provision).toBeCloseTo(0.3, 9);
  });

  it("persists band Famine from a survival punch-through even while Provisioned reads high", async () => {
    // d = 0.1 (Provisioned 0.9, well above SUPPLIED_PROVISION) but the supply fold's famine
    // punch-through still classifies the system as Famine — the whole reason the band rides
    // alongside the number instead of being re-inferred from it on the read side.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [] });
    const ctx: TickContext = {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["a", 0.1]]),
          supplyStateBySystem: new Map([
            ["a", { regime: "famine", survivalShortfall: true, criticalWeight: 0, emptyBasket: false }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
    await runPopulationProcessor(world, ctx, PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.provision).toBeCloseTo(0.9, 9); // Provisioned reads high...
    expect(a.supplyBand).toBe("famine"); // ...but the band still carries the famine punch-through
  });

  it("leaves the band absent — not the ctx-default 'supplied' — for a system the supply signal genuinely omits", async () => {
    // ctxWithD's default regimes map is empty: "a" has a dissatisfaction entry but no matching
    // supply state, the defensive-default path population.ts documents as unreachable in real
    // play. Persisting the default's "supplied" label would record a classification the economy
    // never actually made this cycle for this system.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [] });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 0.3]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.provision).toBeCloseTo(0.7, 9); // Provisioned itself is still assessed from real d...
    expect(a.supplyBand).toBeUndefined(); // ...but the band is not
    expect("supplyBand" in a).toBe(false);
  });

  it("leaves provision absent — never NaN — when the dissatisfaction signal is corrupt", async () => {
    // Mirrors the honestUseRate corrupt-compute guard above: the poison must not land as a
    // number at all (0 would read as a real, false 0% Provisioned assessment), and the stale
    // prior figure must not survive either — this is a fresh per-cycle reading, not a memory.
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 500, 1000, 0), provision: 0.5, supplyBand: "supplied" }],
      markets: [],
    });
    await runPopulationProcessor(
      world, ctxWithD(new Map([["a", Number.NaN]]), new Map([["a", "rationing"]])), PARAMS,
    );
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.provision).toBeUndefined();
    expect("provision" in a).toBe(false);
  });

  it("persists criticalWeight exactly, UN-CLAMPED above 1 — supplyUnrestTerm bounds its EFFECT, not the stored weight", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [] });
    const ctx: TickContext = {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["a", 0.4]]),
          supplyStateBySystem: new Map([
            ["a", { regime: "rationing", survivalShortfall: false, criticalWeight: 1.3, emptyBasket: false }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
    await runPopulationProcessor(world, ctx, PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.criticalWeight).toBe(1.3); // not clamped to 1, unlike provision
  });

  it("leaves criticalWeight absent — reading rawSupply, not the defensive-default 'supply' — for a system the supply signal genuinely omits", async () => {
    // Mirrors the supplyBand absence test above: ctxWithD's default regimes map is empty, so "a"
    // hits the processor's unreachable-in-real-play default (criticalWeight 0). Persisting that
    // default would fabricate a real, meaningful "assessed at 0" reading the economy never made.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 500, 1000, 0)], markets: [] });
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 0.3]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.criticalWeight).toBeUndefined();
    expect("criticalWeight" in a).toBe(false);
  });

  it("leaves criticalWeight absent — never a stale prior figure — when the supply signal is corrupt", async () => {
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 500, 1000, 0), criticalWeight: 0.6 }],
      markets: [],
    });
    const ctx: TickContext = {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["a", 0.4]]),
          supplyStateBySystem: new Map([
            ["a", { regime: "rationing", survivalShortfall: false, criticalWeight: Number.NaN, emptyBasket: false }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
    await runPopulationProcessor(world, ctx, PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.criticalWeight).toBeUndefined();
    expect("criticalWeight" in a).toBe(false);
  });
});

// ── Calibration instrumentation: the overshoot-death gate's magnitude, isolated per system —
// the harness's episode-cost evidence (docs/active/gameplay/economy.md, unrest
// promise 5). Observational: the amount reported must match what actually left `population`. ──

describe("population processor: overshoot-death instrumentation", () => {
  // decay: 0 makes accumulateUnrest a no-op (relaxed = floor + 1*(unrest - floor) = unrest,
  // gain = term*0 = 0), so the fixture's starting unrest IS the cycle's unrest — deterministic
  // without having to also derive the term the accumulator would otherwise fold in.
  const NO_RELAX = { slopeBase: 0, slopeShortage: 0, decay: 0 };

  it("reports exactly the death gate's formula, matching the population actually lost", async () => {
    // population 150, popCap 100 -> 50 overshoot; unrest 0.9 > gate 0.65; rate 0.1.
    // death = 0.1 * 50 * 0.9 = 4.5.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 150, 100, 0.9)], markets: [] });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), {
      unrest: NO_RELAX,
      population: { growthRate: 0, declineRate: 0, overshootDeathRate: 0.1, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.overshootDeathBySystem?.get("a")).toBeCloseTo(4.5, 9);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.population).toBeCloseTo(150 - 4.5, 9); // the reported amount is what actually left
  });

  it("omits a system entirely when the gate does not fire (unrest at or below the gate)", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 150, 100, 0.5)], markets: [] });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), {
      unrest: NO_RELAX,
      population: { growthRate: 0, declineRate: 0, overshootDeathRate: 0.1, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    // Empty map ⇒ the processor returns {} rather than an empty Map (kept sparse).
    expect(result.overshootDeathBySystem).toBeUndefined();
  });

  it("scales with the run's catch-up factor, exactly like the delta it is isolated from", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 150, 100, 0.9)], markets: [] });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), {
      unrest: NO_RELAX,
      population: { growthRate: 0, declineRate: 0, overshootDeathRate: 0.1, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 48, // catchUpFactor(48) = 2 reference cycles
    });
    expect(result.overshootDeathBySystem?.get("a")).toBeCloseTo(9, 9); // 4.5 * 2
  });

  it("leaves growth and decline untouched — a system with both still isolates only the death share", async () => {
    // growth = 0.05*100*crowdFactor(r=1)*(1-d=1) = 5; decline = 0 (unrest gate governs death, not
    // decline here); death = 0.1*0 = 0 (population <= popCap, no overshoot). The instrument must
    // read 0 death (omitted), not the net delta (+5), proving it isolates the death TERM and not
    // just whatever moved the population.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 100, 1000, 0.9)], markets: [] });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), {
      unrest: NO_RELAX,
      population: { growthRate: 0.05, declineRate: 0, overshootDeathRate: 0.1, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.overshootDeathBySystem).toBeUndefined();
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.population).toBeCloseTo(105, 9);
  });
});

describe("population processor: growth-term instrumentation", () => {
  // decay: 0 makes accumulateUnrest a no-op (relaxed = floor + 1*(unrest - floor) = unrest,
  // gain = term*0 = 0), so the fixture's starting unrest IS the cycle's unrest — deterministic
  // without having to also derive the term the accumulator would otherwise fold in.
  const NO_RELAX = { slopeBase: 0, slopeShortage: 0, decay: 0 };

  it("reports exactly the growth term's formula, catch-up scaled, matching the population actually gained", async () => {
    // population 200, popCap 1000 -> r = 0.2, well under 1, crowdFactor = 1; d = 0.3.
    // growth (one reference cycle) = 0.1 * 200 * 1 * 0.7 = 14; interval 48 -> catchUp = 2 -> 28.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 200, 1000, 0)], markets: [] });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0.3]])), {
      unrest: NO_RELAX,
      population: { growthRate: 0.1, declineRate: 0, overshootDeathRate: 0, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 48,
    });
    expect(result.growthBySystem?.get("a")).toBeCloseTo(28, 9);
    const a = world.systems.find((s) => s.id === "a")!;
    expect(a.population).toBeCloseTo(200 + 28, 9); // the reported amount is what actually arrived
  });

  it("reports the same growth whether or not decline/death fired this cycle — same pop/popCap/D, different unrest", async () => {
    // Both systems: population 110, popCap 100 (r = 1.1, mid-brake), d = 0.2. "calm" sits at
    // unrest 0 (no decline, no death); "hot" sits at unrest 0.9, above the death gate (0.65) —
    // decline and the death gate both fire for "hot" but neither term feeds populationDelta's
    // growth product, so the two systems must report identical growth despite very different
    // net population outcomes.
    const world = new InMemoryPopulationWorld({
      systems: [sys("calm", 110, 100, 0), sys("hot", 110, 100, 0.9)],
      markets: [],
    });
    const result = await runPopulationProcessor(
      world,
      ctxWithD(new Map([["calm", 0.2], ["hot", 0.2]])),
      {
        unrest: NO_RELAX,
        population: { growthRate: 0.05, declineRate: 0.02, overshootDeathRate: 0.1, ...POP_SHAPE },
        expectation: EXPECTATION_PARAMS,
        interval: 24,
      },
    );
    const calmGrowth = result.growthBySystem?.get("calm");
    const hotGrowth = result.growthBySystem?.get("hot");
    expect(calmGrowth).toBeCloseTo(1.140741, 6);
    expect(hotGrowth).toBeCloseTo(1.140741, 6);
    expect(hotGrowth).toBeCloseTo(calmGrowth ?? Number.NaN, 9);
    // The net populations diverge (decline/death actually hit "hot") — proving the identical
    // growth reading above is isolation, not a fixture where nothing happened to either system.
    const calm = world.systems.find((s) => s.id === "calm")!;
    const hot = world.systems.find((s) => s.id === "hot")!;
    expect(calm.population).not.toBeCloseTo(hot.population, 6);
  });

  it("omits a system entirely when growth is zero (popCap <= 0)", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 50, 0, 0)], markets: [] });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), {
      unrest: NO_RELAX,
      population: { growthRate: 0.1, declineRate: 0, overshootDeathRate: 0, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    // Empty map ⇒ the processor returns {} rather than an empty Map (kept sparse).
    expect(result.growthBySystem).toBeUndefined();
  });

  it("omits a system entirely when growth is zero (population at or past the crowd brake end)", async () => {
    // r = population/popCap = 10, far past crowdBrakeEnd (1.15) -> crowdFactor saturates at 0.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 1000, 100, 0)], markets: [] });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), {
      unrest: NO_RELAX,
      population: { growthRate: 0.1, declineRate: 0, overshootDeathRate: 0, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.growthBySystem).toBeUndefined();
  });

  it("vacuity: a growing fixture yields a non-empty map, so a dropped fold is seen to fail", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 300, 1000, 0)], markets: [] });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), {
      unrest: NO_RELAX,
      population: { growthRate: 0.02, declineRate: 0, overshootDeathRate: 0, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.growthBySystem).toBeInstanceOf(Map);
    expect(result.growthBySystem?.size).toBeGreaterThan(0);
  });
});

// ── Abandonment Rule 2 (the death line): the processor REPORTS any system whose post-delta
// population has collapsed below ABANDON_POP_FLOOR, famine or not — it never writes control
// itself, only names the candidate for the tick body to reset
// (docs/active/gameplay/colonisation.md, abandonment). ──

describe("population processor: abandonment reporting (Rule 2)", () => {
  // FROZEN_POP (growth/decline/death all zero) makes the fixture's starting population the
  // post-delta population the gate reads — deterministic without deriving the delta formula.
  function shortfallCtx(survivalShortfall: boolean): TickContext {
    return {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["a", 0.5]]),
          supplyStateBySystem: new Map([
            ["a", { regime: "famine", survivalShortfall, criticalWeight: 0, emptyBasket: false }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
  }

  it("reports a system in famine whose (frozen) population sits below the floor", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 0.5, 1000, 0)], markets: [] });
    const result = await runPopulationProcessor(world, shortfallCtx(true), {
      unrest: { slopeBase: 1, slopeShortage: 1, decay: 0 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.abandonedSystems).toEqual(["a"]);
  });

  it("does not report a famine system whose population sits at or above the floor", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 5, 1000, 0)], markets: [] });
    const result = await runPopulationProcessor(world, shortfallCtx(true), {
      unrest: { slopeBase: 1, slopeShortage: 1, decay: 0 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.abandonedSystems).toBeUndefined();
  });

  it("reports a below-floor system that is NOT in survival shortfall — the dropped famine conjunct", async () => {
    // Abandonment Rule 2 no longer requires famine: a colony declining to empty under ordinary
    // (non-famine) stress abandons the same as a starved one. shortfallCtx(false) marks this
    // system NOT in survival shortfall; the frozen population sits below ABANDON_POP_FLOOR (1)
    // regardless, and that alone is now enough.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 0.5, 1000, 0)], markets: [] });
    const result = await runPopulationProcessor(world, shortfallCtx(false), {
      unrest: { slopeBase: 1, slopeShortage: 1, decay: 0 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.abandonedSystems).toEqual(["a"]);
  });

  it("keeps the field absent entirely (not an empty array) when nothing qualifies — the sparse convention", async () => {
    const world = new InMemoryPopulationWorld({
      systems: [sys("a", 500, 1000, 0)],
      markets: [market("a", "food")],
    });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), PARAMS);
    expect(result.abandonedSystems).toBeUndefined();
    expect("abandonedSystems" in result).toBe(false);
  });

  it("reports only the qualifying system out of several", async () => {
    const world = new InMemoryPopulationWorld({
      systems: [sys("dying", 0.5, 1000, 0), sys("fine", 5, 1000, 0)],
      markets: [],
    });
    const ctx: TickContext = {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["dying", 0.5], ["fine", 0.5]]),
          supplyStateBySystem: new Map([
            ["dying", { regime: "famine", survivalShortfall: true, criticalWeight: 0, emptyBasket: false }],
            ["fine", { regime: "famine", survivalShortfall: true, criticalWeight: 0, emptyBasket: false }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
    const result = await runPopulationProcessor(world, ctx, {
      unrest: { slopeBase: 1, slopeShortage: 1, decay: 0 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.abandonedSystems).toEqual(["dying"]);
  });
});

// ── Abandonment by cause: the same Rule 2 findings above, tagged with whether famine
// (survivalShortfall) was present at the triggering cycle — famine-collapse vs decline-to-empty.
// Purely observational (harness instrumentation only), built from the same loop as
// abandonedSystems, so the two can never disagree on membership. ──

describe("population processor: abandonment reporting (by cause)", () => {
  function shortfallCtx(survivalShortfall: boolean): TickContext {
    return {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["a", 0.5]]),
          supplyStateBySystem: new Map([
            ["a", { regime: "famine", survivalShortfall, criticalWeight: 0, emptyBasket: false }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
  }

  it("tags a famine-present abandonment famine-collapse", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 0.5, 1000, 0)], markets: [] });
    const result = await runPopulationProcessor(world, shortfallCtx(true), {
      unrest: { slopeBase: 1, slopeShortage: 1, decay: 0 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.abandonedSystemsByCause?.get("a")).toBe("famine-collapse");
  });

  it("tags a non-famine abandonment decline-to-empty — the dropped conjunct's other path", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 0.5, 1000, 0)], markets: [] });
    const result = await runPopulationProcessor(world, shortfallCtx(false), {
      unrest: { slopeBase: 1, slopeShortage: 1, decay: 0 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.abandonedSystemsByCause?.get("a")).toBe("decline-to-empty");
  });

  it("keeps the field absent entirely when nothing qualifies — the sparse convention", async () => {
    const world = new InMemoryPopulationWorld({
      systems: [sys("a", 500, 1000, 0)],
      markets: [market("a", "food")],
    });
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), PARAMS);
    expect(result.abandonedSystemsByCause).toBeUndefined();
    expect("abandonedSystemsByCause" in result).toBe(false);
  });

  it("sums to abandonedSystems — every reported abandonment carries exactly one cause tag, no orphans, no double count", async () => {
    // A mixed cohort: one famine-driven collapse, one non-famine decline, one system that stays
    // healthy — the same shape the harness's whole-run count folds over many cycles.
    const world = new InMemoryPopulationWorld({
      systems: [sys("dying-famine", 0.5, 1000, 0), sys("dying-decline", 0.5, 1000, 0), sys("fine", 5, 1000, 0)],
      markets: [],
    });
    const ctx: TickContext = {
      tick: 0,
      results: new Map([["economy", {
        economySignals: {
          dissatisfactionBySystem: new Map([["dying-famine", 0.5], ["dying-decline", 0.5], ["fine", 0.5]]),
          supplyStateBySystem: new Map([
            ["dying-famine", { regime: "famine", survivalShortfall: true, criticalWeight: 0, emptyBasket: false }],
            ["dying-decline", { regime: "deprived", survivalShortfall: false, criticalWeight: 0, emptyBasket: false }],
            ["fine", { regime: "famine", survivalShortfall: true, criticalWeight: 0, emptyBasket: false }],
          ]),
          sellingFactorBySystem: new Map(),
          realisedProductionBySystem: new Map(),
          productionSuppressBySystem: new Map(),
        },
      }]]),
    };
    const result = await runPopulationProcessor(world, ctx, {
      unrest: { slopeBase: 1, slopeShortage: 1, decay: 0 },
      population: FROZEN_POP,
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    });
    expect(result.abandonedSystems).toEqual(
      expect.arrayContaining(["dying-famine", "dying-decline"]),
    );
    expect(result.abandonedSystems?.length).toBe(2);
    // The identity Prove 4 checks: cause-tag count sums to the total abandonments this cycle
    // found, with no member left untagged and no extra member invented.
    expect(result.abandonedSystemsByCause?.size).toBe(result.abandonedSystems?.length);
    for (const id of result.abandonedSystems ?? []) {
      expect(result.abandonedSystemsByCause?.has(id)).toBe(true);
    }
    expect(result.abandonedSystemsByCause?.get("dying-famine")).toBe("famine-collapse");
    expect(result.abandonedSystemsByCause?.get("dying-decline")).toBe("decline-to-empty");
  });
});

// ── Fill-best-first habitability quality: the fold-site cache (lib/engine/habitability.ts) ──
// The cached value only advances when the occupied prefix crosses a body boundary
// (frontierIndex changing) — population movement within the same body must leave it untouched,
// even though the honest fold would compute a different number for it. Observable at the cache
// itself (the persisted system-row reading), never via a spy on internal call counts.

describe("population processor: fill-best-first habitability quality", () => {
  // Three bodies, out-of-score order on purpose (the fold sorts internally): A (score 1.0, land
  // 100), B (score 0.6, land 50), C (score 0.3, land 50) — total 200.
  const BODIES = [
    { score: 0.3, peopleLand: 50 }, // C
    { score: 1.0, peopleLand: 100 }, // A
    { score: 0.6, peopleLand: 50 }, // B
  ];

  function sysWithBodies(population: number): TickSystem {
    return { ...sys("h", population, 100_000, 0), habitabilityBodies: BODIES };
  }

  // FROZEN_POP: growth/decline/overshoot all zero, so a run leaves population exactly where the
  // fixture set it — isolates the quality cache from the growth dynamics entirely.
  const runOnce = (world: InMemoryPopulationWorld) => runPopulationProcessor(world, ctxWithD(new Map([["h", 0]])), {
    unrest: RATES,
    population: FROZEN_POP,
    expectation: EXPECTATION_PARAMS,
    interval: 24,
  });

  it("computes and caches on the FIRST cycle a never-before-assessed system is resolved", async () => {
    // occupiedLand = 2200/20 = 110: A fully occupied (100) + 10 of B's 50 — the mid-prefix arm.
    const world = new InMemoryPopulationWorld({ systems: [sysWithBodies(2200)], markets: [] });
    await runOnce(world);
    const h = world.systems.find((s) => s.id === "h")!;
    // weighted = 1.0*100 + 0.6*10 = 106; quality = 106/110.
    expect(h.habitabilityQuality?.quality).toBeCloseTo(106 / 110, 12);
    expect(h.habitabilityQuality?.frontierIndex).toBe(1); // B (index 1 after sort) is marginal
  });

  it("leaves the cached quality UNCHANGED while population moves within the same marginal body", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sysWithBodies(2200)], markets: [] });
    await runOnce(world);
    const afterFirst = world.systems.find((s) => s.id === "h")!.habitabilityQuality;
    if (afterFirst === undefined) throw new Error("Expected a cached reading after the first run");

    // Move population to occupiedLand = 140 (still inside B: A full 100 + 40 of B's 50) —
    // frontierIndex stays 1. The HONEST fold at this population reads a different number
    // ((100*1.0 + 40*0.6) / 140 = 124/140 ≈ 0.8857), so a passing test here proves the cache
    // really did skip the recompute rather than coincidentally landing on the same figure.
    const honestAtSecondPopulation = (100 * 1.0 + 40 * 0.6) / 140;
    expect(honestAtSecondPopulation).not.toBeCloseTo(afterFirst.quality, 6);

    world.systems[0].population = 2800; // occupiedLand 140
    await runOnce(world);
    const afterSecond = world.systems.find((s) => s.id === "h")!.habitabilityQuality;
    expect(afterSecond?.frontierIndex).toBe(1); // still inside B — no boundary crossed
    expect(afterSecond?.quality).toBe(afterFirst.quality); // byte-identical: the cache never moved
  });

  it("recomputes the cached quality once the occupied prefix crosses a body boundary", async () => {
    const world = new InMemoryPopulationWorld({ systems: [sysWithBodies(2200)], markets: [] });
    await runOnce(world);
    const afterFirst = world.systems.find((s) => s.id === "h")!.habitabilityQuality;
    if (afterFirst === undefined) throw new Error("Expected a cached reading after the first run");

    // Push past B entirely into C: occupiedLand = 180 (A 100 + B 50 + 30 of C's 50).
    // frontierIndex becomes 2 (C, the sorted list's last index) — a genuine boundary crossing.
    world.systems[0].population = 3600;
    await runOnce(world);
    const afterThird = world.systems.find((s) => s.id === "h")!.habitabilityQuality;
    expect(afterThird?.frontierIndex).toBe(2);
    expect(afterThird?.frontierIndex).not.toBe(afterFirst.frontierIndex);
    // weighted = 1.0*100 + 0.6*50 + 0.3*30 = 139; quality = 139/180.
    expect(afterThird?.quality).toBeCloseTo(139 / 180, 12);
    expect(afterThird?.quality).not.toBeCloseTo(afterFirst.quality, 6);
  });

  it("computes once for the dominant single-people-land-body case: quality stays exactly the top body's score at every population level", async () => {
    const oneBody = [{ score: 0.6, peopleLand: 50 }];
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("h", 200, 100_000, 0), habitabilityBodies: oneBody }],
      markets: [],
    });
    await runOnce(world);
    const afterFirst = world.systems.find((s) => s.id === "h")!.habitabilityQuality;
    expect(afterFirst?.quality).toBe(0.6);
    expect(afterFirst?.frontierIndex).toBe(0);

    // Grow well past the single body's land (occupiedLand 200 vs land 50 — the clamp arm) and
    // rerun: frontierIndex is STILL 0 (the sorted list's only, and therefore last, index) both
    // before and after, so this is the "never recomputes" path too — and correctly so, since the
    // honest clamp-arm mean for a single body is that body's own score again.
    world.systems[0].population = 4000;
    await runOnce(world);
    const afterSecond = world.systems.find((s) => s.id === "h")!.habitabilityQuality;
    expect(afterSecond?.frontierIndex).toBe(0);
    expect(afterSecond?.quality).toBe(0.6);
  });
});

// ── Growth coupling (Task 8): quality multiplies the growth term only. Decline/death and the
// processor's own growth/death isolation folds must stay exact regardless of quality. ──

describe("population processor: growth-quality coupling", () => {
  const NO_RELAX = { slopeBase: 0, slopeShortage: 0, decay: 0 };
  // A single body, land far past anything these fixtures occupy, so quality reads exactly the
  // body's own score at every population level in this suite (frontierIndex stays 0, never the
  // clamp arm) — isolates the coupling from the fill-best-first fold itself (Task 7's concern).
  const bodyOfScore = (score: number) => [{ score, peopleLand: 1000 }];

  function coupledSystem(quality: number): TickSystem {
    return { ...sys("a", 1050, 1000, 0.9), habitabilityBodies: bodyOfScore(quality) };
  }

  it("scales growth by quality while decline and overshoot-death stay bit-identical — isolation folds attribute exactly", async () => {
    // r = 1050/1000 = 1.05 (inside the brake ramp, not past it) -> crowdFactor = 20/27.
    // unrest 0.9 is above overshootDeathUnrestGate (0.65) -> death fires; declineRate 0 removes
    // the decline term so growth and death are the only two moving parts.
    const params = {
      unrest: NO_RELAX,
      population: { growthRate: 0.1, declineRate: 0, overshootDeathRate: 0.05, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    };
    const full = new InMemoryPopulationWorld({ systems: [coupledSystem(1)], markets: [] });
    const half = new InMemoryPopulationWorld({ systems: [coupledSystem(0.5)], markets: [] });
    const resultFull = await runPopulationProcessor(full, ctxWithD(new Map([["a", 0]])), params);
    const resultHalf = await runPopulationProcessor(half, ctxWithD(new Map([["a", 0]])), params);

    // growth = 0.1 * 1050 * (20/27) * 1 * quality = 2100/27 * quality.
    const rawGrowth = 2100 / 27;
    expect(resultFull.growthBySystem?.get("a")).toBeCloseTo(rawGrowth, 9);
    expect(resultHalf.growthBySystem?.get("a")).toBeCloseTo(rawGrowth * 0.5, 9);
    expect(resultHalf.growthBySystem?.get("a")).toBeCloseTo((resultFull.growthBySystem?.get("a") ?? Number.NaN) / 2, 9);

    // death = 0.05 * (1050 - 1000) * 0.9 = 2.25, identical at both quality values — the death
    // term never reads quality at all.
    expect(resultFull.overshootDeathBySystem?.get("a")).toBeCloseTo(2.25, 9);
    expect(resultHalf.overshootDeathBySystem?.get("a")).toBeCloseTo(2.25, 9);
    expect(resultFull.overshootDeathBySystem?.get("a")).toBe(resultHalf.overshootDeathBySystem?.get("a"));
  });

  it("reads THIS CYCLE'S OPENING cached quality for growth, never a fresh per-cycle fold", async () => {
    // Two bodies: A (score 1.0, land 20) fully occupied by the opening population (400/20 = 20),
    // B (score 0.2, land 1000) picks up everything past it. The OPENING cache (quality 1.0,
    // frontierIndex 0, seeded by a first run at population exactly 400) must drive this cycle's
    // growth even though the post-delta population has moved deep into B — the honest fresh read
    // at the post-delta population would be far lower.
    const bodies = [{ score: 1.0, peopleLand: 20 }, { score: 0.2, peopleLand: 1000 }];
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 400, 100_000, 0), habitabilityBodies: bodies }],
      markets: [],
    });
    // Seed the cache at quality 1.0 (frontierIndex 0) with a frozen run.
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), {
      unrest: NO_RELAX, population: FROZEN_POP, expectation: EXPECTATION_PARAMS, interval: 24,
    });
    const seeded = world.systems.find((s) => s.id === "a")!;
    expect(seeded.habitabilityQuality).toEqual({ quality: 1, frontierIndex: 0 });

    // Now grow hard for one cycle: r stays tiny (popCap 100_000) so crowdFactor = 1 throughout.
    const params = {
      unrest: NO_RELAX,
      population: { growthRate: 0.5, declineRate: 0, overshootDeathRate: 0, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    };
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), params);
    // growth = 0.5 * 400 * 1 * 1 * 1.0 (the OPENING cache) = 200 — not the honest fresh quality at
    // the post-delta population (occupiedLand (400+200)/20 = 30, deep into B, honest quality
    // (20*1.0 + 10*0.2)/30 = 22/30 ≈ 0.733, which would give a smaller growth figure).
    expect(result.growthBySystem?.get("a")).toBeCloseTo(200, 9);
  });

  it("missing-cache fallback: bodies present computes a fresh quality from the OPENING population", async () => {
    // No cache (a never-before-assessed system) but a real body list: falls back to a fresh
    // compute at this cycle's opening population (200 -> occupiedLand 10, well inside the single
    // body's 50 land) rather than a neutral default.
    const bodies = [{ score: 0.4, peopleLand: 50 }];
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", 200, 100_000, 0), habitabilityBodies: bodies }],
      markets: [],
    });
    const params = {
      unrest: NO_RELAX,
      population: { growthRate: 0.1, declineRate: 0, overshootDeathRate: 0, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    };
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), params);
    // growth = 0.1 * 200 * 1 * 1 * 0.4 = 8 — the real body score, not a neutral 1 (which would
    // read 20).
    expect(result.growthBySystem?.get("a")).toBeCloseTo(8, 9);
  });

  it("missing-cache fallback: no bodies at all reads neutral quality (1) — never a silent zero", async () => {
    // No cache, no `habitabilityBodies` either (a fixture predating Task 7, or a defensive gap):
    // `systemHabitabilityQuality`'s own empty-list reading is 0, which would erase this system's
    // growth entirely if trusted here. The fallback must read neutral instead.
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 200, 100_000, 0)], markets: [] });
    const params = {
      unrest: NO_RELAX,
      population: { growthRate: 0.1, declineRate: 0, overshootDeathRate: 0, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    };
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 0]])), params);
    // growth = 0.1 * 200 * 1 * 1 * 1 (neutral) = 20, not 0.
    expect(result.growthBySystem?.get("a")).toBeCloseTo(20, 9);
  });

  it("a fresh seed colony (COLONY_SEED_POP 2) survives an unlucky first cycle — the floor sits below the seed, not above it", async () => {
    // A marginal-land world (quality 0.3) at exactly COLONY_SEED_POP, hit with high unrest and
    // zero satisfaction on its very first cycle (no cache, no famine): net-declines, but
    // ABANDON_POP_FLOOR (1) sits below the seed (2), so one unlucky cycle alone can't cross it.
    const bodies = [{ score: 0.3, peopleLand: 1000 }];
    const world = new InMemoryPopulationWorld({
      systems: [{ ...sys("a", EXPANSION.COLONY_SEED_POP, 10, 0.9), habitabilityBodies: bodies }],
      markets: [],
    });
    const params = {
      unrest: NO_RELAX,
      population: { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0, ...POP_SHAPE },
      expectation: EXPECTATION_PARAMS,
      interval: 24,
    };
    const result = await runPopulationProcessor(world, ctxWithD(new Map([["a", 1]])), params);
    const a = world.systems.find((s) => s.id === "a")!;
    // growth = 0.02*2*1*(1-1)*0.3 = 0 (d = 1 zeroes satisfaction); decline = 0.02*2*0.9 = 0.036.
    // population after = 2 - 0.036 = 1.964 — well above ABANDON_POP_FLOOR (1).
    expect(a.population).toBeCloseTo(EXPANSION.COLONY_SEED_POP - 0.036, 9);
    expect(a.population).toBeGreaterThan(ABANDON_POP_FLOOR);
    expect(result.abandonedSystems).toBeUndefined();
  });
});
