import { describe, it, expect } from "vitest";
import {
  housingUsed,
  idleLevels,
  collapseSeverity,
  computeSystemDecay,
  type DecayParams,
} from "@/lib/engine/infrastructure-decay";
import {
  HOUSING_TYPE,
  POP_CENTRE_DENSITY,
  BUILDING_TYPES,
  labourTotal,
  VOCATIONAL_SCHOOL_TYPE,
  HEAVY_INDUSTRY_COMPLEX,
} from "@/lib/constants/industry";

const ORE_LABOUR = labourTotal(BUILDING_TYPES.ore!.labour!);

/** Buffered decay: a level must sit idle 3 runs before the marginal level sheds; θ_decay 0.75. */
const PARAMS: DecayParams = { idleBufferMonths: 3, unrestThreshold: 0.75 };
/** Never sheds — for asserting "no-op" paths. */
const NO_DECAY: DecayParams = { idleBufferMonths: 9999, unrestThreshold: 1 };

const fullSelling = () => 1;

describe("housingUsed", () => {
  it("is population / POP_CENTRE_DENSITY (housing the current pop fills)", () => {
    expect(housingUsed(200)).toBeCloseTo(200 / POP_CENTRE_DENSITY, 6);
    expect(housingUsed(0)).toBe(0);
    expect(housingUsed(-50)).toBe(0);
  });
});

describe("idleLevels", () => {
  it("is the whole levels of unused capacity (floor of count − used)", () => {
    expect(idleLevels(5, 3.2)).toBe(1); // 1.8 idle → one whole idle level
    expect(idleLevels(5, 4.9)).toBe(0); // 0.1 idle → not a whole level
    expect(idleLevels(5, 5)).toBe(0);
  });

  it("is negative (never idle) when utilization exceeds count — housing over-crowding", () => {
    expect(idleLevels(3, 5)).toBe(-2);
  });
});

