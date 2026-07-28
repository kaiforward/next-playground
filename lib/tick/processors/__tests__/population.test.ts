import { describe, it, expect } from "vitest";
import { runPopulationProcessor } from "../population";
import { InMemoryPopulationWorld } from "@/lib/tick/adapters/memory/population";
import type { TickContext } from "@/lib/tick/types";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import { civilianDemandRateForGood, totalDemandRateForGood } from "@/lib/constants/market-economy";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
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
  unrest: { ceilingRationing: 2, ceilingShortage: 4, decay: 0.05, recoveryDecay: 0.1 },
  population: { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0, ...POP_SHAPE },
  interval: 24,
};

// Invariance fixture: lower unrest rates than PARAMS. The unrest filter is integrated
// with explicit Euler, whose split residue between one full step and two half steps is
// ≈ 0.25·decay from a zero start — an integrator artifact, not a scaling error. Keeping
// every relaxation rate small holds that residue well under the 1% first-order bar the
// scaling must meet, whichever regime selects it. One ceiling for both regimes: this fixture
// measures the time step, not the D-selected ceiling.
const INVARIANCE_PARAMS = {
  unrest: { ceilingRationing: 3, ceilingShortage: 3, decay: 0.02, recoveryDecay: 0.02 },
  population: { growthRate: 0.02, declineRate: 0.02, overshootDeathRate: 0, ...POP_SHAPE },
};

