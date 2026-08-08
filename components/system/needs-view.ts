/** Shared needs view-model — severity thresholds, glyphs, ledger split. No DOM, no React. */
import { SHORTAGE_SATISFACTION } from "@/lib/constants/economy";

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

export interface ProblemItem { kind: "input" | "pops"; label: string; severity: NeedSeverity }

/** Exception-reporting: items exist only for actual problems; a healthy row returns []. */
export function buildProblems(
  supply: { inputGate: number; throttledBy: string[] } | undefined,
  popNeed: { satisfaction: number } | undefined,
  inputLabel: (goodId: string) => string,
): ProblemItem[] {
  const items: ProblemItem[] = [];
  if (supply && supply.throttledBy.length > 0) {
    const sev = needSeverity(supply.inputGate);
    for (const input of supply.throttledBy) {
      items.push({ kind: "input", label: `${inputLabel(input)} ${Math.round(supply.inputGate * 100)}%`, severity: sev === "met" ? "short" : sev });
    }
  }
  if (popNeed) {
    const sev = needSeverity(popNeed.satisfaction);
    if (sev !== "met") items.push({ kind: "pops", label: `pops short ${Math.round(popNeed.satisfaction * 100)}%`, severity: sev });
  }
  return items;
}
