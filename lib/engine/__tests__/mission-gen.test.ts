import { describe, it, expect } from "vitest";
import {
  selectPatrolCandidates,
  selectSurveyCandidates,
  selectBountyCandidates,
  generateOpMissionCandidates,
  type SystemSnapshot,
} from "../mission-gen";
import { MISSION_TYPE_DEFS, OP_MISSION_DEADLINE_TICKS } from "@/lib/constants/missions";

// ── Helpers ──────────────────────────────────────────────────────

function makeSystem(
  id: string,
  traits: Array<{ traitId: string; quality: 1 | 2 | 3 }> = [],
): SystemSnapshot {
  return {
    id,
    name: `System ${id}`,
    traits: traits as SystemSnapshot["traits"],
  };
}

/** Always-pass RNG: returns 0 (below any threshold). */
const alwaysPass = () => 0;
/** Always-fail RNG: returns 1 (above any threshold). */
const alwaysFail = () => 0.999;

// ── selectPatrolCandidates ──────────────────────────────────────

describe("selectPatrolCandidates", () => {
  it("generates patrol missions for systems above danger threshold", () => {
    const systems = [makeSystem("a"), makeSystem("b")];
    const danger = new Map([["a", 0.2], ["b", 0.1]]);

    const candidates = selectPatrolCandidates(systems, danger, 100, alwaysPass);
    expect(candidates.length).toBe(1);
    expect(candidates[0].type).toBe("patrol");
    expect(candidates[0].systemId).toBe("a");
    expect(candidates[0].targetSystemId).toBe("a");
  });

  it("skips systems below danger threshold", () => {
    const systems = [makeSystem("a")];
    const danger = new Map([["a", 0.1]]);

    const candidates = selectPatrolCandidates(systems, danger, 100, alwaysPass);
    expect(candidates).toHaveLength(0);
  });

  it("sets deadline correctly", () => {
    const systems = [makeSystem("a")];
    const danger = new Map([["a", 0.3]]);

    const candidates = selectPatrolCandidates(systems, danger, 100, alwaysPass);
    expect(candidates[0].deadlineTick).toBe(100 + OP_MISSION_DEADLINE_TICKS);
  });

  it("includes stat requirements from definition", () => {
    const systems = [makeSystem("a")];
    const danger = new Map([["a", 0.3]]);

    const candidates = selectPatrolCandidates(systems, danger, 100, alwaysPass);
    expect(candidates[0].statRequirements).toEqual(
      expect.objectContaining({ firepower: 5 }),
    );
  });

  it("sets durationTicks within range", () => {
    const systems = [makeSystem("a")];
    const danger = new Map([["a", 0.3]]);

    const candidates = selectPatrolCandidates(systems, danger, 100, alwaysPass);
    const dur = candidates[0].durationTicks!;
    const [min, max] = MISSION_TYPE_DEFS.patrol.durationTicks!;
    expect(dur).toBeGreaterThanOrEqual(min);
    expect(dur).toBeLessThanOrEqual(max);
  });

  it("higher danger gives higher reward", () => {
    const systems = [makeSystem("a"), makeSystem("b")];
    const danger = new Map([["a", 0.15], ["b", 0.45]]);

    const candidates = selectPatrolCandidates(systems, danger, 100, alwaysPass);
    const rewardA = candidates.find((c) => c.systemId === "a")!.reward;
    const rewardB = candidates.find((c) => c.systemId === "b")!.reward;
    expect(rewardB).toBeGreaterThan(rewardA);
  });

  it("probability gating works (high rng skips generation)", () => {
    const systems = [makeSystem("a")];
    const danger = new Map([["a", 0.2]]);

    const candidates = selectPatrolCandidates(systems, danger, 100, alwaysFail);
    expect(candidates).toHaveLength(0);
  });
});

// ── selectSurveyCandidates ──────────────────────────────────────

