import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemVitals } from "@/lib/services/system-vitals";
import { ServiceError } from "@/lib/services/errors";
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
