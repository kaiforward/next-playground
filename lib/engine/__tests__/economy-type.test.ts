import { describe, it, expect } from "vitest";
import { deriveEconomyTypeLabel } from "../economy-type";
import { makeResourceVector, unitResourceVector } from "../resources";

// The classifier reads the effective deposit potential (slotCap[r] × yieldMult[r]).
// Passing unit yields makes the effective vector equal the slotCap, so these cases
// exercise the threshold logic on a known vector exactly as the legacy aggregate did.
const UNIT = unitResourceVector();

describe("deriveEconomyTypeLabel", () => {
  it("returns extraction for a zero slotCap (matches legacy fallback)", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({}), UNIT, 0)).toBe("extraction");
  });

  it("classifies an arable/biomass-dominant low-pop system as agricultural", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ arable: 8, biomass: 4, ore: 1 }), UNIT, 1000))
      .toBe("agricultural");
  });

  it("classifies an ore/mineral-dominant low-pop system as extraction", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ ore: 6, minerals: 6, water: 1 }), UNIT, 1000))
      .toBe("extraction");
  });

  it("classifies a mid-pop mixed system as refinery", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ water: 4, ore: 2, biomass: 1, gas: 1 }), UNIT, 4000))
      .toBe("refinery");
  });

  it("classifies a populous balanced/food system as core", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ arable: 4, biomass: 3, water: 4, ore: 2 }), UNIT, 15000))
      .toBe("core");
  });

  it("classifies a populous raw-heavy system as industrial", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ ore: 6, minerals: 5, gas: 3 }), UNIT, 15000))
      .toBe("industrial");
  });

  it("classifies a populous low-resource system as tech", () => {
    expect(deriveEconomyTypeLabel(makeResourceVector({ water: 5, biomass: 1 }), UNIT, 15000))
      .toBe("tech");
  });

  it("reads the effective potential — yieldMult scales the slotCap", () => {
    // A slot-rich-but-poor-quality ore world reads low-potential; a high yield on
    // ore lifts the effective ore share so a balanced slotCap reads extraction.
    const slotCap = makeResourceVector({ ore: 4, water: 4 });
    const oreRich = { ...unitResourceVector(), ore: 5 };
    expect(deriveEconomyTypeLabel(slotCap, oreRich, 100)).toBe("extraction");
  });

  it("always returns one of the six economy types", () => {
    const result = deriveEconomyTypeLabel(makeResourceVector({ gas: 2, ore: 2, water: 2 }), UNIT, 500);
    expect(["agricultural", "extraction", "refinery", "industrial", "tech", "core"]).toContain(result);
  });
});
