import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemIndustry } from "@/lib/services/universe";
import { ServiceError } from "@/lib/services/errors";
import { BUILDING_TYPES } from "@/lib/constants/industry";
import type { World, WorldSystem } from "@/lib/world/types";

const VALID_BANDS = ["poor", "average", "good", "rich"];

let world: World;
let system: WorldSystem;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 14 });
  // A populated system with buildings exercises the full readout path.
  system = [...world.systems].sort((a, b) => b.population - a.population)[0];
  expect(system.population).toBeGreaterThan(0);
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getSystemIndustry", () => {
  it("assembles the full industry readout", () => {
    const data = getSystemIndustry(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    // Space partition mirrors the world columns; deposit = available − general.
    expect(data.space.available).toBe(system.availableSpace);
    expect(data.space.general).toBe(system.generalSpace);
    expect(data.space.habitable).toBe(system.habitableSpace);
    expect(data.space.deposit).toBeCloseTo(system.availableSpace - system.generalSpace, 6);
    for (const v of [data.space.depositWorked, data.space.generalUsed, data.space.habitableUsed]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }

    // Deposits: one row per resource with slots, worked within cap, valid band.
    for (const d of data.deposits) {
      expect(d.slotCap).toBeGreaterThan(0);
      expect(d.worked).toBeGreaterThanOrEqual(0);
      expect(d.worked).toBeLessThanOrEqual(d.slotCap);
      expect(Number.isFinite(d.yieldMult)).toBe(true);
      expect(VALID_BANDS).toContain(d.band);
    }

    // Readout core: building roster present, labour ratio bounded, supply chain present.
    expect(data.buildings.length).toBeGreaterThan(0);
    expect(data.labourFulfillment).toBeGreaterThanOrEqual(0);
    expect(data.labourFulfillment).toBeLessThanOrEqual(1);
    expect(Array.isArray(data.supplyChain)).toBe(true);

    // Production/consumption profile resolves through the world market rows
    // (the marketBandForRow path) without producing NaN.
    expect(data.goods.length).toBeGreaterThan(0);
    for (const g of data.goods) {
      expect(Number.isFinite(g.production)).toBe(true);
      expect(Number.isFinite(g.consumption)).toBe(true);
    }

    // Pop needs ride the industry readout (strip chip + per-row pop-short
    // markers) — pressure-sorted, internally consistent, goodName-resolved.
    expect(data.popNeeds.length).toBeGreaterThan(6);
    for (let i = 1; i < data.popNeeds.length; i++) {
      expect(data.popNeeds[i - 1].pressure).toBeGreaterThanOrEqual(data.popNeeds[i].pressure);
    }
    for (const n of data.popNeeds) {
      expect(n.satisfaction).toBeGreaterThanOrEqual(0);
      expect(n.satisfaction).toBeLessThanOrEqual(1);
      expect(n.delivered).toBeCloseTo(n.want * n.satisfaction, 6);
    }
    const water = data.popNeeds.find((n) => n.goodId === "water");
    expect(water?.goodName).toBe("Water");
  });

  it("treats a funding-bound glutted producer as demand-backed", () => {
    const producer = world.buildings.find((building) => {
      const definition = BUILDING_TYPES[building.buildingType];
      const owner = world.systems.find((candidate) => candidate.id === building.systemId);
      return building.count > 0 && definition?.resource !== undefined && owner?.control === "developed";
    })!;
    const definition = BUILDING_TYPES[producer.buildingType];
    if (definition?.outputGood === undefined) throw new Error("expected an extractor fixture");
    const goodId = definition.outputGood;
    const count = 10;
    const prepared: World = {
      ...world,
      systems: world.systems.map((candidate) =>
        candidate.id === producer.systemId ? { ...candidate, population: 1_000_000_000 } : candidate,
      ),
      buildings: [
        ...world.buildings.filter((building) => building.systemId !== producer.systemId),
        { ...producer, count },
      ],
      markets: world.markets.map((market) =>
        market.systemId === producer.systemId && market.goodId === goodId
          ? { ...market, stock: 1_000_000_000, logisticsFundingBound: false }
          : market,
      ),
    };
    setWorld(prepared);
    const ordinary = getSystemIndustry(producer.systemId);
    if (ordinary.visibility !== "visible") throw new Error("expected visible industry");
    const ordinaryProducer = ordinary.buildings.find((building) => building.buildingType === producer.buildingType)!;
    expect(ordinaryProducer.used).toBeCloseTo(count * 0.15);
    expect(ordinaryProducer.idleReason).toBe("selling");

    setWorld({
      ...prepared,
      markets: prepared.markets.map((market) =>
        market.systemId === producer.systemId && market.goodId === goodId
          ? { ...market, logisticsFundingBound: true }
          : market,
      ),
    });
    const protectedIndustry = getSystemIndustry(producer.systemId);
    if (protectedIndustry.visibility !== "visible") throw new Error("expected visible industry");
    const protectedProducer = protectedIndustry.buildings.find(
      (building) => building.buildingType === producer.buildingType,
    )!;
    expect(protectedProducer.used).toBe(count);
    expect(protectedProducer.idleReason).toBeUndefined();
  });

  it("throws ServiceError(404) for an unknown system", () => {
    expect(() => getSystemIndustry("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemIndustry("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});
