import { describe, expect, it } from "vitest";
import { needSeverity, splitNeedsLedger, SEVERITY_GLYPH, buildProblems, NEED_MET_SATISFACTION } from "@/components/system/needs-view";
import { SHORTAGE_SATISFACTION } from "@/lib/constants/economy";

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

  it("the met boundary tracks the named constant, not a stray literal — moves if NEED_MET_SATISFACTION moves", () => {
    expect(needSeverity(NEED_MET_SATISFACTION)).toBe("met");
    expect(needSeverity(NEED_MET_SATISFACTION - 0.001)).not.toBe("met");
  });

  it("the critical boundary tracks SHORTAGE_SATISFACTION — the same line the survival-good fold reads", () => {
    expect(needSeverity(SHORTAGE_SATISFACTION)).toBe("short");
    expect(needSeverity(SHORTAGE_SATISFACTION - 0.001)).toBe("critical");
  });

  it("a need exactly at the met boundary lands on the met side in the ledger split, not just in needSeverity", () => {
    const rows = [{ satisfaction: NEED_MET_SATISFACTION }, { satisfaction: NEED_MET_SATISFACTION - 0.001 }];
    const { problems, met } = splitNeedsLedger(rows);
    expect(met).toEqual([{ satisfaction: NEED_MET_SATISFACTION }]);
    expect(problems).toEqual([{ satisfaction: NEED_MET_SATISFACTION - 0.001 }]);
  });

  it("the ledger's met tail and an industry-panel-style unmet filter agree on every row — one predicate, two call sites", () => {
    // `rows.filter((n) => needSeverity(n.satisfaction) !== "met")` is the exact expression
    // industry-panel.tsx uses to build `unmet` — reproduced here to pin the two surfaces together.
    const rows = [
      { satisfaction: 1 },
      { satisfaction: NEED_MET_SATISFACTION },
      { satisfaction: NEED_MET_SATISFACTION - 0.001 },
      { satisfaction: 0.6 },
      { satisfaction: 0 },
    ];
    const { problems, met } = splitNeedsLedger(rows);
    const unmet = rows.filter((n) => needSeverity(n.satisfaction) !== "met");
    expect(unmet).toEqual(problems);
    expect(met.length + problems.length).toBe(rows.length);
  });

  it("filtering never re-sorts by gap depth — pressure order (input order) survives even where it contradicts gap depth", () => {
    // Pressure-sorted upstream (computePopNeeds): a shallow gap (0.8) can lead a deep one (0.3)
    // when it carries more necessity-weighted share. The top-2 readers must not undo that.
    const rows = [{ satisfaction: 0.8 }, { satisfaction: 0.3 }, { satisfaction: 0.99 }];
    const { problems } = splitNeedsLedger(rows);
    expect(problems.map((r) => r.satisfaction)).toEqual([0.8, 0.3]);
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

  it("the industry input gate shares both boundaries with a pop need — same function, a different quantity", () => {
    // At SHORTAGE_SATISFACTION exactly: still "short" (the critical cut is strict `<`).
    expect(buildProblems({ inputGate: SHORTAGE_SATISFACTION, throttledBy: ["gas"] }, undefined, label)).toEqual([
      { kind: "input", label: `gas ${Math.round(SHORTAGE_SATISFACTION * 100)}%`, severity: "short" },
    ]);
    // Just below SHORTAGE_SATISFACTION: critical, same as a pop need would read.
    const belowCritical = buildProblems({ inputGate: SHORTAGE_SATISFACTION - 0.01, throttledBy: ["gas"] }, undefined, label);
    expect(belowCritical[0].severity).toBe("critical");
    // At NEED_MET_SATISFACTION exactly: "met" is downgraded to "short" for a throttled input — never green.
    const atMet = buildProblems({ inputGate: NEED_MET_SATISFACTION, throttledBy: ["gas"] }, undefined, label);
    expect(atMet[0].severity).toBe("short");
  });
});
