import { describe, it, expect } from "vitest";
import { BODY_ARCHETYPES } from "../bodies";

describe("BODY_ARCHETYPES — generalWeight and habitableFraction", () => {
  const archetypes = Object.values(BODY_ARCHETYPES);

  it("every archetype has generalWeight >= 0 and habitableFraction in [0, 1]", () => {
    for (const a of archetypes) {
      expect(a.generalWeight).toBeGreaterThanOrEqual(0);
      expect(a.habitableFraction).toBeGreaterThanOrEqual(0);
      expect(a.habitableFraction).toBeLessThanOrEqual(1);
    }
  });

  it("every habitable archetype has habitableFraction > 0", () => {
    for (const a of archetypes.filter((a) => a.habitable)) {
      expect(a.habitableFraction).toBeGreaterThan(0);
    }
  });

  it("every non-habitable archetype has habitableFraction <= 0.1", () => {
    for (const a of archetypes.filter((a) => !a.habitable)) {
      expect(a.habitableFraction).toBeLessThanOrEqual(0.1);
    }
  });

  it("garden_world has the largest generalWeight of all archetypes", () => {
    const gardenWeight = BODY_ARCHETYPES.garden_world.generalWeight;
    for (const a of archetypes) {
      if (a.id !== "garden_world") {
        expect(gardenWeight).toBeGreaterThan(a.generalWeight);
      }
    }
  });
});
