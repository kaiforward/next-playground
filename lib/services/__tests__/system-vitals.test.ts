import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemVitals } from "@/lib/services/system-vitals";
import { ServiceError } from "@/lib/services/errors";
import { EXPECTATION_PARAMS } from "@/lib/constants/population";
import type { World, WorldSystem } from "@/lib/world/types";

let world: World;
let system: WorldSystem;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 15 });
  system = [...world.systems].sort((a, b) => b.population - a.population)[0];
  expect(system.population).toBeGreaterThan(0);
  expect(system.control).toBe("developed");
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getSystemVitals", () => {
  it("assembles stability, development, and population from the system row", () => {
    const data = getSystemVitals(system.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");

    expect(data.stability.unrest).toBe(system.unrest);
    expect(data.stability.pct).toBeCloseTo((1 - system.unrest) * 100, 6);
    expect(data.stability.pct).toBeGreaterThanOrEqual(0);
    expect(data.stability.pct).toBeLessThanOrEqual(100);

    expect(data.development.points).toBeGreaterThan(0);
    expect(data.development.potential).toBeGreaterThan(0);
    expect(data.development.pct).toBeGreaterThanOrEqual(0);
    expect(data.development.pct).toBeLessThanOrEqual(100);

    expect(data.population.headcount).toBe(system.population);
    const { unskilled, technicians, engineers, unemployed } = data.population.composition;
    expect(unskilled + technicians + engineers + unemployed).toBeCloseTo(Math.max(0, system.population), 6);
  });

  it("development pct is 0, not NaN/Infinity, when potential is 0", () => {
    setWorld({
      ...world,
      systems: world.systems.map((s) =>
        s.id === system.id
          ? {
              ...s,
              habitableSpace: 0,
              generalSpace: 0,
              slotGas: 0,
              slotMinerals: 0,
              slotOre: 0,
              slotBiomass: 0,
              slotArable: 0,
              slotWater: 0,
              slotRadioactive: 0,
            }
          : s,
      ),
    });
    const data = getSystemVitals(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    // Buildings + population still score developmentPoints > 0, but a zero-substrate
    // potential must short-circuit pct to 0, not divide-by-zero into Infinity/NaN.
    expect(data.development.points).toBeGreaterThan(0);
    expect(data.development.potential).toBe(0);
    expect(data.development.pct).toBe(0);
  });

  it("pins development pct at exactly 100 when points exceed a small (>0) potential", () => {
    // Tiny habitable land (small but non-zero potential) + a large population (dev-points well
    // above that potential): the ratio clears 1, so clamp(points/potential, 0, 1) must engage and
    // pin pct at 100 — this is the property that keeps pct ≤ 100 when current dev-points exceed the
    // base-heads-only potential.
    setWorld({
      ...world,
      systems: world.systems.map((s) =>
        s.id === system.id
          ? {
              ...s,
              population: 100_000,
              habitableSpace: 1,
              generalSpace: 0,
              slotGas: 0,
              slotMinerals: 0,
              slotOre: 0,
              slotBiomass: 0,
              slotArable: 0,
              slotWater: 0,
              slotRadioactive: 0,
            }
          : s,
      ),
    });
    const data = getSystemVitals(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.development.potential).toBeGreaterThan(0);
    expect(data.development.points).toBeGreaterThan(data.development.potential);
    expect(data.development.pct).toBe(100);
  });

  // Visibility gating on non-developed control is covered once, cross-service, in
  // developed-gate-services.test.ts — not duplicated here.

  it("throws ServiceError(404) for an unknown system", () => {
    expect(() => getSystemVitals("does-not-exist")).toThrow(ServiceError);
    try {
      getSystemVitals("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });
});

describe("getSystemVitals — provision read", () => {
  function withFields(overrides: Partial<WorldSystem>) {
    setWorld({
      ...world,
      systems: world.systems.map((s) => (s.id === system.id ? { ...s, ...overrides } : s)),
    });
  }

  it("renders the unassessed arm — never a fabricated 0% — for a system that has never run an economy cycle, and for a partially-written one", () => {
    expect(system.provision).toBeUndefined();
    expect(system.supplyBand).toBeUndefined();
    let data = getSystemVitals(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.provision).toEqual({ assessed: false });

    withFields({ provision: 0.8, supplyBand: undefined });
    data = getSystemVitals(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.provision).toEqual({ assessed: false });

    withFields({ provision: undefined, supplyBand: "famine" });
    data = getSystemVitals(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.provision).toEqual({ assessed: false });
  });

  it("seeds the remembered level from current Provisioned when the stored expectation is absent or out of range, rather than reading it as perfect memory", () => {
    const expectedEffective = Math.max(0.72, EXPECTATION_PARAMS.floor) * 100;

    withFields({ provision: 0.72, supplyBand: "supplied", provisionExpectation: undefined });
    let data = getSystemVitals(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    if (!data.provision.assessed) throw new Error("expected assessed");
    expect(data.provision.expectationPct).toBeCloseTo(expectedEffective, 6);

    withFields({ provision: 0.72, supplyBand: "supplied", provisionExpectation: 5 });
    data = getSystemVitals(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    if (!data.provision.assessed) throw new Error("expected assessed");
    expect(data.provision.expectationPct).toBeCloseTo(expectedEffective, 6);
  });

  it("carries Provisioned, its band and the remembered level and nothing else — grievance stays server-side", () => {
    // The vitals tiles print the reading; grievance is an input to the unrest floor, resolved on the
    // server (`ResolvedProvision`) and never serialised. An exact-shape assertion, so a field added
    // back to the wire read fails here rather than shipping unread.
    withFields({ provision: 0.75, supplyBand: "supplied", provisionExpectation: 0.55 });
    const data = getSystemVitals(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.provision).toEqual({
      assessed: true,
      pct: 75,
      band: "supplied",
      expectationPct: Math.max(0.55, EXPECTATION_PARAMS.floor) * 100,
    });
  });

  it("reports band Famine while Provisioned reads high — the famine punch-through is never re-derived from the percentage", () => {
    withFields({ provision: 0.92, supplyBand: "famine", provisionExpectation: 0.9 });
    const data = getSystemVitals(system.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    if (!data.provision.assessed) throw new Error("expected assessed");
    expect(data.provision.band).toBe("famine");
    expect(data.provision.pct).toBeCloseTo(92, 6);
  });
});
