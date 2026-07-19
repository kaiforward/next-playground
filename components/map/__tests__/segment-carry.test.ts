import { describe, it, expect } from "vitest";
import { resolveCarriedSegment } from "../segment-carry";

describe("resolveCarriedSegment", () => {
  it("returns null when no sub-tab is open", () => {
    expect(resolveCarriedSegment("/system/s1", true)).toBeNull();
    expect(resolveCarriedSegment("/system/s1", false)).toBeNull();
  });

  it("carries astrography regardless of the target's developed tier", () => {
    expect(resolveCarriedSegment("/system/s1/astrography", true)).toBe("astrography");
    expect(resolveCarriedSegment("/system/s1/astrography", false)).toBe("astrography");
  });

  it("carries any other sub-tab only when the target is developed", () => {
    expect(resolveCarriedSegment("/system/s1/industry", true)).toBe("industry");
    expect(resolveCarriedSegment("/system/s1/industry", false)).toBeNull();
  });
});
