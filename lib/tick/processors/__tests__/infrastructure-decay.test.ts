import { describe, it, expect } from "vitest";
import { runInfrastructureDecayProcessor } from "@/lib/tick/processors/infrastructure-decay";
import { InMemoryInfrastructureWorld } from "@/lib/tick/adapters/memory/infrastructure";
import { HOUSING_TYPE, POP_CENTRE_DENSITY, BUILDING_TYPES, labourTotal } from "@/lib/constants/industry";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { TickContext, EconomySignals } from "@/lib/tick/types";
import type { TickSystem } from "@/lib/tick/rows";

const ORE_LABOUR = labourTotal(BUILDING_TYPES.ore!.labour!);

function sys(id: string, over: Partial<TickSystem>): TickSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", control: "developed",
    governmentType: "frontier", population: 100, popCap: 200,
    unrest: 0, buildings: { [HOUSING_TYPE]: 10, ore: 10 }, buildingIdleCycles: {}, collapseDebt: 0, yields: unitResourceVector(),
    extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(), peopleLand: 0,
    ...over,
  };
}

function ctxWith(signals: EconomySignals): TickContext {
  return { tick: 0, results: new Map([["economy", { economySignals: signals }]]) };
}

// Buffer 1 → a level idle for a single run sheds immediately, which keeps these unit assertions crisp.
const DECAY = { idleBufferCycles: 1, unrestThreshold: 0.75 };