// Unrest fixture for the floor/regime suites: four pairwise-distinct numbers, so an assertion
// naming the wrong one cannot pass by coincidence.
const RATES = { ceilingRationing: 1.5, ceilingShortage: 3, decay: 0.06, recoveryDecay: 0.12 };
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
    population, popCap, unrest, buildings, buildingIdleMonths: {}, collapseDebt: 0,
    yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
  };
}
function market(systemId: string, goodId: string): WorldMarket {
  return { systemId, goodId, stock: 100, anchorMult: 1, demandRate: 1, storageCapacity: 0 };
}
function ctxWithD(d: Map<string, number>, regimes: Map<string, SupplyRegime> = new Map()): TickContext {
  const states = new Map<string, SupplyState>(
    [...regimes].map(([systemId, regime]) => [systemId, { regime, survivalShortfall: false }]),
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
    //   unrest = floor + (1−decay)·(0 − floor) + ceilingShortage·decay·1 = 4·0.05 = 0.2
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
    // d = 0, unrest starts 0, interval 24 (catchUp 1), calm and supplied: the run relaxes
    // toward the floor, so unrest moves recoveryDecay of the way to the tax pressure. A
    // gain term would instead have integrated gainRationing × pressure — a different number
    // that then decays back to zero rather than holding.
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
    expect(unrestOf(world, "taxed")).toBeCloseTo(RATES.recoveryDecay * pressure, 9);
    expect(unrestOf(world, "free")).toBe(0);
  });

  it("settles a calm, supplied, taxed system at exactly its tax pressure", async () => {
    // The floor is the equilibrium: however many pulses run, a system with no
    // dissatisfaction converges on its standing pressure and stops there.
    const pressure = TAX_LEVEL_UNREST_PRESSURE.very_high;
    const world = new InMemoryPopulationWorld({ systems: [sys("a", 100, 1000, 0)], markets: [] });
    const ctx = ctxWithD(new Map([["a", 0]]));
    const params = {
      unrest: RATES,
      population: FROZEN_POP,
      interval: 24,
      taxPressureBySystem: new Map([["a", pressure]]),
    };
    for (let pulse = 0; pulse < 120; pulse++) await runPopulationProcessor(world, ctx, params);
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
    expect(unrestOf(world, "roomy")).toBeCloseTo(RATES.recoveryDecay * pressure, 9);
    expect(unrestOf(world, "half")).toBeCloseTo(RATES.recoveryDecay * (pressure + CROWDING.PRESSURE_MAX / 2), 9);
    expect(unrestOf(world, "packed")).toBeCloseTo(RATES.recoveryDecay * (pressure + CROWDING.PRESSURE_MAX), 9);
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
    expect(unrestOf(world, "packed")).toBeCloseTo(RATES.recoveryDecay * CROWDING.PRESSURE_MAX, 9);
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
    expect(unrestOf(atDefault, "s")).toBeCloseTo(RATES.recoveryDecay * CROWDING.PRESSURE_MAX, 9);
    expect(atDefault.systems[0].population).toBeCloseTo(population, 9); // growth fully braked

    // r = 1.3 over a span of 0.6 ⇒ t = 0.5: half the crowding pressure, and a smoothstep
    // brake of 1 − t²(3 − 2t) = 0.5 on growth.
    const stretched = await runWithBrakeEnd(1.6);
    expect(unrestOf(stretched, "s")).toBeCloseTo(RATES.recoveryDecay * (CROWDING.PRESSURE_MAX / 2), 9);
    expect(stretched.systems[0].population).toBeCloseTo(population + growthRate * population * 0.5, 9);
  });

  it("clamps the standing floor at 1 when tax and crowding would overflow it", async () => {
    // No tax level reaches this today; the clamp guards a future retune. floor saturates at
    // 1, so one supplied run moves recoveryDecay of the way from 0 to 1 — an unclamped
    // floor of 1.04 would have landed at 0.1248 instead.
    const cap = 1000;
    const world = new InMemoryPopulationWorld({ systems: [sys("overtaxed", cap * BRAKE_END, cap, 0)], markets: [] });
    await runPopulationProcessor(world, ctxWithD(new Map([["overtaxed", 0]])), {
      unrest: RATES,
      population: FROZEN_POP,
      interval: 24,
      taxPressureBySystem: new Map([["overtaxed", 0.99]]),
    });
    expect(unrestOf(world, "overtaxed")).toBeCloseTo(RATES.recoveryDecay, 9);
  });

  it("treats a system missing from the regime map as supplied", async () => {
    // Equal starting unrest, no floor and no dissatisfaction, so the regime picks the
    // relaxation rate alone: an unlisted system must shed unrest at the supplied
    // (recovery) rate, not the slower rationing one.
    const start = 0.5;
    const world = new InMemoryPopulationWorld({
      systems: [
        sys("unlisted", 100, 1000, start),
        sys("served", 100, 1000, start),
        sys("short", 100, 1000, start),
      ],
      markets: [],
    });
    const regimes = new Map<string, SupplyRegime>([["served", "supplied"], ["short", "rationing"]]);
    await runPopulationProcessor(
      world,
      ctxWithD(new Map([["unlisted", 0], ["served", 0], ["short", 0]]), regimes),
      { unrest: RATES, population: FROZEN_POP, interval: 24 },
    );
    expect(unrestOf(world, "unlisted")).toBeCloseTo(start * (1 - RATES.recoveryDecay), 9);
    expect(unrestOf(world, "unlisted")).toBe(unrestOf(world, "served"));
    expect(unrestOf(world, "short")).toBeCloseTo(start * (1 - RATES.decay), 9);
    expect(unrestOf(world, "short")).toBeGreaterThan(unrestOf(world, "unlisted"));
  });

  it("scales the relaxation rates — and hence the derived gains — by the catch-up factor", async () => {
    // Interval 48 is two reference months, so one run must move exactly twice as far as one run at
    // the reference interval. Only the relaxation rates are scaled; the gain is ceiling × rate, so it
    // rides along while the ceilings stay dimensionless bounds. Gains are read from a zero start (no
    // relaxation term) and relaxation from a raised start (D = 0, so no gain term). Which ceiling
    // applies is selected by D, not by the regime label: D_LOW sits below the shortage cut and D_HIGH
    // above the top of the blend band.
    const start = 0.5;
    const D_LOW = 0.1;
    const D_HIGH = 0.5;
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

    const rationingGain = RATES.ceilingRationing * RATES.decay * D_LOW;
    const shortageGain = RATES.ceilingShortage * RATES.decay * D_HIGH;
    expect(unrestOf(ref, "gain-rationing")).toBeCloseTo(rationingGain, 9);
    expect(unrestOf(double, "gain-rationing")).toBeCloseTo(2 * rationingGain, 9);
    expect(unrestOf(ref, "gain-shortage")).toBeCloseTo(shortageGain, 9);
    expect(unrestOf(double, "gain-shortage")).toBeCloseTo(2 * shortageGain, 9);
    expect(unrestOf(ref, "relax-rationing")).toBeCloseTo(start * (1 - RATES.decay), 9);
    expect(unrestOf(double, "relax-rationing")).toBeCloseTo(start * (1 - 2 * RATES.decay), 9);
    expect(unrestOf(ref, "relax-supplied")).toBeCloseTo(start * (1 - RATES.recoveryDecay), 9);
    expect(unrestOf(double, "relax-supplied")).toBeCloseTo(start * (1 - 2 * RATES.recoveryDecay), 9);
  });

  it("settles unrest at the same level whatever the interval", async () => {
    // The reparameterisation's payoff at the processor: equilibrium is floor + ceiling × D, with no
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
    const expected = RATES.ceilingRationing * d;
    expect(await settleAt(24)).toBeCloseTo(expected, 6);
    expect(await settleAt(48)).toBeCloseTo(expected, 6);
  });
});
