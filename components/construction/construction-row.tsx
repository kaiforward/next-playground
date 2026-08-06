"use client";

import Link from "next/link";
import type { ConstructionProjectRow } from "@/lib/engine/construction-readout";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Badge } from "@/components/ui/badge";
import { formatMagnitude, fractionPct } from "@/lib/utils/format";
import { formatEta } from "@/lib/utils/construction-format";
import { COLONY_STALL_COPY, COLONY_STALL_DETAIL } from "@/lib/types/colonisation";

/**
 * One stat-block construction row (the locked style B): title · detail line · exact full-width
 * progress bar, with a coarse ETA. `showSystem` appends "— <system>" to the title on the faction
 * roll-up (where rows span systems); the per-system section omits it (the system is the page).
 * Player-ordered rows carry an ORDERED badge; `onCancel` (also player-origin gated) adds a cancel
 * button to the detail line.
 *
 * A founding also reports what it is waiting on: money and materials gate its work, so a colony can
 * sit at a standstill while the construction pool is perfectly healthy, and a progress bar alone
 * would read as steady progress.
 */
export function ConstructionRow({
  row,
  showSystem,
  onCancel,
}: {
  row: ConstructionProjectRow;
  showSystem: boolean;
  onCancel?: (projectId: string) => void;
}) {
  const stalled = row.etaCycles === null;
  const baseTitle =
    row.kind === "colony_establish" ? "Establish Colony" : `${row.buildingLabel} ×${row.levels}`;
  const titleText = showSystem ? `${baseTitle} — ${row.systemName}` : baseTitle; // plain, for aria
  const rate = Math.round(row.nextCycleGain * 10) / 10; // 1-dp; avoids "+0/cyc" noise
  const rateText = rate > 0 ? `+${rate}/cyc` : "waiting";

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
        {row.origin === "player" && <Badge color="amber">ORDERED</Badge>}
        {row.kind === "colony_establish" && row.stalledReason !== null && (
          <Badge color="amber">{COLONY_STALL_COPY[row.stalledReason].toUpperCase()}</Badge>
        )}
        <span
          className={`ml-auto font-mono text-[11px] ${stalled ? "text-status-amber-light" : "text-text-secondary"}`}
        >
          {formatEta(row.etaCycles)}
        </span>
      </div>

      <p className="mt-0.5 mb-1 text-xs text-text-secondary">
        <span className="flex items-center gap-2">
          <span>
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
                {" · "}
                <span className="font-mono text-text-primary">{fractionPct(row.stagedFraction)}%</span>
                <span className="text-text-tertiary"> of stores staged</span>
              </>
            ) : (
              row.detail
            )}
          </span>
          {row.origin === "player" && onCancel && (
            <button
              type="button"
              aria-label="Cancel order"
              onClick={() => onCancel(row.id)}
              className="ml-auto px-1.5 text-[11px] text-status-red-light transition-colors hover:text-status-red"
            >
              ✕ Cancel
            </button>
          )}
        </span>
      </p>

      {row.kind === "colony_establish" && (
        <p
          className={`mb-1.5 text-[11px] ${row.stalledReason !== null ? "text-status-amber-light" : "text-text-tertiary"}`}
        >
          {row.stalledReason !== null
            ? COLONY_STALL_DETAIL[row.stalledReason]
            : "On completion: develops, receives seed pop, lands bundled housing."}
        </p>
      )}

      <ProgressBar
        label={rateText}
        value={row.workDone}
        max={row.workTotal}
        valueText={`${Math.round(row.progress * 100)}%`}
        projected={row.nextCycleGain}
        color={stalled ? "amber" : "copper"}
        ariaLabel={`${titleText}: ${Math.round(row.progress * 100)}% complete, ${rateText}`}
      />
    </div>
  );
}
