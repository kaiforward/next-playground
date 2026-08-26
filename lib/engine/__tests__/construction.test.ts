import { describe, it, expect } from "vitest";
import { fundQueue, fundQueueWithFloor, developmentFloorShare, factionConstructionPool, proposalRoi, orderProposals, orderOpenProjects, forecastEtaCycles, forecastIndependentEtaCycles } from "@/lib/engine/construction";
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
  return { kind: "build", id, origin: "auto", factionId: "f1", systemId: "s1", buildingType, levels, workTotal, workDone };
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
  it("advances a single build by min(cap, remaining, pool) each cycle — duration emerges as work ÷ cap", () => {
    const cap = 10;
    // workTotal = 8 × cap, pool = cap → the build absorbs exactly `cap` per cycle and lands on cycle 8.
    let projects = [project("p", HOUSING_TYPE, 1, 0, 8 * cap)];
    let landedCycle = 0;
    for (let cycle = 1; cycle <= 8; cycle++) {
      const r = fundQueue(projects, cap, cap);
      projects = r.projects;
      if (r.landed.length > 0) {
        landedCycle = cycle;
        break;
      }
    }
    expect(landedCycle).toBe(8);
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
    // One cycle from completion: remaining work = 5 ≤ cap → lands this cycle.
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

  it("cascades leftover from a near-complete front to the next build in one cycle", () => {
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

  it("reports total absorbed points", () => {
    const projects = [
      project("a", HOUSING_TYPE, 1, 0, 10),
      project("b", HOUSING_TYPE, 1, 0, 10),
    ];
    const r = fundQueue(projects, 6, 4);
    expect(r.absorbed).toBeCloseTo(6); // 4 to the first (cap), 2 to the second
  });
});

describe("fundQueue — per-level landing (split)", () => {
  it("lands 1 of 2 levels when funded to exactly half its work, keeping the remainder open under the same id", () => {
    // The roadmap's canonical case: a 2-level build, workTotal 20 (perLevelWork 10), funded exactly
    // to 10 — one whole level's worth.
    const r = fundQueue([project("p", HOUSING_TYPE, 2, 0, 20)], 10, 10);
    expect(r.landed).toHaveLength(1);
    expect(r.landed[0]).toMatchObject({ id: "p", levels: 1, workTotal: 10, workDone: 10 });
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]).toMatchObject({ id: "p", levels: 1, workTotal: 10, workDone: 0 });
  });

  it("counts a level whose workDone lands exactly on its boundary despite float imprecision", () => {
    // workTotal 1 over 3 levels gives a perLevelWork of 1/3, which is not exactly representable —
    // two levels' worth of work computed the same way the engine would accumulate it must still
    // floor to k=2, not 1.
    const perLevelWork = 1 / 3;
    const twoLevelsWorth = perLevelWork + perLevelWork; // 0.6666666666666666
    const r = fundQueue([project("p", HOUSING_TYPE, 3, twoLevelsWorth, 1)], 0, 10);
    // Zero pool: workDone is exactly the pre-funded boundary value, so this only exercises the split
    // math on the boundary, not the absorption step.
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]).toMatchObject({ id: "p", levels: 1 });
    expect(r.landed).toHaveLength(1);
    expect(r.landed[0]).toMatchObject({ id: "p", levels: 2 });
  });

  it("does not split a single-level project — it lands whole on completion exactly as before", () => {
    const cap = 10;
    const r = fundQueue([project("p", HOUSING_TYPE, 1, 0, 15)], cap, cap);
    expect(r.landed).toHaveLength(0);
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]).toMatchObject({ levels: 1, workDone: 10 });
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
  return { kind: "build", id, origin: "auto", factionId: "f1", systemId, buildingType, levels, workTotal, workDone };
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
    // Reserve (100) far exceeds what the one eligible build can absorb this cycle (cap = 10); the surplus
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

  it("absorbed covers both passes and never exceeds the pool", () => {
    const cap = 10;
    const ordered = [
      projectAt("h", "home", "food", 1, 0, 1000),
      projectAt("c", "colony", "food", 1, 0, 1000),
    ];
    const r = fundQueueWithFloor(ordered, 10, cap, 4, (p) => p.systemId === "colony");
    const workDelta =
      [...r.projects, ...r.landed].reduce((acc, p) => acc + p.workDone, 0) -
      ordered.reduce((acc, p) => acc + p.workDone, 0);
    expect(r.absorbed).toBeCloseTo(workDelta);
    expect(r.absorbed).toBeLessThanOrEqual(10);
  });

  it("holds a project at a per-project ceiling of 0 — through the reserve pass too", () => {
    // The regression this guards: pass A funds the floor-eligible slice on the SCALAR cap, so a
    // ceiling that only binds in pass B lets a reserved project absorb work it cannot pay for.
    const cap = 10;
    const blocked = projectAt("c", "colony", "food", 1, 0, 1000);
    const neighbour = projectAt("h", "home", "food", 1, 0, 1000);
    const r = fundQueueWithFloor(
      [blocked, neighbour],
      100,
      cap,
      50, // a reserve big enough to fund the blocked project several times over
      (p) => p.id === "c", // …and it is the only project the reserve is for
      (p) => (p.id === "c" ? 0 : cap),
    );
    expect(r.projects.find((p) => p.id === "c")!.workDone).toBe(0);
    expect(r.projects.find((p) => p.id === "h")!.workDone).toBe(cap);
    expect(r.absorbed).toBe(cap);
  });

  it("resolves each project's ceiling once, so both passes see one figure", () => {
    // The callback reads market and treasury state the caller re-derives per cycle; nothing here
    // promises it is pure. Resolving it per pass would let a floor-eligible project absorb its
    // reserved slice under one ceiling and the general pool under another — a build-time floor no
    // caller could reason about, and a per-project call count that grows with the queue.
    const cap = 10;
    const calls: string[] = [];
    let handed = 0;
    const r = fundQueueWithFloor(
      [projectAt("c", "colony", "food", 1, 0, 1000), projectAt("h", "home", "food", 1, 0, 1000)],
      100, cap, 50,
      (p) => p.id === "c",
      (p) => { calls.push(p.id); handed += cap; return handed; }, // 10 first, 20 second, …
    );
    expect(calls).toEqual(["c", "h"]); // one resolution each, not one per pass
    // Both ceilings clamp back to the scalar cap, so each project absorbs exactly a cap's worth —
    // a second call for "c" would have handed it 30 and the clamp would hide the extra call.
    expect(r.projects.find((p) => p.id === "c")!.workDone).toBe(cap);
    expect(r.projects.find((p) => p.id === "h")!.workDone).toBe(cap);
  });

  it("spares nothing for a project whose ceiling is unreadable", () => {
    // A ceiling is derived from market and money state; a NaN reaching workDone would land in World
    // state, and `JSON.stringify` turns it into null on save.
    const cap = 10;
    for (const unreadable of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = fundQueueWithFloor(
        [projectAt("c", "colony", "food", 1, 0, 1000)],
        100, cap, 50, () => true, () => unreadable,
      );
      expect(r.projects[0].workDone).toBe(0);
      expect(r.absorbed).toBe(0);
    }
  });

  it("makes a project at half its ceiling take twice the cycles", () => {
    const cap = 10;
    let full = projectAt("f", "s", "food", 1, 0, 40);
    let half = projectAt("g", "s", "food", 1, 0, 40);
    let fullCycles = 0;
    let halfCycles = 0;
    while (fullCycles < 20) {
      const r = fundQueueWithFloor([full], 100, cap, 0, () => false);
      fullCycles++;
      if (r.landed.length > 0) break;
      full = r.projects[0];
    }
    while (halfCycles < 20) {
      const r = fundQueueWithFloor([half], 100, cap, 0, () => false, () => cap / 2);
      halfCycles++;
      if (r.landed.length > 0) break;
      half = r.projects[0];
    }
    expect(fullCycles).toBe(4);
    expect(halfCycles).toBe(8);
  });

  it("is identical to the scalar cap when capFor returns it", () => {
    const cap = 10;
    const ordered = [
      projectAt("h", "home", "food", 1, 0, 1000),
      projectAt("c", "colony", "food", 1, 0, 1000),
    ];
    expect(fundQueueWithFloor(ordered, 15, cap, 4, (p) => p.systemId === "colony", () => cap)).toEqual(
      fundQueueWithFloor(ordered, 15, cap, 4, (p) => p.systemId === "colony"),
    );
  });

  it("only ever lowers: a ceiling above the scalar cap is clamped back to it", () => {
    // The per-build cap is the minimum-build-time floor (workTotal ÷ cap cycles). A caller that
    // could raise its own ceiling would buy past that floor — so a raise reads as the plain cap.
    const cap = 10;
    const ordered = [projectAt("c", "colony", "food", 1, 0, 1000)];
    const raised = fundQueueWithFloor(ordered, 500, cap, 0, () => false, () => cap * 5);
    expect(raised.projects[0].workDone).toBe(cap);
  });

  it("splits a build row that crosses a level boundary without completing, across the reserve + general passes", () => {
    // 2-level build, workTotal 20 (perLevelWork 10): the reserve funds 6, the general pass tops it up
    // to 10 — exactly a level's worth — so it splits identically to the plain fundQueue case.
    const twoLevel = projectAt("p", "colony", "food", 2, 0, 20);
    const r = fundQueueWithFloor([twoLevel], 10, 10, 6, () => true);
    expect(r.landed).toHaveLength(1);
    expect(r.landed[0]).toMatchObject({ id: "p", levels: 1, workTotal: 10, workDone: 10 });
    expect(r.projects).toHaveLength(1);
    expect(r.projects[0]).toMatchObject({ id: "p", levels: 1, workTotal: 10, workDone: 0 });
  });
});

