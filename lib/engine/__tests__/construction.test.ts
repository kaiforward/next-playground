import { describe, it, expect } from "vitest";
import { fundQueue, factionThroughputPool, proposalRoi, orderProposals } from "@/lib/engine/construction";
import type { Proposal } from "@/lib/engine/directed-build";
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
  return { kind: "build", id, factionId: "f1", systemId: "s1", buildingType, levels, workTotal, workDone };
}

describe("factionThroughputPool", () => {
  it("sums pop × rate over economically-active (developed) systems only", () => {
    const systems = [
      { control: "developed" as const, population: 100 },
      { control: "controlled" as const, population: 50 },   // inert
      { control: "unclaimed" as const, population: 0 },      // inert
      { control: "developed" as const, population: 200 },
    ];
    expect(factionThroughputPool(systems, 0.05)).toBeCloseTo((100 + 200) * 0.05);
  });

  it("floors negative population at zero", () => {
    expect(factionThroughputPool([{ control: "developed" as const, population: -10 }], 0.05)).toBe(0);
  });
});

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
    expect(r.landed).toHaveLength(1);
    expect(r.landed[0].id).toBe("p");
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
    expect(r.landed).toHaveLength(1);
    expect(r.landed[0].id).toBe("p1");
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

/** Build a proposal with explicit value/work; `role` defaults to industry. */
function proposal(
  systemId: string,
  items: Array<{ buildingType: string; levels: number }>,
  value: number,
  work: number,
  role: "housing" | "industry" = "industry",
): Proposal {
  return { kind: "build", factionId: "f1", systemId, role, items, value, work };
}

describe("proposalRoi", () => {
  it("is value ÷ whole-bundle work", () => {
    expect(proposalRoi(proposal("s", [{ buildingType: "food", levels: 1 }], 20, 8))).toBeCloseTo(2.5, 6);
  });

  it("is 0 for zero-work or housing (value 0) proposals", () => {
    expect(proposalRoi(proposal("s", [{ buildingType: "food", levels: 1 }], 20, 0))).toBe(0);
    expect(proposalRoi(proposal("s", [{ buildingType: "housing", levels: 1 }], 0, 8, "housing"))).toBe(0);
  });
});

describe("orderProposals", () => {
  it("funds housing ahead of all industry (the proactive substrate leads regardless of ROI)", () => {
    const housing = proposal("s1", [{ buildingType: "housing", levels: 1 }], 0, 8, "housing");
    const richIndustry = proposal("s2", [{ buildingType: "food", levels: 1 }], 100, 4); // ROI 25 ≫ anything
    const ordered = orderProposals([richIndustry, housing]);
    expect(ordered[0]).toBe(housing);
    expect(ordered[1]).toBe(richIndustry);
  });

  it("orders industry by descending ROI (value ÷ work)", () => {
    const lo = proposal("s1", [{ buildingType: "food", levels: 1 }], 10, 20);   // ROI 0.5
    const hi = proposal("s2", [{ buildingType: "ore", levels: 1 }], 30, 20);    // ROI 1.5
    const mid = proposal("s3", [{ buildingType: "gas", levels: 1 }], 20, 20);   // ROI 1.0
    expect(orderProposals([lo, hi, mid]).map((p) => p.systemId)).toEqual(["s2", "s3", "s1"]);
  });

  it("keeps a bundled academy ahead of its production after ordering (gate-first preserved)", () => {
    // A high-work, low-value-looking bundle whose FIRST item is the academy: ordering must not split
    // it — the academy rides the production's bundle ROI and stays in front of the production.
    const gated = proposal("s1", [
      { buildingType: "vocational_school", levels: 1 },
      { buildingType: "electronics", levels: 1 },
    ], 12, 45);
    const other = proposal("s2", [{ buildingType: "food", levels: 1 }], 8, 12);
    const flat = orderProposals([other, gated]).flatMap((p) => p.items.map((i) => i.buildingType));
    expect(flat.indexOf("vocational_school")).toBeLessThan(flat.indexOf("electronics"));
  });

  it("is deterministic under input reordering (stable total order via the systemId tiebreak)", () => {
    const a = proposal("s-a", [{ buildingType: "food", levels: 1 }], 20, 20); // ROI 1.0
    const b = proposal("s-b", [{ buildingType: "ore", levels: 1 }], 20, 20);  // ROI 1.0 (tie)
    const c = proposal("s-c", [{ buildingType: "gas", levels: 1 }], 40, 20);  // ROI 2.0
    const order1 = orderProposals([a, b, c]).map((p) => p.systemId);
    const order2 = orderProposals([c, b, a]).map((p) => p.systemId);
    expect(order1).toEqual(order2);
    expect(order1[0]).toBe("s-c"); // highest ROI first; a/b tie broken by systemId
  });

  it("does not mutate its input array", () => {
    const input = [
      proposal("s1", [{ buildingType: "food", levels: 1 }], 10, 20),
      proposal("s2", [{ buildingType: "ore", levels: 1 }], 30, 20),
    ];
    const snapshot = input.map((p) => p.systemId);
    orderProposals(input);
    expect(input.map((p) => p.systemId)).toEqual(snapshot);
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
