import { describe, it, expect } from "vitest";
import { InMemoryInfrastructureWorld } from "@/lib/tick/adapters/memory/infrastructure";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { SimSystem } from "@/lib/engine/simulator/types";

function sys(id: string, buildings: Record<string, number>): SimSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", control: "developed",
    governmentType: "frontier", population: 100, popCap: 200, traits: [],
    unrest: 0.3, buildings, yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
  };
}

describe("InMemoryInfrastructureWorld", () => {
  it("reads building roster + population + unrest for the requested systems only", async () => {
    const world = new InMemoryInfrastructureWorld({
      systems: [sys("s1", { [HOUSING_TYPE]: 5, ore: 3 }), sys("s2", { ore: 1 })],
    });
    const states = await world.getInfrastructureState(["s1"]);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ systemId: "s1", population: 100, unrest: 0.3 });
    expect(states[0].buildings).toEqual({ [HOUSING_TYPE]: 5, ore: 3 });
  });

  it("applies building decays downward-only (never raises a count) and floors at 0", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { ore: 4 })] });
    await world.applyBuildingDecays([
      { systemId: "s1", buildingType: "ore", count: 99 }, // higher than current → ignored (downward-only)
    ]);
    expect(world.systems.find((s) => s.id === "s1")!.buildings.ore).toBe(4);
    await world.applyBuildingDecays([{ systemId: "s1", buildingType: "ore", count: 1.5 }]);
    expect(world.systems.find((s) => s.id === "s1")!.buildings.ore).toBeCloseTo(1.5, 6);
    await world.applyBuildingDecays([{ systemId: "s1", buildingType: "ore", count: -3 }]);
    expect(world.systems.find((s) => s.id === "s1")!.buildings.ore).toBe(0); // floored
  });

  it("applies popCap updates", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { [HOUSING_TYPE]: 5 })] });
    await world.applyPopCapUpdates([{ systemId: "s1", popCap: 80 }]);
    expect(world.systems.find((s) => s.id === "s1")!.popCap).toBe(80);
  });
});
