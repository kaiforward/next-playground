import { describe, it, expect } from "vitest";
import { runShipArrivalsProcessor } from "../ship-arrivals";
import { InMemoryShipArrivalsWorld } from "@/lib/tick/adapters/memory/ship-arrivals";
import type { WorldShip } from "@/lib/world/types";
import type { TickContext } from "@/lib/tick/types";

const ctx = (tick: number): TickContext => ({ tick, results: new Map() });

function ship(over: Partial<WorldShip> & { id: string }): WorldShip {
  return {
    name: over.id,
    shipType: "freighter",
    fuel: 100,
    maxFuel: 100,
    speed: 1,
    hullMax: 100,
    hullCurrent: 100,
    shieldMax: 0,
    shieldCurrent: 0,
    firepower: 0,
    evasion: 0,
    stealth: 0,
    sensors: 0,
    crewCapacity: 1,
    disabled: false,
    status: "in_transit",
    systemId: "origin",
    destinationSystemId: "dest",
    departureTick: 0,
    arrivalTick: 10,
    ...over,
  };
}

const SYSTEMS = [
  { id: "origin", name: "Origin" },
  { id: "dest", name: "Destination" },
];

describe("runShipArrivalsProcessor", () => {
  it("docks a ship whose arrivalTick is due and emits one shipArrived event", async () => {
    const world = new InMemoryShipArrivalsWorld(
      { ships: [ship({ id: "ship-1", arrivalTick: 10 })] },
      SYSTEMS,
    );

    const result = await runShipArrivalsProcessor(world, ctx(10));

    const docked = world.ships.find((s) => s.id === "ship-1")!;
    expect(docked.status).toBe("docked");
    expect(docked.systemId).toBe("dest");
    expect(docked.destinationSystemId).toBeNull();
    expect(docked.departureTick).toBeNull();
    expect(docked.arrivalTick).toBeNull();

    expect(result.globalEvents?.shipArrived).toEqual([
      { shipId: "ship-1", shipName: "ship-1", systemId: "dest", destName: "Destination" },
    ]);
  });

  it("leaves a ship with a future arrivalTick untouched and returns no event", async () => {
    const world = new InMemoryShipArrivalsWorld(
      { ships: [ship({ id: "ship-1", arrivalTick: 20 })] },
      SYSTEMS,
    );

    const result = await runShipArrivalsProcessor(world, ctx(10));

    const untouched = world.ships.find((s) => s.id === "ship-1")!;
    expect(untouched.status).toBe("in_transit");
    expect(untouched.systemId).toBe("origin");
    expect(untouched.arrivalTick).toBe(20);

    expect(result).toEqual({});
  });

  it("docks every ship arriving the same tick and lists them all in one shipArrived array", async () => {
    const world = new InMemoryShipArrivalsWorld(
      {
        ships: [
          ship({ id: "ship-1", arrivalTick: 10 }),
          ship({ id: "ship-2", arrivalTick: 10 }),
          ship({ id: "ship-3", arrivalTick: 20 }), // not yet due
        ],
      },
      SYSTEMS,
    );

    const result = await runShipArrivalsProcessor(world, ctx(10));

    expect(world.ships.find((s) => s.id === "ship-1")!.status).toBe("docked");
    expect(world.ships.find((s) => s.id === "ship-2")!.status).toBe("docked");
    expect(world.ships.find((s) => s.id === "ship-3")!.status).toBe("in_transit");

    expect(result.globalEvents?.shipArrived).toHaveLength(2);
    expect(result.globalEvents?.shipArrived?.map((e) => e.shipId).sort()).toEqual([
      "ship-1",
      "ship-2",
    ]);
  });
});
