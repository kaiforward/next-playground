import { describe, it, expect } from "vitest";
import { resolveConstants, DEFAULT_SIM_CONSTANTS } from "../simulator/constants";
import { ECONOMY_CONSTANTS, EQUILIBRIUM_TARGETS } from "@/lib/constants/economy";
import { GOODS } from "@/lib/constants/goods";
import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";
import {
  EVENT_SPAWN_INTERVAL,
  MAX_EVENTS_PER_SYSTEM,
  MAX_EVENTS_GLOBAL,
  MODIFIER_CAPS,
} from "@/lib/constants/events";
import { SHIP_TYPES } from "@/lib/constants/ships";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";

describe("SimConstants", () => {
  describe("resolveConstants() defaults", () => {
    it("economy matches ECONOMY_CONSTANTS", () => {
      const c = resolveConstants();
      expect(c.economy.reversionRate).toBe(ECONOMY_CONSTANTS.REVERSION_RATE);
      expect(c.economy.noiseAmplitude).toBe(ECONOMY_CONSTANTS.NOISE_AMPLITUDE);
      expect(c.economy.minLevel).toBe(ECONOMY_CONSTANTS.MIN_LEVEL);
      expect(c.economy.maxLevel).toBe(ECONOMY_CONSTANTS.MAX_LEVEL);
      expect(c.economy.productionRate).toBe(ECONOMY_CONSTANTS.PRODUCTION_RATE);
      expect(c.economy.consumptionRate).toBe(ECONOMY_CONSTANTS.CONSUMPTION_RATE);
    });

    it("equilibrium matches EQUILIBRIUM_TARGETS", () => {
      const c = resolveConstants();
      expect(c.equilibrium.produces).toEqual(EQUILIBRIUM_TARGETS.produces);
      expect(c.equilibrium.consumes).toEqual(EQUILIBRIUM_TARGETS.consumes);
      expect(c.equilibrium.neutral).toEqual(EQUILIBRIUM_TARGETS.neutral);
    });

    it("goods base prices match GOODS", () => {
      const c = resolveConstants();
      for (const [key, def] of Object.entries(GOODS)) {
        expect(c.goods[key].basePrice).toBe(def.basePrice);
      }
    });

    it("goods price clamps match GOODS", () => {
      const c = resolveConstants();
      for (const [key, def] of Object.entries(GOODS)) {
        expect(c.goods[key].priceFloor).toBe(def.priceFloor);
        expect(c.goods[key].priceCeiling).toBe(def.priceCeiling);
      }
    });

    it("goods equilibrium targets match GOODS", () => {
      const c = resolveConstants();
      for (const [key, def] of Object.entries(GOODS)) {
        expect(c.goods[key].equilibrium.produces).toEqual(def.equilibrium.produces);
        expect(c.goods[key].equilibrium.consumes).toEqual(def.equilibrium.consumes);
      }
    });

    it("fuel matches REFUEL_COST_PER_UNIT", () => {
      const c = resolveConstants();
      expect(c.fuel.refuelCostPerUnit).toBe(REFUEL_COST_PER_UNIT);
    });

    it("events matches event constants", () => {
      const c = resolveConstants();
      expect(c.events.spawnInterval).toBe(EVENT_SPAWN_INTERVAL);
      expect(c.events.maxPerSystem).toBe(MAX_EVENTS_PER_SYSTEM);
      expect(c.events.maxGlobal).toBe(MAX_EVENTS_GLOBAL);
      expect(c.events.modifierCaps).toEqual(MODIFIER_CAPS);
    });

    it("ships matches SHIP_TYPES", () => {
      const c = resolveConstants();
      for (const [key, def] of Object.entries(SHIP_TYPES)) {
        expect(c.ships[key]).toEqual({
          fuel: def.fuel,
          cargo: def.cargo,
          speed: def.speed,
          hullMax: def.hullMax,
          shieldMax: def.shieldMax,
          firepower: def.firepower,
          evasion: def.evasion,
          stealth: def.stealth,
          price: def.price,
        });
      }
    });

    it("universe matches UNIVERSE_GEN", () => {
      const c = resolveConstants();
      expect(c.universe.regionCount).toBe(UNIVERSE_GEN.REGION_COUNT);
      expect(c.universe.totalSystems).toBe(UNIVERSE_GEN.TOTAL_SYSTEMS);
      expect(c.universe.intraRegionBaseFuel).toBe(UNIVERSE_GEN.INTRA_REGION_BASE_FUEL);
      expect(c.universe.gatewayFuelMultiplier).toBe(UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER);
      expect(c.universe.gatewaysPerBorder).toBe(UNIVERSE_GEN.GATEWAYS_PER_BORDER);
      expect(c.universe.intraRegionExtraEdges).toBe(UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES);
    });

    it("pricing has correct read-only values", () => {
      const c = resolveConstants();
      expect(c.pricing.minMultiplier).toBe(0.2);
      expect(c.pricing.maxMultiplier).toBe(5.0);
    });

    it("bots has expected defaults", () => {
      const c = resolveConstants();
      expect(c.bots.startingCredits).toBe(500);
      expect(c.bots.refuelThreshold).toBe(0.5);
      expect(c.bots.tradeImpactFactor).toBe(0.1);
    });

    it("every section is populated (no undefined)", () => {
      const c = resolveConstants();
      for (const [key, value] of Object.entries(c)) {
        expect(value, `${key} should be defined`).toBeDefined();
        expect(value, `${key} should not be null`).not.toBeNull();
      }
    });
  });

  describe("resolveConstants() with overrides", () => {
    it("overrides a single economy field", () => {
      const c = resolveConstants({ economy: { reversionRate: 0.1 } });
      expect(c.economy.reversionRate).toBe(0.1);
      // Other fields preserved
      expect(c.economy.noiseAmplitude).toBe(ECONOMY_CONSTANTS.NOISE_AMPLITUDE);
    });

    it("overrides a single good base price, preserves others", () => {
      const c = resolveConstants({ goods: { food: { basePrice: 99 } } });
      expect(c.goods.food.basePrice).toBe(99);
      expect(c.goods.ore.basePrice).toBe(GOODS.ore.basePrice);
      expect(c.goods.luxuries.basePrice).toBe(GOODS.luxuries.basePrice);
    });

    it("overrides fuel cost", () => {
      const c = resolveConstants({ fuel: { refuelCostPerUnit: 5 } });
      expect(c.fuel.refuelCostPerUnit).toBe(5);
    });

    it("overrides events modifier caps", () => {
      const c = resolveConstants({
        events: { modifierCaps: { maxShift: 200 } },
      });
      expect(c.events.modifierCaps.maxShift).toBe(200);
      // Other cap fields preserved
      expect(c.events.modifierCaps.minMultiplier).toBe(MODIFIER_CAPS.minMultiplier);
    });

    it("overrides bots section", () => {
      const c = resolveConstants({ bots: { startingCredits: 1000 } });
      expect(c.bots.startingCredits).toBe(1000);
      expect(c.bots.refuelThreshold).toBe(0.5);
    });

    it("preserves pricing (read-only) even if passed", () => {
      const c = resolveConstants({} as never);
      expect(c.pricing.minMultiplier).toBe(0.2);
      expect(c.pricing.maxMultiplier).toBe(5.0);
    });
  });

  describe("DEFAULT_SIM_CONSTANTS", () => {
    it("matches resolveConstants() with no args", () => {
      const fresh = resolveConstants();
      expect(DEFAULT_SIM_CONSTANTS).toEqual(fresh);
    });
  });
});