describe("computeSystemDecay — whole-level buffered contraction", () => {
  it("does not shed a viable system (built = used, calm) and leaves idle countdowns at 0", () => {
    const result = computeSystemDecay(
      {
        buildings: { [HOUSING_TYPE]: 5, ore: 2 },
        buildingIdleMonths: {},
        collapseDebt: 0,
        population: 100, // fills 5 housing exactly; 2 ore fully staffed + selling
        unrest: 0,
        sellingFactor: fullSelling,
      },
      PARAMS,
    );
    expect(result.newCounts).toEqual({});
    expect(result.newIdleMonths).toEqual({});
    expect(result.popCap).toBeCloseTo(5 * POP_CENTRE_DENSITY, 6);
  });

  it("counts an idle building's buffer up without shedding below the threshold", () => {
    // 3 ore, population 0 → used 0 → all 3 levels idle. Countdown 1 → 2, no removal (buffer 3).
    const result = computeSystemDecay(
      { buildings: { ore: 3 }, buildingIdleMonths: { ore: 1 }, collapseDebt: 0, population: 0, unrest: 0, sellingFactor: fullSelling },
      PARAMS,
    );
    expect(result.newCounts).toEqual({});
    expect(result.newIdleMonths.ore).toBe(2);
  });

  it("sheds exactly one whole level at the buffer and resets the countdown", () => {
    const result = computeSystemDecay(
      { buildings: { ore: 3 }, buildingIdleMonths: { ore: 2 }, collapseDebt: 0, population: 0, unrest: 0, sellingFactor: fullSelling },
      PARAMS,
    );
    expect(result.newCounts.ore).toBe(2); // one level torn down; count stays integer
    expect(Number.isInteger(result.newCounts.ore)).toBe(true);
    expect(result.newIdleMonths.ore).toBe(0); // countdown reset after shedding
  });

  it("resets the countdown when a level refills, without shedding (hysteresis)", () => {
    // Fully staffed + selling now → no idle level, so a mid-countdown building recovers for free.
    const result = computeSystemDecay(
      {
        buildings: { ore: 3 },
        buildingIdleMonths: { ore: 2 },
        collapseDebt: 0,
        population: 3 * ORE_LABOUR,
        unrest: 0,
        sellingFactor: fullSelling,
      },
      PARAMS,
    );
    expect(result.newCounts).toEqual({});
    expect(result.newIdleMonths.ore).toBe(0);
  });

  it("tears down a whole level immediately when unrest exceeds the threshold (discrete collapse)", () => {
    // 2 ore fully staffed + selling (not idle), but unrest 1 > 0.75 → one level torn down anyway.
    const result = computeSystemDecay(
      { buildings: { ore: 2 }, buildingIdleMonths: {}, collapseDebt: 0, population: 2 * ORE_LABOUR, unrest: 1, sellingFactor: fullSelling },
      PARAMS,
    );
    expect(result.newCounts.ore).toBe(1);
    expect(Number.isInteger(result.newCounts.ore)).toBe(true);
  });

  it("funding-bound protection does not suppress catastrophic unrest teardown", () => {
    const result = computeSystemDecay(
      {
        buildings: { ore: 2 },
        buildingIdleMonths: {},
        collapseDebt: 0,
        population: 2 * ORE_LABOUR,
        unrest: 1,
        sellingFactor: () => 0,
        logisticsFundingBound: () => true,
      },
      PARAMS,
    );
    expect(result.newCounts.ore).toBe(1);
  });

  it("recomputes popCap from the surviving housing when a housing level sheds", () => {
    const result = computeSystemDecay(
      { buildings: { [HOUSING_TYPE]: 5 }, buildingIdleMonths: { [HOUSING_TYPE]: 2 }, collapseDebt: 0, population: 0, unrest: 0, sellingFactor: fullSelling },
      PARAMS,
    );
    expect(result.newCounts[HOUSING_TYPE]).toBe(4);
    expect(result.popCap).toBeCloseTo(4 * POP_CENTRE_DENSITY, 6);
  });

  it("holds housing through healthy vacancy but accrues through material emptying", () => {
    const healthy = computeSystemDecay(
      {
        buildings: { [HOUSING_TYPE]: 10 },
        buildingIdleMonths: { [HOUSING_TYPE]: 2 },
        collapseDebt: 0,
        population: 9.2 * POP_CENTRE_DENSITY,
        unrest: 0,
        sellingFactor: fullSelling,
      },
      PARAMS,
    );
    expect(healthy.newIdleMonths[HOUSING_TYPE]).toBe(0);

    const emptying = computeSystemDecay(
      {
        buildings: { [HOUSING_TYPE]: 10 },
        buildingIdleMonths: {},
        collapseDebt: 0,
        population: 8 * POP_CENTRE_DENSITY,
        unrest: 0,
        sellingFactor: fullSelling,
      },
      PARAMS,
    );
    expect(emptying.newIdleMonths[HOUSING_TYPE]).toBe(1);
  });

  it("is a no-op under a never-expiring buffer and sub-threshold unrest", () => {
    const result = computeSystemDecay(
      { buildings: { [HOUSING_TYPE]: 3, ore: 1 }, buildingIdleMonths: {}, collapseDebt: 0, population: 0, unrest: 0.7, sellingFactor: () => 0 },
      NO_DECAY,
    );
    expect(result.newCounts).toEqual({});
    // Idle countdowns still advance (they just never reach the never-expiring buffer).
    expect(result.newIdleMonths[HOUSING_TYPE]).toBe(1);
    expect(result.newIdleMonths.ore).toBe(1);
  });
});

