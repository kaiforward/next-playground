import { describe, expect, it } from "vitest";
import { needSeverity, splitNeedsLedger, SEVERITY_GLYPH, buildProblems } from "@/components/system/needs-view";

describe("needs view-model", () => {
  it("classifies severity at the approved thresholds", () => {
    expect(needSeverity(1)).toBe("met");
    expect(needSeverity(0.95)).toBe("met");
    expect(needSeverity(0.949)).toBe("short");
    expect(needSeverity(0.5)).toBe("short");
    expect(needSeverity(0.499)).toBe("critical");
  });
  it("splits problems from met, preserving input (pressure) order", () => {
    const rows = [{ satisfaction: 0.6 }, { satisfaction: 1 }, { satisfaction: 0.4 }, { satisfaction: 0.99 }];
    const { problems, met } = splitNeedsLedger(rows);
    expect(problems.map((r) => r.satisfaction)).toEqual([0.6, 0.4]);
    expect(met.map((r) => r.satisfaction)).toEqual([1, 0.99]);
  });
  it("glyphs are shape-distinct", () => {
    expect(new Set(Object.values(SEVERITY_GLYPH)).size).toBe(3);
  });
});

describe("buildProblems", () => {
  const label = (id: string) => id;
  it("healthy row → empty (renders nothing)", () => {
    expect(buildProblems({ inputGate: 1, throttledBy: [] }, { satisfaction: 1 }, label)).toEqual([]);
    expect(buildProblems(undefined, undefined, label)).toEqual([]);
  });
  it("input throttle and pop shortage each produce an item; both can coexist", () => {
    const items = buildProblems({ inputGate: 0.62, throttledBy: ["gas"] }, { satisfaction: 0.41 }, label);
    expect(items).toEqual([
      { kind: "input", label: "gas 62%", severity: "short" },
      { kind: "pops", label: "pops short 41%", severity: "critical" },
    ]);
  });
  it("a throttled input with a met-grade gate still reads short, never green", () => {
    expect(buildProblems({ inputGate: 0.97, throttledBy: ["gas"] }, undefined, label)).toEqual([
      { kind: "input", label: "gas 97%", severity: "short" },
    ]);
  });
});
