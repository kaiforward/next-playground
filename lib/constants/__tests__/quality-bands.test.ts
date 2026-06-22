import { describe, it, expect } from "vitest";
import { QUALITY_BANDS } from "@/lib/constants/substrate-gen";

describe("QUALITY_BANDS", () => {
  it("bands are ordered, non-overlapping, weighted", () => {
    const ids = QUALITY_BANDS.map((b) => b.id);
    expect(ids).toEqual(["poor", "average", "good", "rich"]);
    for (let i = 1; i < QUALITY_BANDS.length; i++)
      expect(QUALITY_BANDS[i].min).toBeGreaterThanOrEqual(QUALITY_BANDS[i - 1].max);
    expect(QUALITY_BANDS.every((b) => b.weight > 0 && b.min < b.max)).toBe(true);
  });
});
