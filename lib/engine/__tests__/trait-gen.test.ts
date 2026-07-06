import { describe, it, expect } from "vitest";
import { computeTraitDanger, type GeneratedTrait } from "../trait-gen";
import type { QualityTier, TraitId } from "@/lib/types/game";

// ── Helpers ─────────────────────────────────────────────────────

function makeTrait(traitId: TraitId, quality: QualityTier = 1): GeneratedTrait {
  return { traitId, quality };
}

// ── computeTraitDanger ───────────────────────────────────────────
//
// Sums dangerModifier over a system's feature traits. Body-type environmental
// danger is summed separately as bodyDanger.

describe("computeTraitDanger", () => {
  it("returns 0 for a feature trait with no danger modifier", () => {
    const traits = [makeTrait("precursor_ruins", 3)];
    expect(computeTraitDanger(traits)).toBe(0);
  });

  it("returns a positive value for dangerous feature traits", () => {
    const traits = [makeTrait("dark_nebula", 2)];
    expect(computeTraitDanger(traits)).toBe(0.06);
  });

  it("returns a negative value for safe feature traits", () => {
    const traits = [makeTrait("lagrange_stations", 1)];
    expect(computeTraitDanger(traits)).toBe(-0.03);
  });

  it("stacks multiple feature danger modifiers", () => {
    const traits = [makeTrait("dark_nebula", 3), makeTrait("subspace_rift", 2)];
    expect(computeTraitDanger(traits)).toBe(0.14); // 0.06 + 0.08 (exact in IEEE-754)
  });

  it("positive and negative feature modifiers cancel out", () => {
    const traits = [makeTrait("dark_nebula", 1), makeTrait("lagrange_stations", 2)];
    expect(computeTraitDanger(traits)).toBe(0.03); // 0.06 - 0.03 (exact in IEEE-754)
  });

  it("returns 0 for empty trait list", () => {
    expect(computeTraitDanger([])).toBe(0);
  });
});
