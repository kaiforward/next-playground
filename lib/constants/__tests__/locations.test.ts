import { describe, it, expect } from "vitest";
import {
  deriveSystemLocations,
  LOCATIONS,
  type LocationTypeId,
} from "../locations";
import { enrichTraits } from "@/lib/utils/traits";
import { TRAITS, ALL_TRAIT_IDS } from "@/lib/constants/traits";
import type { SystemTraitInfo, TraitId, QualityTier } from "@/lib/types/game";

/** Helper: build a SystemTraitInfo from ID + quality and enrich it. */
function makeTraits(
  pairs: Array<[TraitId, QualityTier]>,
) {
  const raw: SystemTraitInfo[] = pairs.map(([traitId, quality]) => ({
    traitId,
    quality,
  }));
  return enrichTraits(raw);
}

describe("deriveSystemLocations", () => {
  it("always includes station locations even with no traits", () => {
    const result = deriveSystemLocations([]);

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
    const result = deriveSystemLocations([]);

    for (const loc of result.filter((l) => l.category === "station")) {
      expect(loc.quality).toBeNull();
      expect(loc.qualityLabel).toBeNull();
      expect(loc.traitDescription).toBeNull();
      expect(loc.matchedTraitId).toBeNull();
    }
  });

  it("returns system locations matching traits", () => {
    const traits = makeTraits([["asteroid_belt", 2]]);
    const result = deriveSystemLocations(traits);

    const systemLocs = result.filter((l) => l.category === "system");
    expect(systemLocs).toHaveLength(1);
    expect(systemLocs[0].id).toBe("asteroid_field");
    expect(systemLocs[0].quality).toBe(2);
    expect(systemLocs[0].matchedTraitId).toBe("asteroid_belt");
  });

  it("deduplicates: multiple traits mapping to same location keep highest quality", () => {
    // habitable_world and desert_world both map to planet_surface
    const traits = makeTraits([
      ["habitable_world", 1],
      ["desert_world", 3],
    ]);
    const result = deriveSystemLocations(traits);

    const planetSurface = result.find((l) => l.id === "planet_surface");
    expect(planetSurface).toBeDefined();
    expect(planetSurface!.quality).toBe(3);
    expect(planetSurface!.matchedTraitId).toBe("desert_world");
  });

  it("deduplicates: when qualities are equal, first trait wins", () => {
    const traits = makeTraits([
      ["habitable_world", 2],
      ["desert_world", 2],
    ]);
    const result = deriveSystemLocations(traits);

    const planetSurface = result.find((l) => l.id === "planet_surface");
    expect(planetSurface).toBeDefined();
    expect(planetSurface!.quality).toBe(2);
    // First trait in the array wins when quality is equal (not strictly replaced)
    expect(planetSurface!.matchedTraitId).toBe("habitable_world");
  });

  it("produces multiple system locations for diverse trait sets", () => {
    const traits = makeTraits([
      ["asteroid_belt", 2],
      ["precursor_ruins", 3],
      ["smuggler_haven", 1],
    ]);
    const result = deriveSystemLocations(traits);

    const systemIds = result
      .filter((l) => l.category === "system")
      .map((l) => l.id);

    expect(systemIds).toContain("asteroid_field");
    expect(systemIds).toContain("ruins_expedition");
    expect(systemIds).toContain("smuggler_den");
    expect(systemIds).toHaveLength(3);
  });

  it("uses the enriched trait description for traitDescription", () => {
    const traits = makeTraits([["gas_giant", 3]]);
    const result = deriveSystemLocations(traits);

    const gasLoc = result.find((l) => l.id === "gas_harvesting_platform");
    expect(gasLoc).toBeDefined();
    expect(gasLoc!.traitDescription).toBe(
      TRAITS.gas_giant.descriptions[3],
    );
  });

  it("includes quality label from trait tier", () => {
    const traits = makeTraits([["rare_earth_deposits", 1]]);
    const result = deriveSystemLocations(traits);

    const mining = result.find((l) => l.id === "mining_outpost");
    expect(mining).toBeDefined();
    expect(mining!.qualityLabel).toBe("Marginal");
  });
});

describe("LOCATIONS catalog", () => {
  it("every location has a unique id matching its key", () => {
    for (const [key, loc] of Object.entries(LOCATIONS)) {
      expect(loc.id).toBe(key);
    }
  });

  it("station locations have null traitRequirement", () => {
    const stations = Object.values(LOCATIONS).filter(
      (l) => l.category === "station",
    );
    for (const loc of stations) {
      expect(loc.traitRequirement).toBeNull();
    }
  });

  it("system locations have non-empty traitRequirement arrays", () => {
    const systemLocs = Object.values(LOCATIONS).filter(
      (l) => l.category === "system",
    );
    for (const loc of systemLocs) {
      expect(loc.traitRequirement).not.toBeNull();
      expect(loc.traitRequirement!.length).toBeGreaterThan(0);
    }
  });

  it("every trait in the game maps to at least one system location", () => {
    const coveredTraits = new Set<string>();
    for (const loc of Object.values(LOCATIONS)) {
      if (loc.traitRequirement) {
        for (const traitId of loc.traitRequirement) {
          coveredTraits.add(traitId);
        }
      }
    }

    for (const traitId of ALL_TRAIT_IDS) {
      expect(
        coveredTraits.has(traitId),
        `Trait "${traitId}" is not mapped to any location`,
      ).toBe(true);
    }
  });

  it("every traitRequirement references a valid TraitId", () => {
    const validTraits = new Set(ALL_TRAIT_IDS);
    for (const loc of Object.values(LOCATIONS)) {
      if (loc.traitRequirement) {
        for (const traitId of loc.traitRequirement) {
          expect(
            validTraits.has(traitId),
            `Location "${loc.id}" references unknown trait "${traitId}"`,
          ).toBe(true);
        }
      }
    }
  });
});
