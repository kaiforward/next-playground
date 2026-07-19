/**
 * Shared Need / Met / Want / Delivered table markup — the Population tab's needs
 * ledger and the Industry pop-pressure chip tooltip render the same columns at
 * two densities. Callers own the `<tr>` wrappers (the ledger adds per-row
 * tooltips, focus and an expand tail; the chip body is static).
 */
import type { ReactNode } from "react";
import type { PopNeedData } from "@/lib/types/api";
import { needSeverity, SEVERITY_GLYPH, SEVERITY_TEXT } from "@/components/system/needs-view";

export type NeedsTableDensity = "panel" | "tooltip";

const DENSITY: Record<NeedsTableDensity, { th: string; name: string; glyph: string; value: string }> = {
  panel: {
    th: "border-b border-border-strong px-1.5 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary",
    name: "px-1.5 py-1 text-xs text-text-primary",
    glyph: "mr-1.5 font-mono text-[10px]",
    value: "px-1.5 py-1 text-right font-mono text-[11px]",
  },
  tooltip: {
    th: "border-b border-border/60 px-1 py-0.5 font-display text-[9px] font-semibold uppercase tracking-wider text-text-tertiary",
    name: "px-1 py-0.5 text-text-primary",
    glyph: "mr-1 font-mono text-[9px]",
    value: "px-1 py-0.5 text-right font-mono",
  },
};

const HEADERS = ["Need", "Met", "Want", "Delivered"] as const;

/** One need's four cells — severity glyph + name, % met, want, delivered. */
export function NeedCells({ n, density }: { n: PopNeedData; density: NeedsTableDensity }) {
  const d = DENSITY[density];
  const sev = needSeverity(n.satisfaction);
  return (
    <>
      <td className={d.name}>
        <span aria-label={sev} className={`${d.glyph} ${SEVERITY_TEXT[sev]}`}>{SEVERITY_GLYPH[sev]}</span>
        {n.goodName}
      </td>
      <td className={`${d.value} ${SEVERITY_TEXT[sev]}`}>{Math.round(n.satisfaction * 100)}%</td>
      <td className={`${d.value} text-text-secondary`}>{n.want.toFixed(1)}</td>
      <td className={`${d.value} text-text-secondary`}>{n.delivered.toFixed(1)}</td>
    </>
  );
}

/** The table scaffold — header row + caller-provided body rows. */
export function NeedsTable({ density, children }: { density: NeedsTableDensity; children: ReactNode }) {
  const d = DENSITY[density];
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {HEADERS.map((h, i) => (
            <th key={h} className={`${d.th} ${i > 0 ? "text-right" : "text-left"}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
