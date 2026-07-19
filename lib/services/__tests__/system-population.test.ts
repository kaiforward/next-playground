import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemPopulation } from "@/lib/services/system-population";
import { ServiceError } from "@/lib/services/errors";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import type { World, WorldSystem } from "@/lib/world/types";

let world: World;
let system: WorldSystem;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 15 });
  system = [...world.systems].sort((a, b) => b.population - a.population)[0];
  expect(system.population).toBeGreaterThan(0);
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getSystemPopulation", () => {
  it("returns the population snapshot with a pressure-sorted needs ledger", () => {
    const data = getSystemPopulation(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    expect(data.population).toBe(system.population);
    expect(data.popCap).toBe(system.popCap);
    expect(data.unrest).toBeGreaterThanOrEqual(0);
    expect(data.unrest).toBeLessThanOrEqual(1);
    expect(data.striking).toBe(data.unrest >= STRIKE_PARAMS.threshold);

    // Full needs ledger — mid-pack goods like consumer_goods included.
    expect(data.needs.length).toBeGreaterThan(6);
    expect(data.needs.some((n) => n.goodId === "consumer_goods")).toBe(true);
    for (let i = 1; i < data.needs.length; i++) {
      expect(data.needs[i - 1].pressure).toBeGreaterThanOrEqual(data.needs[i].pressure);
    }
    for (const n of data.needs) {
      expect(n.satisfaction).toBeGreaterThanOrEqual(0);
      expect(n.satisfaction).toBeLessThanOrEqual(1);
      expect(n.delivered).toBeCloseTo(n.want * n.satisfaction, 6);
      // Each entry carries its consumption breakdown; unfloored, so the terms
      // always sum to `want` exactly (unlike the old MIN_DEMAND-floored footprint).
      expect(n.breakdown.base + n.breakdown.technicians + n.breakdown.engineers).toBeCloseTo(n.want, 6);
    }
    // goodName resolves the real display name via the GOODS lookup.
    const water = data.needs.find((n) => n.goodId === "water");
    expect(water?.goodName).toBe("Water");
  });

  it("reflects skilled work in the demand breakdown", () => {
    // Give the system technician jobs (metals is skill1-gated) plus the licence
    // to work them (vocational_school): the service's building-derived basis must
    // surface a technician term for a skill1-basket good.
    const withoutTarget = world.buildings.filter(
      (b) => !(b.systemId === system.id && (b.buildingType === "metals" || b.buildingType === "vocational_school")),
    );
    setWorld({
      ...world,
      buildings: [
        ...withoutTarget,
        { systemId: system.id, buildingType: "metals", count: 3, idleMonths: 0 },
        { systemId: system.id, buildingType: "vocational_school", count: 1, idleMonths: 0 },
      ],
    });

    const data = getSystemPopulation(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");
    const consumerGoods = data.needs.find((n) => n.goodId === "consumer_goods")!;
    expect(consumerGoods.breakdown.technicians).toBeGreaterThan(0);
  });

  it("throws ServiceError(404) for an unknown system", () => {
    expect(() => getSystemPopulation("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemPopulation("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});
