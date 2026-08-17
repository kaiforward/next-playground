import { describe, expect, it } from "vitest";
import { needSeverity, splitNeedsLedger, SEVERITY_GLYPH, buildProblems, NEED_MET_SATISFACTION } from "@/components/system/needs-view";
import { SHORTAGE_SATISFACTION } from "@/lib/constants/economy";
import type { IdleReason } from "@/lib/engine/industry";

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
  const staffed: { staffedFraction: number; idleReason?: IdleReason } = { staffedFraction: 1, idleReason: undefined };

  it("healthy row → empty (renders nothing)", () => {
    expect(buildProblems(staffed, { inputGate: 1, throttledBy: [] }, { satisfaction: 1 }, label)).toEqual([]);
    expect(buildProblems(undefined, undefined, undefined, label)).toEqual([]);
  });
  it("input throttle and pop shortage each produce an item; both can coexist", () => {
    const items = buildProblems(staffed, { inputGate: 0.62, throttledBy: ["gas"] }, { satisfaction: 0.41 }, label);
    expect(items).toEqual([
      { kind: "input", label: "gas 62%", severity: "short" },
      { kind: "pops", label: "pops short 41%", severity: "critical" },
    ]);
  });
  it("a throttled input with a met-grade gate still reads short, never green", () => {
    expect(buildProblems(staffed, { inputGate: 0.97, throttledBy: ["gas"] }, undefined, label)).toEqual([
      { kind: "input", label: "gas 97%", severity: "short" },
    ]);
  });

  it("the industry input gate shares both boundaries with a pop need — same function, a different quantity", () => {
    // At SHORTAGE_SATISFACTION exactly: still "short" (the critical cut is strict `<`).
    expect(buildProblems(staffed, { inputGate: SHORTAGE_SATISFACTION, throttledBy: ["gas"] }, undefined, label)).toEqual([
      { kind: "input", label: `gas ${Math.round(SHORTAGE_SATISFACTION * 100)}%`, severity: "short" },
    ]);
    // Just below SHORTAGE_SATISFACTION: critical, same as a pop need would read.
    const belowCritical = buildProblems(staffed, { inputGate: SHORTAGE_SATISFACTION - 0.01, throttledBy: ["gas"] }, undefined, label);
    expect(belowCritical[0].severity).toBe("critical");
    // At NEED_MET_SATISFACTION exactly: "met" is downgraded to "short" for a throttled input — never green.
    const atMet = buildProblems(staffed, { inputGate: NEED_MET_SATISFACTION, throttledBy: ["gas"] }, undefined, label);
    expect(atMet[0].severity).toBe("short");
  });

  // ── staffing + selling ───────────────────────────────────────

  it("Proves 1 — a fully staffed, input-satisfied, freely selling producer yields an empty item list", () => {
    expect(buildProblems({ staffedFraction: 1, idleReason: undefined }, { inputGate: 1, throttledBy: [] }, { satisfaction: 1 }, label)).toEqual([]);
  });

  it("Proves 2 — glut appears only when fully staffed AND input-satisfied", () => {
    // Fully staffed, no input throttle, engine names selling as the binding constraint → glut.
    expect(buildProblems({ staffedFraction: 1, idleReason: "selling" }, { inputGate: 1, throttledBy: [] }, undefined, label)).toEqual([
      { kind: "selling", label: "Glut", severity: "short" },
    ]);
    // Same staffing/selling reading, but the good is ALSO input-throttled — an input-starved
    // producer must never read as glut while its stock drains: only the input item shows.
    const inputStarved = buildProblems({ staffedFraction: 1, idleReason: "selling" }, { inputGate: 0.4, throttledBy: ["gas"] }, undefined, label);
    expect(inputStarved).toEqual([{ kind: "input", label: "gas 40%", severity: "critical" }]);
    expect(inputStarved.some((i) => i.kind === "selling")).toBe(false);
  });

  it("Proves 3 — an understaffed producer names the binding grade, not a generic labour shortfall", () => {
    const engineers = buildProblems({ staffedFraction: 0.6, idleReason: "skill2" }, undefined, undefined, label);
    expect(engineers).toEqual([{ kind: "staffing", label: "Engineers understaffed 60%", severity: "short" }]);
    const technicians = buildProblems({ staffedFraction: 0.3, idleReason: "skill1" }, undefined, undefined, label);
    expect(technicians[0].label).toBe("Technicians understaffed 30%");
    const unskilled = buildProblems({ staffedFraction: 0.45, idleReason: "labour" }, undefined, undefined, label);
    expect(unskilled[0].label).toBe("Unskilled understaffed 45%");
  });

  it("Proves 4 — an input-short producer lists every short input, not only the worst", () => {
    const items = buildProblems(staffed, { inputGate: 0.3, throttledBy: ["gas", "ore", "water"] }, undefined, label);
    expect(items).toEqual([
      { kind: "input", label: "gas 30%", severity: "critical" },
      { kind: "input", label: "ore 30%", severity: "critical" },
      { kind: "input", label: "water 30%", severity: "critical" },
    ]);
  });

  it("Proves 5 — housing rows never produce a selling item", () => {
    // Housing's idleReason is "occupancy", never "selling" — a low-occupancy housing row must not
    // read as glut, and (occupancy not being a labour reason) must not read as understaffed either.
    expect(buildProblems({ staffedFraction: 0.4, idleReason: "occupancy" }, undefined, undefined, label)).toEqual([]);
  });

  // ── Fix 2: an understaffed-AND-glutting producer must read understaffed, not Glut ────────────

  it("a producer where selling binds tighter than staffing still reads understaffed, generically (the engine never measured which grade) — and never reads Glut", () => {
    // idleReason "selling" here means selling binds TIGHTER than labour (canSell < fulfil) — it does
    // not mean labour is fine. staffedFraction 0.6 is genuinely short, so the staffing item must fire
    // and the Glut item must not, even though the engine's own idleReason says "selling".
    const items = buildProblems({ staffedFraction: 0.6, idleReason: "selling" }, undefined, undefined, label);
    expect(items).toEqual([{ kind: "staffing", label: "Understaffed 60%", severity: "short" }]);
    expect(items.some((i) => i.kind === "selling")).toBe(false);
  });

  it("a capacity/modifier row (academy or complex — idleReason undefined) never reads understaffed", () => {
    // Academies/complexes never carry idleReason at all (buildIndustryReadout only sets it for
    // housing and producers) — a low staffedFraction here is licence/family draw, not a labour
    // shortfall, and must not surface a staffing chip.
    expect(buildProblems({ staffedFraction: 0.5, idleReason: undefined }, undefined, undefined, label)).toEqual([]);
  });

  it("housing (idleReason occupancy) never reads understaffed OR selling, at any staffedFraction", () => {
    expect(buildProblems({ staffedFraction: 0.5, idleReason: "occupancy" }, undefined, undefined, label)).toEqual([]);
  });

  // ── A sixth IdleReason: "inputs" (input starvation) ──────────────────────

  it("Proves 2 — a fully staffed, input-starved producer renders no understaffed chip (only the real input chip)", () => {
    // Same fully-staffed factory buildIndustryReadout now names 'inputs' for. staffedFraction stays
    // 1 (pure staffing ratio, unaffected by the gate — see industry.ts), so the severity number is
    // what keeps this row's staffing chip away — not the reason. The genuinely-short counterpart
    // below shows the same reason DOES raise a chip once the staffing number is short.
    const items = buildProblems({ staffedFraction: 1, idleReason: "inputs" }, { inputGate: 0, throttledBy: ["ore"] }, undefined, label);
    expect(items).toEqual([{ kind: "input", label: "ore 0%", severity: "critical" }]);
    expect(items.some((i) => i.kind === "staffing")).toBe(false);
  });

  it("a producer that is BOTH input-starved and understaffed shows both chips", () => {
    // The row shows a chip for every negative state, and `idleReason` names only the tightest one.
    // "inputs" binding says nothing about labour — `staffedFraction` is the pure staffing ratio, and
    // 0.5 is genuinely short — so an input chip alone would hide half of what is wrong with this
    // producer. Exactly the "selling" case one describe above, with the sixth reason in its place.
    const items = buildProblems({ staffedFraction: 0.5, idleReason: "inputs" }, { inputGate: 0, throttledBy: ["ore"] }, undefined, label);
    expect(items).toEqual([
      // Generic, not grade-named: with inputs binding tightest the engine never measured which
      // labour grade was the wall, the same reason "selling" falls back to the generic chip.
      { kind: "staffing", label: "Understaffed 50%", severity: "short" },
      { kind: "input", label: "ore 0%", severity: "critical" },
    ]);
    // …and still no Glut: that branch is reserved for idleReason "selling".
    expect(items.some((i) => i.kind === "selling")).toBe(false);
  });

  it("'inputs' never reads Glut either — Glut is reserved for idleReason 'selling'", () => {
    // The Glut branch checks `idleReason === "selling"` specifically; an input-starved producer
    // with nothing else short and no throttledBy data supplied must render no items at all rather
    // than falling into the selling-only Glut path.
    expect(buildProblems({ staffedFraction: 1, idleReason: "inputs" }, undefined, undefined, label)).toEqual([]);
  });
});
