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
  const baseTitle =
    row.kind === "colony_establish" ? "Establish Colony" : `${row.buildingLabel} ×${row.levels}`;
  const titleText = showSystem ? `${baseTitle} — ${row.systemName}` : baseTitle; // plain, for aria
  const rate = Math.round(row.nextPulseGain * 10) / 10; // 1-dp; avoids "+0/pulse" noise
  const rateText = rate > 0 ? `+${rate}/pulse` : "waiting";

  return (
    <div className="border-b border-border/40 py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-sm text-text-primary">
          {baseTitle}
          {showSystem && (
            <>
              {" — "}
              <Link
                href={`/system/${row.systemId}`}
                className="text-text-accent hover:text-text-accent-hover transition-colors"
              >
                {row.systemName}
              </Link>
            </>
          )}
        </span>
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
        label={rateText}
        value={row.workDone}
        max={row.workTotal}
        valueText={`${Math.round(row.progress * 100)}%`}
        projected={row.nextPulseGain}
        color={stalled ? "amber" : "copper"}
        ariaLabel={`${titleText}: ${Math.round(row.progress * 100)}% complete, ${rateText}`}
      />
    </div>
  );
}
