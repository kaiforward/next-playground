import { describe, it, expect } from "vitest";
import { computeTraitDanger, type GeneratedTrait } from "../trait-gen";
import type { QualityTier, TraitId } from "@/lib/types/game";

// ── Helpers ─────────────────────────────────────────────────────

function makeTrait(traitId: TraitId, quality: QualityTier = 1): GeneratedTrait {
  return { traitId, quality };
}

// ── computeTraitDanger ───────────────────────────────────────────
//
// Danger sums dangerModifier over FEATURE-kind traits only. The archetype
// (volcanic_world / habitable_world) and richness (radioactive_deposits) danger
// traits no longer contribute — real body-type danger is wired from SystemBody
// rows in PR3. See docs/plans/economy-simulation-sp1-pr2-detach-consumers.md
// ("Design decision (resolved)").

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

  it("excludes archetype and richness trait danger (feature-only re-base)", () => {
    // volcanic_world (archetype, +0.05), habitable_world (archetype, -0.03),
    // radioactive_deposits (richness, +0.04) all stop contributing in PR2.
    const traits = [
      makeTrait("volcanic_world", 3),
      makeTrait("habitable_world", 2),
      makeTrait("radioactive_deposits", 3),
    ];
    expect(computeTraitDanger(traits)).toBe(0);
  });

  it("counts only the feature trait's danger in a mixed system", () => {
    // pirate_stronghold (feature, +0.08) kept; volcanic_world (archetype, +0.05) dropped.
    const traits = [makeTrait("pirate_stronghold", 1), makeTrait("volcanic_world", 3)];
    expect(computeTraitDanger(traits)).toBe(0.08);
  });

  it("returns 0 for empty trait list", () => {
    expect(computeTraitDanger([])).toBe(0);
  });
});
