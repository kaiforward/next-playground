import { describe, it, expect } from "vitest";
import { shipToTradableUnit, convoyToTradableUnit } from "../tradable";
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

describe("shipToTradableUnit", () => {
  it("wraps a ship with correct cargo fields", () => {
    const cargo = [
      { goodId: "ore", goodName: "Ore", quantity: 10 },
      { goodId: "food", goodName: "Food", quantity: 5 },
    ];
    const ship = makeShip({ id: "s1", name: "Hauler", cargoMax: 80, cargo });
    const unit = shipToTradableUnit(ship);

    expect(unit.kind).toBe("ship");
    expect(unit.id).toBe("s1");
    expect(unit.name).toBe("Hauler");
    expect(unit.cargoMax).toBe(80);
    expect(unit.cargo).toBe(cargo);
  });
});

describe("convoyToTradableUnit", () => {
  it("aggregates cargo across members", () => {
    const members = [
      makeShip({
        id: "s1",
        cargoMax: 50,
        cargo: [
          { goodId: "ore", goodName: "Ore", quantity: 10 },
          { goodId: "food", goodName: "Food", quantity: 5 },
        ],
      }),
      makeShip({
        id: "s2",
        cargoMax: 30,
        cargo: [
          { goodId: "ore", goodName: "Ore", quantity: 7 },
          { goodId: "fuel", goodName: "Fuel", quantity: 3 },
        ],
      }),
    ];
    const convoy = makeConvoy(members);
    const unit = convoyToTradableUnit(convoy);

    expect(unit.kind).toBe("convoy");
    expect(unit.cargoMax).toBe(80); // 50 + 30
    expect(unit.cargo).toHaveLength(3); // ore, food, fuel

    const ore = unit.cargo.find((c) => c.goodId === "ore");
    const food = unit.cargo.find((c) => c.goodId === "food");
    const fuel = unit.cargo.find((c) => c.goodId === "fuel");
    expect(ore?.quantity).toBe(17); // 10 + 7
    expect(food?.quantity).toBe(5);
    expect(fuel?.quantity).toBe(3);
  });

  it("does not mutate original cargo items", () => {
    const cargo1 = [{ goodId: "ore", goodName: "Ore", quantity: 10 }];
    const cargo2 = [{ goodId: "ore", goodName: "Ore", quantity: 5 }];
    const members = [
      makeShip({ id: "s1", cargo: cargo1 }),
      makeShip({ id: "s2", cargo: cargo2 }),
    ];
    const convoy = makeConvoy(members);
    convoyToTradableUnit(convoy);

    expect(cargo1[0].quantity).toBe(10);
    expect(cargo2[0].quantity).toBe(5);
  });

  it("uses combinedCargoMax from convoy", () => {
    const members = [
      makeShip({ id: "s1", cargoMax: 50 }),
      makeShip({ id: "s2", cargoMax: 30 }),
    ];
    const convoy = makeConvoy(members, { combinedCargoMax: 80 });
    const unit = convoyToTradableUnit(convoy);

    expect(unit.cargoMax).toBe(80);
  });

  it("defaults name to 'Convoy' when null", () => {
    const convoy = makeConvoy([makeShip()], { name: null });
    const unit = convoyToTradableUnit(convoy);
    expect(unit.name).toBe("Convoy");
  });

  it("uses convoy name when provided", () => {
    const convoy = makeConvoy([makeShip()], { name: "Trade Fleet" });
    const unit = convoyToTradableUnit(convoy);
    expect(unit.name).toBe("Trade Fleet");
  });

  it("handles empty members gracefully", () => {
    const convoy = makeConvoy([], { combinedCargoMax: 0 });
    const unit = convoyToTradableUnit(convoy);

    expect(unit.cargoMax).toBe(0);
    expect(unit.cargo).toEqual([]);
  });
});
