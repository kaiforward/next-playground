import { describe, it, expect } from "vitest";
import { formatEta } from "@/lib/utils/construction-format";

describe("formatEta", () => {
  it("renders stalled for null", () => { expect(formatEta(null)).toBe("stalled"); });
  it("converts construction cycles to an in-world duration — 1 cycle = 24 ticks = 6 days", () => {
    expect(formatEta(1)).toBe("≈6 days");
  });
  it("inherits the duration auto-scale — 170 cycles crosses into months", () => {
    // 170 × 24 ticks = 1,020 days ≥ 300 → years branch: 1020/360 = 2.83 → tenths.
    expect(formatEta(170)).toBe("≈2.8 years");
  });
});
