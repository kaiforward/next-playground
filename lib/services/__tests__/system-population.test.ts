import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getSystemPopulation, resolveTaxPressure } from "@/lib/services/system-population";
import { resolveProvisionRead } from "@/lib/services/provision-read";
import { ServiceError } from "@/lib/services/errors";
import { STRIKE_PARAMS, EXPECTATION_PARAMS, UNREST_PARAMS, POPULATION_PARAMS, CROWDING } from "@/lib/constants/population";
import { TAX_LEVEL_UNREST_PRESSURE } from "@/lib/constants/treasury";
import { crowdingPressure } from "@/lib/engine/population";
import { stabilityLabel } from "@/lib/utils/stability";
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

  // `strikeMultiplier` (lib/engine/population.ts) suppresses production on `unrest > threshold`, so a
  // world sitting exactly on the threshold produces normally. The readout may not call it striking.
  it("calls a world striking only above the threshold, never at it — matching the engine", () => {
    system.unrest = STRIKE_PARAMS.threshold;
    const at = getSystemPopulation(system.id);
    if (at.visibility !== "visible") throw new Error("expected visible");
    expect(at.striking).toBe(false);
    expect(stabilityLabel(system.unrest)).not.toBe("Strike");

    system.unrest = STRIKE_PARAMS.threshold + 1e-9;
    const above = getSystemPopulation(system.id);
    if (above.visibility !== "visible") throw new Error("expected visible");
    expect(above.striking).toBe(true);
    expect(stabilityLabel(system.unrest)).toBe("Strike");
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
    withFields({ provision: undefined, supplyBand: "famine" });
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

  it("resolves zero grievance whenever delivery meets or exceeds the remembered level, at any absolute level", () => {
    // Grievance never reaches the client — it is an input to the unrest floor's goods term, so it
    // lives on the server-side `ResolvedProvision` and this reads the resolver the breakdown
    // consumes, not the payload.
    const resolved = (): ReturnType<typeof resolveProvisionRead> =>
      resolveProvisionRead(getWorld().systems.find((s) => s.id === system.id)!);

    // Low absolute level, right at the read-side floor.
    withFields({ provision: 0.75, supplyBand: "supplied", provisionExpectation: 0.55 });
    let read = resolved();
    if (!read.assessed) throw new Error("expected assessed");
    expect(read.grievance).toBe(0);

    // High absolute level, delivery exactly matches memory.
    withFields({ provision: 0.95, supplyBand: "supplied", provisionExpectation: 0.95 });
    read = resolved();
    if (!read.assessed) throw new Error("expected assessed");
    expect(read.grievance).toBe(0);
  });

  it("serialises Provisioned, its band and the remembered level only — grievance stops at the service", () => {
    // An exact-shape assertion: grievance is resolved for this very system (its expectation sits
    // above delivery, so it is non-zero) and still must not appear on the payload.
    withFields({ provision: 0.625, supplyBand: "strained", provisionExpectation: 0.875 });
    const resolved = resolveProvisionRead(getWorld().systems.find((s) => s.id === system.id)!);
    if (!resolved.assessed) throw new Error("expected assessed");
    expect(resolved.grievance).toBeGreaterThan(0);

    const data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.provision).toEqual({
      assessed: true,
      pct: 62.5,
      band: "strained",
      expectationPct: Math.max(0.875, EXPECTATION_PARAMS.floor) * 100,
    });
  });

  it("reports band Famine while Provisioned reads high — the famine punch-through is never re-derived from the percentage", () => {
    withFields({ provision: 0.92, supplyBand: "famine", provisionExpectation: 0.9 });
    const data = getSystemPopulation(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    if (!data.provision.assessed) throw new Error("expected assessed");
    expect(data.provision.band).toBe("famine");
    expect(data.provision.pct).toBeCloseTo(92, 6);
  });
});