describe("computeSystemDecay — interval awareness", () => {
  // θ_decay 0.75; a 2-run idle buffer so the fractional countdown is easy to trace.
  const IV_PARAMS: DecayParams = { idleBufferMonths: 2, unrestThreshold: 0.75 };

  // ore fully staffed + selling (idleLevels 0), so only the unrest channel can act.
  const inUse = (count: number, unrest: number, collapseDebt = 0) => ({
    buildings: { ore: count },
    buildingIdleMonths: {},
    collapseDebt,
    population: count * ORE_LABOUR,
    unrest,
    sellingFactor: fullSelling,
  });

  it("idle countdown is tick-denominated: catchUp 0.5 needs twice the runs", () => {
    // 2 ore, population 0 → idle. Buffer 2 reference-months at catchUp 0.5: the countdown
    // climbs 0.5 → 1.0 → 1.5 (no teardown) and only crosses 2.0 on the 4th run.
    let idleMonths: Record<string, number> = {};
    for (let run = 1; run <= 3; run++) {
      const r = computeSystemDecay(
        { buildings: { ore: 2 }, buildingIdleMonths: idleMonths, collapseDebt: 0, population: 0, unrest: 0, sellingFactor: fullSelling },
        IV_PARAMS,
        0.5,
      );
      expect(r.newCounts).toEqual({});
      expect(r.newIdleMonths.ore).toBeCloseTo(run * 0.5, 6);
      idleMonths = r.newIdleMonths;
    }
    const r4 = computeSystemDecay(
      { buildings: { ore: 2 }, buildingIdleMonths: idleMonths, collapseDebt: 0, population: 0, unrest: 0, sellingFactor: fullSelling },
      IV_PARAMS,
      0.5,
    );
    expect(r4.newCounts.ore).toBe(1); // fourth run crosses the buffer, sheds one level
    expect(r4.newIdleMonths.ore).toBe(0);
  });

  it("unrest teardown accrues fractional collapse debt", () => {
    // In use (not idle), unrest at full severity, catchUp 0.5: debt builds 0.5 → 1.0.
    const r1 = computeSystemDecay(inUse(2, 1), IV_PARAMS, 0.5);
    expect(r1.newCounts).toEqual({}); // floor(0.5) = 0 levels removed
    expect(r1.collapseDebt).toBeCloseTo(0.5, 6);

    const r2 = computeSystemDecay(inUse(2, 1, 0.5), IV_PARAMS, 0.5);
    expect(r2.newCounts.ore).toBe(1); // floor(1.0) = 1 level removed
    expect(r2.collapseDebt).toBeCloseTo(0, 6);
  });

  it("collapse debt resets when unrest drops below the threshold", () => {
    // 0.5 debt armed, but unrest recovers below θ_decay: the regime clears, no teardown.
    const r = computeSystemDecay(inUse(2, 0.5, 0.5), IV_PARAMS, 0.5);
    expect(r.newCounts).toEqual({});
    expect(r.collapseDebt).toBe(0);
  });

  it("lapses the part of a catchUp-inflated budget it has no type to spend on", () => {
    // catchUp 2 at full severity owes floor(0 + 2) = 2 levels, but ore is the only eligible
    // type and each type gives up at most one level per run — so one level sheds and the
    // unspendable remainder lapses rather than banking.
    const r = computeSystemDecay(inUse(3, 1), IV_PARAMS, 2);
    expect(r.newCounts.ore).toBe(2); // 3 − 1, not 3 − 2
    expect(r.collapseDebt).toBe(0);
  });

  it("default catchUp sheds exactly one level and leaves no residue", () => {
    const collapse = computeSystemDecay(inUse(2, 1), IV_PARAMS);
    expect(collapse.newCounts.ore).toBe(1);
    expect(collapse.collapseDebt).toBe(0);

    // …and the idle countdown advances by whole 1s.
    const idle = computeSystemDecay(
      { buildings: { ore: 3 }, buildingIdleMonths: { ore: 1 }, collapseDebt: 0, population: 0, unrest: 0, sellingFactor: fullSelling },
      PARAMS, // buffer 3 from the top-level fixture
    );
    expect(idle.newIdleMonths.ore).toBe(2);
  });
});

describe("collapseSeverity", () => {
  it("is 0 at or below the threshold and ramps to 1 at full unrest", () => {
    expect(collapseSeverity(0.75, 0.75)).toBe(0);
    expect(collapseSeverity(0.5, 0.75)).toBe(0);
    expect(collapseSeverity(1, 0.75)).toBeCloseTo(1, 6);
    expect(collapseSeverity(0.8, 0.75)).toBeCloseTo(0.2, 6);
    expect(collapseSeverity(0.875, 0.75)).toBeCloseTo(0.5, 6);
  });

  it("is finite for a threshold at or above 1 (no division by zero)", () => {
    // θ = 1 leaves no span above it. Unrest is clamped to [0,1] in world state, so this is
    // only reachable from a retuned threshold or a raw call, but it must never yield NaN.
    expect(collapseSeverity(1, 1)).toBe(0); // not above θ
    expect(collapseSeverity(1.5, 1)).toBe(1);
    expect(collapseSeverity(2, 1.5)).toBe(1);
    expect(Number.isFinite(collapseSeverity(1.5, 1))).toBe(true);
  });
});

