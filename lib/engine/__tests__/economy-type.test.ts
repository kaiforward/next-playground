import { describe, it, expect } from "vitest";
import { deriveEconomyTypeLabel } from "../economy-type";
import { makeResourceVector } from "../resources";

describe("deriveEconomyTypeLabel", () => {
  it("returns extraction for a zero aggregate (matches legacy fallback)", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({}), 0)).toBe("extraction");
  });

  it("classifies an arable/biomass-dominant low-pop system as agricultural", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ arable: 8, biomass: 4, ore: 1 }), 100))
      .toBe("agricultural");
  });

  it("classifies an ore/mineral-dominant low-pop system as extraction", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ ore: 6, minerals: 6, water: 1 }), 100))
      .toBe("extraction");
  });

  it("classifies a mid-pop mixed system as refinery", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ water: 4, ore: 2, biomass: 1, gas: 1 }), 400))
      .toBe("refinery");
  });

  it("classifies a populous balanced/food system as core", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ arable: 4, biomass: 3, water: 4, ore: 2 }), 1500))
      .toBe("core");
  });

  it("classifies a populous raw-heavy system as industrial", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ ore: 6, minerals: 5, gas: 3 }), 1500))
      .toBe("industrial");
  });

  it("classifies a populous low-resource system as tech", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ water: 5, biomass: 1 }), 1500))
      .toBe("tech");
  });

  it("always returns one of the six economy types", () => {
    const result = deriveEconomyTypeLabel(makeResourceVector({ gas: 2, ore: 2, water: 2 }), 500);
    expect(["agricultural", "extraction", "refinery", "industrial", "tech", "core"]).toContain(result);
  });
});
