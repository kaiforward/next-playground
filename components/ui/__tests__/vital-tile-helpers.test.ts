import { describe, it, expect } from "vitest";
import { compositionSegmentWidths } from "@/components/ui/vital-tile-helpers";

describe("compositionSegmentWidths", () => {
  it("splits a normal set of values into percentages that sum to 100", () => {
    const widths = compositionSegmentWidths([
      { label: "Unskilled", value: 61, color: "var(--color-status-blue)" },
      { label: "Technicians", value: 22, color: "var(--color-status-cyan)" },
      { label: "Engineers", value: 9, color: "var(--color-status-purple)" },
      { label: "Unemployed", value: 8, color: "var(--color-surface-active)" },
    ]);
    expect(widths.map((w) => w.pct)).toEqual([61, 22, 9, 8]);
    expect(widths.reduce((sum, w) => sum + w.pct, 0)).toBe(100);
  });

  it("a zero-total input yields all-zero widths — no NaN/Infinity", () => {
    const widths = compositionSegmentWidths([
      { label: "A", value: 0, color: "red" },
      { label: "B", value: 0, color: "blue" },
    ]);
    for (const w of widths) {
      expect(w.pct).toBe(0);
      expect(Number.isFinite(w.pct)).toBe(true);
    }
  });

  it("an empty segment list returns an empty array (no divide-by-zero)", () => {
    expect(compositionSegmentWidths([])).toEqual([]);
  });

  it("a single non-zero segment renders at 100%", () => {
    const widths = compositionSegmentWidths([{ label: "Solo", value: 42, color: "green" }]);
    expect(widths).toHaveLength(1);
    expect(widths[0].pct).toBe(100);
  });

  it("preserves segment label/color alongside the computed pct", () => {
    const widths = compositionSegmentWidths([{ label: "Solo", value: 10, color: "#abcabc" }]);
    expect(widths[0]).toMatchObject({ label: "Solo", value: 10, color: "#abcabc" });
  });
});
