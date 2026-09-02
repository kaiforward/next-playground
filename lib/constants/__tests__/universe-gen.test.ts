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
    expectWithinPercent(config.TOTAL_SYSTEMS, 600, 5);
    expectWithinPercent(config.MAP_SIZE, 7000, 5);
    expectWithinPercent(config.MAP_PADDING, 0.1, 5);
    expectWithinPercent(config.POISSON_MIN_DISTANCE, 117, 5);
    expectWithinPercent(config.POISSON_K_CANDIDATES, 30, 5);
    expect(config.LANE_PRUNE_FRACTION).toBe(0);
    expectWithinPercent(config.CROSSING_FUEL_MULTIPLIER, 2.5, 5);
    expectWithinPercent(config.INTRA_REGION_BASE_FUEL, 8, 5);
    expectWithinPercent(config.MINOR_FACTION_COUNT, 12, 5);
    expectWithinPercent(config.CLUSTER_COUNT, 24, 5);
    expectWithinPercent(config.CLUSTER_SPACING, 800, 5);
  });

  it('matches today\'s SCALE_OVERRIDES["10k"] within 5% at the 10,000-system anchor', () => {
    const config = genConfigForSystemCount(10_000);

    expectWithinPercent(config.TOTAL_SYSTEMS, 10_000, 5);
    expectWithinPercent(config.MAP_SIZE, 25_000, 5);
    expectWithinPercent(config.MINOR_FACTION_COUNT, 18, 5);
    expectWithinPercent(config.CLUSTER_COUNT, 60, 5);
    expectWithinPercent(config.CLUSTER_SPACING, 2_500, 5);
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

  it("grows CLUSTER_COUNT, CLUSTER_SPACING, and MINOR_FACTION_COUNT monotonically with system count", () => {
    const counts = [50, 600, 5_000, 10_000, 20_000];
    const clusterCounts = counts.map((count) => genConfigForSystemCount(count).CLUSTER_COUNT);
    const clusterSpacings = counts.map(
      (count) => genConfigForSystemCount(count).CLUSTER_SPACING
    );
    const minorFactionCounts = counts.map(
      (count) => genConfigForSystemCount(count).MINOR_FACTION_COUNT
    );

    for (let i = 1; i < counts.length; i++) {
      expect(clusterCounts[i]).toBeGreaterThanOrEqual(clusterCounts[i - 1]);
      expect(clusterSpacings[i]).toBeGreaterThanOrEqual(clusterSpacings[i - 1]);
      expect(minorFactionCounts[i]).toBeGreaterThanOrEqual(minorFactionCounts[i - 1]);
    }
  });

  it("keeps knobs not overridden by the 10k preset constant at BASE_CONFIG values", () => {
    for (const count of [50, 600, 4_242, 10_000, 20_000]) {
      const config = genConfigForSystemCount(count);
      expect(config.SEED).toBe(42);
      expect(config.MAP_PADDING).toBe(0.1);
      expect(config.POISSON_MIN_DISTANCE).toBe(117);
      expect(config.POISSON_K_CANDIDATES).toBe(30);
      expect(config.LANE_PRUNE_FRACTION).toBe(0);
      expect(config.CROSSING_FUEL_MULTIPLIER).toBe(2.5);
      expect(config.INTRA_REGION_BASE_FUEL).toBe(8);
      expect(config.CLUSTER_SIZE_SKEW).toBe(0.6);
      expect(config.VOID_FLOOR).toBe(0.08);
      expect(config.CORRIDORS_PER_CLUSTER).toBe(0.3);
      expect(config.CORRIDOR_STYLE_MIX).toBe(0.5);
    }
  });

  it("returns integer values for every integer-typed knob", () => {
    for (const count of [50, 733, 10_000, 19_999]) {
      const config = genConfigForSystemCount(count);
      expect(Number.isInteger(config.MAP_SIZE)).toBe(true);
      expect(Number.isInteger(config.CLUSTER_COUNT)).toBe(true);
      expect(Number.isInteger(config.CLUSTER_SPACING)).toBe(true);
      expect(Number.isInteger(config.MINOR_FACTION_COUNT)).toBe(true);
      expect(Number.isInteger(config.TOTAL_SYSTEMS)).toBe(true);
    }
  });
});
