import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemPopulation } from "@/lib/services/system-population";
import { ServiceError } from "@/lib/services/errors";
import { STRIKE_PARAMS, EXPECTATION_PARAMS } from "@/lib/constants/population";
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
        { systemId: system.id, buildingType: "metals", count: 3, idleCycles: 0 },
        { systemId: system.id, buildingType: "vocational_school", count: 1, idleCycles: 0 },
      ],
    });

    const data = getSystemPopulation(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");
    const consumerGoods = data.needs.find((n) => n.goodId === "consumer_goods")!;
    expect(consumerGoods.breakdown.technicians).toBeGreaterThan(0);
  });

  it("splits every need's want into its base and skilled-basket terms", () => {
    const data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible population");
    expect(data.needs.length).toBeGreaterThan(0);
    for (const need of data.needs) {
      expect(need.want, need.goodId).toBeCloseTo(
        need.breakdown.base + need.breakdown.technicians + need.breakdown.engineers,
        10,
      );
    }
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

describe("getSystemPopulation — provision read", () => {
  function withFields(overrides: Partial<WorldSystem>) {
    setWorld({
      ...world,
      systems: world.systems.map((s) => (s.id === system.id ? { ...s, ...overrides } : s)),
    });
  }

  it("renders the unassessed arm — never a fabricated 0% — for a system that has never run an economy cycle, and for a partially-written one", () => {
    // Fresh world-gen: neither field has ever been written.
    expect(system.provision).toBeUndefined();
    expect(system.supplyBand).toBeUndefined();
    let data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.provision).toEqual({ assessed: false });

    // provision without a band — a partial write, not a real assessment.
    withFields({ provision: 0.8, supplyBand: undefined });
    data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.provision).toEqual({ assessed: false });

    // band without provision — same partial-write guard, the other way round.
    withFields({ provision: undefined, supplyBand: "shortage" });
    data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.provision).toEqual({ assessed: false });
  });

  it("seeds the remembered level from current Provisioned when the stored expectation is absent or out of range, rather than reading it as perfect memory", () => {
    const expectedEffective = Math.max(0.72, EXPECTATION_PARAMS.floor) * 100;

    withFields({ provision: 0.72, supplyBand: "supplied", provisionExpectation: undefined });
    let data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    if (!data.provision.assessed) throw new Error("expected assessed");
    expect(data.provision.expectationPct).toBeCloseTo(expectedEffective, 6);

    withFields({ provision: 0.72, supplyBand: "supplied", provisionExpectation: 5 });
    data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    if (!data.provision.assessed) throw new Error("expected assessed");
    expect(data.provision.expectationPct).toBeCloseTo(expectedEffective, 6);
  });

  it("reports zero grievance whenever delivery meets or exceeds the remembered level, at any absolute level", () => {
    // Low absolute level, right at the read-side floor.
    withFields({ provision: 0.75, supplyBand: "supplied", provisionExpectation: 0.55 });
    let data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    if (!data.provision.assessed) throw new Error("expected assessed");
    expect(data.provision.grievance).toBe(0);

    // High absolute level, delivery exactly matches memory.
    withFields({ provision: 0.95, supplyBand: "supplied", provisionExpectation: 0.95 });
    data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    if (!data.provision.assessed) throw new Error("expected assessed");
    expect(data.provision.grievance).toBe(0);
  });

  it("reports band Shortage while Provisioned reads high — the famine punch-through is never re-derived from the percentage", () => {
    withFields({ provision: 0.92, supplyBand: "shortage", provisionExpectation: 0.9 });
    const data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    if (!data.provision.assessed) throw new Error("expected assessed");
    expect(data.provision.band).toBe("shortage");
    expect(data.provision.pct).toBeCloseTo(92, 6);
  });
});
