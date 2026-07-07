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
  it("returns the population snapshot with a demand-sorted consumption footprint", () => {
    const data = getSystemPopulation(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    expect(data.population).toBe(system.population);
    expect(data.popCap).toBe(system.popCap);
    expect(data.unrest).toBeGreaterThanOrEqual(0);
    expect(data.unrest).toBeLessThanOrEqual(1);
    expect(data.striking).toBe(data.unrest >= STRIKE_PARAMS.threshold);

    // Full consumption footprint — mid-pack goods like consumer_goods included.
    expect(data.demand.length).toBeGreaterThan(6);
    expect(data.demand.some((d) => d.goodId === "consumer_goods")).toBe(true);
    expect(data.demand[0].demandRate).toBeGreaterThanOrEqual(data.demand[1].demandRate);
    // goodName resolves the real display name via the GOODS lookup. Water/food
    // (highest per-capita) lead the footprint.
    expect(["Water", "Food"]).toContain(data.demand[0].goodName);
    // Each entry carries its consumption breakdown; for the top good (well above
    // the MIN_DEMAND floor) the terms sum to the demandRate exactly.
    const top = data.demand[0];
    expect(top.breakdown.base).toBeGreaterThan(0);
    expect(top.breakdown.base + top.breakdown.technicians + top.breakdown.engineers).toBeCloseTo(top.demandRate, 6);
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
        { systemId: system.id, buildingType: "metals", count: 3 },
        { systemId: system.id, buildingType: "vocational_school", count: 1 },
      ],
    });

    const data = getSystemPopulation(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");
    const consumerGoods = data.demand.find((d) => d.goodId === "consumer_goods")!;
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
