import { describe, it, expect } from "vitest";
import { fundQueue, fundQueueWithFloor, developmentFloorShare, factionConstructionPool, proposalRoi, orderProposals } from "@/lib/engine/construction";
import type { Proposal, ColonyProposal } from "@/lib/engine/directed-build";
import { workCostPerLevel, CONSTRUCTION } from "@/lib/constants/construction";
import { HOUSING_TYPE, CONSTRUCTION_CENTRE_TYPE, VOCATIONAL_SCHOOL_TYPE } from "@/lib/constants/industry";
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

describe("factionConstructionPool", () => {
  const rates = { throughputPerPop: 0.05, pointsPerLevel: 5 };

  it("counts every head at a system with no skilled employment (young economy unchanged)", () => {
    const systems = [
      { control: "developed" as const, population: 100, buildings: {} },
      { control: "controlled" as const, population: 50, buildings: {} },  // inert
      { control: "developed" as const, population: 200, buildings: {} },
    ];
    const pool = factionConstructionPool(systems, rates);
    expect(pool.base).toBeCloseTo((100 + 200) * 0.05);
    expect(pool.centres).toBe(0);
    expect(pool.total).toBeCloseTo(pool.base);
  });

  it("removes employed technicians/engineers from the base, but not licensed-but-jobless heads", () => {
    // metals: labour { unskilled: 18, skill1: 7 } (tier-1 default). One school licenses 150 skill-1 seats.
    // 2 metals factories demand 14 technician heads; the school itself draws 15 unskilled.
    const employed = {
      control: "developed" as const,
      population: 200,
      buildings: { metals: 2, [VOCATIONAL_SCHOOL_TYPE]: 1 },
    };
    // Same licences, no skilled jobs: graduates still swing hammers — full population counts.
    const jobless = {
      control: "developed" as const,
      population: 200,
      buildings: { [VOCATIONAL_SCHOOL_TYPE]: 1 },
    };
    const withJobs = factionConstructionPool([employed], rates);
    const withoutJobs = factionConstructionPool([jobless], rates);
    expect(withJobs.base).toBeCloseTo((200 - 14) * 0.05); // 14 technician heads employed
    expect(withoutJobs.base).toBeCloseTo(200 * 0.05);     // licences alone cost nothing
  });

  it("adds centre output scaled by staffing fulfilment (labour and technician gates)", () => {
    // 1 centre: 25 heads (18 unskilled + 7 skill1); a school licenses its technicians; pop staffs fully.
    const staffed = {
      control: "developed" as const,
      population: 200,
      buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1, [VOCATIONAL_SCHOOL_TYPE]: 1 },
    };
    const full = factionConstructionPool([staffed], rates);
    expect(full.centres).toBeCloseTo(5); // 1 level × 5 × fulfilment 1
    // The centre's own technicians are employed heads — they leave the base.
    expect(full.base).toBeCloseTo((200 - 7) * 0.05);
    expect(full.total).toBeCloseTo(full.base + full.centres);

    // No school → skill1Fulfil = 0 → centre produces nothing.
    const unlicensed = {
      control: "developed" as const,
      population: 200,
      buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1 },
    };
    expect(factionConstructionPool([unlicensed], rates).centres).toBe(0);

    // Half the heads → labourFulfil scales output down proportionally.
    const short = {
      control: "developed" as const,
      population: 20, // demand = 25 (centre) + 15 (school) = 40 → labourFulfil = 0.5
      buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1, [VOCATIONAL_SCHOOL_TYPE]: 1 },
    };
    expect(factionConstructionPool([short], rates).centres).toBeCloseTo(5 * 0.5);
  });

  it("floors negative population at zero", () => {
    expect(
      factionConstructionPool(
        [{ control: "developed" as const, population: -10, buildings: {} }],
        rates,
      ).total,
    ).toBe(0);
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
    // The full discriminated row (kind/buildingType/levels) survives onto the landed set, not a narrowed payload.
    expect(r.landed[0]).toEqual({ ...project("p", HOUSING_TYPE, 3, 25, 30), workDone: 30 });
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
    expect(r.landed[0]).toEqual({ ...project("p1", HOUSING_TYPE, 1, 27, 30), workDone: 30 });
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

/** Build an open project at an explicit system (the floor gates on which system a build targets). */
function projectAt(
  id: string,
  systemId: string,
  buildingType: string,
  levels: number,
  workDone: number,
  workTotal: number,
): WorldConstructionProject {
  return { kind: "build", id, factionId: "f1", systemId, buildingType, levels, workTotal, workDone };
}

describe("developmentFloorShare", () => {
  it("is the full base at zero development and weans linearly to zero at the knee", () => {
    expect(developmentFloorShare(0, 12, 0.5)).toBeCloseTo(12, 6); // raw colony → full floor
    expect(developmentFloorShare(0.25, 12, 0.5)).toBeCloseTo(6, 6); // halfway to the knee
    expect(developmentFloorShare(0.5, 12, 0.5)).toBeCloseTo(0, 6); // at the knee → nothing reserved
    expect(developmentFloorShare(0.9, 12, 0.5)).toBe(0); // past the knee stays zero (no negative floor)
  });

  it("reserves nothing for a non-positive knee", () => {
    expect(developmentFloorShare(0, 12, 0)).toBe(0);
  });
});

describe("fundQueueWithFloor", () => {
  it("reproduces fundQueue exactly when reserved is 0", () => {
    const cap = 10;
    const projects = [projectAt("a", "s", "food", 1, 0, 1000), projectAt("b", "s", "food", 1, 0, 1000)];
    expect(fundQueueWithFloor(projects, 15, cap, 0, () => true)).toEqual(fundQueue(projects, 15, cap));
  });

  it("guarantees an eligible colony build its reserved slice ahead of a higher-priority homeworld build", () => {
    const cap = 10;
    // Front-first, the homeworld build (first in the queue) would take the whole cap-sized pool and the
    // colony would get 0. A reserve of 4 for the colony flips that: it funds first from the reserve, the
    // homeworld drains the remainder.
    const home = projectAt("h", "home", "food", 1, 0, 1000);
    const col = projectAt("c", "colony", "food", 1, 0, 1000);
    const r = fundQueueWithFloor([home, col], 10, cap, 4, (p) => p.systemId === "colony");
    expect(r.projects.find((p) => p.id === "c")!.workDone).toBe(4); // its reserved slice (would be 0 unreserved)
    expect(r.projects.find((p) => p.id === "h")!.workDone).toBe(6); // homeworld drains the rest
  });

  it("returns unspent reserve to the general pool rather than wasting it", () => {
    const cap = 10;
    // Reserve (100) far exceeds what the one eligible build can absorb this pulse (cap = 10); the surplus
    // must fund the non-eligible homeworld build, not vanish.
    const col = projectAt("c", "colony", "food", 1, 0, 1000);
    const home = projectAt("h", "home", "food", 1, 0, 1000);
    const r = fundQueueWithFloor([col, home], 30, cap, 100, (p) => p.systemId === "colony");
    expect(r.projects.find((p) => p.id === "c")!.workDone).toBe(10); // capped despite the huge reserve
    expect(r.projects.find((p) => p.id === "h")!.workDone).toBe(10); // freed reserve funded the homeworld
  });

  it("never lets a project absorb more than cap across the reserve + general passes", () => {
    const cap = 10;
    // Eligible build funded to the cap by the reserve; a huge general pool must not top it up past cap.
    const col = projectAt("c", "colony", "food", 1, 0, 1000);
    const r = fundQueueWithFloor([col], 100, cap, 10, () => true);
    expect(r.projects.find((p) => p.id === "c")!.workDone).toBe(cap);
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
    const flat = orderProposals([other, gated]).flatMap((p) => (p.kind === "build" ? p.items.map((i) => i.buildingType) : []));
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

/** Build a colony-establish proposal with explicit value/work. */
function colony(systemId: string, value: number, work: number): ColonyProposal {
  return { kind: "colony_establish", factionId: "f1", systemId, sourceSystemId: "home", seedPop: 50, housingLevels: 3, value, work };
}

describe("orderProposals — colony interleaving", () => {
  it("interleaves a colony among build bundles by descending ROI", () => {
    const hi = proposal("s1", [{ buildingType: "food", levels: 1 }], 40, 20);   // ROI 2.0
    const col = colony("c1", 30, 20);                                            // ROI 1.5
    const lo = proposal("s2", [{ buildingType: "ore", levels: 1 }], 10, 20);     // ROI 0.5
    expect(orderProposals([lo, col, hi]).map((p) => p.systemId)).toEqual(["s1", "c1", "s2"]);
  });

  it("keeps housing ahead of a higher-ROI colony (proactive substrate still leads)", () => {
    const housing = proposal("s1", [{ buildingType: "housing", levels: 1 }], 0, 8, "housing");
    const col = colony("c1", 1000, 4); // enormous ROI, still funded after housing
    const ordered = orderProposals([col, housing]);
    expect(ordered[0]).toBe(housing);
    expect(ordered[1]).toBe(col);
  });

  it("is deterministic with a colony present (union-safe tiebreak, no items on a colony)", () => {
    const a = colony("c-a", 20, 20); // ROI 1.0
    const b = proposal("s-b", [{ buildingType: "ore", levels: 1 }], 20, 20); // ROI 1.0 (tie)
    const order1 = orderProposals([a, b]).map((p) => p.systemId);
    const order2 = orderProposals([b, a]).map((p) => p.systemId);
    expect(order1).toEqual(order2);
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

  it("prices a construction-centre level above a tier-1 factory and below a complex", () => {
    expect(workCostPerLevel(CONSTRUCTION_CENTRE_TYPE)).toBeGreaterThan(workCostPerLevel("metals"));
    expect(workCostPerLevel(CONSTRUCTION_CENTRE_TYPE)).toBeLessThan(workCostPerLevel("heavy_industry_complex"));
  });

  it("exposes positive centre knobs (points per level, payback horizon, backlog window)", () => {
    expect(CONSTRUCTION.POINTS_PER_LEVEL).toBeGreaterThan(0);
    expect(CONSTRUCTION.PAYBACK_HORIZON).toBeGreaterThan(0);
    expect(CONSTRUCTION.BACKLOG_WINDOW).toBeGreaterThan(0);
  });
});
