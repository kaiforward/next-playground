import { describe, it, expect } from "vitest";
import { InMemoryInfrastructureWorld } from "@/lib/tick/adapters/memory/infrastructure";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { TickSystem } from "@/lib/tick/rows";

function sys(id: string, buildings: Record<string, number>, idle: Record<string, number> = {}, debt = 0): TickSystem {
  return {
    id, name: id, economyType: "extraction", regionId: "r1", factionId: "f1", control: "developed",
    governmentType: "frontier", population: 100, popCap: 200,
    unrest: 0.3, buildings, buildingIdleMonths: idle, collapseDebt: debt, yields: unitResourceVector(), slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
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

  it("writes idleMonths back per building, overwriting stale counts and leaving unmentioned systems untouched", async () => {
    const world = new InMemoryInfrastructureWorld({
      systems: [sys("s1", { ore: 3, [HOUSING_TYPE]: 2 }, { ore: 5 }), sys("s2", { ore: 1 }, { ore: 9 })],
    });
    await world.applyIdleMonths([
      { systemId: "s1", buildingType: "ore", idleMonths: 6 },
      { systemId: "s1", buildingType: HOUSING_TYPE, idleMonths: 0 },
    ]);
    const s1 = world.systems.find((s) => s.id === "s1")!;
    expect(s1.buildingIdleMonths.ore).toBe(6); // overwrote the stale 5
    expect(s1.buildingIdleMonths[HOUSING_TYPE]).toBe(0); // newly recorded
    // s2 received no update → its idle map survives verbatim.
    expect(world.systems.find((s) => s.id === "s2")!.buildingIdleMonths).toEqual({ ore: 9 });
  });

  it("applies popCap updates", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { [HOUSING_TYPE]: 5 })] });
    await world.applyPopCapUpdates([{ systemId: "s1", popCap: 80 }]);
    expect(world.systems.find((s) => s.id === "s1")!.popCap).toBe(80);
  });

  it("writes the system's collapseDebt back, overwriting the stale value and leaving unmentioned systems untouched", async () => {
    const world = new InMemoryInfrastructureWorld({
      systems: [sys("s1", { ore: 3, [HOUSING_TYPE]: 2 }, {}, 0.5), sys("s2", { ore: 1 }, {}, 0.9)],
    });
    await world.applyCollapseDebts([{ systemId: "s1", collapseDebt: 0.75 }]);
    expect(world.systems.find((s) => s.id === "s1")!.collapseDebt).toBe(0.75); // overwrote the stale 0.5
    // s2 received no update → its debt survives verbatim.
    expect(world.systems.find((s) => s.id === "s2")!.collapseDebt).toBe(0.9);
  });

  it("clears the debt to 0 when the regime lapses, rather than skipping the write", async () => {
    // Dropping back below θ_decay must actually erase the armed debt: a skipped write would
    // leave a system one bad pulse away from a teardown it already recovered from.
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { ore: 3 }, {}, 0.8)] });
    await world.applyCollapseDebts([{ systemId: "s1", collapseDebt: 0 }]);
    expect(world.systems.find((s) => s.id === "s1")!.collapseDebt).toBe(0);
  });

  it("floors a negative collapse debt at 0 rather than storing credit", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { ore: 2 }, {}, 0.4)] });
    await world.applyCollapseDebts([{ systemId: "s1", collapseDebt: -3 }]);
    expect(world.systems.find((s) => s.id === "s1")!.collapseDebt).toBe(0);
  });

  it("reads the system's collapse debt back with its state", async () => {
    const world = new InMemoryInfrastructureWorld({ systems: [sys("s1", { ore: 2 }, {}, 0.4)] });
    const [state] = await world.getInfrastructureState(["s1"]);
    expect(state.collapseDebt).toBe(0.4);
  });
});
