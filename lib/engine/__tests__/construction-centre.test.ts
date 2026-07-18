import { describe, it, expect } from "vitest";
import { planCentreProposal } from "@/lib/engine/construction-centre";
import type { Proposal, BuildSystemState } from "@/lib/engine/directed-build";
import type { WorldConstructionProject } from "@/lib/world/types";
import { workCostPerLevel } from "@/lib/constants/construction";
import { CONSTRUCTION_CENTRE_TYPE } from "@/lib/constants/industry";
import { emptyResourceVector } from "@/lib/engine/resources";

const PARAMS = { pointsPerLevel: 5, paybackHorizon: 12, backlogWindow: 6 };

function system(systemId: string, population: number, generalSpace = 50): BuildSystemState {
  return {
    systemId, factionId: "f1", control: "developed", population, unrest: 0,
    buildings: {}, slotCap: emptyResourceVector(), generalSpace, habitableSpace: 10, goods: [],
  };
}

function proposal(systemId: string, value: number, work: number, buildingType = "metals"): Proposal {
  return { kind: "build", factionId: "f1", systemId, role: "industry",
    items: [{ buildingType, levels: 1 }], value, work };
}

function centreProject(workDone = 1): WorldConstructionProject {
  return { kind: "build", id: "c1", origin: "auto", factionId: "f1", systemId: "s1",
    buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1,
    workTotal: workCostPerLevel(CONSTRUCTION_CENTRE_TYPE), workDone };
}

describe("planCentreProposal", () => {
  it("emits a centre priced off the best starved ROI when valuable work sits beyond the frontier", () => {
    // pool 10 × window 6 = 60 budget. First proposal (work 50) fits; the second (work 50, roi 2) starts
    // inside but its cumulative 100 > 60 → beyond the frontier.
    const ordered = [proposal("s1", 25, 50), proposal("s1", 100, 50)];
    const p = planCentreProposal("f1", ordered, [], [system("s1", 500)], 10, PARAMS);
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(p.items).toEqual([{ buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1 }]);
    expect(p.work).toBe(workCostPerLevel(CONSTRUCTION_CENTRE_TYPE));
    expect(p.value).toBeCloseTo(5 * (100 / 50) * 12); // pointsPerLevel × r × horizon
    expect(p.role).toBe("industry");
  });

  it("returns null when the backlog drains inside the window", () => {
    const ordered = [proposal("s1", 25, 50)]; // 50 ≤ 10 × 6 — everything funds in time
    expect(planCentreProposal("f1", ordered, [], [system("s1", 500)], 10, PARAMS)).toBeNull();
  });

  it("counts in-flight remaining work toward the frontier", () => {
    // 55 remaining in-flight + a 10-work proposal = 65 > 60 → that proposal is starved.
    const open: WorldConstructionProject[] = [{ kind: "build", id: "b1", origin: "auto", factionId: "f1",
      systemId: "s1", buildingType: "metals", levels: 3, workTotal: 60, workDone: 5 }];
    const ordered = [proposal("s1", 30, 10)];
    const p = planCentreProposal("f1", ordered, open, [system("s1", 500)], 10, PARAMS);
    expect(p).not.toBeNull();
  });

  it("returns null while a centre project is already in flight", () => {
    const ordered = [proposal("s1", 100, 50), proposal("s1", 100, 50)];
    expect(planCentreProposal("f1", ordered, [centreProject()], [system("s1", 500)], 1, PARAMS)).toBeNull();
  });

  it("sites at the developed system with the most spare labour, tie-broken by systemId", () => {
    // Tier-0 items (deposit slots, not general space) so committed space stays 0 everywhere —
    // isolates the spare-labour and systemId comparisons from the space term.
    const ordered = [proposal("s1", 100, 50, "ore"), proposal("s1", 100, 50, "ore")];
    // s2 has more spare labour (no buildings anywhere → spare = population).
    const p = planCentreProposal("f1", ordered, [], [system("s1", 100), system("s2", 300)], 1, PARAMS);
    expect(p?.systemId).toBe("s2");
    // Exact tie on spare labour and space → lowest systemId.
    const tied = planCentreProposal("f1", ordered, [], [system("s2", 300), system("s1", 300)], 1, PARAMS);
    expect(tied?.systemId).toBe("s1");
  });

  it("sites at the developed system with more remaining space when spare labour ties", () => {
    // Tier-0 proposal (zero committed space) so the space term isn't contaminated by the queue.
    const ordered = [proposal("s1", 100, 50, "ore")];
    // Equal population, no buildings → spare labour ties; s2 has more remaining general space.
    const p = planCentreProposal("f1", ordered, [], [system("s1", 300, 40), system("s2", 300, 60)], 1, PARAMS);
    expect(p?.systemId).toBe("s2");
  });

  it("returns null when no developed system has general space for the centre", () => {
    const ordered = [proposal("s1", 100, 50), proposal("s1", 100, 50)];
    expect(planCentreProposal("f1", ordered, [], [system("s1", 500, 0.5)], 1, PARAMS)).toBeNull();
  });

  it("ignores zero-value (housing) proposals when picking the frontier ROI", () => {
    const housing: Proposal = { kind: "build", factionId: "f1", systemId: "s1", role: "housing",
      items: [{ buildingType: "housing", levels: 10 }], value: 0, work: 80 };
    expect(planCentreProposal("f1", [housing], [], [system("s1", 500)], 1, PARAMS)).toBeNull();
  });

  it("prices off the HIGHER of two starved ROIs regardless of proposal order", () => {
    // Tiny budget (pool 1 × window 6 = 6) puts both proposals well beyond the frontier, so
    // Math.max must pick the higher ROI (150/50=3) over the lower (50/50=1) either way round.
    const low = proposal("s1", 50, 50);   // roi 1
    const high = proposal("s1", 150, 50); // roi 3
    const expectedValue = PARAMS.pointsPerLevel * 3 * PARAMS.paybackHorizon; // 5 × 3 × 12 = 180
    const forward = planCentreProposal("f1", [low, high], [], [system("s1", 500)], 1, PARAMS);
    const reversed = planCentreProposal("f1", [high, low], [], [system("s1", 500)], 1, PARAMS);
    expect(forward?.value).toBeCloseTo(expectedValue);
    expect(reversed?.value).toBeCloseTo(expectedValue);
  });
});
