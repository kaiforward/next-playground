import { describe, it, expect } from "vitest";
import { depositGrade, depositGradeVector, type GradedBody } from "../deposit-grade";
import { makeResourceVector, unitResourceVector, RESOURCE_TYPES } from "../resources";

/** A body with the given ore slot count + quality (all other resources empty). */
function oreBody(slots: number, quality: number): GradedBody {
  return {
    slots: makeResourceVector({ ore: slots }),
    quality: { ...unitResourceVector(), ore: quality },
  };
}

describe("depositGrade", () => {
  it("is the capacity-weighted mean quality across the resource's slots", () => {
    // 2 slots @ 2.0 + 6 slots @ 1.0 → (2·2 + 6·1) / 8 = 1.25. Order-independent (all slots counted).
    const bodies = [oreBody(2, 2.0), oreBody(6, 1.0)];
    expect(depositGrade(bodies, "ore")).toBeCloseTo((2 * 2.0 + 6 * 1.0) / 8, 6);
  });

  it("returns a single body's quality when it is the only host", () => {
    expect(depositGrade([oreBody(5, 1.7)], "ore")).toBeCloseTo(1.7, 6);
  });

  it("is fill-independent — the count of slots does not change the mean, only their quality mix", () => {
    // Doubling every slot count leaves the capacity-weighted mean unchanged.
    const single = [oreBody(2, 2.0), oreBody(6, 1.0)];
    const doubled = [oreBody(4, 2.0), oreBody(12, 1.0)];
    expect(depositGrade(doubled, "ore")).toBeCloseTo(depositGrade(single, "ore"), 6);
  });

  it("returns a neutral 1.0 where the system has no slots for the resource", () => {
    expect(depositGrade([oreBody(4, 2.0)], "water")).toBe(1.0);
    expect(depositGrade([], "ore")).toBe(1.0);
  });
});

describe("depositGradeVector", () => {
  it("grades every resource, neutral where absent", () => {
    const bodies: GradedBody[] = [
      { slots: makeResourceVector({ ore: 4, water: 2 }), quality: { ...unitResourceVector(), ore: 1.5, water: 2.0 } },
    ];
    const v = depositGradeVector(bodies);
    expect(v.ore).toBeCloseTo(1.5, 6);
    expect(v.water).toBeCloseTo(2.0, 6);
    for (const r of RESOURCE_TYPES) {
      if (r !== "ore" && r !== "water") expect(v[r], r).toBe(1.0);
    }
  });
});
