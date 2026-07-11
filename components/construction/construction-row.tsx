"use client";

import Link from "next/link";
import type { ConstructionProjectRow } from "@/lib/engine/construction-readout";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatMagnitude } from "@/lib/utils/format";
import { formatEta } from "@/lib/utils/construction-format";

/**
 * One stat-block construction row (the locked style B): title · detail line · exact full-width
 * progress bar, with a coarse ETA. `showSystem` appends "— <system>" to the title on the faction
 * roll-up (where rows span systems); the per-system section omits it (the system is the page).
 */
export function ConstructionRow({ row, showSystem }: { row: ConstructionProjectRow; showSystem: boolean }) {
  const stalled = row.etaPulses === null;
  const suffix = showSystem ? ` — ${row.systemName}` : "";
  const title =
    row.kind === "colony_establish"
      ? `Establish Colony${suffix}`
      : `${row.buildingLabel} ×${row.levels}${suffix}`;

  return (
    <div className="border-b border-border/40 py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-sm text-text-primary">{title}</span>
        <span
          className={`ml-auto font-mono text-[11px] ${stalled ? "text-status-amber-light" : "text-text-secondary"}`}
        >
          {formatEta(row.etaPulses)}
        </span>
      </div>

      <p className="mt-0.5 mb-1 text-xs text-text-secondary">
        {row.kind === "colony_establish" ? (
          <>
            seed <span className="font-mono text-text-primary">{formatMagnitude(row.seedPop)}</span> pop ·{" "}
            <span className="font-mono text-text-primary">{row.housingLevels}</span> housing bundled ·{" "}
            <span className="text-text-tertiary">from </span>
            <Link
              href={`/system/${row.sourceSystemId}`}
              className="text-text-accent hover:text-text-accent-hover transition-colors"
            >
              {row.sourceSystemName}
            </Link>
          </>
        ) : (
          row.detail
        )}
      </p>

      {row.kind === "colony_establish" && (
        <p className="mb-1.5 text-[11px] text-text-tertiary">
          On completion: develops, receives seed pop, lands bundled housing.
        </p>
      )}

      <ProgressBar
        label=""
        value={row.workDone}
        max={row.workTotal}
        valueText={`${Math.round(row.progress * 100)}%`}
        color={stalled ? "amber" : "copper"}
        ariaLabel={`${title}: ${Math.round(row.progress * 100)}% complete`}
      />
    </div>
  );
}
