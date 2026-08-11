import { StatList, StatRow } from "@/components/ui/stat-row";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { occupancyBar, OVERSHOOT_SPAN_PCT, type CrowdChip } from "@/components/system/provision-view";
import { formatHeadcount } from "@/lib/utils/format";

const CROWD_LABEL: Record<CrowdChip, string> = {
  comfortable: "Comfortable",
  crowding: "Crowding",
  braked: "Braked",
};
const CROWD_TONE: Record<CrowdChip, BadgeColor> = {
  comfortable: "green",
  crowding: "amber",
  braked: "red",
};

// The track's total axis — "percent of capacity" from 0 through the growth brake's own overshoot
// ceiling — so the capacity rule sits at the same position for every system regardless of how far
// (if at all) it has overshot, and the housed fill never stretches to fill a track that has no
// overshoot to show.
const TRACK_TOTAL_PCT = 100 + OVERSHOOT_SPAN_PCT;

function OccupancyTrack({ fillPct, overshootPct }: { fillPct: number; overshootPct: number }) {
  const housedWidth = (fillPct / TRACK_TOTAL_PCT) * 100;
  const overshootWidth = (overshootPct / TRACK_TOTAL_PCT) * 100;
  const capacityMark = (100 / TRACK_TOTAL_PCT) * 100;
  return (
    <div className="relative h-2.5 overflow-hidden bg-surface-active">
      <div className="flex h-full">
        <span aria-hidden className="block h-full bg-accent" style={{ width: `${housedWidth}%` }} />
        {overshootWidth > 0 && (
          <span aria-hidden className="block h-full bg-status-amber" style={{ width: `${overshootWidth}%` }} />
        )}
      </div>
      {/* Capacity rule — zero-width span; only its left border paints the tick. */}
      <span
        aria-hidden
        className="absolute -top-0.5 -bottom-0.5 border-l-2 border-text-secondary"
        style={{ left: `${capacityMark}%` }}
      />
    </div>
  );
}

/**
 * Population / capacity / occupancy block as bare inner content (no Card or section header — each
 * consumer frames it). The occupancy bar and crowding chip read `occupancyBar`
 * (`provision-view.ts`) directly, so a `popCap <= 0` system with residents renders a real (0%
 * housed, fully overshot) bar rather than dividing by zero — this component always renders what
 * it's given; the caller decides whether the system is worth an empty state at all.
 */
export function PopulationSummary({
  population,
  popCap,
}: {
  population: number;
  popCap: number;
}) {
  const bar = occupancyBar(population, popCap);
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <StatList className="flex-1">
          <StatRow label="Population">
            <span className="font-mono text-sm text-text-primary">
              {formatHeadcount(population)}
            </span>
          </StatRow>
          <StatRow label="Capacity">
            <span className="font-mono text-sm text-text-primary">
              {formatHeadcount(popCap)}
            </span>
          </StatRow>
        </StatList>
        <Badge color={CROWD_TONE[bar.crowdChip]}>{CROWD_LABEL[bar.crowdChip]}</Badge>
      </div>
      <OccupancyTrack fillPct={bar.fillPct} overshootPct={bar.overshootPct} />
      <div className="flex items-center gap-3 text-xs text-text-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 bg-accent" /> Housed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 bg-status-amber" /> Over capacity
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-0.5 bg-text-secondary" /> Capacity
        </span>
      </div>
    </div>
  );
}
