import { describe, it, expect } from "vitest";
import { TRAIT_MIGRATION } from "../trait-migration";
import { BODY_ARCHETYPES, RICHNESS_MODIFIERS } from "../bodies";
import type { TraitId } from "@/lib/types/game";
import { ALL_TRAIT_IDS } from "@/lib/constants/traits";
import {
  SURVEY_ELIGIBLE_TRAITS, SALVAGE_ELIGIBLE_TRAITS, RECON_ELIGIBLE_TRAITS,
} from "@/lib/constants/missions";

describe("TRAIT_MIGRATION", () => {
  it("classifies every trait exactly once and adds no extras", () => {
    expect(Object.keys(TRAIT_MIGRATION).sort()).toEqual([...ALL_TRAIT_IDS].sort());
  });

  it("archetype targets are valid body archetypes", () => {
    for (const m of Object.values(TRAIT_MIGRATION)) {
      if (m.kind === "archetype") expect(BODY_ARCHETYPES[m.archetype].id).toBe(m.archetype);
    }
  });

  it("richness targets are valid richness modifiers", () => {
    for (const m of Object.values(TRAIT_MIGRATION)) {
      if (m.kind === "richness") expect(RICHNESS_MODIFIERS[m.modifier].id).toBe(m.modifier);
    }
  });

  it("every mission-eligible trait survives as a feature", () => {
    const eligible = new Set<TraitId>([
      ...SURVEY_ELIGIBLE_TRAITS, ...SALVAGE_ELIGIBLE_TRAITS, ...RECON_ELIGIBLE_TRAITS,
    ]);
    for (const traitId of eligible) {
      expect(TRAIT_MIGRATION[traitId]?.kind).toBe("feature");
    }
  });

  it("has the expected bucket counts (8 archetype / 13 richness / 31 feature)", () => {
    const counts = { archetype: 0, richness: 0, feature: 0 };
    for (const m of Object.values(TRAIT_MIGRATION)) counts[m.kind]++;
    expect(counts).toEqual({ archetype: 8, richness: 13, feature: 31 });
  });
});
