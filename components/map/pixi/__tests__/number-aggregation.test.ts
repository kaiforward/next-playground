import { describe, it, expect } from "vitest";
import {
  aggregateValue, buildAggregationGroups, pickTier, DEFAULT_TIER_THRESHOLDS,
} from "@/components/map/pixi/number-aggregation";
import type { AtlasSystem } from "@/lib/types/game";

const sys = (id: string, x: number, y: number, factionId: string | null, regionId: string): AtlasSystem => ({
  id, x, y, regionId, factionId, economyType: "agricultural", isGateway: false, developed: true, sunClass: "yellow",
});

describe("buildAggregationGroups", () => {
  const systems = [
    sys("a", 0, 0, "f1", "r1"), sys("b", 10, 0, "f1", "r1"),   // f1 in r1 (2)
    sys("c", 100, 0, "f1", "r2"),                               // f1 in r2 (1) → f1 spans 2 regions
    sys("d", 0, 100, "f2", "r1"),                               // f2 in r1
    sys("u", 50, 50, null, "r1"),                               // unclaimed
  ];
  const values = new Map([["a", 4], ["b", 6], ["c", 10], ["d", 2], ["u", 0]]);

  it("splits a multi-region faction into one faction-region group per region", () => {
    const g = buildAggregationGroups(systems, values, "population");
    const f1regions = g.factionRegion.filter((x) => x.key.startsWith("f1|"));
    expect(f1regions).toHaveLength(2);
  });
  it("population aggregates by SUM", () => {
    const g = buildAggregationGroups(systems, values, "population");
    const f1 = g.faction.find((x) => x.key === "f1")!;
    expect(f1.value).toBe(20); // 4 + 6 + 10
  });
  it("development aggregates by SUM (extensive — spreading into new systems adds, never dilutes)", () => {
    const g = buildAggregationGroups(systems, values, "development");
    const f1r1 = g.factionRegion.find((x) => x.key === "f1|r1")!;
    expect(f1r1.value).toBe(10); // 4 + 6
    const f1 = g.faction.find((x) => x.key === "f1")!;
    expect(f1.value).toBe(20); // 4 + 6 + 10
  });
  it("stability aggregates by a POPULATION-WEIGHTED mean (a big-pop capital dominates a tiny outpost)", () => {
    const pair = [sys("a", 0, 0, "f1", "r1"), sys("b", 10, 0, "f1", "r1")];
    const stability = new Map([["a", 0.9], ["b", 0.3]]);
    const population = new Map([["a", 1000], ["b", 10]]);
    const g = buildAggregationGroups(pair, stability, "stability", population);
    const f1 = g.faction.find((x) => x.key === "f1")!;
    // (0.9·1000 + 0.3·10) / 1010 = 903/1010 ≈ 0.894 — far above the plain mean 0.6
    expect(f1.value).toBeCloseTo(903 / 1010, 10);
    expect(f1.value).toBeGreaterThan(0.85);
  });
  it("stability without weights degrades to a plain mean (safe fallback)", () => {
    const pair = [sys("a", 0, 0, "f1", "r1"), sys("b", 10, 0, "f1", "r1")];
    const stability = new Map([["a", 0.2], ["b", 0.8]]);
    const g = buildAggregationGroups(pair, stability, "stability");
    const f1 = g.faction.find((x) => x.key === "f1")!;
    expect(f1.value).toBeCloseTo(0.5, 10);
  });
  it("unclaimed (null faction) systems form no faction/faction-region group", () => {
    const g = buildAggregationGroups(systems, values, "population");
    expect(g.faction.some((x) => x.key === "null")).toBe(false);
    expect(g.factionRegion.some((x) => x.key.startsWith("null"))).toBe(false);
    expect(g.system).toHaveLength(5); // system tier still includes the unclaimed cell
  });
  it("group centroid is the mean of member positions", () => {
    const g = buildAggregationGroups(systems, values, "population");
    const f1r1 = g.factionRegion.find((x) => x.key === "f1|r1")!;
    expect(f1r1.cx).toBe(5); // (0 + 10) / 2
    expect(f1r1.cy).toBe(0);
  });

  it("aggregates only over members that have a value (an absent member is skipped, not counted as 0)", () => {
    const pair = [sys("a", 0, 0, "f1", "r1"), sys("b", 10, 0, "f1", "r1")];
    const present = new Map([["a", 0.8]]); // b is undeveloped → absent from the value map
    const population = new Map([["a", 100], ["b", 100]]);
    const g = buildAggregationGroups(pair, present, "stability", population);
    const f1 = g.faction.find((x) => x.key === "f1")!;
    expect(f1.value).toBe(0.8); // weighted mean of {0.8}, NOT (0.8 + 0) / 2 = 0.4
  });
});

describe("aggregateValue", () => {
  it("sums the extensive modes (population, development); weights are ignored there", () => {
    expect(aggregateValue([4, 6, 10], [], "population")).toBe(20);
    expect(aggregateValue([4, 6, 10], [], "development")).toBe(20);
  });
  it("population-weights the stability mode", () => {
    // (0.2·10 + 0.8·30) / 40 = 26/40
    expect(aggregateValue([0.2, 0.8], [10, 30], "stability")).toBeCloseTo(26 / 40, 10);
  });
  it("population-weights the migration mode (intensive — an attraction rate, like stability)", () => {
    expect(aggregateValue([0.2, 0.8], [10, 30], "migration")).toBeCloseTo(26 / 40, 10);
  });
  it("returns 0 for an empty group (no divide-by-zero)", () => {
    expect(aggregateValue([], [], "population")).toBe(0);
    expect(aggregateValue([], [], "development")).toBe(0);
    expect(aggregateValue([], [], "stability")).toBe(0);
    expect(aggregateValue([], [], "migration")).toBe(0);
  });
});

describe("pickTier", () => {
  it("zooms from faction → faction-region → system as zoom rises", () => {
    const t = DEFAULT_TIER_THRESHOLDS;
    expect(pickTier(t.factionToRegion - 0.01, t)).toBe("faction");
    expect(pickTier(t.factionToRegion, t)).toBe("faction-region");
    expect(pickTier(t.regionToSystem, t)).toBe("system");
  });
});
