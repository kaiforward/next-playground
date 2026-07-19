/** Shared needs view-model — severity thresholds, glyphs, ledger split. No DOM, no React. */
export type NeedSeverity = "met" | "short" | "critical";

export function needSeverity(satisfaction: number): NeedSeverity {
  if (satisfaction >= 0.95) return "met";
  if (satisfaction >= 0.5) return "short";
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
