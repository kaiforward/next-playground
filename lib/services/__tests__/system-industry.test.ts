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

    // Three independent budgets mirror the world columns' totals.
    expect(data.space.people.total).toBe(system.peopleLand);
    expect(data.space.industry.total).toBe(system.industryLand);
    for (const budget of [data.space.people, data.space.industry, data.space.deposit]) {
      expect(Number.isFinite(budget.used)).toBe(true);
      expect(budget.used).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(budget.total)).toBe(true);
    }

    // Deposits: one row per resource with slots, worked within cap, valid band.
    for (const d of data.deposits) {
      expect(d.depositCounts).toBeGreaterThan(0);
      expect(d.worked).toBeGreaterThanOrEqual(0);
      expect(d.worked).toBeLessThanOrEqual(d.depositCounts);
      expect(Number.isFinite(d.yieldMult)).toBe(true);
      expect(VALID_BANDS).toContain(d.band);
    }

    // Readout core: building roster present, labour ratio bounded, supply chain present.
    expect(data.buildings.length).toBeGreaterThan(0);
    expect(data.labourFulfilment).toBeGreaterThanOrEqual(0);
    expect(data.labourFulfilment).toBeLessThanOrEqual(1);
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

  it("keeps industry capacity and population needs on the same civilian demand", () => {
    // The Industry readout's per-good consumption and the needs ledger's want are two projections of
    // one consumptionRate call — they must not drift apart.
    const data = getSystemIndustry(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible industry");
    expect(data.popNeeds.length).toBeGreaterThan(0);
    for (const need of data.popNeeds) {
      const rate = data.goods.find((good) => good.goodId === need.goodId)!;
      expect(rate.consumption, need.goodId).toBeCloseTo(need.want, 10);
    }
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

  it("recomputes a producer's selling factor live when its market row carries no persisted use figure", () => {
    // A legacy-save fallback: generateWorld always persists honestUseRate (lib/world/markets.ts),
    // so this simulates the one case that field can be missing. The live recompute must reproduce
    // the SAME value the persisted field holds here — never fall to 0, which would weld the
    // producer's brake knee shut and read it as idle for the wrong reason.
    const producer = world.buildings.find((building) => {
      const definition = BUILDING_TYPES[building.buildingType];
      const owner = world.systems.find((candidate) => candidate.id === building.systemId);
      return building.count > 0 && definition?.resource !== undefined && owner?.control === "developed";
    })!;
    const definition = BUILDING_TYPES[producer.buildingType];
    if (definition?.outputGood === undefined) throw new Error("expected an extractor fixture");
    const goodId = definition.outputGood;

    const baseline = getSystemIndustry(producer.systemId);
    if (baseline.visibility !== "visible") throw new Error("expected visible industry");
    const baselineBuilding = baseline.buildings.find((b) => b.buildingType === producer.buildingType)!;

    const stripped: World = {
      ...world,
      markets: world.markets.map((market) =>
        market.systemId === producer.systemId && market.goodId === goodId
          ? { ...market, honestUseRate: undefined }
          : market,
      ),
    };
    setWorld(stripped);
    const strippedData = getSystemIndustry(producer.systemId);
    if (strippedData.visibility !== "visible") throw new Error("expected visible industry");
    const strippedBuilding = strippedData.buildings.find((b) => b.buildingType === producer.buildingType)!;

    expect(strippedBuilding.used).toBeCloseTo(baselineBuilding.used, 9);
    expect(strippedBuilding.idleReason).toBe(baselineBuilding.idleReason);
  });

  it('throws ServiceError("not_found") for an unknown system', () => {
    expect(() => getSystemIndustry("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemIndustry("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ kind: "not_found" });
    }
  });
});
