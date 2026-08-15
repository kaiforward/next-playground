/** Shared needs view-model — severity thresholds, glyphs, ledger split. No DOM, no React. */
import { SHORTAGE_SATISFACTION } from "@/lib/constants/economy";
import type { IdleReason } from "@/lib/engine/industry";

export type NeedSeverity = "met" | "short" | "critical";

/**
 * Satisfaction at or above which a single need reads "met" — answers "is this particular good fully
 * served", a per-good attention line. Deliberately NOT the same line as the system band's Supplied
 * edge (a separate constant, near 0.90), which answers "is anything wrong here" as a world mean: the
 * two disagree on ~6 of 582 worlds on cliff data, and that disagreement is correct — a good can read
 * short without moving the world mean, and vice versa. Never import the band edges here.
 */
export const NEED_MET_SATISFACTION = 0.95;

export function needSeverity(satisfaction: number): NeedSeverity {
  if (satisfaction >= NEED_MET_SATISFACTION) return "met";
  if (satisfaction >= SHORTAGE_SATISFACTION) return "short";
  return "critical";
}

/** Shape-first (colourblind-safe) severity glyphs. */
export const SEVERITY_GLYPH: Record<NeedSeverity, string> = { met: "✓", short: "⚠", critical: "▼" };
export const SEVERITY_TEXT: Record<NeedSeverity, string> = {
  met: "text-status-green-light",
  short: "text-status-amber-light",
  critical: "text-status-red-light",
};

export interface NeedsLedgerRows<T extends { satisfaction: number }> { problems: T[]; met: T[] }

/** Split pressure-sorted needs into inline problem rows and the collapsed met tail (order preserved). */
export function splitNeedsLedger<T extends { satisfaction: number }>(needs: T[]): NeedsLedgerRows<T> {
  return {
    problems: needs.filter((n) => needSeverity(n.satisfaction) !== "met"),
    met: needs.filter((n) => needSeverity(n.satisfaction) === "met"),
  };
}

export interface ProblemItem { kind: "input" | "pops" | "staffing" | "selling"; label: string; severity: NeedSeverity }

/**
 * The labour grade a producer's idleReason names, for the "understaffed on which grade" chip —
 * undefined when the binding constraint isn't a named labour grade. That covers "selling": when
 * selling binds tighter than labour the engine never computes *which* grade was the wall (see
 * `buildIndustryReadout`'s idleReason branch, `industry.ts:790-804` — the skill1/skill2/labour
 * branches only run when selling and inputs do NOT bind tightest), so naming one we didn't measure
 * would be worse than staying generic. Callers fall back to a plain "Understaffed" chip in that case.
 * "inputs" never reaches here at all — `buildProblems`'s `hasBindingReason` excludes it before this
 * function is called, since a recipe shortfall already has its own, more precise report via the
 * `supply`/`throttledBy` argument.
 */
function staffingGradeName(reason: IdleReason | undefined): string | undefined {
  switch (reason) {
    case "labour": return "Unskilled";
    case "skill1": return "Technicians";
    case "skill2": return "Engineers";
    default: return undefined;
  }
}

/**
 * Exception-reporting: items exist only for actual problems; a healthy row returns [].
 *
 * Precedence (spec §1/§6): understaffed classifies first — only a producer that is both fully
 * staffed and input-satisfied can read Glut. Staffing is keyed off the *severity number*
 * (`staffedFraction`), not off `idleReason` naming a labour grade: `idleReason` reads "selling"
 * whenever selling binds *tighter* than labour (`canSell < fulfil` at `industry.ts:797`), including
 * while the producer is ALSO short on labour — so gating the staffing item on "idleReason is a
 * labour reason" would let an understaffed-and-glutting producer read as pure Glut with no
 * understaffed chip at all. Any binding reason other than "occupancy" (housing), "inputs" (a recipe
 * input, reported instead through the dedicated `supply`/`throttledBy` argument below — see
 * `industry.ts:790-804`) or `undefined` (capacity/modifier rows with nothing binding) can gate a
 * staffing item; `idleReason` is then only used to *name the grade*, via `staffingGradeName` — which
 * falls back to a generic "Understaffed" chip when the reason is "selling", because in that case the
 * engine never measured which grade was the actual wall.
 */
export function buildProblems(
  staffing: { staffedFraction: number; idleReason?: IdleReason } | undefined,
  supply: { inputGate: number; throttledBy: string[] } | undefined,
  popNeed: { satisfaction: number } | undefined,
  inputLabel: (goodId: string) => string,
): ProblemItem[] {
  const items: ProblemItem[] = [];

  const hasBindingReason =
    staffing?.idleReason !== undefined && staffing.idleReason !== "occupancy" && staffing.idleReason !== "inputs";
  let staffingShort = false;
  if (staffing && hasBindingReason) {
    const sev = needSeverity(staffing.staffedFraction);
    if (sev !== "met") {
      staffingShort = true;
      const grade = staffingGradeName(staffing.idleReason);
      items.push({
        kind: "staffing",
        label: `${grade ? `${grade} understaffed` : "Understaffed"} ${Math.round(staffing.staffedFraction * 100)}%`,
        severity: sev,
      });
    }
  }

  const throttled = supply && supply.throttledBy.length > 0 ? supply : undefined;
  if (throttled) {
    const sev = needSeverity(throttled.inputGate);
    for (const input of throttled.throttledBy) {
      items.push({ kind: "input", label: `${inputLabel(input)} ${Math.round(throttled.inputGate * 100)}%`, severity: sev === "met" ? "short" : sev });
    }
  }

  // Glut: the producer is done idling on staffing/input and still isn't using its built capacity —
  // the only remaining reason is the selling ceiling.
  if (!staffingShort && !throttled && staffing?.idleReason === "selling") {
    items.push({ kind: "selling", label: "Glut", severity: "short" });
  }

  if (popNeed) {
    const sev = needSeverity(popNeed.satisfaction);
    if (sev !== "met") items.push({ kind: "pops", label: `pops short ${Math.round(popNeed.satisfaction * 100)}%`, severity: sev });
  }
  return items;
}

/**
 * Glyph for a problem chip: the severity ladder (✓⚠▼) for shortfalls, or `▲` for glut — a state
 * meaning too much rather than too little, which sits outside the shortfall ladder entirely.
 */
export function problemGlyph(item: ProblemItem): string {
  return item.kind === "selling" ? "▲" : SEVERITY_GLYPH[item.severity];
}
