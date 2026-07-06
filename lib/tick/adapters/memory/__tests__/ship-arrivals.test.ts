import { describe, it, expect } from "vitest";
import { InMemoryShipArrivalsWorld } from "@/lib/tick/adapters/memory/ship-arrivals";
import type { WorldShip } from "@/lib/world/types";

function ship(overrides: Partial<WorldShip> & { id: string }): WorldShip {
  return {
    name: overrides.id,
    shipType: "shuttle",
    fuel: 100,
    maxFuel: 100,
    speed: 5,
    hullMax: 40,
    hullCurrent: 40,
    shieldMax: 10,
    shieldCurrent: 10,
    firepower: 2,
    evasion: 6,
    stealth: 3,
    sensors: 4,
    crewCapacity: 2,
    disabled: false,
    status: "in_transit",
    systemId: "sys-origin",
    destinationSystemId: "sys-dest",
    departureTick: 1,
    arrivalTick: 10,
    ...overrides,
  };
}

describe("InMemoryShipArrivalsWorld", () => {
  const systems = [
    { id: "sys-origin", name: "Origin" },
    { id: "sys-dest", name: "Destination" },
  ];

  it("returns only ships in_transit whose arrivalTick has come due", async () => {
    const due = ship({ id: "ship-due", arrivalTick: 10 });
    const notDueYet = ship({ id: "ship-future", arrivalTick: 20 });
    const alreadyDocked = ship({ id: "ship-docked", status: "docked", arrivalTick: null, destinationSystemId: null });

    const world = new InMemoryShipArrivalsWorld({ ships: [due, notDueYet, alreadyDocked] }, systems);
    const arriving = await world.getArrivingShips(10);

    expect(arriving).toHaveLength(1);
    expect(arriving[0]).toEqual({
      id: "ship-due",
      name: "ship-due",
      destinationSystemId: "sys-dest",
      playerId: "",
      destination: { name: "Destination" },
    });
  });

  it("treats a ship whose arrivalTick is in the past as due (<=, not ==)", async () => {
    const overdue = ship({ id: "ship-overdue", arrivalTick: 5 });
    const world = new InMemoryShipArrivalsWorld({ ships: [overdue] }, systems);
    const arriving = await world.getArrivingShips(10);
    expect(arriving.map((s) => s.id)).toEqual(["ship-overdue"]);
  });

  it("dockShip docks the named ship and leaves every other ship untouched", async () => {
    const target = ship({ id: "ship-due", arrivalTick: 10 });
    const other = ship({ id: "ship-other", arrivalTick: 20 });
    const world = new InMemoryShipArrivalsWorld({ ships: [target, other] }, systems);

    await world.dockShip({ shipId: "ship-due", destinationSystemId: "sys-dest" });

    const docked = world.ships.find((s) => s.id === "ship-due")!;
    expect(docked.status).toBe("docked");
    expect(docked.systemId).toBe("sys-dest");
    expect(docked.destinationSystemId).toBeNull();
    expect(docked.departureTick).toBeNull();
    expect(docked.arrivalTick).toBeNull();

    const untouched = world.ships.find((s) => s.id === "ship-other")!;
    expect(untouched).toEqual(other);
  });

  it("excludes docked ships and ships with a null arrivalTick from arrivals", async () => {
    const docked = ship({ id: "ship-docked", status: "docked", arrivalTick: null, destinationSystemId: null });
    const world = new InMemoryShipArrivalsWorld({ ships: [docked] }, systems);
    expect(await world.getArrivingShips(999)).toEqual([]);
  });
});
