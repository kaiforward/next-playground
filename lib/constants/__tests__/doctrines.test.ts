import { describe, it, expect } from "vitest";
import { DOCTRINES } from "../doctrines";
import { ALL_DOCTRINES, isDoctrine } from "@/lib/types/guards";

describe("DOCTRINES", () => {
  it("defines an entry for every Doctrine", () => {
    for (const doctrine of ALL_DOCTRINES) {
      expect(DOCTRINES[doctrine]).toBeDefined();
    }
  });

  it("includes all 5 doctrines", () => {
    expect(ALL_DOCTRINES).toHaveLength(5);
    expect(Object.keys(DOCTRINES).sort()).toEqual([...ALL_DOCTRINES].sort());
  });

  it("every entry has a non-empty name and description", () => {
    for (const doctrine of ALL_DOCTRINES) {
      const def = DOCTRINES[doctrine];
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("declarationModifier stays within the intended narrow band (0.5 – 1.5)", () => {
    for (const doctrine of ALL_DOCTRINES) {
      const m = DOCTRINES[doctrine].declarationModifier;
      expect(m).toBeGreaterThanOrEqual(0.5);
      expect(m).toBeLessThanOrEqual(1.5);
    }
  });

  it("exhaustionMultiplier stays within the intended narrow band (0.5 – 1.5)", () => {
    for (const doctrine of ALL_DOCTRINES) {
      const m = DOCTRINES[doctrine].exhaustionMultiplier;
      expect(m).toBeGreaterThanOrEqual(0.5);
      expect(m).toBeLessThanOrEqual(1.5);
    }
  });

  it("expansionist has the highest declarationModifier (most war-prone)", () => {
    const values = ALL_DOCTRINES.map((d) => [d, DOCTRINES[d].declarationModifier] as const);
    const max = values.reduce((a, b) => (a[1] >= b[1] ? a : b));
    expect(max[0]).toBe("expansionist");
  });

  it("protectionist has the lowest declarationModifier (least war-prone)", () => {
    const values = ALL_DOCTRINES.map((d) => [d, DOCTRINES[d].declarationModifier] as const);
    const min = values.reduce((a, b) => (a[1] <= b[1] ? a : b));
    expect(min[0]).toBe("protectionist");
  });

  it("isDoctrine recognizes every key in DOCTRINES", () => {
    for (const key of Object.keys(DOCTRINES)) {
      expect(isDoctrine(key)).toBe(true);
    }
  });
});
