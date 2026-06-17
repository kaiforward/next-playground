import { describe, it, expect } from "vitest";
import { deriveSystemLocations, LOCATIONS } from "../locations";
import { enrichTraits } from "@/lib/utils/traits";
import { TRAITS, ALL_TRAIT_IDS } from "@/lib/constants/traits";
import { BODY_ARCHETYPES, RICHNESS_MODIFIERS } from "@/lib/constants/bodies";
import { makeResourceVector } from "@/lib/engine/resources";
import type {
  SystemTraitInfo,
  TraitId,
  QualityTier,
  BodyArchetypeId,
  RichnessModifierId,
} from "@/lib/types/game";
import type { BodyView } from "@/lib/types/api";

/** Build a BodyView from an archetype + optional richness modifiers. */
function makeBody(
  bodyType: BodyArchetypeId,
  richness: RichnessModifierId[] = [],
): BodyView {
  const arch = BODY_ARCHETYPES[bodyType];
  return {
    id: `body-${bodyType}`,
    bodyType,
    archetypeName: arch.name,
    habitable: arch.habitable,
    size: 1,
    popCapWeight: arch.popCapWeight,
    resources: makeResourceVector({}),
    richness: richness.map((id) => ({
      id,
      name: RICHNESS_MODIFIERS[id].name,
      resource: RICHNESS_MODIFIERS[id].resource,
      multiplier: RICHNESS_MODIFIERS[id].multiplier,
    })),
  };
}

/** Build enriched feature traits from ID + quality pairs. */
function makeFeatures(pairs: Array<[TraitId, QualityTier]>) {
  const raw: SystemTraitInfo[] = pairs.map(([traitId, quality]) => ({
    traitId,
    quality,
  }));
  return enrichTraits(raw);
}