describe("resolveTaxPressure — entry 2", () => {
  it("reads zero for a system with no owning faction, rather than falling back to a default tax level", () => {
    // A faction-owned system, so the treasury lookup would find a real (non-zero) entry if the
    // null-faction guard were missing — proves the zero comes from the guard, not from an absent
    // treasury.
    const owned = world.systems.find((s) => s.factionId !== null && s.control === "developed");
    if (!owned) throw new Error("expected a faction-owned developed system in the fixture");
    const ownerTreasury = world.treasuries.find((t) => t.factionId === owned.factionId);
    if (!ownerTreasury) throw new Error("expected a treasury for the owning faction");
    setWorld({
      ...world,
      treasuries: world.treasuries.map((t) =>
        t.factionId === owned.factionId ? { ...t, taxLevel: "very_high" } : t,
      ),
    });
    expect(TAX_LEVEL_UNREST_PRESSURE.very_high).toBeGreaterThan(0);

    const unowned: WorldSystem = { ...owned, factionId: null };
    expect(resolveTaxPressure(unowned, getWorld())).toBe(0);
  });

  it("reads the owning faction's TAX_LEVEL_UNREST_PRESSURE lookup for a system with a treasury", () => {
    const owned = world.systems.find((s) => s.factionId !== null);
    if (!owned) throw new Error("expected a faction-owned system in the fixture");
    setWorld({
      ...world,
      treasuries: world.treasuries.map((t) =>
        t.factionId === owned.factionId ? { ...t, taxLevel: "high" } : t,
      ),
    });
    expect(resolveTaxPressure(owned, getWorld())).toBe(TAX_LEVEL_UNREST_PRESSURE.high);
  });

  it("reads zero for a faction with no treasury entry, rather than throwing or defaulting", () => {
    const owned = world.systems.find((s) => s.factionId !== null);
    if (!owned) throw new Error("expected a faction-owned system in the fixture");
    setWorld({ ...world, treasuries: world.treasuries.filter((t) => t.factionId !== owned.factionId) });
    expect(resolveTaxPressure(owned, getWorld())).toBe(0);
  });
});

