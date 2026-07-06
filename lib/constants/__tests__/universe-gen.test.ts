import { describe, it, expect } from "vitest";
import { genConfigForSystemCount } from "@/lib/constants/universe-gen";

function expectWithinPercent(actual: number, expected: number, percent: number): void {
  const tolerance = Math.abs(expected) * (percent / 100);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

describe("genConfigForSystemCount", () => {
  it("matches today's BASE_CONFIG within 5% at the 600-system anchor", () => {
    const config = genConfigForSystemCount(600);

    expectWithinPercent(config.SEED, 42, 5);
    expectWithinPercent(config.REGION_COUNT, 24, 5);
    expectWithinPercent(config.TOTAL_SYSTEMS, 600, 5);
    expectWithinPercent(config.MAP_SIZE, 7000, 5);
    expectWithinPercent(config.MAP_PADDING, 0.1, 5);
    expectWithinPercent(config.POISSON_MIN_DISTANCE, 180, 5);
    expectWithinPercent(config.POISSON_K_CANDIDATES, 30, 5);
    expectWithinPercent(config.REGION_MIN_DISTANCE, 800, 5);
    expectWithinPercent(config.INTRA_REGION_EXTRA_EDGES, 0.5, 5);
    expectWithinPercent(config.GATEWAY_FUEL_MULTIPLIER, 2.5, 5);
    expectWithinPercent(config.GATEWAYS_PER_BORDER, 3, 5);
    expectWithinPercent(config.INTRA_REGION_BASE_FUEL, 8, 5);
    expectWithinPercent(config.MAX_PLACEMENT_ATTEMPTS, 500, 5);
    expectWithinPercent(config.MINOR_FACTION_COUNT, 12, 5);
  });

  it('matches today\'s SCALE_OVERRIDES["10k"] within 5% at the 10,000-system anchor', () => {
    const config = genConfigForSystemCount(10_000);

    expectWithinPercent(config.TOTAL_SYSTEMS, 10_000, 5);
    expectWithinPercent(config.MAP_SIZE, 25_000, 5);
    expectWithinPercent(config.REGION_COUNT, 60, 5);
    expectWithinPercent(config.REGION_MIN_DISTANCE, 2_500, 5);
    expectWithinPercent(config.MINOR_FACTION_COUNT, 18, 5);
  });

  it("sets TOTAL_SYSTEMS to exactly the requested system count", () => {
    expect(genConfigForSystemCount(50).TOTAL_SYSTEMS).toBe(50);
    expect(genConfigForSystemCount(3_333).TOTAL_SYSTEMS).toBe(3_333);
    expect(genConfigForSystemCount(20_000).TOTAL_SYSTEMS).toBe(20_000);
  });

  it("grows MAP_SIZE monotonically with system count", () => {
    const counts = [50, 300, 600, 1_500, 3_000, 6_000, 10_000, 15_000, 20_000];
    const mapSizes = counts.map((count) => genConfigForSystemCount(count).MAP_SIZE);

    for (let i = 1; i < mapSizes.length; i++) {
      expect(mapSizes[i]).toBeGreaterThan(mapSizes[i - 1]);
    }
  });

  it("grows REGION_COUNT, REGION_MIN_DISTANCE, and MINOR_FACTION_COUNT monotonically with system count", () => {
    const counts = [50, 600, 5_000, 10_000, 20_000];
    const regionCounts = counts.map((count) => genConfigForSystemCount(count).REGION_COUNT);
    const regionMinDistances = counts.map(
      (count) => genConfigForSystemCount(count).REGION_MIN_DISTANCE
    );
    const minorFactionCounts = counts.map(
      (count) => genConfigForSystemCount(count).MINOR_FACTION_COUNT
    );

    for (let i = 1; i < counts.length; i++) {
      expect(regionCounts[i]).toBeGreaterThanOrEqual(regionCounts[i - 1]);
      expect(regionMinDistances[i]).toBeGreaterThanOrEqual(regionMinDistances[i - 1]);
      expect(minorFactionCounts[i]).toBeGreaterThanOrEqual(minorFactionCounts[i - 1]);
    }
  });

  it("keeps knobs not overridden by the 10k preset constant at BASE_CONFIG values", () => {
    for (const count of [50, 600, 4_242, 10_000, 20_000]) {
      const config = genConfigForSystemCount(count);
      expect(config.SEED).toBe(42);
      expect(config.MAP_PADDING).toBe(0.1);
      expect(config.POISSON_MIN_DISTANCE).toBe(180);
      expect(config.POISSON_K_CANDIDATES).toBe(30);
      expect(config.INTRA_REGION_EXTRA_EDGES).toBe(0.5);
      expect(config.GATEWAY_FUEL_MULTIPLIER).toBe(2.5);
      expect(config.GATEWAYS_PER_BORDER).toBe(3);
      expect(config.INTRA_REGION_BASE_FUEL).toBe(8);
      expect(config.MAX_PLACEMENT_ATTEMPTS).toBe(500);
    }
  });

  it("returns integer values for every integer-typed knob", () => {
    for (const count of [50, 733, 10_000, 19_999]) {
      const config = genConfigForSystemCount(count);
      expect(Number.isInteger(config.MAP_SIZE)).toBe(true);
      expect(Number.isInteger(config.REGION_COUNT)).toBe(true);
      expect(Number.isInteger(config.REGION_MIN_DISTANCE)).toBe(true);
      expect(Number.isInteger(config.MINOR_FACTION_COUNT)).toBe(true);
      expect(Number.isInteger(config.TOTAL_SYSTEMS)).toBe(true);
    }
  });
});