describe("computeSystemDecay — proportionate unrest collapse", () => {
  const PROP: DecayParams = { idleBufferMonths: 3, unrestThreshold: 0.75 };
  /** Ten production types, so a wide base can be compared against a narrow one. */
  const TEN_TYPES = Object.keys(BUILDING_TYPES).filter((t) => t !== HOUSING_TYPE).slice(0, 10);
  const levelsShed = (before: Record<string, number>, newCounts: Record<string, number>) =>
    Object.entries(newCounts).reduce((sum, [type, count]) => sum + ((before[type] ?? 0) - count), 0);

  it("sheds at a rate set by the system, not by how many building types it runs", () => {
    // The old channel ran one debt per building type, so a ten-industry world lost ten levels
    // in the time a one-industry world lost one. Population 0 keeps both bases idle-but-buffered,
    // isolating the catastrophic channel.
    const narrow = { ore: 3 };
    const wide: Record<string, number> = Object.fromEntries(TEN_TYPES.map((t) => [t, 3]));
    expect(Object.keys(wide)).toHaveLength(10);

    const narrowResult = computeSystemDecay(
      { buildings: narrow, buildingIdleMonths: {}, collapseDebt: 0, population: 0, unrest: 1, sellingFactor: fullSelling },
      PROP,
    );
    const wideResult = computeSystemDecay(
      { buildings: wide, buildingIdleMonths: {}, collapseDebt: 0, population: 0, unrest: 1, sellingFactor: fullSelling },
      PROP,
    );

    expect(levelsShed(narrow, narrowResult.newCounts)).toBe(1);
    expect(levelsShed(wide, wideResult.newCounts)).toBe(1);
  });

  it("picks the least-used level first", () => {
    // Both types are fully staffed, so utilization differs only by how well each SELLS: water
    // moves a fifth of its output, ore all of it. The collapse level must land on water — the
    // levels a system is failing to keep busy go before the ones it still leans on.
    const buildings = { ore: 2, water: 2 };
    const result = computeSystemDecay(
      {
        buildings,
        buildingIdleMonths: {},
        collapseDebt: 0,
        population: 1e6, // far past both labour draws, so staffing is not the differentiator
        unrest: 1,
        sellingFactor: (goodId) => (goodId === "water" ? 0.2 : 1),
      },
      PROP,
    );
    expect(levelsShed(buildings, result.newCounts)).toBe(1);
    expect(result.newCounts.water).toBe(1); // the idlest seller gives up a level
    expect(result.newCounts.ore).toBeUndefined(); // the busy one survives
  });

  it("breaks an exact utilization tie on ascending type id", () => {
    // Identical staffing and identical selling leaves nothing to choose between them, so the
    // ordering falls back to the type id — the outcome must not depend on key insertion order.
    const buildings = { water: 2, ore: 2 };
    const result = computeSystemDecay(
      { buildings, buildingIdleMonths: {}, collapseDebt: 0, population: 1e6, unrest: 1, sellingFactor: fullSelling },
      PROP,
    );
    expect(levelsShed(buildings, result.newCounts)).toBe(1);
    expect(result.newCounts.ore).toBe(1); // "ore" sorts before "water"
    expect(result.newCounts.water).toBeUndefined();
  });

  it("spreads a multi-level budget one level per type", () => {
    // catchUp 2 at full severity owes two levels and there are two eligible types, so each gives
    // up exactly one — the budget spreads across the base instead of gutting a single industry.
    const buildings = { ore: 3, water: 3 };
    const result = computeSystemDecay(
      { buildings, buildingIdleMonths: {}, collapseDebt: 0, population: 1e6, unrest: 1, sellingFactor: fullSelling },
      PROP,
      2,
    );
    expect(levelsShed(buildings, result.newCounts)).toBe(2);
    expect(result.newCounts.ore).toBe(2);
    expect(result.newCounts.water).toBe(2);
  });

  it("ramps with severity: just above the threshold is slow, full unrest is a level a run", () => {
    // θ 0.75, unrest 0.8 → severity 0.2, so the debt needs five runs to buy one level.
    let debt = 0;
    for (let run = 1; run <= 4; run++) {
      const r = computeSystemDecay(
        { buildings: { ore: 10 }, buildingIdleMonths: {}, collapseDebt: debt, population: 10 * ORE_LABOUR, unrest: 0.8, sellingFactor: fullSelling },
        PROP,
      );
      expect(r.newCounts).toEqual({});
      expect(r.collapseDebt).toBeCloseTo(run * 0.2, 6);
      debt = r.collapseDebt;
    }
    const fifth = computeSystemDecay(
      { buildings: { ore: 10 }, buildingIdleMonths: {}, collapseDebt: debt, population: 10 * ORE_LABOUR, unrest: 0.8, sellingFactor: fullSelling },
      PROP,
    );
    expect(fifth.newCounts.ore).toBe(9);
    expect(fifth.collapseDebt).toBeCloseTo(0, 6);

    // At unrest 1 the same system sheds on every single run.
    const full = computeSystemDecay(
      { buildings: { ore: 10 }, buildingIdleMonths: {}, collapseDebt: 0, population: 10 * ORE_LABOUR, unrest: 1, sellingFactor: fullSelling },
      PROP,
    );
    expect(full.newCounts.ore).toBe(9);
  });

  it("never strands a population at popCap 0, however long unrest stays maxed", () => {
    // The trap this channel used to spring: housing torn down under a resident population
    // leaves popCap 0, which zeroes the growth brake AND blocks the relief valve that would
    // rebuild it. Housing must stay at or above resident occupancy no matter how long it runs.
    const population = 2 * POP_CENTRE_DENSITY;
    let buildings: Record<string, number> = { [HOUSING_TYPE]: 5, ore: 4 };
    let popCap = 5 * POP_CENTRE_DENSITY;
    for (let run = 0; run < 40; run++) {
      const r = computeSystemDecay(
        { buildings, buildingIdleMonths: {}, collapseDebt: 0, population, unrest: 1, sellingFactor: fullSelling },
        PROP,
      );
      buildings = { ...buildings, ...r.newCounts };
      popCap = r.popCap;
      expect(popCap).toBeGreaterThanOrEqual(population);
    }
    expect(buildings[HOUSING_TYPE]).toBe(2); // exactly the occupied levels survive
    expect(buildings.ore).toBe(0); // industry is not protected
    expect(popCap).toBeGreaterThan(0);
  });

  it("keeps the part-occupied level a fractional population needs (ceil, not floor)", () => {
    // 2.5 levels' worth of residents occupy THREE levels — the third is half full, not absent. Every
    // other test here uses an exact multiple of POP_CENTRE_DENSITY, where the rounding is invisible;
    // at 2.5 a floor settles on 2 levels (popCap 40 < 50) and strands exactly the population the
    // floor exists to protect.
    const population = 2.5 * POP_CENTRE_DENSITY;
    let buildings: Record<string, number> = { [HOUSING_TYPE]: 5 };
    let popCap = 5 * POP_CENTRE_DENSITY;
    for (let run = 0; run < 40; run++) {
      const r = computeSystemDecay(
        { buildings, buildingIdleMonths: {}, collapseDebt: 0, population, unrest: 1, sellingFactor: fullSelling },
        PROP,
      );
      buildings = { ...buildings, ...r.newCounts };
      popCap = r.popCap;
      expect(popCap).toBeGreaterThanOrEqual(population);
    }
    expect(buildings[HOUSING_TYPE]).toBe(3); // the part-occupied level survives
  });

  it("fully sheds the housing of a system holding nobody", () => {
    // A genuinely abandoned colony still cleans up — the floor is occupancy, not a reserved level.
    let buildings: Record<string, number> = { [HOUSING_TYPE]: 3 };
    for (let run = 0; run < 5; run++) {
      const r = computeSystemDecay(
        { buildings, buildingIdleMonths: {}, collapseDebt: 0, population: 0, unrest: 1, sellingFactor: fullSelling },
        PROP,
      );
      buildings = { ...buildings, ...r.newCounts };
    }
    expect(buildings[HOUSING_TYPE]).toBe(0);
  });

  it("is total for degenerate inputs", () => {
    const finite = (r: { collapseDebt: number; popCap: number }) => {
      expect(Number.isFinite(r.collapseDebt)).toBe(true);
      expect(Number.isFinite(r.popCap)).toBe(true);
      expect(r.collapseDebt).toBeGreaterThanOrEqual(0);
    };

    // No buildings at all.
    finite(computeSystemDecay(
      { buildings: {}, buildingIdleMonths: {}, collapseDebt: 0, population: 100, unrest: 1, sellingFactor: fullSelling },
      PROP,
    ));
    // Zero counts on every entry.
    finite(computeSystemDecay(
      { buildings: { ore: 0, [HOUSING_TYPE]: 0 }, buildingIdleMonths: {}, collapseDebt: 0, population: 0, unrest: 1, sellingFactor: fullSelling },
      PROP,
    ));
    // θ at 1 — no span above the threshold.
    finite(computeSystemDecay(
      { buildings: { ore: 2 }, buildingIdleMonths: {}, collapseDebt: 0, population: 0, unrest: 1, sellingFactor: fullSelling },
      { idleBufferMonths: 3, unrestThreshold: 1 },
    ));
    // A corrupt carried debt must not propagate into world state.
    const corrupt = computeSystemDecay(
      { buildings: { ore: 2 }, buildingIdleMonths: {}, collapseDebt: Number.NaN, population: 0, unrest: 1, sellingFactor: fullSelling },
      PROP,
    );
    finite(corrupt);
    // …and a negative one is treated as no debt, never as credit.
    finite(computeSystemDecay(
      { buildings: { ore: 2 }, buildingIdleMonths: {}, collapseDebt: -5, population: 0, unrest: 1, sellingFactor: fullSelling },
      PROP,
    ));
  });

  it("leaves the idle channel on its own schedule while the collapse channel runs", () => {
    // The idle countdown must still take the full buffer to prune a genuinely idle level, and
    // must not be accelerated (or reset) by the catastrophic channel acting on the same run.
    const calm = (idleMonths: number) => computeSystemDecay(
      { buildings: { ore: 3 }, buildingIdleMonths: { ore: idleMonths }, collapseDebt: 0, population: 0, unrest: 0, sellingFactor: fullSelling },
      PROP,
    );
    expect(calm(0).newIdleMonths.ore).toBe(1);
    expect(calm(1).newIdleMonths.ore).toBe(2);
    expect(calm(2).newCounts.ore).toBe(2); // buffer 3 reached: exactly one level pruned
    expect(calm(2).newIdleMonths.ore).toBe(0);
  });
});

