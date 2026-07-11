import { describe, it, expect } from "vitest";
import { formatEta } from "@/lib/utils/construction-format";

describe("formatEta", () => {
  it("renders stalled for null", () => { expect(formatEta(null)).toBe("stalled"); });
  it("singularises one pulse", () => { expect(formatEta(1)).toBe("≈1 pulse"); });
  it("pluralises many pulses", () => { expect(formatEta(4)).toBe("≈4 pulses"); });
});
