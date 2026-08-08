import { describe, it, expect } from "vitest";
import { runPopulationProcessor } from "../population";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import type { TickContext } from "@/lib/tick/types";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import { civilianDemandRateForGood, totalDemandRateForGood } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot, inputDemandForGood } from "@/lib/engine/industry";
import { consumptionRate } from "@/lib/engine/physical-economy";
import type { CivilianDemandBasis } from "@/lib/engine/physical-economy";
import type { SupplyRegime, SupplyState } from "@/lib/engine/population";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import { CROWDING } from "@/lib/constants/population";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";

// Occupancy at which the growth brake reaches zero and the crowding-pressure ramp saturates
// — one boundary these fixtures hand to the processor, which threads it to both terms.
const BRAKE_END = 1.15;
// Non-rate shape knobs shared by the population fixtures below — the growth brake's end
// and the overshoot-death gate. Every fixture sets overshootDeathRate 0, so the gate value
// is inert here; only the rates differ between fixtures.
const POP_SHAPE = { crowdBrakeEnd: BRAKE_END, overshootDeathUnrestGate: 0.65 };

const PARAMS = {
  unrest: { slopeRationing: 2, slopeShortage: 4, decay: 0.05 },
  population: { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0, ...POP_SHAPE },
  interval: 24,
};

// Invariance fixture: a lower relaxation rate than PARAMS. The unrest filter is integrated
// with explicit Euler, whose split residue between one full step and two half steps is
// ≈ 0.25·decay from a zero start — an integrator artifact, not a scaling error. Keeping
// the relaxation rate small holds that residue well under the 1% first-order bar the
// scaling must meet, whichever regime selects it. One slope for both regimes: this fixture
// measures the time step, not the D-selected slope.
const INVARIANCE_PARAMS = {
  unrest: { slopeRationing: 3, slopeShortage: 3, decay: 0.02 },
  population: { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0, ...POP_SHAPE },
};

