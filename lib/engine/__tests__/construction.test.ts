import { describe, it, expect } from "vitest";
import { fundQueue } from "@/lib/engine/construction";
import { workCostPerLevel, CONSTRUCTION } from "@/lib/constants/construction";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type { WorldConstructionProject } from "@/lib/world/types";

/** Build an open project; workTotal defaults to `levels × workCostPerLevel(type)`. */
function project(
  id: string,
  buildingType: string,
  levels: number,
  workDone = 0,
  workTotal = levels * workCostPerLevel(buildingType),
): WorldConstructionProject {
  return { id, factionId: "f1", systemId: "s1", buildingType, levels, workTotal, workDone };
}

describe("fundQueue", () => {
  it("advances a single build by min(cap, remaining, pool) each pulse — duration emerges as work ÷ cap", () => {
    const cap = 10;
    // workTotal = 8 × cap, pool = cap → the build absorbs exactly `cap` per pulse and lands on pulse 8.
    let projects = [project("p", HOUSING_TYPE, 1, 0, 8 * cap)];
    let landedPulse = 0;
    for (let pulse = 1; pulse <= 8; pulse++) {
      const r = fundQueue(projects, cap, cap);
      projects = r.projects;
      if (r.landed.length > 0) {
        landedPulse = pulse;
        break;
      }
    }
    expect(landedPulse).toBe(8);
  });

  it("does not land before the work is complete", () => {
    const cap = 10;
    const r = fundQueue([project("p", HOUSING_TYPE, 1, 0, 3 * cap)], cap, cap);
    expect(r.landed).toHaveLength(0);
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0].workDone).toBe(cap);
  });

  it("lands a project's whole levels at workDone ≥ workTotal and removes it from the open set", () => {
    const cap = 10;
    // One pulse from completion: remaining work = 5 ≤ cap → lands this pulse.
    const r = fundQueue([project("p", HOUSING_TYPE, 3, 25, 30)], cap, cap);
    expect(r.projects).toHaveLength(0);
    expect(r.landed).toEqual([{ systemId: "s1", buildingType: HOUSING_TYPE, levels: 3 }]);
  });

  it("spreads the pool across parallel fronts ≈ pool ÷ cap (front-first)", () => {
    const cap = 10;
    // pool = 4 × cap, five big builds → the first four each absorb `cap`, the fifth gets nothing.
    const big = (id: string) => project(id, HOUSING_TYPE, 1, 0, 100 * cap);
    const r = fundQueue([big("a"), big("b"), big("c"), big("d"), big("e")], 4 * cap, cap);
    expect(r.projects.map((p) => p.workDone)).toEqual([cap, cap, cap, cap, 0]);
  });

  it("cascades leftover from a near-complete front to the next build in one pulse", () => {
    const cap = 10;
    // First build needs only 3 more (< cap): it takes 3, the remaining 7 of its cap-share… no — cap is
    // per-build, so leftover POOL (not cap) cascades. pool = 12: p1 takes min(cap,3,12)=3 → lands;
    // p2 takes min(cap,remaining,9)=9.
    const r = fundQueue(
      [project("p1", HOUSING_TYPE, 1, 27, 30), project("p2", HOUSING_TYPE, 1, 0, 100)],
      12,
      cap,
    );
    expect(r.landed).toEqual([{ systemId: "s1", buildingType: HOUSING_TYPE, levels: 1 }]);
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0].id).toBe("p2");
    expect(r.projects[0].workDone).toBe(9);
  });

  it("with zero pool lands nothing and leaves projects unchanged", () => {
    const p = project("p", HOUSING_TYPE, 2, 5, 40);
    const r = fundQueue([p], 0, 10);
    expect(r.landed).toHaveLength(0);
    expect(r.projects).toEqual([p]);
  });

  it("never overshoots workTotal or produces NaN/Infinity", () => {
    const r = fundQueue([project("p", HOUSING_TYPE, 1, 0, 30)], 1000, 1000);
    expect(r.landed).toHaveLength(1); // cap ≥ workTotal → lands immediately
    // A landed project is removed, so assert the invariant on the funding of a still-open one.
    const r2 = fundQueue([project("q", HOUSING_TYPE, 1, 0, 1e9)], 1000, 1000);
    expect(Number.isFinite(r2.projects[0].workDone)).toBe(true);
    expect(r2.projects[0].workDone).toBeLessThanOrEqual(r2.projects[0].workTotal);
  });
});

describe("construction constants", () => {
  it("prices a housing level below a specialisation-complex level (coarse ordering)", () => {
    expect(workCostPerLevel(HOUSING_TYPE)).toBeLessThan(workCostPerLevel("heavy_industry_complex"));
  });

  it("exposes a positive throughput-per-pop and per-build absorption cap", () => {
    expect(CONSTRUCTION.THROUGHPUT_PER_POP).toBeGreaterThan(0);
    expect(CONSTRUCTION.PER_BUILD_ABSORPTION_CAP).toBeGreaterThan(0);
  });
});