/** Build a proposal with explicit value/work; `role` defaults to industry. */
function proposal(
  systemId: string,
  items: Array<{ buildingType: string; levels: number }>,
  value: number,
  work: number,
  role: "housing" | "industry" = "industry",
  producedGood?: string,
): Proposal {
  return { kind: "build", factionId: "f1", systemId, role, items, value, work, producedGood };
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

describe("orderProposals — survival band (necessity weighting)", () => {
  it("still funds housing ahead of everything, including a survival-serving industry proposal", () => {
    const housing = proposal("s1", [{ buildingType: "housing", levels: 1 }], 0, 8, "housing");
    const richSurvival = proposal("s2", [{ buildingType: "food", levels: 1 }], 1000, 1, "industry", "food"); // enormous ROI
    const ordered = orderProposals([richSurvival, housing]);
    expect(ordered[0]).toBe(housing);
    expect(ordered[1]).toBe(richSurvival);
  });

  it("funds a survival-serving proposal ahead of a higher-ROI non-survival one", () => {
    const survival = proposal("s1", [{ buildingType: "food", levels: 1 }], 10, 20, "industry", "food"); // ROI 0.5
    const richOther = proposal("s2", [{ buildingType: "electronics", levels: 1 }], 100, 4); // ROI 25, no producedGood band
    const ordered = orderProposals([richOther, survival]);
    expect(ordered[0]).toBe(survival);
    expect(ordered[1]).toBe(richOther);
  });

  it("orders two survival-serving proposals by descending ROI within their own band", () => {
    const lo = proposal("s1", [{ buildingType: "water", levels: 1 }], 10, 20, "industry", "water"); // ROI 0.5
    const hi = proposal("s2", [{ buildingType: "food", levels: 1 }], 30, 20, "industry", "food");    // ROI 1.5
    expect(orderProposals([lo, hi]).map((p) => p.systemId)).toEqual(["s2", "s1"]);
  });

  it("funds a colony proposal in the third band — behind a survival-serving proposal even at a lower ROI", () => {
    const survival = proposal("s1", [{ buildingType: "food", levels: 1 }], 5, 20, "industry", "food"); // ROI 0.25
    const col = colony("c1", 1000, 1); // enormous ROI, no producedGood — the colony branch never carries one
    const ordered = orderProposals([col, survival]);
    expect(ordered[0]).toBe(survival);
    expect(ordered[1]).toBe(col);
  });

  it("a colony still interleaves with ordinary (non-survival) industry by ROI, band-equal", () => {
    const hi = proposal("s1", [{ buildingType: "ore", levels: 1 }], 40, 20);   // ROI 2.0, no producedGood
    const col = colony("c1", 30, 20);                                          // ROI 1.5
    const lo = proposal("s2", [{ buildingType: "gas", levels: 1 }], 10, 20);   // ROI 0.5, no producedGood
    expect(orderProposals([lo, col, hi]).map((p) => p.systemId)).toEqual(["s1", "c1", "s2"]);
  });

  it("the vacuity check — bands by producedGood, never by items[0] (a survival good gated behind an unrelated first item)", () => {
    // items[0] is a school, not a survival good at all — a reader keyed off items[0] would call this
    // non-survival. producedGood alone says it serves food.
    const gatedSurvival = proposal("s1", [
      { buildingType: "vocational_school", levels: 1 },
      { buildingType: "food", levels: 1 },
    ], 5, 40, "industry", "food"); // ROI 0.125 — deliberately low, so only the BAND (not ROI) could put it first
    const richOther = proposal("s2", [{ buildingType: "electronics", levels: 1 }], 100, 4); // ROI 25
    const ordered = orderProposals([richOther, gatedSurvival]);
    expect(ordered[0]).toBe(gatedSurvival);
    expect(ordered[1]).toBe(richOther);
  });

  it("is deterministic under input reordering with a mixed housing/survival/other/colony queue", () => {
    const housing = proposal("s0", [{ buildingType: "housing", levels: 1 }], 0, 8, "housing");
    const survivalA = proposal("s1", [{ buildingType: "food", levels: 1 }], 10, 20, "industry", "food");
    const survivalB = proposal("s2", [{ buildingType: "water", levels: 1 }], 30, 20, "industry", "water");
    const other = proposal("s3", [{ buildingType: "ore", levels: 1 }], 40, 20);
    const col = colony("c1", 30, 20);
    const input = [housing, survivalA, survivalB, other, col];
    const order1 = orderProposals(input).map((p) => p.systemId);
    const order2 = orderProposals([...input].reverse()).map((p) => p.systemId);
    const order3 = orderProposals([col, other, survivalB, housing, survivalA]).map((p) => p.systemId);
    expect(order1).toEqual(order2);
    expect(order1).toEqual(order3);
    expect(order1).toEqual(["s0", "s2", "s1", "s3", "c1"]);
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

describe("orderOpenProjects", () => {
  const row = (id: string, origin: "auto" | "player", workDone: number): WorldConstructionProject => ({
    kind: "build", id, factionId: "f1", systemId: "s1", origin,
    buildingType: "metals", levels: 1, workTotal: 20, workDone,
  });

  it("moves fresh player orders behind committed work, preserving relative order (FIFO)", () => {
    const stored = [row("p1", "player", 0), row("a1", "auto", 5), row("p2", "player", 0), row("a2", "auto", 0)];
    expect(orderOpenProjects(stored).map((p) => p.id)).toEqual(["a1", "a2", "p1", "p2"]);
  });

  it("is an identity on queues with no fresh player rows (AI queues untouched)", () => {
    const stored = [row("a1", "auto", 0), row("a2", "auto", 7), row("a3", "auto", 0)];
    expect(orderOpenProjects(stored).map((p) => p.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("keeps a player row that has received work in its committed position", () => {
    const stored = [row("p1", "player", 3), row("a1", "auto", 0)];
    expect(orderOpenProjects(stored).map((p) => p.id)).toEqual(["p1", "a1"]);
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

// ── Boundaries and arithmetic the cases above leave unpinned ──

describe("fundQueueWithFloor — the reserve never over-funds", () => {
  const eligible = () => true;

  it("caps the reserved pass at the work a project has left, not its whole total", () => {
    // 90 of 100 done: however deep the reserve, only the last 10 points can be absorbed.
    const result = fundQueueWithFloor([project("p1", HOUSING_TYPE, 1, 90, 100)], 1000, 1000, 1000, eligible);
    expect(result.absorbed).toBeCloseTo(10);
    expect(result.landed.map((p) => p.workDone)).toEqual([100]);
  });

  it("nets the reserved pass's absorption off the general pass's remaining work", () => {
    // The reserve funds 30 of the 100 remaining; the general pass may only fund the other 70, so the
    // project lands at exactly its total rather than absorbing the work twice over.
    const result = fundQueueWithFloor([project("p1", HOUSING_TYPE, 1, 0, 100)], 1000, 1000, 30, eligible);
    expect(result.absorbed).toBeCloseTo(100);
    expect(result.landed.map((p) => p.workDone)).toEqual([100]);
  });

  it("nets a partly-built project's standing work off the general pass too", () => {
    const result = fundQueueWithFloor([project("p1", HOUSING_TYPE, 1, 60, 100)], 1000, 1000, 10, eligible);
    expect(result.absorbed).toBeCloseTo(40);
    expect(result.landed.map((p) => p.workDone)).toEqual([100]);
  });
});

describe("orderProposals — the deterministic tiebreak", () => {
  const build = (systemId: string, buildingType: string, value: number, work: number): Proposal => ({
    kind: "build", factionId: "f1", systemId, role: "industry",
    items: [{ buildingType, levels: 1 }], value, work,
  });
  const colony = (systemId: string, value: number, work: number): ColonyProposal => ({
    kind: "colony_establish", factionId: "f1", systemId, sourceSystemId: "home",
    seedPop: 2, housingLevels: 1, value, work,
  });

  it("labels a build by its first item's type, so it sorts against a colony at the same system", () => {
    // Equal ROI at one system: the total order is by label, and "alloys" sorts ahead of "colony".
    const ordered = orderProposals([colony("s1", 10, 10), build("s1", "alloys", 10, 10)]);
    expect(ordered.map((p) => p.kind)).toEqual(["build", "colony_establish"]);
  });

  it("orders two equal-ROI builds at one system by their first item's type", () => {
    const ordered = orderProposals([build("s1", "zzz_late", 10, 10), build("s1", "alloys", 10, 10)]);
    expect(ordered.map((p) => (p.kind === "build" ? p.items[0]?.buildingType : "colony")))
      .toEqual(["alloys", "zzz_late"]);
  });

  it("labels an item-less build proposal without throwing", () => {
    // `items[0]` is optional on the type, so the label has to survive an empty bundle.
    const empty: Proposal = {
      kind: "build", factionId: "f1", systemId: "s1", role: "industry", items: [], value: 10, work: 10,
    };
    const ordered = orderProposals([build("s1", "alloys", 10, 10), empty]);
    expect(ordered).toHaveLength(2);
    expect(ordered[0]).toBe(empty); // the empty label "s1|" sorts ahead of "s1|alloys"
  });
});

describe("forecastEtaCycles — the stall guard and the cycle horizon", () => {
  it("stalls everything on a zero pool or a zero cap, including a project already at its total", () => {
    const done = project("done", HOUSING_TYPE, 1, 100, 100);
    const open = project("open", HOUSING_TYPE, 1, 0, 100);
    expect(forecastEtaCycles([done, open], 0, 50)).toEqual([null, null]);
    expect(forecastEtaCycles([done, open], 50, 0)).toEqual([null, null]);
    expect(forecastEtaCycles([done, open], Number.NaN, 50)).toEqual([null, null]);
  });

  it("still reports a project that lands on the very last cycle of the horizon", () => {
    // 30 points of work at cap 10 lands on cycle 3 — the horizon must include its own last cycle.
    expect(forecastEtaCycles([project("p", HOUSING_TYPE, 1, 0, 30)], 10, 10, 3)).toEqual([3]);
    expect(forecastEtaCycles([project("p", HOUSING_TYPE, 1, 0, 40)], 10, 10, 3)).toEqual([null]);
  });

  it("reports the LAST level's landing cycle for a project that lands levels incrementally", () => {
    // 2-level build, workTotal 20 (perLevelWork 10), cap/pool 5: level 1 lands on cycle 2, level 2
    // (the whole project) on cycle 4 — etaCycles must read 4, not the first partial landing.
    expect(forecastEtaCycles([project("p", HOUSING_TYPE, 2, 0, 20)], 5, 5)).toEqual([4]);
  });
});

describe("forecastIndependentEtaCycles — the stall guard, remaining work and the horizon", () => {
  it("stalls every hypothetical on a zero pool or a zero cap, including one already at its total", () => {
    const done = project("h-done", HOUSING_TYPE, 1, 100, 100);
    const open = project("h-open", HOUSING_TYPE, 1, 0, 100);
    expect(forecastIndependentEtaCycles([], [done, open], 0, 50)).toEqual([null, null]);
    expect(forecastIndependentEtaCycles([], [done, open], 50, 0)).toEqual([null, null]);
    expect(forecastIndependentEtaCycles([], [done, open], Number.NaN, 50)).toEqual([null, null]);
  });

  it("counts a hypothetical's REMAINING work, not its whole total", () => {
    // 80 of 100 done, cap 10 ⇒ two cycles left, not ten (and certainly not eighteen).
    expect(forecastIndependentEtaCycles([], [project("h", HOUSING_TYPE, 1, 80, 100)], 100, 10)).toEqual([2]);
  });

  it("reports null for a hypothetical the horizon cannot finish", () => {
    // 100 points at cap 10 needs ten cycles; the horizon stops at three.
    expect(forecastIndependentEtaCycles([], [project("h", HOUSING_TYPE, 1, 0, 100)], 100, 10, 3)).toEqual([null]);
  });

  it("still reports a hypothetical that lands on the very last cycle of the horizon", () => {
    expect(forecastIndependentEtaCycles([], [project("h", HOUSING_TYPE, 1, 0, 30)], 100, 10, 3)).toEqual([3]);
  });

  it("computes the correct leftover pool when a committed row splits mid-cycle", () => {
    // Committed: a 2-level build, perLevelWork 1000 (workTotal 2000), poised 10 short of the first
    // level boundary. pool 12, cap 10: cycle 1 absorbs exactly 10, landing level 1 (workDone hits the
    // 1000 boundary) and leaving level 2 open under the same id at workDone 0 — the row SPLITS this
    // cycle. A naive per-row diff (each of the split's landed/open halves diffed against the row's one
    // prior workDone, then summed) double-subtracts that prior workDone and computes a nonsense
    // leftover; the correct absorption is the cap (10), so leftover for the hypothetical is 12 − 10 = 2.
    const committed = [project("c", HOUSING_TYPE, 2, 990, 2000)];
    // Level 2 (workTotal 1000, far beyond what 12/cycle can drain in 50 cycles) never completes, so the
    // committed row keeps absorbing exactly cap (10) every cycle after the split too — leftover stays
    // pinned at 2 for the whole run, making the hypothetical's landing cycle an exact, unambiguous check.
    const hypothetical = project("h", HOUSING_TYPE, 1, 0, 100);
    expect(forecastIndependentEtaCycles(committed, [hypothetical], 12, 10, 50)).toEqual([50]);
  });
});

describe("forecastEtaCycles / forecastIndependentEtaCycles — the default give-up bound (999 → 9999)", () => {
  // The slowed-down constants push every forecast out ~10×, so a project that used to land well
  // inside the old 999-cycle guard now lands past it but still well inside a sane give-up bound.
  // These pin the DEFAULT maxCycles (no explicit horizon argument) directly, so a regression back
  // to 999 fails on a real assertion, not an import error.
  const LANDING_CYCLE = 5000; // strictly between 999 and 9999

  it("forecastEtaCycles reports a numeric ETA for a deep queue landing between 999 and 9999 cycles out", () => {
    const cap = 1;
    const deep = project("deep", HOUSING_TYPE, 1, 0, LANDING_CYCLE * cap);
    expect(forecastEtaCycles([deep], cap, cap)).toEqual([LANDING_CYCLE]);
  });

  it("forecastEtaCycles still reports null (stalled) for a genuinely unfundable queue", () => {
    const cap = 1;
    const deep = project("deep", HOUSING_TYPE, 1, 0, LANDING_CYCLE * cap);
    expect(forecastEtaCycles([deep], 0, cap)).toEqual([null]);
  });

  it("forecastIndependentEtaCycles reports a numeric ETA for a hypothetical landing between 999 and 9999 cycles out", () => {
    const cap = 1;
    const deep = project("deep", HOUSING_TYPE, 1, 0, LANDING_CYCLE * cap);
    expect(forecastIndependentEtaCycles([], [deep], cap, cap)).toEqual([LANDING_CYCLE]);
  });

  it("forecastIndependentEtaCycles still reports null (stalled) for a genuinely unfundable hypothetical", () => {
    const cap = 1;
    const deep = project("deep", HOUSING_TYPE, 1, 0, LANDING_CYCLE * cap);
    expect(forecastIndependentEtaCycles([], [deep], 0, cap)).toEqual([null]);
  });
});