describe("selectSurveyCandidates", () => {
  it("generates survey missions for systems with eligible traits", () => {
    const systems = [
      makeSystem("a", [{ traitId: "precursor_ruins", quality: 2 }]),
      makeSystem("b", [{ traitId: "habitable_world", quality: 3 }]),
    ];

    const candidates = selectSurveyCandidates(systems, 100, alwaysPass);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe("survey");
    expect(candidates[0].systemId).toBe("a");
  });

  it("skips systems without eligible traits", () => {
    const systems = [
      makeSystem("a", [{ traitId: "asteroid_belt", quality: 2 }]),
    ];

    const candidates = selectSurveyCandidates(systems, 100, alwaysPass);
    expect(candidates).toHaveLength(0);
  });

  it("higher trait quality gives higher reward", () => {
    const systemLow = makeSystem("a", [{ traitId: "gravitational_anomaly", quality: 1 }]);
    const systemHigh = makeSystem("b", [{ traitId: "gravitational_anomaly", quality: 3 }]);

    const candidatesLow = selectSurveyCandidates([systemLow], 100, alwaysPass);
    const candidatesHigh = selectSurveyCandidates([systemHigh], 100, alwaysPass);

    expect(candidatesHigh[0].reward).toBeGreaterThan(candidatesLow[0].reward);
  });

  it("includes sensor stat gate", () => {
    const systems = [
      makeSystem("a", [{ traitId: "dark_nebula", quality: 2 }]),
    ];

    const candidates = selectSurveyCandidates(systems, 100, alwaysPass);
    expect(candidates[0].statRequirements).toEqual(
      expect.objectContaining({ sensors: 6 }),
    );
  });

  it("sets durationTicks within range", () => {
    const systems = [
      makeSystem("a", [{ traitId: "binary_star", quality: 2 }]),
    ];

    const candidates = selectSurveyCandidates(systems, 100, alwaysPass);
    const dur = candidates[0].durationTicks!;
    const [min, max] = MISSION_TYPE_DEFS.survey.durationTicks!;
    expect(dur).toBeGreaterThanOrEqual(min);
    expect(dur).toBeLessThanOrEqual(max);
  });

  it("no enemy tier for survey missions", () => {
    const systems = [
      makeSystem("a", [{ traitId: "subspace_rift", quality: 2 }]),
    ];

    const candidates = selectSurveyCandidates(systems, 100, alwaysPass);
    expect(candidates[0].enemyTier).toBeNull();
  });

  it("multiple eligible traits increase generation probability", () => {
    // With 2 eligible traits, probability is 0.15 * 2 = 0.30
    // rng = 0.25 should pass
    const system = makeSystem("a", [
      { traitId: "precursor_ruins", quality: 2 },
      { traitId: "dark_nebula", quality: 1 },
    ]);

    const candidates = selectSurveyCandidates([system], 100, () => 0.25);
    expect(candidates).toHaveLength(1);
  });
});

// ── selectBountyCandidates ──────────────────────────────────────

describe("selectBountyCandidates", () => {
  it("generates bounty missions for high-danger systems", () => {
    const systems = [makeSystem("a"), makeSystem("b")];
    const danger = new Map([["a", 0.25], ["b", 0.1]]);

    const candidates = selectBountyCandidates(systems, danger, 100, alwaysPass);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe("bounty");
    expect(candidates[0].systemId).toBe("a");
  });

  it("assigns enemy tier based on danger level", () => {
    const systems = [makeSystem("a"), makeSystem("b"), makeSystem("c")];
    const danger = new Map([["a", 0.2], ["b", 0.3], ["c", 0.45]]);

    const candidates = selectBountyCandidates(systems, danger, 100, alwaysPass);
    const tierA = candidates.find((c) => c.systemId === "a")!.enemyTier;
    const tierB = candidates.find((c) => c.systemId === "b")!.enemyTier;
    const tierC = candidates.find((c) => c.systemId === "c")!.enemyTier;

    expect(tierA).toBe("weak");
    expect(tierB).toBe("moderate");
    expect(tierC).toBe("strong");
  });

  it("has no duration (battle-driven)", () => {
    const systems = [makeSystem("a")];
    const danger = new Map([["a", 0.3]]);

    const candidates = selectBountyCandidates(systems, danger, 100, alwaysPass);
    expect(candidates[0].durationTicks).toBeNull();
  });

  it("includes firepower and hullMax stat gates", () => {
    const systems = [makeSystem("a")];
    const danger = new Map([["a", 0.3]]);

    const candidates = selectBountyCandidates(systems, danger, 100, alwaysPass);
    expect(candidates[0].statRequirements).toEqual(
      expect.objectContaining({ firepower: 4, hullMax: 30 }),
    );
  });

  it("higher danger gives higher reward", () => {
    const systems = [makeSystem("a"), makeSystem("b")];
    const danger = new Map([["a", 0.2], ["b", 0.45]]);

    const candidates = selectBountyCandidates(systems, danger, 100, alwaysPass);
    const rewardA = candidates.find((c) => c.systemId === "a")!.reward;
    const rewardB = candidates.find((c) => c.systemId === "b")!.reward;
    expect(rewardB).toBeGreaterThan(rewardA);
  });
});

// ── generateOpMissionCandidates ─────────────────────────────────

describe("generateOpMissionCandidates", () => {
  it("combines all three types", () => {
    const systems = [
      makeSystem("a", [{ traitId: "precursor_ruins", quality: 2 }]),
    ];
    const danger = new Map([["a", 0.3]]);

    const candidates = generateOpMissionCandidates(systems, danger, 100, alwaysPass);
    const types = new Set(candidates.map((c) => c.type));

    expect(types.has("patrol")).toBe(true);
    expect(types.has("survey")).toBe(true);
    expect(types.has("bounty")).toBe(true);
  });

  it("returns empty for safe system with no eligible traits", () => {
    const systems = [makeSystem("a", [{ traitId: "asteroid_belt", quality: 1 }])];
    const danger = new Map([["a", 0.05]]);

    const candidates = generateOpMissionCandidates(systems, danger, 100, alwaysPass);
    expect(candidates).toHaveLength(0);
  });
});