// Unrest fixture for the floor/regime suites: three pairwise-distinct numbers, so an assertion
// naming the wrong one cannot pass by coincidence.
const RATES = { slopeRationing: 1.5, slopeShortage: 3, decay: 0.06 };
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
    yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
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
    [...regimes].map(([systemId, regime]) => [systemId, { regime, survivalShortfall: false, criticalWeight: 0 }]),
  );
  return {
    tick: 0,
    results: new Map([
      ["economy", {
        economySignals: {
          dissatisfactionBySystem: d,
          supplyStateBySystem: states,
          sellingFactorBySystem: new Map(),
          realizedProductionBySystem: new Map(),
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
    await runPopulationProcessor(world, ctxWithD(new Map([["a", 1]]), new Map([["a", "shortage"]])), PARAMS);
    const a = world.systems.find((s) => s.id === "a")!;
    // Hand-derived from the start state (pop 500, cap 1000, unrest 0) under D=1 in shortage,
    // so these are an independent oracle rather than the processor's own output read back:
    //   floor  = 0 (untaxed, under the housing cap)
    //   unrest = floor + (1−decay)·(0 − floor) + slopeShortage·decay·1 = 4·0.05 = 0.2
    //   Δpop   = growth·(1−D)=0 − decline·pop·unrest = −(0.02·500·0.2) = −2.0 → pop 498
    expect(a.unrest).toBeCloseTo(0.2, 6);
    expect(a.population).toBeCloseTo(498, 6);
    const m = world.markets.find((mm) => mm.systemId === "a")!;
    // demandRate = civilian-only floor for food at pop 498 (no production-input draw here).
    expect(m.demandRate).toBeCloseTo(civilianDemandRateForGood("food", popOnly(498)), 5);
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

  it("enters per-system tax pressure as the unrest floor, not as a gain", async () => {
    // d = 0, unrest starts 0, interval 24 (catchUp 1), calm: the run relaxes toward the floor,
    // so unrest moves decay of the way to the tax pressure. A gain term would instead have
    // integrated slopeRationing × decay × pressure — a different number that then decays back
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
    const regimes = new Map<string, SupplyRegime>([["served", "supplied"], ["short", "shortage"]]);
    await runPopulationProcessor(
      world,
      ctxWithD(new Map([["unlisted", 0], ["served", 0], ["short", 0]]), regimes),
      { unrest: RATES, population: FROZEN_POP, interval: 24 },
    );
    const expected = start * (1 - RATES.decay);
    expect(unrestOf(world, "unlisted")).toBeCloseTo(expected, 9);
    expect(unrestOf(world, "served")).toBeCloseTo(expected, 9);
    expect(unrestOf(world, "short")).toBeCloseTo(expected, 9);
  });

  it("scales the relaxation rate — and hence the derived gains — by the catch-up factor", async () => {
    // Interval 48 is two reference cycles, so one run must move exactly twice as far as one run at
    // the reference interval. Only the relaxation rate is scaled; the gain is slope × rate, so it
    // rides along while the slopes stay dimensionless exchange rates. Gains are read from a zero start (no
    // relaxation term) and relaxation from a raised start (D = 0, so no gain term). Which slope
    // applies is selected by D, not by the regime label: D_LOW sits below the shortage cut and D_HIGH
    // above the top of the blend band (cut 0.65 + blend 0.25 = 0.90). relax-supplied and
    // relax-rationing carry different LABELS but the identical rate, so they must land on the
    // identical relaxed value.
    const start = 0.5;
    const D_LOW = 0.1;
    const D_HIGH = 0.95;
    const runAt = async (interval: number) => {
      const world = new InMemoryPopulationWorld({
        systems: [
          sys("gain-rationing", 100, 1000, 0),
          sys("gain-shortage", 100, 1000, 0),
          sys("relax-rationing", 100, 1000, start),
          sys("relax-supplied", 100, 1000, start),
        ],
        markets: [],
      });
      const regimes = new Map<string, SupplyRegime>([
        ["gain-rationing", "rationing"],
        ["gain-shortage", "shortage"],
        ["relax-rationing", "rationing"],
        ["relax-supplied", "supplied"],
      ]);
      const dissatisfaction = new Map([
        ["gain-rationing", D_LOW], ["gain-shortage", D_HIGH], ["relax-rationing", 0], ["relax-supplied", 0],
      ]);
      await runPopulationProcessor(world, ctxWithD(dissatisfaction, regimes), {
        unrest: RATES, population: FROZEN_POP, interval,
      });
      return world;
    };
    const ref = await runAt(24);
    const double = await runAt(48);

    const rationingGain = RATES.slopeRationing * RATES.decay * D_LOW;
    const shortageGain = RATES.slopeShortage * RATES.decay * D_HIGH;
    expect(unrestOf(ref, "gain-rationing")).toBeCloseTo(rationingGain, 9);
    expect(unrestOf(double, "gain-rationing")).toBeCloseTo(2 * rationingGain, 9);
    expect(unrestOf(ref, "gain-shortage")).toBeCloseTo(shortageGain, 9);
    expect(unrestOf(double, "gain-shortage")).toBeCloseTo(2 * shortageGain, 9);
    expect(unrestOf(ref, "relax-rationing")).toBeCloseTo(start * (1 - RATES.decay), 9);
    expect(unrestOf(double, "relax-rationing")).toBeCloseTo(start * (1 - 2 * RATES.decay), 9);
    expect(unrestOf(ref, "relax-supplied")).toBeCloseTo(start * (1 - RATES.decay), 9);
    expect(unrestOf(double, "relax-supplied")).toBeCloseTo(start * (1 - 2 * RATES.decay), 9);
    expect(unrestOf(ref, "relax-supplied")).toBe(unrestOf(ref, "relax-rationing"));
  });

  it("settles unrest at the same level whatever the interval", async () => {
    // The reparameterisation's payoff at the processor: equilibrium is floor + slope × D, with no
    // rate in it, so a shard running at a different interval settles in the same place rather than
    // merely approaching it at a scaled speed.
    const d = 0.1;
    const settleAt = async (interval: number) => {
      const world = new InMemoryPopulationWorld({ systems: [sys("a", 100, 1000, 0)], markets: [] });
      const ctx = ctxWithD(new Map([["a", d]]), new Map([["a", "rationing"]]));
      for (let i = 0; i < 400; i++) {
        await runPopulationProcessor(world, ctx, { unrest: RATES, population: FROZEN_POP, interval });
      }
      return unrestOf(world, "a");
    };
    const expected = RATES.slopeRationing * d;
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