describe("deriveSystemLocations", () => {
  it("always includes the 4 station locations with no bodies or features", () => {
    const result = deriveSystemLocations([], []);
    const stationIds = result
      .filter((l) => l.category === "station")
      .map((l) => l.id);

    expect(stationIds).toContain("cantina");
    expect(stationIds).toContain("docking_bay");
    expect(stationIds).toContain("market_hall");
    expect(stationIds).toContain("repair_bay");
    expect(stationIds).toHaveLength(4);
  });

  it("station locations have null quality/trait fields", () => {
    const result = deriveSystemLocations([], []);
    for (const loc of result.filter((l) => l.category === "station")) {
      expect(loc.quality).toBeNull();
      expect(loc.qualityLabel).toBeNull();
      expect(loc.traitDescription).toBeNull();
      expect(loc.matchedTraitId).toBeNull();
    }
  });

  it("a body archetype yields its mapped site with no quality tier", () => {
    const result = deriveSystemLocations([makeBody("asteroid_belt")], []);
    const systemLocs = result.filter((l) => l.category === "system");

    expect(systemLocs).toHaveLength(1);
    expect(systemLocs[0].id).toBe("asteroid_field");
    expect(systemLocs[0].quality).toBeNull();
    expect(systemLocs[0].matchedTraitId).toBeNull();
  });

  it("habitable and non-habitable worlds both yield planet_surface", () => {
    expect(
      deriveSystemLocations([makeBody("garden_world")], []).some(
        (l) => l.id === "planet_surface",
      ),
    ).toBe(true);
    expect(
      deriveSystemLocations([makeBody("volcanic_world")], []).some(
        (l) => l.id === "planet_surface",
      ),
    ).toBe(true);
  });

  it("a gas giant yields a gas harvesting platform", () => {
    const result = deriveSystemLocations([makeBody("gas_giant")], []);
    expect(result.some((l) => l.id === "gas_harvesting_platform")).toBe(true);
  });

  it("a body richness modifier yields a mining outpost alongside the archetype site", () => {
    const result = deriveSystemLocations(
      [makeBody("asteroid_belt", ["heavy_metals"])],
      [],
    );
    const ids = result.map((l) => l.id);
    expect(ids).toContain("mining_outpost");
    expect(ids).toContain("asteroid_field");
  });

  it("a feature yields its mapped site carrying the feature's quality", () => {
    const result = deriveSystemLocations([], makeFeatures([["precursor_ruins", 3]]));
    const ruins = result.find((l) => l.id === "ruins_expedition");

    expect(ruins).toBeDefined();
    expect(ruins!.quality).toBe(3);
    expect(ruins!.matchedTraitId).toBe("precursor_ruins");
    expect(ruins!.traitDescription).toBe(TRAITS.precursor_ruins.descriptions[3]);
  });

  it("dedup: highest-quality feature wins for the same site", () => {
    // colonial_capital + precursor_ruins both → ruins_expedition
    const result = deriveSystemLocations(
      [],
      makeFeatures([
        ["colonial_capital", 1],
        ["precursor_ruins", 3],
      ]),
    );
    const ruins = result.find((l) => l.id === "ruins_expedition");
    expect(ruins!.quality).toBe(3);
    expect(ruins!.matchedTraitId).toBe("precursor_ruins");
  });

  it("dedup: equal-quality features keep the first seen", () => {
    const result = deriveSystemLocations(
      [],
      makeFeatures([
        ["colonial_capital", 2],
        ["precursor_ruins", 2],
      ]),
    );
    const ruins = result.find((l) => l.id === "ruins_expedition");
    expect(ruins!.matchedTraitId).toBe("colonial_capital");
  });

  it("dedup: a quality-bearing feature overrides a body-derived site of the same type", () => {
    // asteroid_belt body → asteroid_field; ancient_minefield feature → asteroid_field
    const result = deriveSystemLocations(
      [makeBody("asteroid_belt")],
      makeFeatures([["ancient_minefield", 2]]),
    );
    const af = result.filter((l) => l.id === "asteroid_field");
    expect(af).toHaveLength(1);
    expect(af[0].quality).toBe(2);
    expect(af[0].matchedTraitId).toBe("ancient_minefield");
  });

  it("produces multiple distinct sites from a mixed substrate", () => {
    const result = deriveSystemLocations(
      [makeBody("gas_giant"), makeBody("asteroid_belt", ["rare_earth"])],
      makeFeatures([["smuggler_haven", 1]]),
    );
    const ids = result.filter((l) => l.category === "system").map((l) => l.id);

    expect(ids).toContain("gas_harvesting_platform");
    expect(ids).toContain("asteroid_field");
    expect(ids).toContain("mining_outpost");
    expect(ids).toContain("smuggler_den");
  });
});

describe("LOCATIONS catalog coverage", () => {
  it("every location has a unique id matching its key", () => {
    for (const [key, loc] of Object.entries(LOCATIONS)) {
      expect(loc.id).toBe(key);
    }
  });

  it("every body archetype maps to a valid system location", () => {
    for (const arch of Object.values(BODY_ARCHETYPES)) {
      const result = deriveSystemLocations([makeBody(arch.id)], []);
      const systemLocs = result.filter((l) => l.category === "system");
      expect(
        systemLocs.length,
        `archetype "${arch.id}" produced no system location`,
      ).toBeGreaterThan(0);
      for (const l of systemLocs) expect(LOCATIONS[l.id]).toBeDefined();
    }
  });

  it("every richness modifier yields a mining outpost", () => {
    for (const mod of Object.values(RICHNESS_MODIFIERS)) {
      const result = deriveSystemLocations([makeBody("asteroid_belt", [mod.id])], []);
      expect(
        result.some((l) => l.id === "mining_outpost"),
        `richness "${mod.id}" did not yield a mining outpost`,
      ).toBe(true);
    }
  });

  it("every feature trait maps to exactly one valid system location (no orphans)", () => {
    const featureIds = ALL_TRAIT_IDS;
    expect(featureIds.length).toBe(31);
    for (const id of featureIds) {
      const result = deriveSystemLocations([], makeFeatures([[id, 1]]));
      const systemLocs = result.filter((l) => l.category === "system");
      expect(systemLocs.length, `feature "${id}" produced no site`).toBe(1);
      expect(LOCATIONS[systemLocs[0].id]).toBeDefined();
    }
  });
});
