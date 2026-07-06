import { describe, it, expect } from "vitest";
import {
  SHIP_TYPES,
  REFERENCE_SPEED,
  type ShipTypeId,
  type ShipSize,
} from "@/lib/constants/ships";
import { isShipTypeId } from "@/lib/types/guards";

describe("Ship constants", () => {
  const allTypes = Object.values(SHIP_TYPES);
  const allIds = Object.keys(SHIP_TYPES).filter((k): k is ShipTypeId => isShipTypeId(k));

  it("defines exactly 12 ship types", () => {
    expect(allTypes).toHaveLength(12);
  });

  it("each type has a matching id key", () => {
    for (const [key, def] of Object.entries(SHIP_TYPES)) {
      expect(def.id).toBe(key);
    }
  });

  it("all stat values are positive (except price and stealth)", () => {
    for (const def of allTypes) {
      expect(def.fuel).toBeGreaterThan(0);
      expect(def.cargo).toBeGreaterThan(0);
      expect(def.speed).toBeGreaterThan(0);
      expect(def.hullMax).toBeGreaterThan(0);
      expect(def.shieldMax).toBeGreaterThanOrEqual(0);
      expect(def.firepower).toBeGreaterThanOrEqual(0);
      expect(def.evasion).toBeGreaterThanOrEqual(0);
      expect(def.stealth).toBeGreaterThanOrEqual(0);
      expect(def.sensors).toBeGreaterThan(0);
      expect(def.crewCapacity).toBeGreaterThan(0);
      expect(def.price).toBeGreaterThanOrEqual(0);
    }
  });

  it("reference speed is the shuttle's speed", () => {
    expect(REFERENCE_SPEED).toBe(SHIP_TYPES.shuttle.speed);
  });

  it("isShipTypeId validates all 12 types", () => {
    for (const id of allIds) {
      expect(isShipTypeId(id)).toBe(true);
    }
    expect(isShipTypeId("invalid")).toBe(false);
    expect(isShipTypeId("freighter")).toBe(false); // old type removed
  });

  it("small ships have lower cargo/hull than large ships", () => {
    const small = allTypes.filter((t) => t.size === "small" && t.role === "trade");
    const large = allTypes.filter((t) => t.size === "large" && t.role === "trade");

    const maxSmallCargo = Math.max(...small.map((t) => t.cargo));
    const minLargeCargo = Math.min(...large.map((t) => t.cargo));
    expect(minLargeCargo).toBeGreaterThan(maxSmallCargo);
  });

  it("combat ships have higher firepower than trade ships of same size", () => {
    const sizes: ShipSize[] = ["small", "medium", "large"];
    for (const size of sizes) {
      const combat = allTypes.filter((t) => t.size === size && t.role === "combat");
      const trade = allTypes.filter((t) => t.size === size && t.role === "trade");
      if (combat.length === 0 || trade.length === 0) continue;

      const minCombatFP = Math.min(...combat.map((t) => t.firepower));
      const maxTradeFP = Math.max(...trade.map((t) => t.firepower));
      expect(minCombatFP).toBeGreaterThan(maxTradeFP);
    }
  });

  it("prices increase with ship size", () => {
    const purchasable = allTypes.filter((t) => t.price > 0);
    const smallPrices = purchasable.filter((t) => t.size === "small").map((t) => t.price);
    const largePrices = purchasable.filter((t) => t.size === "large").map((t) => t.price);

    const maxSmall = Math.max(...smallPrices);
    const minLarge = Math.min(...largePrices);
    expect(minLarge).toBeGreaterThan(maxSmall);
  });
});
