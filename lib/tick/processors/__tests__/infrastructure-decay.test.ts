import { describe, it, expect } from "vitest";
import { runInfrastructureDecayProcessor } from "@/lib/tick/processors/infrastructure-decay";
import { InMemoryInfrastructureWorld } from "@/lib/tick/adapters/memory/infrastructure";
import { HOUSING_TYPE, POP_CENTRE_DENSITY, BUILDING_TYPES, labourTotal } from "@/lib/constants/industry";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { TickContext, EconomySignals } from "@/lib/tick/types";
import type { SimSystem } from "@/lib/engine/simulator/types";

const ORE_LABOUR = labourTotal(BUILDING_TYPES.ore!.labour!);

function sys(id: string, over: Partial<SimSystem>): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", control: "developed",
    governmentType: "frontier", population: 100, popCap: 200, traits: [],
    unrest: 0, buildings: { [HOUSING_TYPE]: 10, ore: 10 }, yields: unitResourceVector(),
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
    ...over,
  };
}

function ctxWith(signals: EconomySignals): TickContext {
  return { tick: 0, results: new Map([["economy", { economySignals: signals }]]) };
}

const DECAY = { disuseRate: 0.1, unrestRate: 0.05, unrestThreshold: 0.75 };

describe("infrastructure-decay processor", () => {
  it("no-ops when there are no economy signals", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", {})] });
    await runInfrastructureDecayProcessor(world, { tick: 0, results: new Map() }, { decay: DECAY });
    expect(world.systems[0].buildings).toEqual({ [HOUSING_TYPE]: 10, ore: 10 });
  });

  it("decays idle capacity for systems in the economy's shard set and lowers popCap", async () => {
    // population = 4 × oreLabour staffs only 4 of 10 ore (demand 10×oreLabour → fulfillment 0.4)
    // and fills population/DENSITY of 10 housing → both have idle capacity that should rot.
    const population = 4 * ORE_LABOUR;
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { population })] });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      outputUptakeBySystem: new Map([["s1", new Map([["ore", 1]])]]),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY });
    const s = world.systems[0];
    // disuse 0.1·(built − used), unrest 0: housing 10−0.1·(10−housingUsed), ore 10−0.1·(10−4)=9.4
    // (housingUsed = population/DENSITY; ore staffed 4 = fulfillment 0.4 × 10).
    const housingUsed = population / POP_CENTRE_DENSITY;
    expect(s.buildings[HOUSING_TYPE]).toBeCloseTo(10 - 0.1 * (10 - housingUsed), 6);
    expect(s.buildings.ore).toBeCloseTo(9.4, 6);
    expect(s.popCap).toBeCloseTo(s.buildings[HOUSING_TYPE] * POP_CENTRE_DENSITY, 6);
  });

  it("ignores systems not in the shard set (no dissatisfaction key)", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", {}), sys("s2", {})] });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      outputUptakeBySystem: new Map([["s1", new Map([["ore", 1]])]]),
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY });
    expect(world.systems.find((x) => x.id === "s2")!.buildings).toEqual({ [HOUSING_TYPE]: 10, ore: 10 });
  });

  it("defaults missing uptake to 1 (decay still driven by labour + unrest)", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { unrest: 1, population: 4 * ORE_LABOUR })] });
    const signals: EconomySignals = {
      dissatisfactionBySystem: new Map([["s1", 0]]),
      outputUptakeBySystem: new Map(), // no uptake recorded for s1
    };
    await runInfrastructureDecayProcessor(world, ctxWith(signals), { decay: DECAY });
    // ore: disuse 0.1·(10−4 staffed)=0.6 + unrest 0.05·10·(1−0.75)=0.125 → 9.275
    expect(world.systems[0].buildings.ore).toBeCloseTo(9.275, 6);
  });
});
