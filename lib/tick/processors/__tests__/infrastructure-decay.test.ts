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
    unrest: 0, buildings: { [HOUSING_TYPE]: 10, ore: 10 }, buildingIdleMonths: {}, buildingCollapseDebt: {}, yields: unitResourceVector(),
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    ...over,
  };
}

function ctxWith(signals: EconomySignals): TickContext {
  return { tick: 0, results: new Map([["economy", { economySignals: signals }]]) };
}

// Buffer 1 → a level idle for a single run sheds immediately, which keeps these unit assertions crisp.
const DECAY = { idleBufferMonths: 1, unrestThreshold: 0.75 };

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
      outputUptakeBySystem: new Map([["s1", new Map([["ore", 1]])]]),
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
      outputUptakeBySystem: new Map([["s1", new Map([["ore", 1]])]]),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    expect(world.systems.find((x) => x.id === "s2")!.buildings).toEqual({ [HOUSING_TYPE]: 10, ore: 10 });
  });

  it("defaults missing uptake to 1 and stacks the idle + unrest teardowns (two levels shed)", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { unrest: 1, population: 4 * ORE_LABOUR })] });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      outputUptakeBySystem: new Map(), // no uptake recorded for s1 → defaults to 1
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 24 });
    // ore has ≥1 idle level (staffed 4 of 10) → sheds 1 at the buffer; unrest 1 > 0.75 → sheds 1 more.
    expect(world.systems[0].buildings.ore).toBe(8);
  });

  it("accrues collapse debt fractionally at a sub-reference interval (interval 12)", async () => {
    // Above θ_decay, fully staffed (no idle level) → only the unrest channel acts. At interval 12
    // (catchUp 0.5) the collapse debt builds 0.5 → 1.0: nothing torn down the first run, one level the second.
    const world = new InMemoryInfrastructureWorld({
      systems: [sys("s1", { buildings: { ore: 3 }, unrest: 0.9, population: 3 * ORE_LABOUR })],
    });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      outputUptakeBySystem: new Map([["s1", new Map([["ore", 1]])]]),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 12 });
    expect(world.systems[0].buildings.ore).toBe(3); // nothing torn down yet
    expect(world.systems[0].buildingCollapseDebt.ore).toBeCloseTo(0.5, 6); // debt persisted

    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY, interval: 12 });
    expect(world.systems[0].buildings.ore).toBe(2); // second run crosses 1.0 → one level shed
    expect(world.systems[0].buildingCollapseDebt.ore).toBeCloseTo(0, 6);
  });
});