describe("computeSystemDecay — every output kind sheds whole levels uniformly", () => {
  it("sheds an over-licensed academy level at the buffer (capacity output)", () => {
    // 2 vocational schools license far more skill-1 than one metals fab demands → ≥1 idle level.
    const buildings = { metals: 1, [VOCATIONAL_SCHOOL_TYPE]: 2, [HOUSING_TYPE]: 100 };
    const result = computeSystemDecay(
      { buildings, buildingIdleMonths: { [VOCATIONAL_SCHOOL_TYPE]: 2 }, collapseDebt: 0, population: 100000, unrest: 0, sellingFactor: fullSelling },
      PARAMS,
    );
    expect(result.newCounts[VOCATIONAL_SCHOOL_TYPE]).toBe(1);
  });

  it("sheds an orphaned specialisation complex at the buffer (modifier output)", () => {
    // No family factories → the complex buffs nothing → one whole idle level → sheds at the buffer.
    const result = computeSystemDecay(
      { buildings: { [HEAVY_INDUSTRY_COMPLEX]: 1 }, buildingIdleMonths: { [HEAVY_INDUSTRY_COMPLEX]: 2 }, collapseDebt: 0, population: 1e9, unrest: 0, sellingFactor: fullSelling },
      PARAMS,
    );
    expect(result.newCounts[HEAVY_INDUSTRY_COMPLEX]).toBe(0);
  });
});