describe("infrastructure-decay processor", () => {
  it("no-ops when there are no economy signals", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", {})] });
    await runInfrastructureDecayProcessor(world, { tick: 0, results: new Map() }, { decay: DECAY, interval: 24 });
    expect(world.systems[0].buildings).toEqual({ [HOUSING_TYPE]: 10, ore: 10 });
  });

  it("sheds one idle whole level per building for systems in the shard set and lowers popCap", async () => {
    // population = 4 × oreLabour staffs only 4 of 10 ore (≥1 idle level) and fills < 10 housing
    // (≥1 idle level) → each sheds exactly one whole level this run (buffer 1), counts stay integer.
    const population = 4 * ORE_LABOUR;
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { population })] });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map([["s1", new Map([["ore", 1]])]]),
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    const s = world.systems[0];
    expect(s.buildings.ore).toBe(9);
    expect(s.buildings[HOUSING_TYPE]).toBe(9);
    expect(s.popCap).toBeCloseTo(9 * POP_CENTRE_DENSITY, 6);
  });

  it("ignores systems not in the shard set (no dissatisfaction key)", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", {}), sys("s2", {})] });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map([["s1", new Map([["ore", 1]])]]),
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    expect(world.systems.find((x) => x.id === "s2")!.buildings).toEqual({ [HOUSING_TYPE]: 10, ore: 10 });
  });

  it("defaults a missing selling factor to 1 and runs both channels in one pass", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { unrest: 1, population: 4 * ORE_LABOUR })] });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map(), // no selling factor recorded for s1 → defaults to 1
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    const s = world.systems[0];
    // Both ore and housing carry an idle level at this population, so the buffer prunes one of
    // each. The catastrophic channel then spends its single level on the LEAST-used type —
    // housing sits near a fifth of capacity against ore's staffed two fifths — so housing loses
    // a second level and ore keeps the rest. Three levels total, not one per type per channel.
    expect(s.buildings.ore).toBe(9);
    expect(s.buildings[HOUSING_TYPE]).toBe(8);
  });

  it("accrues collapse debt at severity × catch-up across runs (interval 12)", async () => {
    // Above θ_decay, fully staffed (no idle level) → only the unrest channel acts. Severity at
    // unrest 0.9 is (0.9 − 0.75) / 0.25 = 0.6, and interval 12 halves the run, so the debt builds
    // 0.3 a run and only buys a whole level on the fourth. Both scalings compose here: a severity
    // change and an interval change must each move this number.
    const world = new InMemoryInfrastructureWorld({
      systems: [sys("s1", { buildings: { ore: 3 }, unrest: 0.9, population: 3 * ORE_LABOUR })],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map([["s1", new Map([["ore", 1]])]]),
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    for (const expected of [0.3, 0.6, 0.9]) {
      await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 12 });
      expect(world.systems[0].buildings.ore).toBe(3); // nothing torn down yet
      expect(world.systems[0].collapseDebt).toBeCloseTo(expected, 6); // debt persisted per system
    }

    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 12 });
    expect(world.systems[0].buildings.ore).toBe(2); // fourth run crosses 1.0 → one level shed
    expect(world.systems[0].collapseDebt).toBeCloseTo(0.2, 6); // remainder carries forward
  });

  it("clears a persisted collapse debt once unrest falls back below the threshold", async () => {
    const world = new InMemoryInfrastructureWorld({
      systems: [sys("s1", { buildings: { ore: 3 }, unrest: 0.9, population: 3 * ORE_LABOUR, collapseDebt: 0.2 })],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map([["s1", new Map([["ore", 1]])]]),
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    expect(world.systems[0].collapseDebt).toBeGreaterThan(0); // still in the regime

    world.systems[0] = { ...world.systems[0], unrest: 0.5 };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    expect(world.systems[0].collapseDebt).toBe(0); // regime lapsed → debt erased, not frozen
    expect(world.systems[0].buildings.ore).toBe(3);
  });

  it("scales the idle buffer by per-system maintenance funding", async () => {
    // Buffer 2 with one idle ore level. s-starved carries bufferScale 0.5 → effective
    // buffer 1 → sheds on the first run; s-funded has no map entry → buffer 2 → survives it.
    const population = 4 * ORE_LABOUR;
    const world = new InMemoryInfrastructureWorld({
      systems: [
        sys("s-starved", { population, buildings: { ore: 10 } }),
        sys("s-funded", { population, buildings: { ore: 10 } }),
      ],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s-starved", 0], ["s-funded", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map(),
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), {
      decay: { idleBufferCycles: 2, unrestThreshold: 0.75 },
      interval: 24,
      bufferScaleBySystem: new Map([["s-starved", 0.5]]),
    });
    expect(world.systems.find((x) => x.id === "s-starved")!.buildings.ore).toBe(9);
    expect(world.systems.find((x) => x.id === "s-funded")!.buildings.ore).toBe(10);
  });

  it("protects a glutted funding-bound producer but contracts it without the marker", async () => {
    const population = 10 * ORE_LABOUR;
    const world = new InMemoryInfrastructureWorld({
      systems: [
        sys("protected", { population, buildings: { ore: 10 } }),
        sys("ordinary", { population, buildings: { ore: 10 } }),
      ],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["protected", 0], ["ordinary", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map([
        ["protected", new Map([["ore", 0]])],
        ["ordinary", new Map([["ore", 0]])],
      ]),
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), {
      decay: DECAY,
      interval: 24,
      logisticsFundingBoundBySystem: new Map([["protected", new Set(["ore"])]]),
    });
    expect(world.systems.find((system) => system.id === "protected")!.buildings.ore).toBe(10);
    expect(world.systems.find((system) => system.id === "ordinary")!.buildings.ore).toBe(9);
  });
});

// ── Calibration instrumentation: whole levels torn down per system, combining both decay
// channels — the harness's episode-cost evidence
// (docs/active/gameplay/economy.md, unrest promise 5). ──

describe("infrastructure-decay processor: teardown instrumentation", () => {
  it("reports no entry (undefined map) when nothing decays", async () => {
    // Hugely overstaffed relative to its one level, and unrest 0 — neither channel fires.
    const world = new InMemoryInfrastructureWorld({
      systems: [sys("s1", { population: 1000 * ORE_LABOUR, buildings: { ore: 1 } })],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map(),
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    const result = await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    expect(result.teardownLevelsBySystem).toBeUndefined();
  });

  it("sums BOTH decay channels into one per-system total, matching the actual count drop", async () => {
    // Same fixture as "defaults a missing selling factor..." above: ore sheds one idle level
    // (10 -> 9, idle channel only); housing sheds one idle level PLUS one catastrophic level
    // (10 -> 8, both channels) — the reported total must be the SUM across types and channels,
    // not just whichever channel happened to run last.
    const world = new InMemoryInfrastructureWorld({
      systems: [sys("s1", { unrest: 1, population: 4 * ORE_LABOUR })],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map(),
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    const result = await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    const s = world.systems[0];
    expect(s.buildings.ore).toBe(9);
    expect(s.buildings[HOUSING_TYPE]).toBe(8);
    // Exactly what left: (10-9) ore + (10-8) housing = 3, cross-checked against the count drop.
    expect(result.teardownLevelsBySystem?.get("s1")).toBe(3);
  });

  it("keys per system, omitting one that lost nothing while another decays", async () => {
    const population = 4 * ORE_LABOUR;
    const world = new InMemoryInfrastructureWorld({
      systems: [
        sys("decaying", { population, buildings: { ore: 10 } }),
        sys("steady", { population: 1000 * ORE_LABOUR, buildings: { ore: 1 } }),
      ],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["decaying", 0], ["steady", 0]]),
      supplyStateBySystem: new Map(),
      sellingFactorBySystem: new Map(),
      realisedProductionBySystem: new Map(),
      productionSuppressBySystem: new Map(),
    };
    const result = await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    expect(result.teardownLevelsBySystem?.get("decaying")).toBe(1);
    expect(result.teardownLevelsBySystem?.has("steady")).toBe(false);
  });
});
