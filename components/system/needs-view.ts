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
 * undefined when the binding constraint isn't a named labour grade. That covers "selling" and
 * "inputs" alike: when either binds tighter than labour the engine never computes *which* grade was
 * the wall (see `buildIndustryReadout`'s idleReason branch, `industry.ts:790-804` — the
 * skill1/skill2/labour branches only run when selling and inputs do NOT bind tightest), so naming
 * one we didn't measure would be worse than staying generic. Callers fall back to a plain
 * "Understaffed" chip in both cases.
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
 * A row shows a chip for every negative state it is in, not only for the one the engine named as
 * tightest — an input-starved producer that is ALSO understaffed carries both its input chips and an
 * understaffed chip.
 *
 * That is what keying staffing off the *severity number* (`staffedFraction`) rather than off
 * `idleReason` naming a labour grade buys. `idleReason` is a single binding constraint: it reads
 * "selling" whenever selling binds tighter than labour (`canSell < fulfil` at `industry.ts:797`) and
 * "inputs" whenever a recipe input binds tighter still (`industry.ts:842`), in both cases while the
 * producer may be just as short on labour. `staffedFraction` is independent of both — for a producer
 * row it is the pure staffing ratio (`industry.ts:769-772`), which neither a glut nor an empty input
 * yard moves — so gating the staffing item on "idleReason is a labour reason" would let an
 * understaffed-and-glutting or understaffed-and-starved producer read with no understaffed chip at
 * all.
 *
 * Any binding reason can therefore gate a staffing item except "occupancy" and `undefined`.
 * `undefined` is a capacity/modifier row with nothing binding. "occupancy" is housing, the one row
 * whose `staffedFraction` is not a staffing ratio at all but literal occupancy
 * (`housingUsed(population) / count`, `industry.ts:785`) — homes draw no staff, so a half-empty
 * colony's housing would read "Understaffed 40%" for having spare rooms. `idleReason` is then only
 * used to *name the grade*, via `staffingGradeName` — which falls back to a generic "Understaffed"
 * chip for "selling" and "inputs", because in those cases the engine never measured which grade was
 * the actual wall.
 *
 * Precedence (spec §1/§6): understaffed classifies first — only a producer that is both fully
 * staffed and input-satisfied can read Glut.
 */
export function buildProblems(
  staffing: { staffedFraction: number; idleReason?: IdleReason } | undefined,
  supply: { inputGate: number; throttledBy: string[] } | undefined,
  popNeed: { satisfaction: number } | undefined,
  inputLabel: (goodId: string) => string,
): ProblemItem[] {
  const items: ProblemItem[] = [];

  const hasBindingReason =
    staffing?.idleReason !== undefined && staffing.idleReason !== "occupancy";
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
