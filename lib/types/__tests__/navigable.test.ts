import { describe, it, expect } from "vitest";
import {
  shipToNavigableUnit,
  convoyToNavigableUnit,
  getSoloShips,
} from "../navigable";
import type { ShipState, ConvoyState, StarSystemInfo } from "../game";

const SYSTEM: StarSystemInfo = {
  id: "sys-1",
  name: "Test System",
  economyType: "industrial",
  x: 0,
  y: 0,
  description: "",
  regionId: "reg-1",
  isGateway: false,
};

function makeShip(overrides: Partial<ShipState> = {}): ShipState {
  return {
    id: "ship-1",
    name: "Test Ship",
    shipType: "shuttle",
    size: "small",
    role: "trade",
    fuel: 20,
    maxFuel: 30,
    cargoMax: 50,
    speed: 5,
    hullMax: 100,
    hullCurrent: 100,
    shieldMax: 0,
    shieldCurrent: 0,
    firepower: 0,
    evasion: 2,
    stealth: 1,
    sensors: 3,
    crewCapacity: 2,
    disabled: false,
    cargo: [],
    upgradeSlots: [],
    status: "docked",
    systemId: "sys-1",
    system: SYSTEM,
    destinationSystemId: null,
    destinationSystem: null,
    departureTick: null,
    arrivalTick: null,
    convoyId: null,
    activeMission: null,
    ...overrides,
  };
}

function makeConvoy(members: ShipState[], overrides: Partial<ConvoyState> = {}): ConvoyState {
  return {
    id: "convoy-1",
    playerId: "player-1",
    name: "Alpha Convoy",
    systemId: "sys-1",
    system: SYSTEM,
    status: "docked",
    destinationSystemId: null,
    destinationSystem: null,
    departureTick: null,
    arrivalTick: null,
    members,
    combinedCargoMax: members.reduce((s, m) => s + m.cargoMax, 0),
    combinedCargoUsed: 0,
    ...overrides,
  };
}

describe("shipToNavigableUnit", () => {
  it("wraps a ship with correct fields", () => {
    const ship = makeShip({ id: "s1", name: "Scout", fuel: 15, maxFuel: 20, speed: 8 });
    const unit = shipToNavigableUnit(ship);

    expect(unit.kind).toBe("ship");
    expect(unit.id).toBe("s1");
    expect(unit.name).toBe("Scout");
    expect(unit.fuel).toBe(15);
    expect(unit.maxFuel).toBe(20);
    expect(unit.speed).toBe(8);
    expect(unit.systemId).toBe("sys-1");
    if (unit.kind === "ship") {
      expect(unit.ship).toBe(ship);
    }
  });
});

describe("convoyToNavigableUnit", () => {
  it("uses min fuel, maxFuel, and speed across members", () => {
    const members = [
      makeShip({ id: "s1", fuel: 20, maxFuel: 30, speed: 5 }),
      makeShip({ id: "s2", fuel: 10, maxFuel: 25, speed: 8 }),
      makeShip({ id: "s3", fuel: 15, maxFuel: 40, speed: 3 }),
    ];
    const convoy = makeConvoy(members);
    const unit = convoyToNavigableUnit(convoy);

    expect(unit.kind).toBe("convoy");
    expect(unit.fuel).toBe(10);     // min fuel
    expect(unit.maxFuel).toBe(25);  // min maxFuel
    expect(unit.speed).toBe(3);     // min speed
    expect(unit.name).toBe("Alpha Convoy");
  });

  it("uses convoy name or defaults to 'Convoy'", () => {
    const convoy = makeConvoy([makeShip()], { name: null });
    const unit = convoyToNavigableUnit(convoy);
    expect(unit.name).toBe("Convoy");
  });

  it("handles empty members gracefully", () => {
    const convoy = makeConvoy([]);
    const unit = convoyToNavigableUnit(convoy);
    expect(unit.fuel).toBe(0);
    expect(unit.maxFuel).toBe(0);
    expect(unit.speed).toBe(1);
  });
});

describe("getSoloShips", () => {
  it("filters out ships with convoyId", () => {
    const ships = [
      makeShip({ id: "s1", convoyId: null }),
      makeShip({ id: "s2", convoyId: "c1" }),
      makeShip({ id: "s3", convoyId: null }),
      makeShip({ id: "s4", convoyId: "c2" }),
    ];
    const solo = getSoloShips(ships);
    expect(solo.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("returns all ships when none are in convoys", () => {
    const ships = [makeShip({ id: "s1" }), makeShip({ id: "s2" })];
    const solo = getSoloShips(ships);
    expect(solo).toHaveLength(2);
  });

  it("returns empty array when all ships are in convoys", () => {
    const ships = [
      makeShip({ id: "s1", convoyId: "c1" }),
      makeShip({ id: "s2", convoyId: "c1" }),
    ];
    const solo = getSoloShips(ships);
    expect(solo).toHaveLength(0);
  });
});