describe("getSystemPopulation — unrestBreakdown — entry 1, end to end", () => {
  it("reproduces the settled unrest the tick's own relaxation targets, including the persisted critical-good weight", () => {
    const owned = world.systems.find((s) => s.factionId !== null && s.control === "developed");
    if (!owned) throw new Error("expected a faction-owned developed system in the fixture");
    setWorld({
      ...world,
      systems: world.systems.map((s) =>
        s.id === owned.id
          ? {
              ...s,
              population: 800,
              popCap: 1000,
              unrest: 0.5,
              provision: 0.55,
              supplyBand: "rationing",
              provisionExpectation: undefined,
              criticalWeight: 0.4, // > 0, non-famine regime — exactly the case the reconstruction gap named.
            }
          : s,
      ),
      treasuries: world.treasuries.map((t) =>
        t.factionId === owned.factionId ? { ...t, taxLevel: "high" } : t,
      ),
    });

    const data = getSystemPopulation(owned.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    const breakdown = data.unrestBreakdown;
    if (!breakdown.assessed) throw new Error("expected an assessed unrest breakdown");

    // Independently computed expectation: readExpectation seeds from P itself when no
    // provisionExpectation is stored (0.55 already clears the 0.5 floor), so effective = 0.55 and
    // grievance = 0 — isolates the crisis term (criticalWeight) as the entire goods contributor.
    const d = 1 - 0.55;
    const expectedTax = TAX_LEVEL_UNREST_PRESSURE.high;
    const expectedCrowding = crowdingPressure(800, 1000, POPULATION_PARAMS.crowdBrakeEnd, CROWDING.PRESSURE_MAX);
    const span = UNREST_PARAMS.slopeShortage - UNREST_PARAMS.slopeBase;
    const expectedGoods = Math.min(UNREST_PARAMS.slopeShortage, UNREST_PARAMS.slopeBase + 0.4 * span) * d;

    expect(breakdown.contributors.goods).toBeCloseTo(expectedGoods, 9);
    expect(breakdown.contributors.tax).toBeCloseTo(expectedTax, 9);
    expect(breakdown.contributors.crowding).toBeCloseTo(expectedCrowding, 9);
    expect(breakdown.strikeThreshold).toBe(STRIKE_PARAMS.threshold);

    const settled = expectedGoods + expectedTax + expectedCrowding;
    expect(breakdown.trend).toBe(settled > 0.5 ? "rising" : "recovering");
  });

  it("caps the settled target at 1 and calls a maxed-out famine world stable, not forever rising", () => {
    // The fixture above lands at ~0.96 — under saturation, so the cap never binds there and a raw
    // sum would pass it. This is the case that separates them: slopeShortage (2.4) against a famine
    // shortfall puts the goods term alone past 1, while accumulateUnrest clamps unrest into [0,1].
    // A world already pinned at unrest 1 has nowhere further to climb, so summing the contributors
    // raw would report it rising forever — on precisely the worlds this panel exists to explain.
    const owned = world.systems.find((s) => s.factionId !== null && s.control === "developed");
    if (!owned) throw new Error("expected a faction-owned developed system in the fixture");
    setWorld({
      ...world,
      systems: world.systems.map((s) =>
        s.id === owned.id
          ? {
              ...s,
              population: 800,
              popCap: 1000,
              unrest: 1,
              provision: 0.2,
              supplyBand: "famine", // the biconditional: famine ⇒ survivalShortfall ⇒ slopeShortage × d
              provisionExpectation: undefined,
              criticalWeight: 0,
            }
          : s,
      ),
      treasuries: world.treasuries.map((t) =>
        t.factionId === owned.factionId ? { ...t, taxLevel: "high" } : t,
      ),
    });

    const data = getSystemPopulation(owned.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    const breakdown = data.unrestBreakdown;
    if (!breakdown.assessed) throw new Error("expected an assessed unrest breakdown");

    // The premise this test rests on: the raw sum really does exceed 1 here, so the cap is doing
    // work rather than being a no-op the fixture never reaches.
    const { goods, tax, crowding } = breakdown.contributors;
    expect(goods + tax + crowding).toBeGreaterThan(1);

    expect(breakdown.settled).toBe(1);
    expect(breakdown.trend).toBe("stable");
  });

  it("withholds the goods cause, the settled target and the trend on a system the economy has never assessed", () => {
    // The branch that fires for every colony before its first economy cycle — routine, not
    // defensive. Reporting goods 0 here would read identically to a genuinely well-fed world, and a
    // trend derived from tax and crowding alone would call the world calm on a third of the
    // evidence. Standing pressure IS knowable without an assessment, so it is still carried.
    const owned = world.systems.find((s) => s.factionId !== null && s.control === "developed");
    if (!owned) throw new Error("expected a faction-owned developed system in the fixture");
    setWorld({
      ...world,
      systems: world.systems.map((s) =>
        s.id === owned.id
          ? { ...s, population: 1150, popCap: 1000, provision: undefined, supplyBand: undefined, criticalWeight: undefined }
          : s,
      ),
      treasuries: world.treasuries.map((t) =>
        t.factionId === owned.factionId ? { ...t, taxLevel: "high" } : t,
      ),
    });

    const data = getSystemPopulation(owned.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    const breakdown = data.unrestBreakdown;
    expect(breakdown.assessed).toBe(false);
    if (breakdown.assessed) throw new Error("expected the unassessed arm");

    // Carried: both standing-pressure terms, and crowding is genuinely non-zero here (occupancy
    // 115%) so this pins that they are really computed rather than defaulted to nothing.
    expect(breakdown.contributors.tax).toBe(TAX_LEVEL_UNREST_PRESSURE.high);
    expect(breakdown.contributors.crowding).toBeGreaterThan(0);
    expect(breakdown.strikeThreshold).toBe(STRIKE_PARAMS.threshold);

    // Withheld: no goods cause, no settled target, no trend anywhere on the arm.
    expect("goods" in breakdown.contributors).toBe(false);
    expect("settled" in breakdown).toBe(false);
    expect("trend" in breakdown).toBe(false);
  });
});
