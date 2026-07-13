import { describe, it, expect } from "vitest";
import {
  buildAggregationGroups, pickTier, DEFAULT_TIER_THRESHOLDS,
} from "@/components/map/pixi/number-aggregation";
import type { AtlasSystem } from "@/lib/types/game";

const sys = (id: string, x: number, y: number, factionId: string | null, regionId: string): AtlasSystem => ({
  id, x, y, regionId, factionId, economyType: "agricultural", isGateway: false, developed: true,
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
  it("development aggregates by AVERAGE", () => {
    const g = buildAggregationGroups(systems, values, "development");
    const f1r1 = g.factionRegion.find((x) => x.key === "f1|r1")!;
    expect(f1r1.value).toBe(5); // (4 + 6) / 2
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
});

describe("pickTier", () => {
  it("zooms from faction → faction-region → system as zoom rises", () => {
    const t = DEFAULT_TIER_THRESHOLDS;
    expect(pickTier(t.factionToRegion - 0.01, t)).toBe("faction");
    expect(pickTier(t.factionToRegion, t)).toBe("faction-region");
    expect(pickTier(t.regionToSystem, t)).toBe("system");
  });
});
