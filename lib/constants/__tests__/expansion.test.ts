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

  it("keeps claims + developments gradual (small per-pulse caps, permissive positive floor)", () => {
    expect(EXPANSION.MAX_CLAIMS_PER_PULSE).toBeGreaterThanOrEqual(1);
    expect(EXPANSION.MAX_DEVELOPS_PER_PULSE).toBeGreaterThanOrEqual(1);
    expect(EXPANSION.SCORE_FLOOR).toBeGreaterThan(0);
  });

  it("carries the four substrate + proximity score weights and a positive colony seed", () => {
    for (const k of ["habitable", "diversity", "trait", "proximity"] as const) {
      expect(EXPANSION.SCORE_WEIGHTS[k]).toBeGreaterThan(0);
    }
    expect(EXPANSION.DEVELOP_HABITABLE_FLOOR).toBeGreaterThan(0);
    expect(EXPANSION.COLONY_SEED_POP).toBeGreaterThan(0);
  });
});
