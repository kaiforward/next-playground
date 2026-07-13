import { describe, it, expect } from "vitest";
import { EXPANSION } from "@/lib/constants/expansion";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

describe("EXPANSION constants", () => {
  it("bounds reach within the hop-BFS radius the tick computes", () => {
    expect(EXPANSION.REACH_JUMPS).toBeGreaterThanOrEqual(1);
    expect(EXPANSION.REACH_JUMPS).toBeLessThanOrEqual(
      Math.max(DIRECTED_BUILD.MAX_HOPS, DIRECTED_LOGISTICS.MAX_HOPS),
    );
  });

  it("keeps claims gradual (small per-pulse cap, permissive positive floor)", () => {
    expect(EXPANSION.MAX_CLAIMS_PER_PULSE).toBeGreaterThanOrEqual(1);
    expect(EXPANSION.SCORE_FLOOR).toBeGreaterThan(0);
  });

  it("carries the substrate + proximity score weights and a positive colony seed", () => {
    for (const k of ["habitable", "diversity", "proximity"] as const) {
      expect(EXPANSION.SCORE_WEIGHTS[k]).toBeGreaterThan(0);
    }
    expect(EXPANSION.DEVELOP_HABITABLE_FLOOR).toBeGreaterThan(0);
    expect(EXPANSION.COLONY_SEED_POP).toBeGreaterThan(0);
  });

  it("keeps the colony seed a tiny bootstrap spark, not a population transfer (seed model C)", () => {
    // A big seed drains the source and dumps pops on a jobless world faster than jobs form; seed
    // model C moves a tiny spark and lets job-aware migration grow the colony. Guard against the
    // seed silently regrowing back toward a transfer size.
    expect(EXPANSION.COLONY_SEED_POP).toBeLessThanOrEqual(5);
  });
});
